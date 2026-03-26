import type { Database } from "@/database.types";
import { parseRunMetadata } from "@/lib/runs/progress";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export type RunRow = Database["public"]["Tables"]["runs"]["Row"];
export type ArticleRow = Database["public"]["Tables"]["articles"]["Row"];
export type RunStoryClusterRow =
  Database["public"]["Tables"]["run_story_clusters"]["Row"];
export type RunStoryClusterSourceRow =
  Database["public"]["Tables"]["run_story_cluster_sources"]["Row"];

export type RunArticleWithPublisher = Pick<
  ArticleRow,
  | "id"
  | "run_id"
  | "publisher_id"
  | "canonical_url"
  | "title"
  | "published_at"
  | "body_text"
  | "extracted_at"
  | "metadata"
> & {
  publisher_name: string | null;
};

export type RunDetailPayload = {
  run: RunRow;
  metadata: ReturnType<typeof parseRunMetadata>;
  articles: RunArticleWithPublisher[];
  clusters: RunStoryClusterWithSources[];
  /**
   * Keys `${publisher_id}::${canonical_url}` where `articles.body_text` is
   * non-empty, for sources in selected clusters — same lookup scope as brief
   * generation (any run), not only `articles.run_id = this run`.
   */
  briefArticleBodyKeys: string[];
};

export type RunStoryClusterSourceWithPublisher = Pick<
  RunStoryClusterSourceRow,
  | "cluster_id"
  | "publisher_id"
  | "url"
  | "canonical_url"
  | "title"
  | "published_at"
> & {
  publisher_name: string | null;
};

export type RunStoryClusterWithSources = Pick<
  RunStoryClusterRow,
  | "id"
  | "run_id"
  | "title"
  | "summary"
  | "selection_reason"
  | "status"
  | "source_count"
  | "created_at"
  | "updated_at"
> & {
  sources: RunStoryClusterSourceWithPublisher[];
};

export async function listRecentRuns(limit = 20): Promise<RunRow[]> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }
  return data ?? [];
}

export async function getRunById(runId: string): Promise<RunRow | null> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("runs")
    .select("*")
    .eq("id", runId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  return data;
}

export async function listRunArticles(
  runId: string,
): Promise<RunArticleWithPublisher[]> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("articles")
    .select(
      "id,run_id,publisher_id,canonical_url,title,published_at,body_text,extracted_at,metadata,publishers(name)",
    )
    .eq("run_id", runId)
    .order("extracted_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    run_id: row.run_id,
    publisher_id: row.publisher_id,
    canonical_url: row.canonical_url,
    title: row.title,
    published_at: row.published_at,
    body_text: row.body_text,
    extracted_at: row.extracted_at,
    metadata: row.metadata,
    publisher_name:
      row.publishers && !Array.isArray(row.publishers)
        ? row.publishers.name
        : null,
  }));
}

/** Same key shape as `createAndPublishBriefForRun` article text map. */
export function articleBodyLookupKey(
  publisherId: string,
  canonicalUrl: string,
) {
  return `${publisherId}::${canonicalUrl}`;
}

async function loadBriefArticleBodyKeysForSources(
  sources: Array<{ publisher_id: string; canonical_url: string }>,
): Promise<string[]> {
  const urlsByPublisher = new Map<string, Set<string>>();
  for (const source of sources) {
    const set = urlsByPublisher.get(source.publisher_id) ?? new Set<string>();
    set.add(source.canonical_url);
    urlsByPublisher.set(source.publisher_id, set);
  }

  const keys = new Set<string>();
  if (urlsByPublisher.size === 0) {
    return [];
  }

  const supabase = createSupabaseServiceClient();
  for (const [publisherId, canonicalUrlsSet] of urlsByPublisher) {
    const canonicalUrls = Array.from(canonicalUrlsSet);
    const { data, error } = await supabase
      .from("articles")
      .select("publisher_id,canonical_url,body_text")
      .eq("publisher_id", publisherId)
      .in("canonical_url", canonicalUrls);

    if (error) {
      throw new Error(error.message);
    }
    for (const row of data ?? []) {
      if (!row.body_text?.trim()) continue;
      keys.add(
        articleBodyLookupKey(row.publisher_id, row.canonical_url),
      );
    }
  }

  return Array.from(keys);
}

export async function getRunDetailPayload(
  runId: string,
): Promise<RunDetailPayload | null> {
  const run = await getRunById(runId);
  if (!run) return null;
  const articles = await listRunArticles(runId);
  const clusters = await listRunStoryClusters(runId);

  const selectedSources = clusters
    .filter((c) => c.status === "selected")
    .flatMap((c) =>
      c.sources.map((s) => ({
        publisher_id: s.publisher_id,
        canonical_url: s.canonical_url,
      })),
    );
  const briefArticleBodyKeys =
    await loadBriefArticleBodyKeysForSources(selectedSources);

  return {
    run,
    metadata: parseRunMetadata(run.metadata),
    articles,
    clusters,
    briefArticleBodyKeys,
  };
}

async function listRunStoryClusters(
  runId: string,
): Promise<RunStoryClusterWithSources[]> {
  const supabase = createSupabaseServiceClient();
  const { data: clusterRows, error: clusterError } = await supabase
    .from("run_story_clusters")
    .select(
      "id,run_id,title,summary,selection_reason,status,source_count,created_at,updated_at",
    )
    .eq("run_id", runId)
    .order("source_count", { ascending: false })
    .order("created_at", { ascending: true });
  if (clusterError) {
    throw new Error(clusterError.message);
  }

  const { data: sourceRows, error: sourceError } = await supabase
    .from("run_story_cluster_sources")
    .select(
      "cluster_id,publisher_id,url,canonical_url,title,published_at,publishers(name)",
    )
    .eq("run_id", runId);
  if (sourceError) {
    throw new Error(sourceError.message);
  }

  const sourceByCluster = new Map<string, RunStoryClusterSourceWithPublisher[]>();
  for (const row of sourceRows ?? []) {
    const clusterSources = sourceByCluster.get(row.cluster_id) ?? [];
    clusterSources.push({
      cluster_id: row.cluster_id,
      publisher_id: row.publisher_id,
      url: row.url,
      canonical_url: row.canonical_url,
      title: row.title,
      published_at: row.published_at,
      publisher_name:
        row.publishers && !Array.isArray(row.publishers)
          ? row.publishers.name
          : null,
    });
    sourceByCluster.set(row.cluster_id, clusterSources);
  }

  return (clusterRows ?? []).map((cluster) => ({
    id: cluster.id,
    run_id: cluster.run_id,
    title: cluster.title,
    summary: cluster.summary,
    selection_reason: cluster.selection_reason,
    status: cluster.status,
    source_count: cluster.source_count,
    created_at: cluster.created_at,
    updated_at: cluster.updated_at,
    sources: sourceByCluster.get(cluster.id) ?? [],
  }));
}
