import { z } from "zod";
import type { Json } from "@/database.types";
import { listPublishers } from "@/lib/data/publishers";
import { fetchHtmlWithRetries } from "@/lib/extract/fetch";
import { cleanHtmlForLLM } from "@/lib/extract/html";
import { generateGeminiJson } from "@/lib/gemini/generate";
import {
  RUN_CLUSTER_MODEL,
  RUN_EXTRACT_MODEL,
  RUN_RELEVANCE_MODEL,
} from "@/lib/runs/constants";
import {
  createInitialRunMetadata,
  type RunMetadata,
} from "@/lib/runs/progress";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

const MIN_SOURCES_PER_CLUSTER = 3;
const MAX_RELEVANT_STORIES = 8;

type CandidateSource = {
  publisherId: string;
  publisherName: string;
  url: string;
  canonicalUrl: string;
  title: string | null;
  publishedAt: string | null;
};

type ExtractedArticle = CandidateSource & {
  sourceUrl: string;
  bodyText: string;
};

type PersistedCluster = {
  id: string;
  title: string;
  summary: string | null;
  status: "clustered" | "eligible" | "selected" | "discarded_low_sources" | "not_selected";
  sourceCount: number;
  sourceKeys: string[];
};

function toClusterStatus(
  value: string,
): PersistedCluster["status"] {
  if (
    value === "clustered" ||
    value === "eligible" ||
    value === "selected" ||
    value === "discarded_low_sources" ||
    value === "not_selected"
  ) {
    return value;
  }
  return "clustered";
}

const articleListSchema = z.object({
  articles: z
    .array(
      z.object({
        title: z.string().trim().min(1).optional(),
        published_at: z.string().trim().min(1).nullable().optional(),
        url: z.string().trim().min(1),
      }),
    )
    .max(20),
});

const clusterSchema = z.object({
  stories: z.array(
    z.object({
      title: z.string().trim().min(1),
      summary: z.string().trim().min(1).nullable().optional(),
      source_keys: z.array(z.string().trim().min(1)).min(1).max(100),
    }),
  ),
});

const clusterResponseJsonSchema = {
  type: "object",
  properties: {
    stories: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          summary: { type: "string" },
          source_keys: { type: "array", items: { type: "string" } },
        },
        required: ["title", "source_keys"],
      },
    },
  },
  required: ["stories"],
};

const articleDetailsSchema = z.object({
  canonical_url: z.string().trim().min(1).nullable().optional(),
  title: z.string().trim().min(1).nullable().optional(),
  published_at: z.string().trim().min(1).nullable().optional(),
  body_text: z.string().trim().min(1),
});

const relevantStoriesSchema = z.object({
  selected_cluster_ids: z.array(z.string().trim().min(1)).max(MAX_RELEVANT_STORIES),
  selection_notes: z.string().trim().min(1).nullable().optional(),
});

const relevantStoriesResponseJsonSchema = {
  type: "object",
  properties: {
    selected_cluster_ids: {
      type: "array",
      items: { type: "string" },
      maxItems: MAX_RELEVANT_STORIES,
    },
    selection_notes: { type: "string" },
  },
  required: ["selected_cluster_ids"],
};

function toCanonicalUrl(raw: string, baseUrl: string): string | null {
  try {
    const url = new URL(raw, baseUrl);
    url.hash = "";
    const removable = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "fbclid",
      "gclid",
    ];
    for (const key of removable) {
      url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return null;
  }
}

function toTimestampOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function getExtractConcurrency(): number {
  const raw = process.env.RUN_EXTRACT_CONCURRENCY;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 5;
  }
  return Math.min(parsed, 20);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) {
        return;
      }
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

async function updateRunProgress(
  runId: string,
  patch: {
    status?: "running" | "completed" | "failed" | "cancelled";
    ended_at?: string;
    error_message?: string | null;
    metadata: RunMetadata;
  },
) {
  const supabase = createSupabaseServiceClient();
  await supabase
    .from("runs")
    .update({
      status: patch.status,
      ended_at: patch.ended_at,
      error_message: patch.error_message ?? null,
      metadata: patch.metadata as Json,
    })
    .eq("id", runId);
}

async function isRunCancelled(runId: string): Promise<boolean> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("runs")
    .select("status")
    .eq("id", runId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return data?.status === "cancelled";
}

async function extractArticleUrls(
  homeUrl: string,
  cleanedHtml: string,
): Promise<{ title?: string; published_at?: string | null; url: string }[]> {
  const result = await generateGeminiJson(
    [
      "You extract article links from a publisher homepage.",
      'Return JSON object: {"articles":[{"title":"...","published_at":"...","url":"..."}]}',
      "Only include news article URLs, at most 20 items.",
      "Include published_at when visible in the homepage content, else null.",
      `Homepage URL: ${homeUrl}`,
      "HTML:",
      cleanedHtml,
    ].join("\n"),
    articleListSchema,
    { model: RUN_EXTRACT_MODEL },
  );
  return result.articles.slice(0, 20);
}

async function extractArticleDetails(url: string, cleanedHtml: string) {
  return generateGeminiJson(
    [
      "Extract article details from this HTML.",
      "Return JSON object with keys: canonical_url, title, published_at, body_text.",
      "published_at must be ISO-8601 datetime when possible, else null.",
      "body_text must be the full article text, no summaries.",
      `Article URL: ${url}`,
      "HTML:",
      cleanedHtml,
    ].join("\n"),
    articleDetailsSchema,
    { model: RUN_EXTRACT_MODEL },
  );
}

function sourceKeyFor(publisherId: string, canonicalUrl: string) {
  return `${publisherId}::${canonicalUrl}`;
}

async function clusterCandidatesIntoStories(candidates: CandidateSource[]) {
  const input = candidates.map((candidate) => ({
    source_key: sourceKeyFor(candidate.publisherId, candidate.canonicalUrl),
    publisher_id: candidate.publisherId,
    publisher_name: candidate.publisherName,
    url: candidate.url,
    canonical_url: candidate.canonicalUrl,
    title: candidate.title,
    published_at: candidate.publishedAt,
  }));

  const response = await generateGeminiJson(
    [
      "Cluster these article sources into stories they are covering.",
      "Each source_key can appear in at most one story.",
      "Use as many story clusters as needed to cover all available sources.",
      "Return JSON object with key stories, each with title, optional summary, and source_keys.",
      "Candidate sources:",
      JSON.stringify(input),
    ].join("\n"),
    clusterSchema,
    {
      model: RUN_CLUSTER_MODEL,
      nativeStructuredOutput: {
        responseSchema: clusterResponseJsonSchema,
      },
    },
  );

  const availableKeys = new Set(
    candidates.map((c) => sourceKeyFor(c.publisherId, c.canonicalUrl)),
  );
  const usedKeys = new Set<string>();
  const stories: { title: string; summary: string | null; sourceKeys: string[] }[] = [];

  for (const story of response.stories) {
    const sourceKeys: string[] = [];
    for (const key of story.source_keys) {
      if (!availableKeys.has(key)) {
        continue;
      }
      if (usedKeys.has(key)) {
        continue;
      }
      usedKeys.add(key);
      sourceKeys.push(key);
    }
    if (sourceKeys.length > 0) {
      stories.push({
        title: story.title,
        summary: story.summary ?? null,
        sourceKeys,
      });
    }
  }

  // Ensure all sources belong to some story cluster.
  for (const candidate of candidates) {
    const key = sourceKeyFor(candidate.publisherId, candidate.canonicalUrl);
    if (usedKeys.has(key)) continue;
    usedKeys.add(key);
    stories.push({
      title: candidate.title ?? candidate.canonicalUrl,
      summary: "Unclustered source fallback cluster.",
      sourceKeys: [key],
    });
  }

  return stories;
}

async function clearPersistedRunClusters(runId: string) {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("run_story_clusters")
    .delete()
    .eq("run_id", runId);
  if (error) throw new Error(error.message);
}

async function persistClusters(
  runId: string,
  stories: { title: string; summary: string | null; sourceKeys: string[] }[],
  sourceByKey: Map<string, CandidateSource>,
) {
  const supabase = createSupabaseServiceClient();
  const persisted: PersistedCluster[] = [];

  for (const story of stories) {
    const { data: insertedCluster, error: clusterError } = await supabase
      .from("run_story_clusters")
      .insert({
        run_id: runId,
        title: story.title,
        summary: story.summary,
        status: "clustered",
        source_count: story.sourceKeys.length,
      })
      .select("id,title,summary,status,source_count")
      .single();
    if (clusterError || !insertedCluster) {
      throw new Error(clusterError?.message ?? "Unable to persist story cluster");
    }

    const sources = story.sourceKeys
      .map((key) => {
        const source = sourceByKey.get(key);
        if (!source) return null;
        return {
          cluster_id: insertedCluster.id,
          run_id: runId,
          publisher_id: source.publisherId,
          url: source.url,
          canonical_url: source.canonicalUrl,
          title: source.title,
          published_at: source.publishedAt,
        };
      })
      .filter((value): value is NonNullable<typeof value> => Boolean(value));

    if (sources.length > 0) {
      const { error: sourceError } = await supabase
        .from("run_story_cluster_sources")
        .insert(sources);
      if (sourceError) {
        throw new Error(sourceError.message);
      }
    }

    persisted.push({
      id: insertedCluster.id,
      title: insertedCluster.title,
      summary: insertedCluster.summary,
      status: toClusterStatus(insertedCluster.status),
      sourceCount: insertedCluster.source_count,
      sourceKeys: story.sourceKeys,
    });
  }

  return persisted;
}

async function markEligibleClusters(
  runId: string,
  clusters: PersistedCluster[],
): Promise<PersistedCluster[]> {
  const supabase = createSupabaseServiceClient();
  const next: PersistedCluster[] = [];
  for (const cluster of clusters) {
    const status =
      cluster.sourceCount >= MIN_SOURCES_PER_CLUSTER
        ? "eligible"
        : "discarded_low_sources";
    const { error } = await supabase
      .from("run_story_clusters")
      .update({ status })
      .eq("id", cluster.id)
      .eq("run_id", runId);
    if (error) throw new Error(error.message);
    next.push({ ...cluster, status });
  }
  return next;
}

async function selectRelevantStories(clusters: PersistedCluster[]) {
  if (clusters.length === 0) return new Set<string>();
  const input = clusters.map((cluster) => ({
    cluster_id: cluster.id,
    title: cluster.title,
    summary: cluster.summary,
    source_count: cluster.sourceCount,
  }));

  const response = await generateGeminiJson(
    [
      "Choose the most relevant stories for extraction.",
      `Return up to ${MAX_RELEVANT_STORIES} cluster IDs as selected_cluster_ids.`,
      "Focus on high-impact and broadly relevant stories.",
      "Stories:",
      JSON.stringify(input),
    ].join("\n"),
    relevantStoriesSchema,
    {
      model: RUN_RELEVANCE_MODEL,
      nativeStructuredOutput: {
        responseSchema: relevantStoriesResponseJsonSchema,
      },
    },
  );

  const eligibleIds = new Set(clusters.map((cluster) => cluster.id));
  const selected = new Set<string>();
  for (const clusterId of response.selected_cluster_ids) {
    if (!eligibleIds.has(clusterId)) continue;
    selected.add(clusterId);
    if (selected.size >= MAX_RELEVANT_STORIES) break;
  }
  return selected;
}

async function updateClusterSelectionStatuses(
  runId: string,
  eligibleClusters: PersistedCluster[],
  selectedClusterIds: Set<string>,
) {
  const supabase = createSupabaseServiceClient();
  for (const cluster of eligibleClusters) {
    const status = selectedClusterIds.has(cluster.id) ? "selected" : "not_selected";
    const { error } = await supabase
      .from("run_story_clusters")
      .update({ status })
      .eq("id", cluster.id)
      .eq("run_id", runId);
    if (error) throw new Error(error.message);
  }
}

async function articleExists(
  publisherId: string,
  canonicalUrl: string,
): Promise<boolean> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("articles")
    .select("id")
    .eq("publisher_id", publisherId)
    .eq("canonical_url", canonicalUrl)
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return Boolean(data);
}

export async function claimNextPendingRun(): Promise<{ id: string } | null> {
  const supabase = createSupabaseServiceClient();
  const { data: pending, error: pendingError } = await supabase
    .from("runs")
    .select("id")
    .eq("status", "pending")
    .order("started_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (pendingError) {
    throw new Error(pendingError.message);
  }
  if (!pending) return null;

  const metadata = createInitialRunMetadata();
  const { data: claimed, error: claimError } = await supabase
    .from("runs")
    .update({
      status: "running",
      error_message: null,
      metadata: metadata as Json,
    })
    .eq("id", pending.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (claimError) {
    throw new Error(claimError.message);
  }
  return claimed ?? null;
}

export async function processRun(runId: string): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const metadata = createInitialRunMetadata();
  const extractConcurrency = getExtractConcurrency();
  try {
    const publishers = await listPublishers();
    metadata.publisher_count = publishers.length;
    metadata.publishers = publishers.map((publisher) => ({
      publisher_id: publisher.id,
      publisher_name: publisher.name,
      base_url: publisher.base_url,
      status: "pending",
      articles_found: 0,
      articles_upserted: 0,
      error_message: null,
    }));
    await updateRunProgress(runId, { metadata });
    if (await isRunCancelled(runId)) {
      return;
    }

    for (const publisher of publishers) {
      if (await isRunCancelled(runId)) {
        return;
      }
      const publisherProgress = metadata.publishers.find(
        (entry) => entry.publisher_id === publisher.id,
      );
      try {
        if (publisherProgress) {
          publisherProgress.status = "running";
          publisherProgress.error_message = null;
          await updateRunProgress(runId, { metadata });
        }
        const home = await fetchHtmlWithRetries(publisher.base_url, {
          retries: 0,
        });
        const cleanedHomeHtml = cleanHtmlForLLM(home.html);
        const candidates = await extractArticleUrls(
          publisher.base_url,
          cleanedHomeHtml,
        );
        const normalizedUrls = Array.from(
          new Set(
            candidates
              .map((c) => toCanonicalUrl(c.url, publisher.base_url))
              .filter((value): value is string => Boolean(value)),
          ),
        ).slice(0, 20);

        metadata.articles_found += normalizedUrls.length;
        if (publisherProgress) {
          publisherProgress.articles_found = normalizedUrls.length;
        }
        metadata.articles.push(
          ...normalizedUrls.map((url) => {
            const identified = candidates.find(
              (candidate) =>
                toCanonicalUrl(candidate.url, publisher.base_url) === url,
            );
            return {
            publisher_id: publisher.id,
            url,
            canonical_url: null,
            title: identified?.title ?? null,
            published_at: toTimestampOrNull(identified?.published_at),
            status: "identified" as const,
            error_message: null,
            };
          }),
        );
        await updateRunProgress(runId, { metadata });
      } catch (error) {
        if (publisherProgress) {
          publisherProgress.status = "failed";
          publisherProgress.error_message =
            error instanceof Error ? error.message : "Publisher crawl failed";
        }
        metadata.errors.push({
          publisher_id: publisher.id,
          message:
            error instanceof Error ? error.message : "Publisher crawl failed",
        });
      } finally {
        metadata.publishers_done += 1;
        if (publisherProgress && publisherProgress.status === "running") {
          publisherProgress.status = "completed";
        }
        await updateRunProgress(runId, { metadata });
      }
    }

    const identifiedCandidates: CandidateSource[] = metadata.articles.map(
      (article) => {
        const publisher = metadata.publishers.find(
          (entry) => entry.publisher_id === article.publisher_id,
        );
        const canonicalUrl = article.canonical_url ?? article.url;
        article.canonical_url = canonicalUrl;
        article.status = "clustering";
        article.error_message = null;
        return {
          publisherId: article.publisher_id,
          publisherName: publisher?.publisher_name ?? article.publisher_id,
          url: article.url,
          canonicalUrl,
          title: article.title,
          publishedAt: article.published_at,
        };
      },
    );
    await updateRunProgress(runId, { metadata });

    const sourceByKey = new Map<string, CandidateSource>();
    for (const candidate of identifiedCandidates) {
      sourceByKey.set(
        sourceKeyFor(candidate.publisherId, candidate.canonicalUrl),
        candidate,
      );
    }

    await clearPersistedRunClusters(runId);
    const clusteredStories = await clusterCandidatesIntoStories(identifiedCandidates);
    const persistedClusters = await persistClusters(
      runId,
      clusteredStories,
      sourceByKey,
    );
    metadata.clusters_total = persistedClusters.length;

    const sourceKeysInClusters = new Set<string>();
    for (const cluster of persistedClusters) {
      for (const key of cluster.sourceKeys) {
        sourceKeysInClusters.add(key);
      }
    }

    for (const candidate of identifiedCandidates) {
      const progress = metadata.articles.find(
        (entry) =>
          entry.publisher_id === candidate.publisherId &&
          entry.url === candidate.url,
      );
      if (progress) {
        progress.status = sourceKeysInClusters.has(
          sourceKeyFor(candidate.publisherId, candidate.canonicalUrl),
        )
          ? "clustered"
          : "not_selected_for_extraction";
      }
    }

    const clustersWithEligibility = await markEligibleClusters(
      runId,
      persistedClusters,
    );
    const eligibleClusters = clustersWithEligibility.filter(
      (cluster) => cluster.status === "eligible",
    );
    metadata.clusters_eligible = eligibleClusters.length;
    const selectedClusterIds = await selectRelevantStories(eligibleClusters);
    await updateClusterSelectionStatuses(runId, eligibleClusters, selectedClusterIds);
    metadata.clusters_selected = selectedClusterIds.size;

    const selectedCandidates: CandidateSource[] = [];
    const selectedSourceKeys = new Set<string>();
    for (const cluster of clustersWithEligibility) {
      if (!selectedClusterIds.has(cluster.id)) continue;
      for (const key of cluster.sourceKeys) {
        selectedSourceKeys.add(key);
        const source = sourceByKey.get(key);
        if (source) {
          selectedCandidates.push(source);
        }
      }
    }
    metadata.sources_selected = selectedSourceKeys.size;

    for (const candidate of identifiedCandidates) {
      const progress = metadata.articles.find(
        (entry) =>
          entry.publisher_id === candidate.publisherId &&
          entry.url === candidate.url,
      );
      if (progress) {
        progress.status = selectedSourceKeys.has(
          sourceKeyFor(candidate.publisherId, candidate.canonicalUrl),
        )
          ? "selected_for_extraction"
          : "not_selected_for_extraction";
      }
    }
    await updateRunProgress(runId, { metadata });

    const candidatesToExtract: CandidateSource[] = [];
    for (const candidate of selectedCandidates) {
      if (await isRunCancelled(runId)) {
        return;
      }
      const progress = metadata.articles.find(
        (entry) =>
          entry.publisher_id === candidate.publisherId &&
          entry.url === candidate.url,
      );
      try {
        const exists = await articleExists(
          candidate.publisherId,
          candidate.canonicalUrl,
        );
        if (exists) {
          if (progress) {
            progress.status = "skipped_existing";
            progress.error_message = null;
          }
        } else {
          candidatesToExtract.push(candidate);
        }
      } catch (error) {
        if (progress) {
          progress.status = "failed";
          progress.error_message =
            error instanceof Error ? error.message : "Existing article check failed";
        }
        metadata.errors.push({
          publisher_id: candidate.publisherId,
          url: candidate.url,
          message:
            error instanceof Error ? error.message : "Existing article check failed",
        });
      }
      await updateRunProgress(runId, { metadata });
    }

    const extractedArticles = await mapWithConcurrency(
      candidatesToExtract,
      extractConcurrency,
      async (candidate): Promise<ExtractedArticle | null> => {
        if (await isRunCancelled(runId)) {
          return null;
        }
        const articleProgress = metadata.articles.find(
          (entry) =>
            entry.publisher_id === candidate.publisherId &&
            entry.url === candidate.url,
        );
        if (articleProgress) {
          articleProgress.status = "fetching";
          articleProgress.error_message = null;
          await updateRunProgress(runId, { metadata });
        }
        try {
          const articleRes = await fetchHtmlWithRetries(candidate.url, {
            retries: 0,
          });
          const cleanedArticleHtml = cleanHtmlForLLM(articleRes.html);
          const details = await extractArticleDetails(
            articleRes.finalUrl,
            cleanedArticleHtml,
          );
          const canonicalUrl =
            toCanonicalUrl(
              details.canonical_url ?? articleRes.finalUrl,
              articleRes.finalUrl,
            ) ?? candidate.canonicalUrl;
          if (articleProgress) {
            articleProgress.canonical_url = canonicalUrl;
            articleProgress.title = details.title ?? candidate.title;
            articleProgress.published_at =
              toTimestampOrNull(details.published_at) ?? candidate.publishedAt;
            articleProgress.status = "extracted";
            await updateRunProgress(runId, { metadata });
          }

          return {
            ...candidate,
            sourceUrl: articleRes.finalUrl,
            canonicalUrl,
            title: details.title ?? candidate.title,
            bodyText: details.body_text,
            publishedAt:
              toTimestampOrNull(details.published_at) ?? candidate.publishedAt,
          };
        } catch (error) {
          if (articleProgress) {
            articleProgress.status = "failed";
            articleProgress.error_message =
              error instanceof Error ? error.message : "Article extraction failed";
          }
          metadata.errors.push({
            publisher_id: candidate.publisherId,
            url: candidate.url,
            message:
              error instanceof Error ? error.message : "Article extraction failed",
          });
          await updateRunProgress(runId, { metadata });
          return null;
        }
      },
    );

    for (const article of extractedArticles) {
      if (await isRunCancelled(runId)) {
        return;
      }
      if (!article) continue;
      try {
        const { error: upsertError } = await supabase
          .from("articles")
          .upsert(
            {
              publisher_id: article.publisherId,
              run_id: runId,
              canonical_url: article.canonicalUrl,
              title: article.title,
              body_text: article.bodyText,
              published_at: article.publishedAt,
              metadata: {
                source_url: article.sourceUrl,
                model: RUN_EXTRACT_MODEL,
                clustering_model: RUN_CLUSTER_MODEL,
                relevance_selection_model: RUN_RELEVANCE_MODEL,
              },
            },
            { onConflict: "publisher_id,canonical_url" },
          );
        if (upsertError) {
          throw new Error(upsertError.message);
        }
        metadata.articles_upserted += 1;
        const publisherProgress = metadata.publishers.find(
          (entry) => entry.publisher_id === article.publisherId,
        );
        if (publisherProgress) {
          publisherProgress.articles_upserted += 1;
        }
        const articleProgress = metadata.articles.find(
          (entry) =>
            entry.publisher_id === article.publisherId &&
            (entry.url === article.canonicalUrl ||
              entry.url === article.sourceUrl ||
              entry.canonical_url === article.canonicalUrl),
        );
        if (articleProgress) {
          articleProgress.status = "upserted";
        }
        await updateRunProgress(runId, { metadata });
      } catch (error) {
        const articleProgress = metadata.articles.find(
          (entry) =>
            entry.publisher_id === article.publisherId &&
            (entry.url === article.canonicalUrl ||
              entry.url === article.sourceUrl ||
              entry.canonical_url === article.canonicalUrl),
        );
        if (articleProgress) {
          articleProgress.status = "failed";
          articleProgress.error_message =
            error instanceof Error ? error.message : "Article upsert failed";
        }
        metadata.errors.push({
          publisher_id: article.publisherId,
          url: article.sourceUrl,
          message: error instanceof Error ? error.message : "Article upsert failed",
        });
        await updateRunProgress(runId, { metadata });
      }
    }

    await updateRunProgress(runId, {
      status: "completed",
      ended_at: new Date().toISOString(),
      metadata,
    });
  } catch (error) {
    await updateRunProgress(runId, {
      status: "failed",
      ended_at: new Date().toISOString(),
      error_message: error instanceof Error ? error.message : "Run failed",
      metadata,
    });
  }
}
