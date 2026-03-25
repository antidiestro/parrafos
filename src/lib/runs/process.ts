import { z } from "zod";
import type { Json } from "@/database.types";
import { listPublishers } from "@/lib/data/publishers";
import { fetchHtmlWithRetries } from "@/lib/extract/fetch";
import { cleanHtmlForLLM } from "@/lib/extract/html";
import { generateGeminiJson } from "@/lib/gemini/generate";
import { RUN_MODEL } from "@/lib/runs/constants";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

type RunError = { publisher_id?: string; url?: string; message: string };
type RunMetadata = {
  model: string;
  publisher_count: number;
  publishers_done: number;
  articles_found: number;
  articles_upserted: number;
  errors: RunError[];
};

const articleListSchema = z.object({
  articles: z
    .array(
      z.object({
        title: z.string().trim().min(1).optional(),
        url: z.string().trim().min(1),
      }),
    )
    .max(20),
});

const articleDetailsSchema = z.object({
  canonical_url: z.string().trim().min(1).nullable().optional(),
  title: z.string().trim().min(1).nullable().optional(),
  published_at: z.string().trim().min(1).nullable().optional(),
  body_text: z.string().trim().min(1),
});

function createInitialMetadata(): RunMetadata {
  return {
    model: RUN_MODEL,
    publisher_count: 0,
    publishers_done: 0,
    articles_found: 0,
    articles_upserted: 0,
    errors: [],
  };
}

function toCanonicalUrl(raw: string, baseUrl: string): string | null {
  try {
    const url = new URL(raw, baseUrl);
    url.hash = "";
    const removable = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"];
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

async function updateRunProgress(
  runId: string,
  patch: { status?: "running" | "completed" | "failed"; ended_at?: string; error_message?: string | null; metadata: RunMetadata },
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

async function extractArticleUrls(homeUrl: string, cleanedHtml: string): Promise<{ title?: string; url: string }[]> {
  const result = await generateGeminiJson(
    [
      "You extract article links from a publisher homepage.",
      "Return JSON object: {\"articles\":[{\"title\":\"...\",\"url\":\"...\"}]}",
      "Only include news article URLs, at most 20 items.",
      `Homepage URL: ${homeUrl}`,
      "HTML:",
      cleanedHtml,
    ].join("\n"),
    articleListSchema,
    { model: RUN_MODEL },
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
    { model: RUN_MODEL },
  );
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

  const metadata = createInitialMetadata();
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
  const metadata = createInitialMetadata();
  try {
    const publishers = await listPublishers();
    metadata.publisher_count = publishers.length;
    await updateRunProgress(runId, { metadata });

    for (const publisher of publishers) {
      try {
        const home = await fetchHtmlWithRetries(publisher.base_url);
        const cleanedHomeHtml = cleanHtmlForLLM(home.html);
        const candidates = await extractArticleUrls(publisher.base_url, cleanedHomeHtml);
        const normalizedUrls = Array.from(
          new Set(
            candidates
              .map((c) => toCanonicalUrl(c.url, publisher.base_url))
              .filter((value): value is string => Boolean(value)),
          ),
        ).slice(0, 20);

        metadata.articles_found += normalizedUrls.length;

        for (const articleUrl of normalizedUrls) {
          try {
            const articleRes = await fetchHtmlWithRetries(articleUrl);
            const cleanedArticleHtml = cleanHtmlForLLM(articleRes.html);
            const details = await extractArticleDetails(articleRes.finalUrl, cleanedArticleHtml);
            const canonicalUrl =
              toCanonicalUrl(details.canonical_url ?? articleRes.finalUrl, articleRes.finalUrl) ??
              articleRes.finalUrl;

            const { error: upsertError } = await supabase.from("articles").upsert(
              {
                publisher_id: publisher.id,
                run_id: runId,
                canonical_url: canonicalUrl,
                title: details.title ?? null,
                body_text: details.body_text,
                published_at: toTimestampOrNull(details.published_at),
                metadata: {
                  source_url: articleRes.finalUrl,
                  model: RUN_MODEL,
                },
              },
              { onConflict: "publisher_id,canonical_url" },
            );
            if (upsertError) {
              throw new Error(upsertError.message);
            }
            metadata.articles_upserted += 1;
          } catch (error) {
            metadata.errors.push({
              publisher_id: publisher.id,
              url: articleUrl,
              message: error instanceof Error ? error.message : "Article extraction failed",
            });
          }
        }
      } catch (error) {
        metadata.errors.push({
          publisher_id: publisher.id,
          message: error instanceof Error ? error.message : "Publisher crawl failed",
        });
      } finally {
        metadata.publishers_done += 1;
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
