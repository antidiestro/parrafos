import { generateGeminiJson } from "@/lib/gemini/generate";
import { divider, logLine } from "@/lib/runs/console/logging";
import {
  clusterResponseJsonSchema,
  clusterSchema,
  clusterSportsFilterResponseJsonSchema,
  clusterSportsFilterSchema,
} from "@/lib/runs/console/pipeline-constants";
import type { CandidateSource, ClusterDraft } from "@/lib/runs/console/types";
import {
  clusterPromptAliasForCandidateIndex,
  sourceKeyFor,
  toSingleLine,
} from "@/lib/runs/console/utils";
import { RUN_CLUSTER_MODEL, RUN_EXTRACT_MODEL } from "@/lib/runs/constants";

async function filterOutRoutineSportsCandidates(
  candidates: CandidateSource[],
): Promise<CandidateSource[]> {
  if (candidates.length === 0) {
    return candidates;
  }

  const sportsFilterLines = candidates.map((candidate, index) => {
    const alias = clusterPromptAliasForCandidateIndex(index);
    const headline = toSingleLine(candidate.title) || "(no headline)";
    return `${alias} | ${headline}`;
  });

  const filtered = await generateGeminiJson(
    [
      "You filter a list of news candidate headlines before clustering.",
      "Each line is: source_ref | headline. The source_ref is only an id (e.g. c1, c2); use the headline text to decide.",
      "Identify lines whose headline is clearly about sports in a routine, non-history-making way.",
      "History-making sports means: landmark championship wins, unprecedented or broken records with lasting significance, major structural milestones for a league or sport, or similar rare defining moments.",
      "Routine sports to EXCLUDE: regular season or typical match results, ordinary trades or signings, previews, injury updates, and generic sports news without that exceptional bar.",
      "If a line is not clearly sports, or sports significance is ambiguous, do NOT remove it (err on the side of keeping).",
      "Non-sports lines must never appear in remove_source_refs.",
      'Return JSON: {"remove_source_refs":["c3",...]} listing only source_ref strings to drop. Use an empty array if none.',
      "Candidates:",
      sportsFilterLines.join("\n"),
    ].join("\n"),
    clusterSportsFilterSchema,
    {
      model: RUN_EXTRACT_MODEL,
      nativeStructuredOutput: {
        responseJsonSchema: clusterSportsFilterResponseJsonSchema,
      },
    },
  );

  const remove = new Set(
    filtered.remove_source_refs.map((ref) => ref.trim()).filter(Boolean),
  );
  const kept = candidates.filter(
    (_, index) => !remove.has(clusterPromptAliasForCandidateIndex(index)),
  );

  logLine("cluster_sources: sports pre-filter", {
    model: RUN_EXTRACT_MODEL,
    before: candidates.length,
    removed: candidates.length - kept.length,
    after: kept.length,
  });

  return kept;
}

export async function clusterSources(candidates: CandidateSource[]): Promise<{
  clusters: ClusterDraft[];
  sourceByKey: Map<string, CandidateSource>;
}> {
  divider("cluster_sources");
  logLine("cluster_sources: input prepared", { candidates: candidates.length });
  if (candidates.length === 0) {
    throw new Error("No candidates available for clustering.");
  }

  const afterSportsFilter = await filterOutRoutineSportsCandidates(candidates);
  if (afterSportsFilter.length === 0) {
    throw new Error(
      "cluster_sources: sports pre-filter removed every candidate; nothing left to cluster.",
    );
  }

  const sourceByKey = new Map<string, CandidateSource>();
  for (const candidate of afterSportsFilter) {
    sourceByKey.set(
      sourceKeyFor(candidate.publisherId, candidate.canonicalUrl),
      candidate,
    );
  }

  const aliasToStableKey = new Map<string, string>();
  const inputLines = afterSportsFilter.map((candidate, index) => {
    const stableKey = sourceKeyFor(
      candidate.publisherId,
      candidate.canonicalUrl,
    );
    const alias = clusterPromptAliasForCandidateIndex(index);
    aliasToStableKey.set(alias, stableKey);
    const headline = toSingleLine(candidate.title) || "(no headline)";
    return `${alias} | ${headline}`;
  });

  const generated = await generateGeminiJson(
    [
      "Assign every candidate source to exactly one story.",
      "Pay special attention to Chilean politics and to international affairs: prioritize accurate clustering and rich descriptions when headlines clearly concern Chile’s government, elections, institutions, major policy, or cross-border diplomatic and geopolitical developments.",
      "Use as many story clusters as needed so each source_ref appears in exactly one story.",
      "Each source_ref is the short id at the start of a candidate line (before the first |).",
      "Return the same source_ref strings in source_keys (not headline text or URLs).",
      "Group clearly related sources that describe the same concrete event or development.",
      "Single-source clusters are required when a source does not clearly match any other.",
      "Do not leave any candidate unassigned.",
      "For each story, write a rich description field of about 25 to 40 words (can go longer if needed): name the event, key actors, context, and stakes—full sentences, not a short headline.",
      'Return JSON object: {"stories":[{"description":"...","source_keys":["..."]}]}',
      "Candidate sources (one per line inside the block: source_ref | source headline):",
      "<candidate_sources>",
      inputLines.join("\n"),
      "</candidate_sources>",
    ].join("\n"),
    clusterSchema,
    {
      model: RUN_CLUSTER_MODEL,
      nativeStructuredOutput: { responseJsonSchema: clusterResponseJsonSchema },
    },
  );
  logLine("cluster_sources: model response received", {
    returnedStories: generated.stories.length,
  });

  const usedKeys = new Set<string>();
  const clusters: ClusterDraft[] = [];
  let nextClusterNumber = 1;
  for (const story of generated.stories) {
    const sourceKeys: string[] = [];
    for (const raw of story.source_keys) {
      const trimmed = raw.trim();
      const stableKey =
        aliasToStableKey.get(trimmed) ??
        (sourceByKey.has(trimmed) ? trimmed : null);
      if (!stableKey) continue;
      if (!sourceByKey.has(stableKey)) continue;
      if (usedKeys.has(stableKey)) continue;
      usedKeys.add(stableKey);
      sourceKeys.push(stableKey);
    }

    if (sourceKeys.length === 0) continue;

    clusters.push({
      id: `cluster_${nextClusterNumber}`,
      title: story.description.trim() || `Story cluster ${nextClusterNumber}`,
      sourceKeys,
      selectionReason: null,
    });
    nextClusterNumber += 1;
  }

  const orphanKeys = Array.from(sourceByKey.keys())
    .filter((key) => !usedKeys.has(key))
    .sort((a, b) => a.localeCompare(b));
  for (const key of orphanKeys) {
    const candidate = sourceByKey.get(key);
    if (!candidate) {
      throw new Error(`cluster_sources: orphan key not in sourceByKey: ${key}`);
    }
    usedKeys.add(key);
    const titleFromArticle =
      (toSingleLine(candidate.title) || "").trim() ||
      `Story cluster ${nextClusterNumber}`;
    clusters.push({
      id: `cluster_${nextClusterNumber}`,
      title: titleFromArticle,
      sourceKeys: [key],
      selectionReason: null,
    });
    nextClusterNumber += 1;
  }

  const assignedSources = clusters.reduce(
    (acc, row) => acc + row.sourceKeys.length,
    0,
  );
  logLine("cluster_sources: done", {
    clustersCreated: clusters.length,
    assignedSources,
    uniqueCandidates: sourceByKey.size,
    singletonBackfill: orphanKeys.length,
    candidatesTotal: afterSportsFilter.length,
    candidatesBeforeSportsFilter: candidates.length,
  });
  return { clusters, sourceByKey };
}
