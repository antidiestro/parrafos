import { z } from "zod";
import type { Json } from "@/database.types";
import { listPublishers } from "@/lib/data/publishers";
import { fetchHtmlWithRetries } from "@/lib/extract/fetch";
import { cleanHtmlForLLM } from "@/lib/extract/html";
import { generateGeminiJson } from "@/lib/gemini/generate";
import { RUN_MODEL } from "@/lib/runs/constants";
import {
  createInitialRunMetadata,
  type RunMetadata,
} from "@/lib/runs/progress";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

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
    status?: "running" | "completed" | "failed" | "cancelled";
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

async function isRunCancelled(runId: string): Promise<boolean> {
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

  const metadata = createInitialRunMetadata();
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
  const metadata = createInitialRunMetadata();
  const extractConcurrency = getExtractConcurrency();
  try {
    const publishers = await listPublishers();
    metadata.publisher_count = publishers.length;
    metadata.publishers = publishers.map((publisher) => ({
      publisher_id: publisher.id,
      publisher_name: publisher.name,
      base_url: publisher.base_url,
      status: "pending",
      articles_found: 0,
      articles_upserted: 0,
      error_message: null,
    }));
    await updateRunProgress(runId, { metadata });
    if (await isRunCancelled(runId)) {
      return;
    }

    for (const publisher of publishers) {
      if (await isRunCancelled(runId)) {
        return;
      }
      const publisherProgress = metadata.publishers.find(
        (entry) => entry.publisher_id === publisher.id,
      );
      try {
        if (publisherProgress) {
          publisherProgress.status = "running";
          publisherProgress.error_message = null;
          await updateRunProgress(runId, { metadata });
        }
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
        if (publisherProgress) {
          publisherProgress.articles_found = normalizedUrls.length;
        }
        metadata.articles.push(
          ...normalizedUrls.map((url) => ({
            publisher_id: publisher.id,
            url,
            canonical_url: null,
            title: null,
            status: "pending" as const,
            error_message: null,
          })),
        );
        await updateRunProgress(runId, { metadata });

        const extractedArticles = await mapWithConcurrency(
          normalizedUrls,
          extractConcurrency,
          async (articleUrl): Promise<ExtractedArticle | null> => {
            if (await isRunCancelled(runId)) {
              return null;
            }
            const articleProgress = metadata.articles.find(
              (entry) =>
                entry.publisher_id === publisher.id && entry.url === articleUrl,
            );
            if (articleProgress) {
              articleProgress.status = "fetching";
              articleProgress.error_message = null;
              await updateRunProgress(runId, { metadata });
            }
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
              if (articleProgress) {
                articleProgress.canonical_url = canonicalUrl;
                articleProgress.title = details.title ?? null;
                articleProgress.status = "extracted";
                await updateRunProgress(runId, { metadata });
              }

              return {
                sourceUrl: articleRes.finalUrl,
                canonicalUrl,
                title: details.title ?? null,
                bodyText: details.body_text,
                publishedAt: toTimestampOrNull(details.published_at),
              };
            } catch (error) {
              if (articleProgress) {
                articleProgress.status = "failed";
                articleProgress.error_message =
                  error instanceof Error
                    ? error.message
                    : "Article extraction failed";
              }
              metadata.errors.push({
                publisher_id: publisher.id,
                url: articleUrl,
                message:
                  error instanceof Error
                    ? error.message
                    : "Article extraction failed",
              });
              await updateRunProgress(runId, { metadata });
              return null;
            }
          },
        );

        for (const article of extractedArticles) {
          if (await isRunCancelled(runId)) {
            return;
          }
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
            if (publisherProgress) {
              publisherProgress.articles_upserted += 1;
            }
            const articleProgress = metadata.articles.find(
              (entry) =>
                entry.publisher_id === publisher.id &&
                (entry.url === article.canonicalUrl ||
                  entry.url === article.sourceUrl ||
                  entry.canonical_url === article.canonicalUrl),
            );
            if (articleProgress) {
              articleProgress.status = "upserted";
            }
            await updateRunProgress(runId, { metadata });
          } catch (error) {
            const articleProgress = metadata.articles.find(
              (entry) =>
                entry.publisher_id === publisher.id &&
                (entry.url === article.canonicalUrl ||
                  entry.url === article.sourceUrl ||
                  entry.canonical_url === article.canonicalUrl),
            );
            if (articleProgress) {
              articleProgress.status = "failed";
              articleProgress.error_message =
                error instanceof Error ? error.message : "Article upsert failed";
            }
            metadata.errors.push({
              publisher_id: publisher.id,
              url: article.sourceUrl,
              message:
                error instanceof Error ? error.message : "Article upsert failed",
            });
            await updateRunProgress(runId, { metadata });
          }
        }
      } catch (error) {
        if (publisherProgress) {
          publisherProgress.status = "failed";
          publisherProgress.error_message =
            error instanceof Error ? error.message : "Publisher crawl failed";
        }
        metadata.errors.push({
          publisher_id: publisher.id,
          message:
            error instanceof Error ? error.message : "Publisher crawl failed",
        });
      } finally {
        metadata.publishers_done += 1;
        if (publisherProgress && publisherProgress.status === "running") {
          publisherProgress.status = "completed";
        }
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
