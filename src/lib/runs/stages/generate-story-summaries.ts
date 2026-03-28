import { generateGeminiJson } from "@/lib/gemini/generate";
import { RUN_BRIEF_MODEL } from "@/lib/runs/constants";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  OBJECTIVE_JOURNALISTIC_TONE_INSTRUCTION,
  simpleStorySummaryResponseJsonSchema,
  simpleStorySummarySchema,
  type StorySummaryJson,
} from "@/lib/runs/console/pipeline-constants";
import { divider, logLine } from "@/lib/runs/console/logging";
import type {
  CandidateSource,
  ClusterDraft,
  StorySummaryRow,
} from "@/lib/runs/console/types";
import { decodeHtmlEntities, toHoursAgo } from "@/lib/runs/console/utils";

function normalizeStorySummaryStrings(
  value: StorySummaryJson,
): StorySummaryJson {
  return {
    ...value,
    summary: decodeHtmlEntities(value.summary).trim(),
    latest_development: decodeHtmlEntities(value.latest_development).trim(),
    timeline: value.timeline.map((item) => ({
      ...item,
      summary: decodeHtmlEntities(item.summary).trim(),
    })),
    key_facts: value.key_facts.map((f) => decodeHtmlEntities(f).trim()),
    quotes: value.quotes.map((q) => ({
      ...q,
      speaker: decodeHtmlEntities(q.speaker).trim(),
      speaker_context: decodeHtmlEntities(q.speaker_context).trim(),
      text: decodeHtmlEntities(q.text).trim(),
    })),
  };
}

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
      pub: publisherId,
      urls: canonicalUrls.length,
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
      pub: publisherId,
      rows: (data ?? []).length,
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
      n: index + 1,
      total: sortedClusters.length,
      cluster: cluster.id,
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
      "You condense multiple news articles about the same story into ONE structured JSON object.",
      "Instructions:",
      "1) Output MUST match the required JSON shape. All narrative string fields MUST be in Spanish.",
      "2) Use only the provided article texts. Do not invent facts, quotes, or dates.",
      "3) In `summary`, synthesize all sources into one coherent account; lead with the newest verified development, then context.",
      "4) `timeline` must list main developments from oldest to newest. Exactly one item must have is_latest=true.",
      "5) `latest_development` must describe that same newest item in one sentence.",
      "6) `latest_development_at` must equal the `timestamp` of the timeline entry where is_latest is true (use null for both when timing is unknown).",
      "7) `key_facts`: each item must be a detailed fact in Spanish (about 1–3 sentences, minimum ~80 characters typical). Include who did what, where relevant places, figures, institutional roles, and dates when the sources give them. One main claim per item; no duplicates; no opinions.",
      "8) `quotes`: only direct quotes from the sources. Every object must include `speaker` (short name) and `speaker_context` (official role, political party, ministry, or affiliation as grounded in the articles). Use an empty array if none.",
      "9) Set `story_id` and `story_title` exactly as given below (do not change them).",
      `10) Set \`as_of\` exactly to: ${referenceNowIso}`,
      "11) Keep a skeptical and balanced tone: acknowledge source bias and possible institutional agendas.",
      "12) Keep that skepticism evidence-based and non-conspiratorial.",
      "13) Use proper Spanish orthography (UTF-8), including accents and ñ; never replace accented characters with ASCII placeholders, numbers, or entities.",
      `14) ${OBJECTIVE_JOURNALISTIC_TONE_INSTRUCTION}`,
      `Reference date/time for recency ("now"): ${referenceNowIso}.`,
      `story_id (cluster id): ${cluster.id}`,
      `story_title: ${cluster.title}`,
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
      "Return the structured story summary JSON now.",
    ]
      .filter(Boolean)
      .join("\n");

    const generated = await generateGeminiJson(prompt, simpleStorySummarySchema, {
      model: RUN_BRIEF_MODEL,
      nativeStructuredOutput: {
        responseJsonSchema: simpleStorySummaryResponseJsonSchema,
      },
    });
    const normalized = normalizeStorySummaryStrings(generated);
    const latestTimeline = normalized.timeline.find((item) => item.is_latest);
    const aligned = {
      ...normalized,
      latest_development_at: latestTimeline
        ? latestTimeline.timestamp
        : normalized.latest_development_at,
    };
    const finalPayload = simpleStorySummarySchema.parse({
      ...aligned,
      story_id: cluster.id,
      story_title: cluster.title,
      as_of: referenceNowIso,
    });
    const detailMarkdown = JSON.stringify(finalPayload);
    summaries.push({
      clusterId: cluster.id,
      title: cluster.title,
      detailMarkdown,
    });
    logLine("story_summary: completed", {
      cluster: cluster.id,
      chars: detailMarkdown.length,
    });
  }
  logLine("generate_story_summaries: done", { summaries: summaries.length });
  return summaries;
}
