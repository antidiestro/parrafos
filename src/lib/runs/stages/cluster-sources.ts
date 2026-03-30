import { generateGeminiJson } from "@/lib/gemini/generate";
import { divider, logLine } from "@/lib/runs/console/logging";
import {
  clusterEventAssignmentResponseJsonSchema,
  clusterEventAssignmentSchema,
  createClusterEventDiscoveryResponseJsonSchema,
  createClusterEventDiscoverySchema,
  clusterSportsFilterResponseJsonSchema,
  clusterSportsFilterSchema,
} from "@/lib/runs/console/pipeline-constants";
import type { CandidateSource, ClusterDraft } from "@/lib/runs/console/types";
import {
  clusterPromptAliasForCandidateIndex,
  sourceKeyFor,
  toHoursAgo,
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
  const nowMs = Date.now();
  const eventDiscoveryLines = afterSportsFilter.map((candidate, index) => {
    const stableKey = sourceKeyFor(
      candidate.publisherId,
      candidate.canonicalUrl,
    );
    const alias = clusterPromptAliasForCandidateIndex(index);
    aliasToStableKey.set(alias, stableKey);
    const headline = toSingleLine(candidate.title) || "(no headline)";
    return `${alias} | ${headline}`;
  });

  const articlesCount = afterSportsFilter.length;
  const minEventsFromArticles = Math.max(1, Math.ceil(articlesCount / 4));
  const eventDiscoverySchema = createClusterEventDiscoverySchema(
    minEventsFromArticles,
  );
  const eventDiscoveryResponseJsonSchema =
    createClusterEventDiscoveryResponseJsonSchema(minEventsFromArticles);

  const discoveredEvents = await generateGeminiJson(
    [
      "Identify specific news events from candidate headlines.",
      `There are ${articlesCount} candidate headlines. You MUST return at least ${minEventsFromArticles} events in the events array; that minimum is ceil(${articlesCount}/4).`,
      "Each event must use a distinct event_ref; duplicate event_ref strings are not allowed.",
      "Pay special attention to Chilean politics and to international affairs: prioritize accurate clustering and rich descriptions when headlines clearly concern Chile’s government, elections, institutions, major policy, or cross-border diplomatic and geopolitical developments.",
      "Each event must represent one concrete, specific development or storyline.",
      "Use enough distinct events to cover the headline set; one event can later receive one or many sources.",
      "For each event, return a unique short event_ref (e1, e2, e3, ...).",
      "For each event, write a rich description of about 25 to 40 words (can go longer if needed): name the event, key actors, context, and stakes in full sentences.",
      'Return JSON object: {"events":[{"event_ref":"e1","description":"..."}]}',
      "Candidate sources (one per line inside the block: source_ref | source headline):",
      "<candidate_sources>",
      eventDiscoveryLines.join("\n"),
      "</candidate_sources>",
    ].join("\n"),
    eventDiscoverySchema,
    {
      model: RUN_CLUSTER_MODEL,
      nativeStructuredOutput: {
        responseJsonSchema: eventDiscoveryResponseJsonSchema,
      },
    },
  );
  logLine("cluster_sources: model response received", {
    pass: "event_discovery",
    articlesCount,
    minEventsFromArticles,
    returnedEvents: discoveredEvents.events.length,
  });

  const uniqueEvents = new Map<string, string>();
  for (const row of discoveredEvents.events) {
    const eventRef = row.event_ref.trim();
    const description = row.description.trim();
    if (!eventRef || !description) continue;
    if (!uniqueEvents.has(eventRef)) uniqueEvents.set(eventRef, description);
  }
  if (uniqueEvents.size === 0) {
    throw new Error("cluster_sources: event discovery returned zero events.");
  }
  if (uniqueEvents.size < minEventsFromArticles) {
    throw new Error(
      `cluster_sources: event discovery produced ${uniqueEvents.size} unique event_ref values; need at least ${minEventsFromArticles} (ceil(${articlesCount}/4)).`,
    );
  }

  const eventList = Array.from(uniqueEvents.entries()).map(
    ([eventRef, description]) => `${eventRef} | ${description}`,
  );
  const assignmentLines = afterSportsFilter.map((candidate, index) => {
    const alias = clusterPromptAliasForCandidateIndex(index);
    const headline = toSingleLine(candidate.title) || "(no headline)";
    const publishedIso = candidate.publishedAt ? new Date(candidate.publishedAt) : null;
    const publishedAt =
      publishedIso && Number.isFinite(+publishedIso)
        ? publishedIso.toISOString()
        : "unknown";
    const hoursAgo = toHoursAgo(publishedAt === "unknown" ? null : publishedAt, nowMs);
    const recency =
      hoursAgo === null
        ? `published_at=${publishedAt}`
        : `published_at=${publishedAt}, hours_ago=${hoursAgo}`;
    return `${alias} | ${headline} | ${recency}`;
  });

  const assignedEvents = await generateGeminiJson(
    [
      "Group candidate sources into clusters keyed by event_ref from the provided event list.",
      "Return one JSON object per event that receives at least one source_ref.",
      "Each object must include event_ref and source_refs as a single comma-separated list of every source_ref for that event (example: \"c1,c2,c5\").",
      "Do not invent new event_ref values.",
      "Every candidate source_ref must appear in exactly one cluster’s source_refs list across the whole response.",
      "If a source_ref is uncertain, still assign it once to the best-fit event_ref.",
      'Return JSON shape: {"clusters":[{"event_ref":"e1","source_refs":"c1,c2"}]}',
      "Events:",
      "<events>",
      eventList.join("\n"),
      "</events>",
      "Candidates (source_ref | headline | recency):",
      "<candidate_sources>",
      assignmentLines.join("\n"),
      "</candidate_sources>",
    ].join("\n"),
    clusterEventAssignmentSchema,
    {
      model: RUN_CLUSTER_MODEL,
      nativeStructuredOutput: {
        responseJsonSchema: clusterEventAssignmentResponseJsonSchema,
      },
    },
  );
  logLine("cluster_sources: model response received", {
    pass: "event_assignment",
    returnedClusterRows: assignedEvents.clusters.length,
  });

  const usedKeys = new Set<string>();
  const clusters: ClusterDraft[] = [];
  let nextClusterNumber = 1;

  const eventToSourceKeys = new Map<string, string[]>();
  for (const row of assignedEvents.clusters) {
    const eventRef = row.event_ref.trim();
    if (!uniqueEvents.has(eventRef)) continue;
    const sourceRefParts = row.source_refs
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const sourceRef of sourceRefParts) {
      const stableKey =
        aliasToStableKey.get(sourceRef) ??
        (sourceByKey.has(sourceRef) ? sourceRef : null);
      if (!stableKey) continue;
      if (!sourceByKey.has(stableKey)) continue;
      if (usedKeys.has(stableKey)) continue;
      usedKeys.add(stableKey);
      const existing = eventToSourceKeys.get(eventRef);
      if (existing) {
        existing.push(stableKey);
      } else {
        eventToSourceKeys.set(eventRef, [stableKey]);
      }
    }
  }

  for (const [eventRef, sourceKeys] of eventToSourceKeys) {
    if (sourceKeys.length === 0) continue;
    clusters.push({
      id: `cluster_${nextClusterNumber}`,
      title:
        uniqueEvents.get(eventRef)?.trim() || `Story cluster ${nextClusterNumber}`,
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
    discoveredEvents: uniqueEvents.size,
    clustersCreated: clusters.length,
    assignedSources,
    uniqueCandidates: sourceByKey.size,
    singletonBackfill: orphanKeys.length,
    candidatesTotal: afterSportsFilter.length,
    candidatesBeforeSportsFilter: candidates.length,
  });
  return { clusters, sourceByKey };
}
