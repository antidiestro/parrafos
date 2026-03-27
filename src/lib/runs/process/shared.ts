import type { Json } from "@/database.types";
import { z } from "zod";
import { cleanTextForLLM } from "@/lib/extract/html";
import { generateGeminiJson } from "@/lib/gemini/generate";
import {
  RUN_BRIEF_MODEL,
  RUN_CLUSTER_MODEL,
  RUN_EXTRACT_MODEL,
  RUN_RELEVANCE_MODEL,
} from "@/lib/runs/constants";
import { persistRunProgressSnapshot } from "@/lib/runs/persistence/progress-repo";
import type { RunMetadata } from "@/lib/runs/progress";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export type CandidateSource = {
  publisherId: string;
  publisherName: string;
  url: string;
  canonicalUrl: string;
  title: string | null;
  description: string | null;
  publishedAt: string | null;
};

export type ExtractedArticle = CandidateSource & {
  sourceUrl: string;
  bodyText: string;
};

export type PrefetchedArticle = CandidateSource & {
  sourceUrl: string;
  html: string;
};

export type RetryFailedExtractionsResult = {
  retriedCount: number;
  succeededCount: number;
  failedCount: number;
  briefPublished: boolean;
};

export type PersistedCluster = {
  id: string;
  title: string;
  summary: string | null;
  status:
    | "clustered"
    | "eligible"
    | "selected"
    | "discarded_low_sources"
    | "not_selected";
  sourceCount: number;
  sourceKeys: string[];
};

export type SelectionDecision = {
  selectedClusterIds: Set<string>;
  reasonsByClusterId: Map<string, string>;
  latestDevelopmentByClusterId: Map<string, string>;
};

const articleBodySchema = z.object({
  body_text: z.string().trim().min(1),
});

const briefParagraphSchema = z.object({
  markdown: z.string().trim().min(10),
});

const briefParagraphResponseJsonSchema = {
  type: "object",
  properties: {
    markdown: { type: "string", minLength: 10 },
  },
  required: ["markdown"],
};

function replaceNewlinesWithSpaces(value: string) {
  return value
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toHoursAgo(iso: string | null, nowMs: number): number | null {
  if (!iso) return null;
  const ts = +new Date(iso);
  if (!Number.isFinite(ts)) return null;
  const delta = nowMs - ts;
  if (delta < 0) return 0;
  return Math.round((delta / (1000 * 60 * 60)) * 10) / 10;
}

function ensureStartsWithIntroBold(markdown: string): string {
  const trimmed = markdown.trim();
  if (/^\*\*.+?\*\*/.test(trimmed)) return trimmed;
  return `**Top update:** ${trimmed}`;
}

export function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function logRun(
  runId: string | null,
  message: string,
  context?: Record<string, unknown>,
) {
  const runLabel = runId ?? "none";
  if (context) {
    console.log(
      `[worker:runs] ${new Date().toISOString()} [run:${runLabel}] ${message}`,
      context,
    );
  } else {
    console.log(
      `[worker:runs] ${new Date().toISOString()} [run:${runLabel}] ${message}`,
    );
  }
}

export function toCanonicalUrl(raw: string, baseUrl: string): string | null {
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

export function getExtractConcurrency(): number {
  const raw = process.env.RUN_EXTRACT_CONCURRENCY;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 5;
  }
  return Math.min(parsed, 20);
}

export async function updateRunProgress(
  runId: string,
  patch: {
    status?: "running" | "completed" | "failed" | "cancelled";
    ended_at?: string;
    error_message?: string | null;
    metadata: RunMetadata;
  },
) {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("runs")
    .update({
      status: patch.status,
      ended_at: patch.ended_at,
      error_message: patch.error_message ?? null,
      metadata: patch.metadata as Json,
    })
    .eq("id", runId);
  if (error) {
    throw new Error(error.message);
  }
  await persistRunProgressSnapshot(runId, patch.metadata);
}

export async function isRunCancelled(runId: string): Promise<boolean> {
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

export async function extractArticleBodyText(
  url: string,
  cleanedText: string,
  identifiedTitle: string | null,
) {
  return generateGeminiJson(
    [
      "Extract full article text from this plain text.",
      'Return JSON object with only {"body_text":"..."}',
      "body_text must be the full article text, no summaries.",
      identifiedTitle ? `Identified title hint: ${identifiedTitle}` : null,
      `Article URL: ${url}`,
      "Text:",
      cleanedText,
    ]
      .filter(Boolean)
      .join("\n"),
    articleBodySchema,
    { model: RUN_EXTRACT_MODEL },
  );
}

export async function createAndPublishBriefForRun(runId: string) {
  const supabase = createSupabaseServiceClient();

  const { data: clusterRows, error: clustersError } = await supabase
    .from("run_story_clusters")
    .select("id,source_count,title,selection_reason,created_at")
    .eq("run_id", runId)
    .eq("status", "selected");

  if (clustersError) {
    throw new Error(clustersError.message);
  }

  const selectedClusters = (clusterRows ?? []) as Array<{
    id: string;
    source_count: number;
    title: string;
    selection_reason: string | null;
    created_at: string;
  }>;
  if (selectedClusters.length === 0) return;

  const clusterIds = selectedClusters.map((c) => c.id);
  const { data: sourceRows, error: sourcesError } = await supabase
    .from("run_story_cluster_sources")
    .select(
      "cluster_id,publisher_id,canonical_url,url,title,published_at,publishers(name)",
    )
    .in("cluster_id", clusterIds);

  if (sourcesError) {
    throw new Error(sourcesError.message);
  }

  const sources = (sourceRows ?? []) as Array<{
    cluster_id: string;
    publisher_id: string;
    canonical_url: string;
    url: string;
    title: string | null;
    published_at: string | null;
    publishers: { name: string } | null;
  }>;

  const urlsByPublisher = new Map<string, Set<string>>();
  for (const source of sources) {
    const set = urlsByPublisher.get(source.publisher_id) ?? new Set<string>();
    set.add(source.canonical_url);
    urlsByPublisher.set(source.publisher_id, set);
  }

  const articleTextByKey = new Map<string, string>();
  for (const [publisherId, canonicalUrlsSet] of urlsByPublisher.entries()) {
    const canonicalUrls = Array.from(canonicalUrlsSet);
    const { data: articleRows, error: articleError } = await supabase
      .from("articles")
      .select("publisher_id,canonical_url,body_text")
      .eq("publisher_id", publisherId)
      .in("canonical_url", canonicalUrls);
    if (articleError) throw new Error(articleError.message);
    for (const row of articleRows ?? []) {
      if (!row.body_text) continue;
      articleTextByKey.set(
        `${row.publisher_id}::${row.canonical_url}`,
        row.body_text,
      );
    }
  }

  const maxPublishedAtByCluster = new Map<string, string | null>();
  for (const cluster of selectedClusters) {
    const clusterPublishedAt = sources
      .filter((s) => s.cluster_id === cluster.id)
      .map((s) => s.published_at)
      .filter((v): v is string => Boolean(v))
      .sort((a, b) => +new Date(b) - +new Date(a))[0];
    maxPublishedAtByCluster.set(cluster.id, clusterPublishedAt ?? null);
  }

  const sortedClusters = selectedClusters.slice().sort((a, b) => {
    if (b.source_count !== a.source_count)
      return b.source_count - a.source_count;
    const aMax = maxPublishedAtByCluster.get(a.id) ?? null;
    const bMax = maxPublishedAtByCluster.get(b.id) ?? null;
    if (aMax && bMax) return +new Date(bMax) - +new Date(aMax);
    if (aMax && !bMax) return -1;
    if (!aMax && bMax) return 1;
    return +new Date(a.created_at) - +new Date(b.created_at);
  });

  const generatedStoryMarkdown: string[] = [];
  const nowMs = Date.now();
  for (const cluster of sortedClusters) {
    const clusterSources = sources
      .filter((s) => s.cluster_id === cluster.id)
      .slice()
      .sort((a, b) => {
        if (a.published_at && b.published_at) {
          return +new Date(b.published_at) - +new Date(a.published_at);
        }
        if (a.published_at && !b.published_at) return -1;
        if (!a.published_at && b.published_at) return 1;
        return a.url.localeCompare(b.url);
      });
    const latestClusterSourceTime = clusterSources.find(
      (source) => source.published_at,
    )?.published_at;
    const latestHoursAgo = toHoursAgo(latestClusterSourceTime ?? null, nowMs);

    const sourceTexts: string[] = [];
    for (const source of clusterSources) {
      const key = `${source.publisher_id}::${source.canonical_url}`;
      const bodyText = articleTextByKey.get(key);
      if (!bodyText) continue;
      sourceTexts.push(
        [
          `Source URL: ${source.url}`,
          `Source: ${source.publishers?.name ?? source.publisher_id}`,
          source.title ? `Title hint: ${source.title}` : null,
          source.published_at
            ? `Published at: ${new Date(source.published_at).toISOString()}`
            : null,
          "Full text:",
          bodyText,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }
    if (sourceTexts.length === 0) {
      throw new Error(
        `No extracted article text available for cluster ${cluster.id}`,
      );
    }

    const prompt = [
      "You write a single news brief paragraph in Markdown (~600 characters).",
      "The brief is for a story made of multiple sources.",
      "Instructions:",
      "1) Output exactly one Markdown paragraph (no headings, no lists).",
      "2) Always start with an introductory phrase in bold (first characters must be bold).",
      "3) First sentence must state the latest concrete development right now.",
      "4) Keep historical context concise and only as support for the latest update.",
      "5) If story spans multiple days, emphasize what changed recently vs prior coverage.",
      "6) Avoid recap-heavy phrasing and avoid listing everything that happened.",
      `Story title / topic: ${cluster.title}`,
      cluster.selection_reason
        ? `Why this story was selected: ${cluster.selection_reason}`
        : null,
      latestClusterSourceTime
        ? `Most recent source timestamp: ${new Date(latestClusterSourceTime).toISOString()}`
        : null,
      latestHoursAgo !== null
        ? `Most recent source is approximately ${latestHoursAgo} hours old.`
        : null,
      "Relevant sources (full texts), each delimited by ---:",
      sourceTexts.map((t) => `---\n${t}\n---`).join("\n"),
      "Write the paragraph now.",
    ]
      .filter(Boolean)
      .join("\n");

    const generated = await generateGeminiJson(prompt, briefParagraphSchema, {
      model: RUN_BRIEF_MODEL,
      nativeStructuredOutput: {
        responseJsonSchema: briefParagraphResponseJsonSchema,
      },
    });
    const cleaned = ensureStartsWithIntroBold(
      replaceNewlinesWithSpaces(generated.markdown),
    );
    generatedStoryMarkdown.push(cleaned);
    console.log(
      `[worker:runs] ${new Date().toISOString()} [run:${runId}] brief: cluster paragraph ok`,
      {
        clusterId: cluster.id,
        title: cluster.title,
        rawMarkdownChars: generated.markdown.length,
        cleanedMarkdownChars: cleaned.length,
        cleanedPreview: cleaned.slice(0, 280),
      },
    );
  }

  const { data: briefRow, error: briefInsertError } = await supabase
    .from("briefs")
    .insert({
      title: "Parrafos brief",
      status: "published",
      published_at: new Date().toISOString(),
    })
    .select("id")
    .maybeSingle();
  if (briefInsertError) throw new Error(briefInsertError.message);
  if (!briefRow?.id) throw new Error("Unable to create brief record");

  const storyInsertRows = generatedStoryMarkdown.map((markdown, idx) => ({
    brief_id: briefRow.id,
    position: idx + 1,
    markdown,
  }));
  const { error: storiesInsertError } = await supabase
    .from("stories")
    .insert(storyInsertRows);
  if (storiesInsertError) throw new Error(storiesInsertError.message);

  console.log(
    `[worker:runs] ${new Date().toISOString()} [run:${runId}] brief: published`,
    {
      briefId: briefRow.id,
      storyCount: generatedStoryMarkdown.length,
    },
  );
}

export function findMetadataArticleProgress(
  metadata: RunMetadata,
  source: {
    publisher_id: string;
    canonical_url: string;
    url: string;
  },
) {
  return metadata.articles.find(
    (entry) =>
      entry.publisher_id === source.publisher_id &&
      (entry.canonical_url === source.canonical_url ||
        entry.url === source.url ||
        entry.url === source.canonical_url),
  );
}

export {
  cleanTextForLLM,
  RUN_CLUSTER_MODEL,
  RUN_EXTRACT_MODEL,
  RUN_RELEVANCE_MODEL,
};
