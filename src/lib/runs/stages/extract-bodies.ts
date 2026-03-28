import { z } from "zod";
import { cleanTextForLLM } from "@/lib/extract/html";
import { fetchHtmlWithRetries } from "@/lib/extract/fetch";
import { generateGeminiJson } from "@/lib/gemini/generate";
import { RUN_EXTRACT_MODEL } from "@/lib/runs/constants";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { divider, logLine } from "@/lib/runs/console/logging";
import type {
  CandidateSource,
  ClusterDraft,
  ExtractedArticle,
  PrefetchedArticle,
} from "@/lib/runs/console/types";
import { sourceKeyFor } from "@/lib/runs/console/utils";

async function articleExists(
  publisherId: string,
  canonicalUrl: string,
): Promise<boolean> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("articles")
    .select("id")
    .eq("publisher_id", publisherId)
    .eq("canonical_url", canonicalUrl)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const exists = Boolean(data);
  logLine("extract: existing article lookup finished", {
    pub: publisherId,
    key: sourceKeyFor(publisherId, canonicalUrl),
    exists,
  });
  return exists;
}

export async function extractBodies(input: {
  selectedClusters: ClusterDraft[];
  sourceByKey: Map<string, CandidateSource>;
  prefetchedByKey: Map<string, PrefetchedArticle>;
}): Promise<{
  extracted: ExtractedArticle[];
  skippedExisting: number;
}> {
  divider("extract_bodies");
  const selectedCandidates = input.selectedClusters.flatMap((cluster) =>
    cluster.sourceKeys
      .map((key) => input.sourceByKey.get(key))
      .filter((value): value is CandidateSource => Boolean(value)),
  );
  const uniqueByKey = new Map<string, CandidateSource>();
  for (const row of selectedCandidates) {
    uniqueByKey.set(`${row.publisherId}::${row.canonicalUrl}`, row);
  }
  const candidates = Array.from(uniqueByKey.values());

  const extracted: ExtractedArticle[] = [];
  let skippedExisting = 0;
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    logLine("extract: item started", {
      n: index + 1,
      total: candidates.length,
      pub: candidate.publisherId,
      url: candidate.url,
    });
    const exists = await articleExists(candidate.publisherId, candidate.canonicalUrl);
    if (exists) {
      skippedExisting += 1;
      logLine("extract: skipped existing article", {
        pub: candidate.publisherId,
        key: sourceKeyFor(candidate.publisherId, candidate.canonicalUrl),
      });
      continue;
    }
    try {
      const prefetched = input.prefetchedByKey.get(
        `${candidate.publisherId}::${candidate.url}`,
      );
      const articleRes = prefetched
        ? { finalUrl: prefetched.sourceUrl, html: prefetched.html }
        : await fetchHtmlWithRetries(candidate.url, { retries: 0 });
      const cleanedText = cleanTextForLLM(articleRes.html);
      const extraction = await generateGeminiJson(
        [
          "Extract full article text from this plain text.",
          'Return JSON object with only {"body_text":"..."}',
          "body_text must be the full article text, no summaries.",
          candidate.title ? `Identified title hint: ${candidate.title}` : null,
          `Article URL: ${articleRes.finalUrl}`,
          "Text:",
          cleanedText,
        ]
          .filter(Boolean)
          .join("\n"),
        z.object({ body_text: z.string().trim().min(1) }),
        { model: RUN_EXTRACT_MODEL },
      );
      extracted.push({
        ...candidate,
        sourceUrl: articleRes.finalUrl,
        bodyText: extraction.body_text,
      });
      logLine("extract: success", {
        pub: candidate.publisherId,
        key: sourceKeyFor(candidate.publisherId, candidate.canonicalUrl),
        bodyChars: extraction.body_text.length,
      });
    } catch (error) {
      logLine("extract: failed", {
        pub: candidate.publisherId,
        key: sourceKeyFor(candidate.publisherId, candidate.canonicalUrl),
        err: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logLine("extract_bodies: done", {
    extracted: extracted.length,
    skippedExisting,
  });
  return { extracted, skippedExisting };
}
