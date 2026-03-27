import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { divider, logLine } from "@/lib/runs/console/logging";
import {
  writeLatestRunJson,
  writeLatestRunStageStatus,
} from "@/lib/runs/console/run-artifacts";
import type {
  BriefParagraphRow,
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
      publisherId,
      canonicalUrls: canonicalUrls.length,
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
      publisherId,
      rowsReturned: (data ?? []).length,
    });
  }
  logLine("persist: load article IDs completed", { mappedArticleIds: map.size });
  return map;
}

export async function persistBriefOutput(input: {
  selectedClusters: ClusterDraft[];
  sourceByKey: Map<string, CandidateSource>;
  storySummaries: StorySummaryRow[];
  briefParagraphs: BriefParagraphRow[];
}): Promise<{ briefId: string }> {
  const stageStartedAt = Date.now();
  divider("persist_brief_output");
  logLine("persist_brief_output: input prepared", {
    selectedClusters: input.selectedClusters.length,
    storySummaries: input.storySummaries.length,
    briefParagraphs: input.briefParagraphs.length,
  });
  if (input.storySummaries.length !== input.briefParagraphs.length) {
    throw new Error("Brief paragraph count must match story summary count.");
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
    storyRows: input.storySummaries.length,
  });
  const { data: stories, error: storiesError } = await supabase
    .from("stories")
    .insert(
      input.storySummaries.map((summary, index) => ({
        brief_id: brief.id,
        position: index + 1,
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

  logLine("persist_brief_output: inserting brief paragraph rows", {
    paragraphRows: input.briefParagraphs.length,
  });
  const { error: paragraphsError } = await supabase.from("brief_paragraphs").insert(
    input.briefParagraphs.map((paragraph, index) => ({
      brief_id: brief.id,
      story_id: storyIdByPosition.get(index + 1) as string,
      position: index + 1,
      markdown: paragraph.markdown,
    })),
  );
  if (paragraphsError) throw new Error(paragraphsError.message);

  const allSelectedSources = input.selectedClusters.flatMap((cluster) =>
    cluster.sourceKeys
      .map((key) => input.sourceByKey.get(key))
      .filter((value): value is CandidateSource => Boolean(value)),
  );
  const articleIdBySource = await loadArticleIdsBySource(allSelectedSources);

  const storyArticleRows: Array<{ story_id: string; article_id: string }> = [];
  for (let index = 0; index < input.selectedClusters.length; index += 1) {
    const cluster = input.selectedClusters[index];
    const storyId = storyIdByPosition.get(index + 1);
    if (!storyId) continue;
    const seen = new Set<string>();
    for (const sourceKey of cluster.sourceKeys) {
      const source = input.sourceByKey.get(sourceKey);
      if (!source) continue;
      const articleId = articleIdBySource.get(
        `${source.publisherId}::${source.canonicalUrl}`,
      );
      if (!articleId || seen.has(articleId)) continue;
      seen.add(articleId);
      storyArticleRows.push({ story_id: storyId, article_id: articleId });
    }
  }

  if (storyArticleRows.length > 0) {
    logLine("persist_brief_output: inserting story-article links", {
      linkRows: storyArticleRows.length,
    });
    const { error: storyArticlesError } = await supabase
      .from("story_articles")
      .insert(storyArticleRows);
    if (storyArticlesError) throw new Error(storyArticlesError.message);
  }

  logLine("persist_brief_output: done", {
    briefId: brief.id,
    stories: input.storySummaries.length,
    paragraphs: input.briefParagraphs.length,
    storyArticleLinks: storyArticleRows.length,
  });
  await writeLatestRunJson("persist_brief_output/publish-result.json", {
    briefId: brief.id,
    stories: input.storySummaries.length,
    paragraphs: input.briefParagraphs.length,
    storyArticleLinks: storyArticleRows.length,
  });
  await writeLatestRunStageStatus("persist_brief_output", {
    stage: "persist_brief_output",
    finishedAt: new Date().toISOString(),
    ok: true,
    durationMs: Date.now() - stageStartedAt,
    briefId: brief.id,
    stories: input.storySummaries.length,
    paragraphs: input.briefParagraphs.length,
    storyArticleLinks: storyArticleRows.length,
  });
  return { briefId: brief.id };
}
