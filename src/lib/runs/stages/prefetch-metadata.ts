import { extractArticleMetadata } from "@/lib/extract/article-candidates";
import { fetchHtmlWithRetries } from "@/lib/extract/fetch";
import {
  RUN_RECENCY_WINDOW_MEDIUM_HOURS,
} from "@/lib/runs/constants";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { divider, logLine } from "@/lib/runs/console/logging";
import type {
  CandidateSource,
  PrefetchedArticle,
} from "@/lib/runs/console/types";
import {
  chunkCanonicalUrlsForLookup,
  isPublishedWithinHours,
  mapWithConcurrency,
  toCanonicalUrl,
} from "@/lib/runs/console/utils";

async function loadExistingMetadataByCanonical(
  canonicalUrls: string[],
): Promise<
  Map<
    string,
    {
      canonicalUrl: string;
      title: string | null;
      publishedAt: string | null;
      sourceUrl: string;
    }
  >
> {
  logLine("prefetch: load existing metadata started", {
    candidateCanonicalUrls: canonicalUrls.length,
  });
  const supabase = createSupabaseServiceClient();
  const out = new Map<
    string,
    {
      canonicalUrl: string;
      title: string | null;
      publishedAt: string | null;
      sourceUrl: string;
    }
  >();

  const unique = Array.from(new Set(canonicalUrls));
  const chunks = chunkCanonicalUrlsForLookup(unique);
  logLine("prefetch: existing metadata lookup plan", {
    uniqueCanonicalUrls: unique.length,
    chunks: chunks.length,
  });
  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    logLine("prefetch: existing metadata lookup chunk started", {
      chunkIndex: i + 1,
      chunkCount: chunks.length,
      chunkSize: chunk.length,
      encodedChars: chunk.reduce((acc, url) => acc + encodeURIComponent(url).length, 0),
    });
    const { data, error } = await supabase
      .from("articles")
      .select("canonical_url,title,published_at,source_url")
      .in("canonical_url", chunk);
    if (error) {
      logLine("prefetch: existing metadata lookup chunk failed", {
        chunkIndex: i + 1,
        chunkCount: chunks.length,
        chunkSize: chunk.length,
        canonicalUrlSample: chunk.slice(0, 5),
        error: {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint,
          status: (error as { status?: number }).status,
        },
      });
      throw new Error(
        `Existing metadata lookup failed (chunk ${i + 1}/${chunks.length}, size ${chunk.length}): ${error.message}`,
      );
    }
    for (const row of data ?? []) {
      out.set(row.canonical_url, {
        canonicalUrl: row.canonical_url,
        title: row.title,
        publishedAt: row.published_at,
        sourceUrl: row.source_url ?? row.canonical_url,
      });
    }
    logLine("prefetch: existing metadata lookup chunk completed", {
      chunkIndex: i + 1,
      rowsReturned: (data ?? []).length,
    });
  }
  logLine("prefetch: load existing metadata completed", {
    matchedCanonicalUrls: out.size,
  });
  return out;
}

export async function prefetchMetadata(input: {
  discovered: CandidateSource[];
  concurrency: number;
}): Promise<{
  prefetchedByKey: Map<string, PrefetchedArticle>;
  metadataReadyRecent: CandidateSource[];
}> {
  divider("prefetch_metadata");
  const canonicalUrls = input.discovered.map((c) => c.canonicalUrl);
  const existingByCanonical = await loadExistingMetadataByCanonical(canonicalUrls);
  logLine("prefetch: existing metadata cache loaded", {
    matchedCanonicalUrls: existingByCanonical.size,
  });

  const nowMs = Date.now();
  const prefetchedByKey = new Map<string, PrefetchedArticle>();
  const prefetched = await mapWithConcurrency(
    input.discovered,
    input.concurrency,
    async (candidate, index): Promise<PrefetchedArticle | null> => {
      if ((index + 1) % 25 === 0 || index === 0) {
        logLine("prefetch: progress", {
          processed: index + 1,
          total: input.discovered.length,
        });
      }
      const existing = existingByCanonical.get(candidate.canonicalUrl);
      if (existing) {
        const row: PrefetchedArticle = {
          ...candidate,
          canonicalUrl: existing.canonicalUrl,
          title: existing.title,
          publishedAt: existing.publishedAt,
          sourceUrl: existing.sourceUrl,
          html: "",
        };
        if (
          !isPublishedWithinHours(
            row.publishedAt,
            nowMs,
            RUN_RECENCY_WINDOW_MEDIUM_HOURS,
          )
        ) {
          return null;
        }
        return row;
      }

      try {
        const articleRes = await fetchHtmlWithRetries(candidate.url, { retries: 0 });
        const extracted = extractArticleMetadata(articleRes.finalUrl, articleRes.html);
        if (!extracted) return null;
        const canonicalUrl =
          toCanonicalUrl(
            extracted.canonicalUrl ?? articleRes.finalUrl,
            articleRes.finalUrl,
          ) ?? candidate.canonicalUrl;
        const row: PrefetchedArticle = {
          ...candidate,
          canonicalUrl,
          title: extracted.title,
          description: extracted.description,
          publishedAt: extracted.publishedAt,
          sourceUrl: articleRes.finalUrl,
          html: articleRes.html,
        };
        if (
          !isPublishedWithinHours(
            row.publishedAt,
            nowMs,
            RUN_RECENCY_WINDOW_MEDIUM_HOURS,
          )
        ) {
          return null;
        }
        return row;
      } catch (error) {
        logLine("prefetch: candidate failed", {
          url: candidate.url,
          publisherId: candidate.publisherId,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    },
  );

  const metadataReadyRecent = prefetched
    .filter((row): row is PrefetchedArticle => Boolean(row))
    .map((row) => ({
      publisherId: row.publisherId,
      publisherName: row.publisherName,
      url: row.url,
      canonicalUrl: row.canonicalUrl,
      title: row.title,
      description: row.description,
      publishedAt: row.publishedAt,
    }));

  for (const row of prefetched) {
    if (!row) continue;
    prefetchedByKey.set(`${row.publisherId}::${row.url}`, row);
  }

  logLine("prefetch_metadata: done", {
    metadataReadyRecent: metadataReadyRecent.length,
    discarded: input.discovered.length - metadataReadyRecent.length,
  });

  return { prefetchedByKey, metadataReadyRecent };
}
