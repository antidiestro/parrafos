import { generateGeminiJson } from "@/lib/gemini/generate";
import { RUN_BRIEF_MODEL } from "@/lib/runs/constants";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  OBJECTIVE_JOURNALISTIC_TONE_INSTRUCTION,
  storyDetailResponseJsonSchema,
  storyDetailSchema,
} from "@/scripts/workflow-console/constants";
import { divider, logLine } from "@/scripts/workflow-console/logging";
import type {
  CandidateSource,
  ClusterDraft,
  StorySummaryRow,
} from "@/scripts/workflow-console/types";
import { decodeHtmlEntities, toHoursAgo } from "@/scripts/workflow-console/utils";

async function loadArticleBodiesBySource(
  sources: CandidateSource[],
): Promise<
  Map<
    string,
    {
      id: string;
      bodyText: string;
      title: string | null;
      publishedAt: string | null;
    }
  >
> {
  logLine("publish: load article bodies started", { sources: sources.length });
  const supabase = createSupabaseServiceClient();
  const urlsByPublisher = new Map<string, Set<string>>();
  for (const source of sources) {
    const set = urlsByPublisher.get(source.publisherId) ?? new Set<string>();
    set.add(source.canonicalUrl);
    urlsByPublisher.set(source.publisherId, set);
  }
  const out = new Map<
    string,
    {
      id: string;
      bodyText: string;
      title: string | null;
      publishedAt: string | null;
    }
  >();

  for (const [publisherId, canonicalSet] of urlsByPublisher) {
    const canonicalUrls = Array.from(canonicalSet);
    logLine("publish: article body query started", {
      publisherId,
      canonicalUrls: canonicalUrls.length,
    });
    const { data, error } = await supabase
      .from("articles")
      .select("id,publisher_id,canonical_url,title,published_at,body_text")
      .eq("publisher_id", publisherId)
      .in("canonical_url", canonicalUrls);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      if (!row.body_text?.trim()) continue;
      out.set(`${row.publisher_id}::${row.canonical_url}`, {
        id: row.id,
        bodyText: row.body_text,
        title: row.title,
        publishedAt: row.published_at,
      });
    }
    logLine("publish: article body query completed", {
      publisherId,
      rowsReturned: (data ?? []).length,
    });
  }
  logLine("publish: load article bodies completed", { withBodyCount: out.size });
  return out;
}

export async function generateStorySummaries(input: {
  selectedClusters: ClusterDraft[];
  sourceByKey: Map<string, CandidateSource>;
}): Promise<StorySummaryRow[]> {
  divider("generate_story_summaries");
  const sortedClusters = input.selectedClusters
    .slice()
    .sort((a, b) => b.sourceKeys.length - a.sourceKeys.length);
  const allSelectedSources = sortedClusters.flatMap((cluster) =>
    cluster.sourceKeys
      .map((key) => input.sourceByKey.get(key))
      .filter((value): value is CandidateSource => Boolean(value)),
  );
  const bodyBySource = await loadArticleBodiesBySource(allSelectedSources);
  const nowMs = Date.now();
  const referenceNowIso = new Date(nowMs).toISOString();

  const summaries: StorySummaryRow[] = [];
  for (let index = 0; index < sortedClusters.length; index += 1) {
    const cluster = sortedClusters[index];
    logLine("story_summary: started", {
      current: index + 1,
      total: sortedClusters.length,
      clusterId: cluster.id,
      title: cluster.title,
    });

    const clusterSources = cluster.sourceKeys
      .map((key) => input.sourceByKey.get(key))
      .filter((value): value is CandidateSource => Boolean(value))
      .sort((a, b) => {
        if (a.publishedAt && b.publishedAt) {
          return +new Date(b.publishedAt) - +new Date(a.publishedAt);
        }
        if (a.publishedAt && !b.publishedAt) return -1;
        if (!a.publishedAt && b.publishedAt) return 1;
        return a.url.localeCompare(b.url);
      });
    const latestClusterSourceTime = clusterSources.find(
      (source) => source.publishedAt,
    )?.publishedAt;
    const latestHoursAgo = toHoursAgo(latestClusterSourceTime ?? null, nowMs);

    const sourceTexts: string[] = [];
    for (const source of clusterSources) {
      const key = `${source.publisherId}::${source.canonicalUrl}`;
      const article = bodyBySource.get(key);
      if (!article) continue;
      sourceTexts.push(
        [
          `Source URL: ${source.url}`,
          `Source: ${source.publisherName}`,
          source.title
            ? `Title hint: ${source.title}`
            : article.title
              ? `Title hint: ${article.title}`
              : null,
          source.publishedAt
            ? `Published at: ${new Date(source.publishedAt).toISOString()}`
            : article.publishedAt
              ? `Published at: ${new Date(article.publishedAt).toISOString()}`
              : null,
          "Full text:",
          article.bodyText,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }
    if (sourceTexts.length === 0) {
      throw new Error(`No extracted article text available for cluster ${cluster.id}`);
    }

    const prompt = [
      "Write an in-depth story summary in Markdown with a clear journalistic structure.",
      "Instructions:",
      "1) Output MUST be in Spanish.",
      "2) Start with a short opening paragraph (no heading) that works like a lede.",
      "3) Organize the rest with a clear structure (short sections, bullets, or both) so it is easy to scan.",
      "4) You may include inline Markdown links using only source URLs from the input when they add context.",
      "5) Do not invent or alter URLs.",
      "6) Do not invent claims; use only the provided source material.",
      "7) Keep a skeptical and balanced tone: acknowledge source bias and possible institutional agendas.",
      "8) Keep that skepticism evidence-based and non-conspiratorial.",
      "9) Use proper Spanish orthography (UTF-8), including accents and ñ; never replace accented characters with ASCII placeholders, numbers, or entities.",
      `10) ${OBJECTIVE_JOURNALISTIC_TONE_INSTRUCTION}`,
      `11) Reference date/time for writing criteria: ${referenceNowIso}. Use this timestamp as "now" when assessing recency and temporal context.`,
      `Story title/topic: ${cluster.title}`,
      cluster.selectionReason
        ? `Why this story was selected: ${cluster.selectionReason}`
        : null,
      latestClusterSourceTime
        ? `Most recent source timestamp: ${new Date(latestClusterSourceTime).toISOString()}`
        : null,
      latestHoursAgo !== null
        ? `Most recent source is approximately ${latestHoursAgo} hours old.`
        : null,
      "Relevant sources (full texts), each delimited by ---:",
      sourceTexts.map((text) => `---\n${text}\n---`).join("\n"),
      "Write the detailed summary now.",
    ]
      .filter(Boolean)
      .join("\n");

    const generated = await generateGeminiJson(prompt, storyDetailSchema, {
      model: RUN_BRIEF_MODEL,
      nativeStructuredOutput: {
        responseJsonSchema: storyDetailResponseJsonSchema,
      },
    });
    summaries.push({
      clusterId: cluster.id,
      title: cluster.title,
      detailMarkdown: decodeHtmlEntities(generated.detail_markdown).trim(),
    });
    logLine("story_summary: completed", {
      clusterId: cluster.id,
      chars: generated.detail_markdown.length,
    });
  }
  logLine("generate_story_summaries: done", { summaries: summaries.length });
  return summaries;
}
