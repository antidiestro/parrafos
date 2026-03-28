import { getLatestPublishedBriefWithStories } from "@/lib/data/briefs";
import { simpleStorySummarySchema } from "@/lib/runs/console/pipeline-constants";
import { divider, logLine } from "@/lib/runs/console/logging";
import type { StorySummaryRow } from "@/lib/runs/console/types";
import { composeBriefSections } from "@/lib/runs/stages/compose-brief-sections";
import { persistBriefOutputWithArticleIds } from "@/lib/runs/stages/persist-brief-output";

/**
 * Re-run brief composition on the latest published brief's stored story-summary JSON
 * and publish a new brief, copying `story_articles` links by section order.
 * Does not create or update a `runs` row.
 */
export async function republishBriefFromLatestStories(): Promise<{
  briefId: string;
}> {
  divider("republish_brief_from_latest");
  const bundle = await getLatestPublishedBriefWithStories();
  if (!bundle) {
    throw new Error("No published brief found.");
  }
  if (bundle.sections.length === 0) {
    throw new Error("Latest brief has no sections.");
  }

  const storySummaries: StorySummaryRow[] = [];
  const articleIdsPerStoryIndex: string[][] = [];

  for (const section of bundle.sections) {
    const dm = section.story.detail_markdown?.trim();
    if (!dm) {
      throw new Error(`Story ${section.story.id} has empty detail_markdown.`);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(dm);
    } catch {
      throw new Error(
        `Story ${section.story.id} detail_markdown is not valid JSON.`,
      );
    }
    const payload = simpleStorySummarySchema.parse(raw);
    storySummaries.push({
      clusterId: payload.story_id,
      title: payload.story_title,
      detailMarkdown: dm,
    });
    articleIdsPerStoryIndex.push(section.sources.map((s) => s.id));
  }

  logLine("republish_brief_from_latest: composing sections", {
    stories: storySummaries.length,
  });
  const briefSections = await composeBriefSections(storySummaries);

  const { briefId } = await persistBriefOutputWithArticleIds({
    storySummaries,
    briefSections,
    articleIdsPerStoryIndex,
  });

  logLine("republish_brief_from_latest: done", { briefId });
  return { briefId };
}
