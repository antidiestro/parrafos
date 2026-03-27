import { extractArticleMetadata } from "@/lib/extract/article-candidates";
import { fetchHtmlWithRetries } from "@/lib/extract/fetch";
import { appendRunEvent } from "@/lib/runs/persistence/events-repo";
import {
  RUN_RECENCY_WINDOW_MEDIUM_HOURS,
} from "@/lib/runs/constants";
import {
  completeRunStage,
  startRunStage,
} from "@/lib/runs/persistence/stages-repo";
import type { ProcessRunContext } from "@/lib/runs/process/context";
import {
  errorToMessage,
  isRunCancelled,
  type PrefetchedArticle,
  toCanonicalUrl,
  updateRunProgress,
} from "@/lib/runs/process/shared";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

type ExistingArticleMetadata = {
  canonicalUrl: string;
  title: string | null;
  publishedAt: string | null;
  sourceUrl: string;
};

const EXISTING_ARTICLE_BATCH_SIZE = 200;

function candidateCanonicalUrl(url: string): string {
  return toCanonicalUrl(url, url) ?? url;
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  if (items.length === 0) return [];
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

function isPublishedWithinHours(
  publishedAt: string | null,
  nowMs: number,
  windowHours: number,
): boolean {
  if (!publishedAt) return false;
  const ts = +new Date(publishedAt);
  if (!Number.isFinite(ts)) return false;
  const delta = nowMs - ts;
  if (delta < 0) return false;
  return delta <= windowHours * 60 * 60 * 1000;
}

async function loadExistingArticleMetadataByCandidate(
  articles: ProcessRunContext["metadata"]["articles"],
): Promise<Map<string, ExistingArticleMetadata>> {
  const supabase = createSupabaseServiceClient();
  const canonicalUrlSet = new Set<string>();

  for (const article of articles) {
    const canonicalUrl = candidateCanonicalUrl(article.url);
    canonicalUrlSet.add(canonicalUrl);
  }

  const existingByCanonicalUrl = new Map<string, ExistingArticleMetadata>();
  const canonicalUrls = Array.from(canonicalUrlSet);
  for (const canonicalUrlChunk of chunkArray(
    canonicalUrls,
    EXISTING_ARTICLE_BATCH_SIZE,
  )) {
    const { data, error } = await supabase
      .from("articles")
      .select("canonical_url,title,published_at,source_url")
      .in("canonical_url", canonicalUrlChunk);

    if (error) throw new Error(error.message);

    for (const row of data ?? []) {
      existingByCanonicalUrl.set(row.canonical_url, {
        canonicalUrl: row.canonical_url,
        title: row.title,
        publishedAt: row.published_at,
        sourceUrl: row.source_url ?? row.canonical_url,
      });
    }
  }

  return existingByCanonicalUrl;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  perKeyConcurrency: number,
  keyForItem: (item: T, index: number) => string,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];

  const results: R[] = new Array(items.length);
  const maxGlobalConcurrency = Math.max(1, Math.min(concurrency, items.length));
  const maxPerKeyConcurrency = Math.max(1, perKeyConcurrency);

  const queuedByKey = new Map<string, number[]>();
  const keyOrder: string[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const key = keyForItem(items[index], index);
    const existing = queuedByKey.get(key);
    if (existing) {
      existing.push(index);
    } else {
      queuedByKey.set(key, [index]);
      keyOrder.push(key);
    }
  }

  const inFlightByKey = new Map<string, number>();
  let active = 0;
  let completed = 0;
  let roundRobinCursor = 0;
  let settled = false;

  return await new Promise<R[]>((resolve, reject) => {
    const schedule = () => {
      if (settled) return;
      if (completed >= items.length) {
        settled = true;
        resolve(results);
        return;
      }

      while (active < maxGlobalConcurrency) {
        let selectedKey: string | null = null;
        for (let offset = 0; offset < keyOrder.length; offset += 1) {
          const key = keyOrder[(roundRobinCursor + offset) % keyOrder.length];
          const queue = queuedByKey.get(key);
          if (!queue || queue.length === 0) continue;
          const keyInFlight = inFlightByKey.get(key) ?? 0;
          if (keyInFlight >= maxPerKeyConcurrency) continue;
          selectedKey = key;
          roundRobinCursor = (roundRobinCursor + offset + 1) % keyOrder.length;
          break;
        }

        if (!selectedKey) break;
        const queue = queuedByKey.get(selectedKey);
        const nextIndex = queue?.shift();
        if (typeof nextIndex !== "number") {
          continue;
        }

        active += 1;
        inFlightByKey.set(
          selectedKey,
          (inFlightByKey.get(selectedKey) ?? 0) + 1,
        );

        void mapper(items[nextIndex], nextIndex)
          .then((value) => {
            results[nextIndex] = value;
          })
          .catch((error) => {
            if (!settled) {
              settled = true;
              reject(error);
            }
          })
          .finally(() => {
            active -= 1;
            completed += 1;
            inFlightByKey.set(
              selectedKey,
              Math.max(0, (inFlightByKey.get(selectedKey) ?? 1) - 1),
            );
            schedule();
          });
      }
    };

    schedule();
  });
}

export async function runPrefetchMetadataStage(
  context: ProcessRunContext,
): Promise<void> {
  const { runId, metadata, extractConcurrency } = context;
  const prefetchPerHostConcurrency = 1;
  const prefetchStageAttempt = await startRunStage(runId, "prefetch_metadata");
  await appendRunEvent({
    runId,
    stage: "prefetch_metadata",
    eventType: "stage_started",
    message: "Metadata prefetch stage started",
  });
  const existingByCanonicalUrl = await loadExistingArticleMetadataByCandidate(
    metadata.articles,
  );

  const metadataReadyCandidates = await mapWithConcurrency(
    metadata.articles,
    extractConcurrency,
    prefetchPerHostConcurrency,
    (article) => {
      try {
        return new URL(article.url).host.toLowerCase();
      } catch {
        return `publisher:${article.publisher_id}`;
      }
    },
    async (article): Promise<PrefetchedArticle | null> => {
      if (await isRunCancelled(runId)) return null;
      const existing = existingByCanonicalUrl.get(
        candidateCanonicalUrl(article.url),
      );

      if (existing) {
        article.canonical_url = existing.canonicalUrl;
        article.title = existing.title;
        article.published_at = existing.publishedAt;
        article.status = "metadata_ready";
        article.error_message = null;
        await updateRunProgress(runId, { metadata });

        const publisher = metadata.publishers.find(
          (entry) => entry.publisher_id === article.publisher_id,
        );
        return {
          publisherId: article.publisher_id,
          publisherName: publisher?.publisher_name ?? article.publisher_id,
          url: article.url,
          canonicalUrl: existing.canonicalUrl,
          title: existing.title,
          description: null,
          publishedAt: existing.publishedAt,
          sourceUrl: existing.sourceUrl,
          html: "",
        };
      }

      article.status = "metadata_fetching";
      article.error_message = null;
      await updateRunProgress(runId, { metadata });

      try {
        const articleRes = await fetchHtmlWithRetries(article.url, {
          retries: 0,
        });
        const metadataResult = extractArticleMetadata(
          articleRes.finalUrl,
          articleRes.html,
        );
        if (!metadataResult) {
          article.status = "not_selected_for_extraction";
          article.error_message =
            "Discarded: missing Article/NewsArticle JSON-LD and no article:published_time meta.";
          await updateRunProgress(runId, { metadata });
          return null;
        }
        const canonicalUrl =
          toCanonicalUrl(
            metadataResult.canonicalUrl ?? articleRes.finalUrl,
            articleRes.finalUrl,
          ) ?? article.url;
        article.canonical_url = canonicalUrl;
        article.title = metadataResult.title ?? null;
        article.published_at = metadataResult.publishedAt ?? null;
        article.status = "metadata_ready";
        article.error_message = null;
        await updateRunProgress(runId, { metadata });

        const publisher = metadata.publishers.find(
          (entry) => entry.publisher_id === article.publisher_id,
        );
        return {
          publisherId: article.publisher_id,
          publisherName: publisher?.publisher_name ?? article.publisher_id,
          url: article.url,
          canonicalUrl,
          title: article.title,
          description: metadataResult.description,
          publishedAt: article.published_at,
          sourceUrl: articleRes.finalUrl,
          html: articleRes.html,
        };
      } catch (error) {
        article.status = "failed";
        article.error_message =
          errorToMessage(error) ?? "Metadata fetch failed";
        metadata.errors.push({
          publisher_id: article.publisher_id,
          url: article.url,
          message: errorToMessage(error) ?? "Metadata fetch failed",
        });
        await updateRunProgress(runId, { metadata });
        return null;
      }
    },
  );

  const nowMs = Date.now();
  const recentMetadataCandidates: PrefetchedArticle[] = [];
  for (const candidate of metadataReadyCandidates) {
    if (!candidate) continue;
    if (
      isPublishedWithinHours(
        candidate.publishedAt,
        nowMs,
        RUN_RECENCY_WINDOW_MEDIUM_HOURS,
      )
    ) {
      recentMetadataCandidates.push(candidate);
      continue;
    }

    const articleProgress = metadata.articles.find(
      (entry) =>
        entry.publisher_id === candidate.publisherId && entry.url === candidate.url,
    );
    if (articleProgress) {
      articleProgress.status = "not_selected_for_extraction";
      articleProgress.error_message = candidate.publishedAt
        ? `Discarded: published more than ${RUN_RECENCY_WINDOW_MEDIUM_HOURS}h ago before clustering.`
        : "Discarded: missing valid published_at metadata before clustering.";
    }
  }
  await updateRunProgress(runId, { metadata });

  context.prefetchedByCandidateKey.clear();
  for (const candidate of recentMetadataCandidates) {
    context.prefetchedByCandidateKey.set(
      `${candidate.publisherId}::${candidate.url}`,
      candidate,
    );
  }
  context.identifiedCandidates = recentMetadataCandidates.map((candidate) => ({
      publisherId: candidate.publisherId,
      publisherName: candidate.publisherName,
      url: candidate.url,
      canonicalUrl: candidate.canonicalUrl,
      title: candidate.title,
      description: candidate.description,
      publishedAt: candidate.publishedAt,
    }));

  await completeRunStage(runId, "prefetch_metadata", prefetchStageAttempt);
  await appendRunEvent({
    runId,
    stage: "prefetch_metadata",
    eventType: "stage_completed",
    message: "Metadata prefetch stage completed",
  });
}
