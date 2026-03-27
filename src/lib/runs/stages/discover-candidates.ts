import { listPublishers } from "@/lib/data/publishers";
import { extractArticleCandidatesFromHomepage } from "@/lib/extract/article-candidates";
import { fetchHtmlWithRetries } from "@/lib/extract/fetch";
import { divider, logLine } from "@/lib/runs/console/logging";
import type { CandidateSource } from "@/lib/runs/console/types";
import { mapWithConcurrency, toCanonicalUrl } from "@/lib/runs/console/utils";

export async function discoverCandidates(): Promise<CandidateSource[]> {
  divider("discover_candidates");
  const publishers = await listPublishers();
  logLine("loaded publishers", { count: publishers.length });
  if (publishers.length === 0) {
    throw new Error("No publishers configured.");
  }

  const discovered = await mapWithConcurrency(
    publishers,
    publishers.length,
    async (publisher) => {
      logLine("publisher discovery: started", {
        publisherId: publisher.id,
        publisherName: publisher.name,
      });
      try {
        const home = await fetchHtmlWithRetries(publisher.base_url, { retries: 0 });
        const rawCandidates = extractArticleCandidatesFromHomepage(
          publisher.base_url,
          home.html,
        );
        const deduped = Array.from(
          new Set(
            rawCandidates
              .map((row) => toCanonicalUrl(row.url, publisher.base_url))
              .filter((value): value is string => Boolean(value)),
          ),
        ).slice(0, 20);

        const rows: CandidateSource[] = deduped.map((url) => ({
          publisherId: publisher.id,
          publisherName: publisher.name,
          url,
          canonicalUrl: toCanonicalUrl(url, url) ?? url,
          title: null,
          description: null,
          publishedAt: null,
        }));
        logLine("publisher discovery: completed", {
          publisherId: publisher.id,
          candidates: rows.length,
        });
        return rows;
      } catch (error) {
        logLine("publisher discovery: failed", {
          publisherId: publisher.id,
          error: error instanceof Error ? error.message : String(error),
        });
        return [];
      }
    },
  );

  const flat = discovered.flat();
  logLine("discover_candidates: done", { candidatesTotal: flat.length });
  return flat;
}
