import { generateGeminiJson } from "@/lib/gemini/generate";
import { RUN_CLUSTER_MODEL } from "@/lib/runs/constants";
import {
  clusterResponseJsonSchema,
  clusterSchema,
} from "@/lib/runs/console/pipeline-constants";
import { divider, logLine } from "@/lib/runs/console/logging";
import type {
  CandidateSource,
  ClusterDraft,
} from "@/lib/runs/console/types";
import { sourceKeyFor, toSingleLine } from "@/lib/runs/console/utils";

export async function clusterSources(candidates: CandidateSource[]): Promise<{
  clusters: ClusterDraft[];
  sourceByKey: Map<string, CandidateSource>;
}> {
  divider("cluster_sources");
  logLine("cluster_sources: input prepared", { candidates: candidates.length });
  if (candidates.length === 0) {
    throw new Error("No candidates available for clustering.");
  }

  const sourceByKey = new Map<string, CandidateSource>();
  for (const candidate of candidates) {
    sourceByKey.set(
      sourceKeyFor(candidate.publisherId, candidate.canonicalUrl),
      candidate,
    );
  }

  const inputLines = candidates.map((candidate) => {
    const sourceKey = sourceKeyFor(candidate.publisherId, candidate.canonicalUrl);
    const title = toSingleLine(candidate.title) || "(untitled)";
    const publishedAt = candidate.publishedAt ?? "unknown";
    return `${sourceKey} | ${publishedAt} | ${title}`;
  });

  const generated = await generateGeminiJson(
    [
      "Group only clearly related sources into specific stories.",
      "Find at least 10 story clusters.",
      "Each source_key can appear in at most one story.",
      "Only group sources that describe one concrete event or development.",
      "Leave uncertain sources unassigned.",
      'Return JSON object: {"stories":[{"title":"...","source_keys":["..."]}]}',
      "Candidate sources (one per line: source_key | published_at | title):",
      inputLines.join("\n"),
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
    for (const key of story.source_keys) {
      if (!sourceByKey.has(key)) continue;
      if (usedKeys.has(key)) continue;
      usedKeys.add(key);
      sourceKeys.push(key);
    }

    if (sourceKeys.length < 3) continue;
    const uniquePublishers = new Set(
      sourceKeys
        .map((key) => sourceByKey.get(key)?.publisherId)
        .filter((value): value is string => Boolean(value)),
    );
    if (uniquePublishers.size < 3) continue;

    clusters.push({
      id: `cluster_${nextClusterNumber}`,
      title: story.title.trim() || `Story cluster ${nextClusterNumber}`,
      sourceKeys,
      selectionReason: null,
    });
    nextClusterNumber += 1;
  }

  logLine("cluster_sources: done", {
    clustersCreated: clusters.length,
    assignedSources: clusters.reduce((acc, row) => acc + row.sourceKeys.length, 0),
    candidatesTotal: candidates.length,
  });
  return { clusters, sourceByKey };
}
