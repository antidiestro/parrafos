import type { CandidateSource } from "@/lib/runs/console/types";
import { logLine } from "@/lib/runs/console/logging";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

/** Deduplicated canonical URLs, sorted for stable storage and diffs. */
export function sortedCanonicalUrlsFromCandidates(
  candidates: CandidateSource[],
): string[] {
  const unique = new Set(
    candidates.map((row) => row.canonicalUrl).filter(Boolean),
  );
  return Array.from(unique).sort((a, b) => a.localeCompare(b));
}

/** Latest snapshot from a prior **completed** brief (failed runs do not insert). */
export async function fetchLatestDiscoveryBaselineUrls(): Promise<string[]> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("run_discovery_candidates")
    .select("canonical_urls")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.canonical_urls ?? [];
}

export function newCandidateMetrics(
  discovered: CandidateSource[],
  baselineUrls: string[],
): {
  currentCount: number;
  baselineCount: number;
  newCount: number;
  /** 0–100, two decimal places; 0 when `currentCount` is 0. */
  pctNew: number;
} {
  const current = sortedCanonicalUrlsFromCandidates(discovered);
  const baseline = new Set(baselineUrls);
  let newCount = 0;
  for (const url of current) {
    if (!baseline.has(url)) newCount += 1;
  }
  const currentCount = current.length;
  const pctNew =
    currentCount === 0
      ? 0
      : Math.round((newCount / currentCount) * 10_000) / 100;
  return {
    currentCount,
    baselineCount: baseline.size,
    newCount,
    pctNew,
  };
}

/** Call only after a successful brief pipeline: full initial `discover_candidates` set, not selected/extracted subsets. */
export async function persistDiscoveryCandidates(input: {
  runId: string;
  discovered: CandidateSource[];
}) {
  const canonicalUrls = sortedCanonicalUrlsFromCandidates(input.discovered);
  logLine("runs: persisting discovery candidates", {
    runId: input.runId,
    count: canonicalUrls.length,
  });
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase.from("run_discovery_candidates").insert({
    run_id: input.runId,
    canonical_urls: canonicalUrls,
  });
  if (error) throw new Error(error.message);
}
