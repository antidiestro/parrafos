import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { divider, logLine } from "@/lib/runs/console/logging";
import type {
  BriefSectionRow,
  CandidateSource,
  ClusterDraft,
  StorySummaryRow,
} from "@/lib/runs/console/types";

async function loadArticleIdsBySource(
  sources: CandidateSource[],
): Promise<Map<string, string>> {
  logLine("persist: load article IDs started", { sources: sources.length });
  const supabase = createSupabaseServiceClient();
  const map = new Map<string, string>();
  const urlsByPublisher = new Map<string, Set<string>>();
  for (const source of sources) {
    const set = urlsByPublisher.get(source.publisherId) ?? new Set<string>();
    set.add(source.canonicalUrl);
    urlsByPublisher.set(source.publisherId, set);
  }

  for (const [publisherId, canonicalSet] of urlsByPublisher.entries()) {
    const canonicalUrls = Array.from(canonicalSet);
    logLine("persist: article ID query started", {
      pub: publisherId,
      urls: canonicalUrls.length,
    });
    const { data, error } = await supabase
      .from("articles")
      .select("id,publisher_id,canonical_url")
      .eq("publisher_id", publisherId)
      .in("canonical_url", canonicalUrls);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      map.set(`${row.publisher_id}::${row.canonical_url}`, row.id);
    }
    logLine("persist: article ID query completed", {
      pub: publisherId,
      rows: (data ?? []).length,
    });
  }
  logLine("persist: load article IDs completed", { mappedArticleIds: map.size });
  return map;
}

export async function upsertSecondarySourceMetadata(input: {
  runId: string;
  secondaryClusters: ClusterDraft[];
  sourceByKey: Map<string, CandidateSource>;
}): Promise<void> {
  if (input.secondaryClusters.length === 0) {
    logLine("persist: secondary metadata upsert skipped (no secondary clusters)");
    return;
  }

  const uniqueByPublisherCanonical = new Map<string, CandidateSource>();
  for (const cluster of input.secondaryClusters) {
    for (const sourceKey of cluster.sourceKeys) {
      const source = input.sourceByKey.get(sourceKey);
      if (!source) continue;
      uniqueByPublisherCanonical.set(
        `${source.publisherId}::${source.canonicalUrl}`,
        source,
      );
    }
  }

  const rows = Array.from(uniqueByPublisherCanonical.values()).map((source) => ({
    run_id: input.runId,
    publisher_id: source.publisherId,
    canonical_url: source.canonicalUrl,
    title: source.title,
    published_at: source.publishedAt,
    source_url: source.url,
    body_text: null,
    extraction_model: null,
    clustering_model: null,
    relevance_selection_model: null,
    metadata: {
      source_url: source.url,
      source_tier: "secondary",
      extraction_state: "metadata_only",
    },
  }));

  if (rows.length === 0) {
    logLine("persist: secondary metadata upsert skipped (no sources)");
    return;
  }

  const supabase = createSupabaseServiceClient();
  logLine("persist: secondary metadata upsert started", {
    secondaryClusters: input.secondaryClusters.length,
    candidateRows: rows.length,
  });
  const { error } = await supabase
    .from("articles")
    .upsert(rows, {
      onConflict: "publisher_id,canonical_url",
      ignoreDuplicates: true,
    });
  if (error) throw new Error(error.message);
  logLine("persist: secondary metadata upsert completed", {
    attemptedRows: rows.length,
    note: "existing article rows were preserved",
  });
}

async function insertPublishedBriefRows(input: {
  primaryClusters: ClusterDraft[];
  secondaryClusters: ClusterDraft[];
  storySummaries: StorySummaryRow[];
  briefSections: BriefSectionRow[];
}): Promise<{
  briefId: string;
  storyIdByPosition: Map<number, string>;
  secondaryStoryIdByClusterId: Map<string, string>;
}> {
  if (input.storySummaries.length !== input.briefSections.length) {
    throw new Error("Brief section count must match story summary count.");
  }
  const supabase = createSupabaseServiceClient();
  logLine("persist_brief_output: inserting brief row");
  const { data: brief, error: briefError } = await supabase
    .from("briefs")
    .insert({
      title: "Parrafos brief",
      status: "published",
      published_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (briefError) throw new Error(briefError.message);

  logLine("persist_brief_output: inserting story rows", {
    primaryStoryRows: input.storySummaries.length,
    secondaryStoryRows: input.secondaryClusters.length,
  });
  const clusterById = new Map<string, ClusterDraft>();
  for (const cluster of input.primaryClusters) {
    clusterById.set(cluster.id, cluster);
  }
  const { data: stories, error: storiesError } = await supabase
    .from("stories")
    .insert(
      input.storySummaries.map((summary, index) => ({
        brief_id: brief.id,
        position: index + 1,
        tier: "primary",
        cluster_id: summary.clusterId,
        selection_reason: clusterById.get(summary.clusterId)?.selectionReason ?? null,
        source_count: clusterById.get(summary.clusterId)?.sourceKeys.length ?? null,
        markdown: summary.detailMarkdown,
        detail_markdown: summary.detailMarkdown,
      })),
    )
    .select("id,position");
  if (storiesError) throw new Error(storiesError.message);
  if (!stories || stories.length !== input.storySummaries.length) {
    throw new Error("Unable to insert stories for brief publication.");
  }

  const storyIdByPosition = new Map<number, string>();
  for (const row of stories) {
    storyIdByPosition.set(row.position, row.id);
  }

  const secondaryStoryIdByClusterId = new Map<string, string>();
  if (input.secondaryClusters.length > 0) {
    const secondaryStoryRows = input.secondaryClusters.map((cluster, index) => ({
      brief_id: brief.id,
      position: input.storySummaries.length + index + 1,
      tier: "secondary",
      cluster_id: cluster.id,
      selection_reason: cluster.selectionReason,
      source_count: cluster.sourceKeys.length,
      markdown: cluster.title,
      detail_markdown: null,
    }));
    const { data: secondaryStories, error: secondaryStoriesError } = await supabase
      .from("stories")
      .insert(secondaryStoryRows)
      .select("id,cluster_id");
    if (secondaryStoriesError) throw new Error(secondaryStoriesError.message);
    if (!secondaryStories || secondaryStories.length !== secondaryStoryRows.length) {
      throw new Error("Unable to insert secondary stories for brief publication.");
    }
    for (const row of secondaryStories) {
      if (!row.cluster_id) continue;
      secondaryStoryIdByClusterId.set(row.cluster_id, row.id);
    }
  }

  logLine("persist_brief_output: inserting brief section rows", {
    sectionRows: input.briefSections.length,
  });
  const { error: sectionsError } = await supabase.from("brief_sections").insert(
    input.briefSections.map((section, index) => ({
      brief_id: brief.id,
      story_id: storyIdByPosition.get(index + 1) as string,
      position: index + 1,
      markdown: section.markdown,
    })),
  );
  if (sectionsError) throw new Error(sectionsError.message);

  return { briefId: brief.id, storyIdByPosition, secondaryStoryIdByClusterId };
}

async function insertStoryArticleLinks(
  storyArticleRows: Array<{ story_id: string; article_id: string }>,
) {
  if (storyArticleRows.length === 0) return;
  const supabase = createSupabaseServiceClient();
  logLine("persist_brief_output: inserting story-article links", {
    linkRows: storyArticleRows.length,
  });
  const { error: storyArticlesError } = await supabase
    .from("story_articles")
    .insert(storyArticleRows);
  if (storyArticlesError) throw new Error(storyArticlesError.message);
}

function storyArticleRowsFromClusters(input: {
  selectedClusters: ClusterDraft[];
  sourceByKey: Map<string, CandidateSource>;
  storySummaries: StorySummaryRow[];
  articleIdBySource: Map<string, string>;
  storyIdByPosition: Map<number, string>;
}): Array<{ story_id: string; article_id: string }> {
  const clusterById = new Map<string, ClusterDraft>();
  for (const cluster of input.selectedClusters) {
    clusterById.set(cluster.id, cluster);
  }

  const storyArticleRows: Array<{ story_id: string; article_id: string }> = [];
  for (let index = 0; index < input.storySummaries.length; index += 1) {
    const summary = input.storySummaries[index];
    const cluster = clusterById.get(summary.clusterId);
    if (!cluster) {
      throw new Error(
        `Persist: story summary references cluster ${summary.clusterId} not found in selectedClusters.`,
      );
    }
    const storyId = input.storyIdByPosition.get(index + 1);
    if (!storyId) continue;
    const seen = new Set<string>();
    for (const sourceKey of cluster.sourceKeys) {
      const source = input.sourceByKey.get(sourceKey);
      if (!source) continue;
      const articleId = input.articleIdBySource.get(
        `${source.publisherId}::${source.canonicalUrl}`,
      );
      if (!articleId || seen.has(articleId)) continue;
      seen.add(articleId);
      storyArticleRows.push({ story_id: storyId, article_id: articleId });
    }
  }
  return storyArticleRows;
}

function storyArticleRowsFromCopiedIds(input: {
  articleIdsPerStoryIndex: string[][];
  storyIdByPosition: Map<number, string>;
}): Array<{ story_id: string; article_id: string }> {
  const out: Array<{ story_id: string; article_id: string }> = [];
  for (let index = 0; index < input.articleIdsPerStoryIndex.length; index += 1) {
    const storyId = input.storyIdByPosition.get(index + 1);
    if (!storyId) continue;
    const seen = new Set<string>();
    for (const articleId of input.articleIdsPerStoryIndex[index] ?? []) {
      if (!articleId?.trim() || seen.has(articleId)) continue;
      seen.add(articleId);
      out.push({ story_id: storyId, article_id: articleId });
    }
  }
  return out;
}

function storyArticleRowsFromSecondaryClusters(input: {
  secondaryClusters: ClusterDraft[];
  sourceByKey: Map<string, CandidateSource>;
  articleIdBySource: Map<string, string>;
  secondaryStoryIdByClusterId: Map<string, string>;
}): Array<{ story_id: string; article_id: string }> {
  const out: Array<{ story_id: string; article_id: string }> = [];
  for (const cluster of input.secondaryClusters) {
    const storyId = input.secondaryStoryIdByClusterId.get(cluster.id);
    if (!storyId) continue;
    const seen = new Set<string>();
    for (const sourceKey of cluster.sourceKeys) {
      const source = input.sourceByKey.get(sourceKey);
      if (!source) continue;
      const articleId = input.articleIdBySource.get(
        `${source.publisherId}::${source.canonicalUrl}`,
      );
      if (!articleId || seen.has(articleId)) continue;
      seen.add(articleId);
      out.push({ story_id: storyId, article_id: articleId });
    }
  }
  return out;
}

export async function persistBriefOutput(input: {
  primaryClusters: ClusterDraft[];
  secondaryClusters: ClusterDraft[];
  sourceByKey: Map<string, CandidateSource>;
  storySummaries: StorySummaryRow[];
  briefSections: BriefSectionRow[];
}): Promise<{ briefId: string }> {
  divider("persist_brief_output");
  logLine("persist_brief_output: input prepared", {
    primaryClusters: input.primaryClusters.length,
    secondaryClusters: input.secondaryClusters.length,
    storySummaries: input.storySummaries.length,
    briefSections: input.briefSections.length,
  });

  const { briefId, storyIdByPosition, secondaryStoryIdByClusterId } =
    await insertPublishedBriefRows({
    primaryClusters: input.primaryClusters,
    secondaryClusters: input.secondaryClusters,
    storySummaries: input.storySummaries,
    briefSections: input.briefSections,
  });

  const allSelectedClusters = [...input.primaryClusters, ...input.secondaryClusters];
  const allSelectedSources = allSelectedClusters.flatMap((cluster) =>
    cluster.sourceKeys
      .map((key) => input.sourceByKey.get(key))
      .filter((value): value is CandidateSource => Boolean(value)),
  );
  const articleIdBySource = await loadArticleIdsBySource(allSelectedSources);

  const primaryStoryArticleRows = storyArticleRowsFromClusters({
    selectedClusters: input.primaryClusters,
    sourceByKey: input.sourceByKey,
    storySummaries: input.storySummaries,
    articleIdBySource,
    storyIdByPosition,
  });
  const secondaryStoryArticleRows = storyArticleRowsFromSecondaryClusters({
    secondaryClusters: input.secondaryClusters,
    sourceByKey: input.sourceByKey,
    articleIdBySource,
    secondaryStoryIdByClusterId,
  });
  const storyArticleRows = [
    ...primaryStoryArticleRows,
    ...secondaryStoryArticleRows,
  ];

  await insertStoryArticleLinks(storyArticleRows);

  logLine("persist_brief_output: done", {
    briefId,
    stories: input.storySummaries.length + input.secondaryClusters.length,
    primaryStories: input.storySummaries.length,
    secondaryStories: input.secondaryClusters.length,
    sections: input.briefSections.length,
    storyArticleLinks: storyArticleRows.length,
  });
  return { briefId };
}

/**
 * Publish a new brief using explicit article IDs per story (0-based index).
 * Used when re-composing copy from an existing published brief without cluster/source maps.
 */
export async function persistBriefOutputWithArticleIds(input: {
  storySummaries: StorySummaryRow[];
  briefSections: BriefSectionRow[];
  articleIdsPerStoryIndex: string[][];
}): Promise<{ briefId: string }> {
  divider("persist_brief_output_copied_articles");
  logLine("persist_brief_output_copied_articles: input prepared", {
    storySummaries: input.storySummaries.length,
    briefSections: input.briefSections.length,
    articleIdArrays: input.articleIdsPerStoryIndex.length,
  });
  if (input.articleIdsPerStoryIndex.length !== input.storySummaries.length) {
    throw new Error(
      "articleIdsPerStoryIndex length must match story summaries count.",
    );
  }

  const { briefId, storyIdByPosition } = await insertPublishedBriefRows({
    primaryClusters: [],
    secondaryClusters: [],
    storySummaries: input.storySummaries,
    briefSections: input.briefSections,
  });

  const storyArticleRows = storyArticleRowsFromCopiedIds({
    articleIdsPerStoryIndex: input.articleIdsPerStoryIndex,
    storyIdByPosition,
  });

  await insertStoryArticleLinks(storyArticleRows);

  logLine("persist_brief_output_copied_articles: done", {
    briefId,
    stories: input.storySummaries.length,
    sections: input.briefSections.length,
    storyArticleLinks: storyArticleRows.length,
  });
  return { briefId };
}
