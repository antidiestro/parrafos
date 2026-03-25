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

type ExtractedArticle = {
  sourceUrl: string;
  canonicalUrl: string;
  title: string | null;
  bodyText: string;
  publishedAt: string | null;
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
    status?: "running" | "completed" | "failed";
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

async function extractArticleUrls(
  homeUrl: string,
  cleanedHtml: string,
): Promise<{ title?: string; url: string }[]> {
  const result = await generateGeminiJson(
    [
      "You extract article links from a publisher homepage.",
      'Return JSON object: {"articles":[{"title":"...","url":"..."}]}',
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
  const extractConcurrency = getExtractConcurrency();
  try {
    const publishers = await listPublishers();
    metadata.publisher_count = publishers.length;
    await updateRunProgress(runId, { metadata });

    for (const publisher of publishers) {
      try {
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

        const extractedArticles = await mapWithConcurrency(
          normalizedUrls,
          extractConcurrency,
          async (articleUrl): Promise<ExtractedArticle | null> => {
            try {
              const articleRes = await fetchHtmlWithRetries(articleUrl, {
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
                ) ?? articleRes.finalUrl;

              return {
                sourceUrl: articleRes.finalUrl,
                canonicalUrl,
                title: details.title ?? null,
                bodyText: details.body_text,
                publishedAt: toTimestampOrNull(details.published_at),
              };
            } catch (error) {
              metadata.errors.push({
                publisher_id: publisher.id,
                url: articleUrl,
                message:
                  error instanceof Error
                    ? error.message
                    : "Article extraction failed",
              });
              return null;
            }
          },
        );

        for (const article of extractedArticles) {
          if (!article) continue;
          try {
            const { error: upsertError } = await supabase
              .from("articles")
              .upsert(
                {
                  publisher_id: publisher.id,
                  run_id: runId,
                  canonical_url: article.canonicalUrl,
                  title: article.title,
                  body_text: article.bodyText,
                  published_at: article.publishedAt,
                  metadata: {
                    source_url: article.sourceUrl,
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
              url: article.sourceUrl,
              message:
                error instanceof Error ? error.message : "Article upsert failed",
            });
          }
        }
      } catch (error) {
        metadata.errors.push({
          publisher_id: publisher.id,
          message:
            error instanceof Error ? error.message : "Publisher crawl failed",
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
