import { z } from "zod";
import type { Json } from "@/database.types";
import { cleanTextForLLM } from "@/lib/extract/html";
import { generateGeminiJson } from "@/lib/gemini/generate";
import {
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
