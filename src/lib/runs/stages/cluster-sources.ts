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
      "Assign every candidate source to exactly one story.",
      "Use as many story clusters as needed so each source_key appears in exactly one story.",
      "Group clearly related sources that describe the same concrete event or development.",
      "Single-source clusters are required when a source does not clearly match any other.",
      "Do not leave any candidate unassigned.",
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

    if (sourceKeys.length === 0) continue;

    clusters.push({
      id: `cluster_${nextClusterNumber}`,
      title: story.title.trim() || `Story cluster ${nextClusterNumber}`,
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
      (toSingleLine(candidate.title) || "").trim() || `Story cluster ${nextClusterNumber}`;
    clusters.push({
      id: `cluster_${nextClusterNumber}`,
      title: titleFromArticle,
      sourceKeys: [key],
      selectionReason: null,
    });
    nextClusterNumber += 1;
  }

  const assignedSources = clusters.reduce((acc, row) => acc + row.sourceKeys.length, 0);
  logLine("cluster_sources: done", {
    clustersCreated: clusters.length,
    assignedSources,
    uniqueCandidates: sourceByKey.size,
    singletonBackfill: orphanKeys.length,
    candidatesTotal: candidates.length,
  });
  return { clusters, sourceByKey };
}
