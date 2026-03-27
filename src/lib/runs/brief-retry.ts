import {
  articleBodyLookupKey,
  type RunDetailPayload,
} from "@/lib/data/runs";

/** Matches brief worker: any `articles` row with body_text, not only this run. */
function buildArticleBodyKeySet(payload: RunDetailPayload): Set<string> {
  const keys = new Set<string>(payload.briefArticleBodyKeys ?? []);
  for (const a of payload.articles) {
    if (a.body_text?.trim()) {
      keys.add(articleBodyLookupKey(a.publisher_id, a.canonical_url));
    }
  }
  return keys;
}

function hasExtractedBodyForSource(
  bodyKeys: Set<string>,
  publisherId: string,
  canonicalUrl: string,
): boolean {
  return bodyKeys.has(articleBodyLookupKey(publisherId, canonicalUrl));
}

export type BriefRetryUnavailabilityReason = { id: string; message: string };

export type BriefRetryAvailability =
  | { kind: "available"; headline: string }
  | {
      kind: "unavailable";
      headline: string;
      reasons: BriefRetryUnavailabilityReason[];
    }
  | { kind: "not_applicable"; headline: string; detail?: string };

/**
 * Explains whether the admin "retry brief generation" action applies to this
 * run payload, and why not when it does not.
 */
export function getBriefRetryAvailability(
  payload: RunDetailPayload,
): BriefRetryAvailability {
  const { run, metadata, clusters } = payload;
  const status = run.status;

  if (status === "completed") {
    return {
      kind: "not_applicable",
      headline: "Manual brief retry does not apply to completed runs.",
      detail:
        "The worker already ran the brief step when the run succeeded. Start a new run if you need another brief.",
    };
  }

  if (status === "cancelled") {
    return {
      kind: "not_applicable",
      headline: "Brief retry is not available for cancelled runs.",
    };
  }

  if (status === "pending" || status === "running") {
    return {
      kind: "not_applicable",
      headline:
        "Brief generation has not run yet; it starts after stories are selected and article text is extracted.",
    };
  }

  if (status !== "failed") {
    return {
      kind: "not_applicable",
      headline: `Brief retry is not available when the run status is "${status}".`,
    };
  }

  const articleBodyKeys = buildArticleBodyKeySet(payload);
  const reasons: BriefRetryUnavailabilityReason[] = [];

  if (metadata.clusters_selected <= 0) {
    reasons.push({
      id: "metadata-clusters-selected",
      message:
        "Run metadata has clusters_selected = 0. At least one selected cluster is required in metadata.",
    });
  }

  const selected = clusters.filter((c) => c.status === "selected");

  if (selected.length === 0) {
    reasons.push({
      id: "no-selected-cluster-rows",
      message:
        "No story clusters are stored with status \"selected\" for this run.",
    });
  }

  for (const cluster of selected) {
    const anyBody = cluster.sources.some((source) =>
      hasExtractedBodyForSource(
        articleBodyKeys,
        source.publisher_id,
        source.canonical_url,
      ),
    );
    if (!anyBody) {
      const label =
        cluster.title.trim() || `cluster ${cluster.id.slice(0, 8)}…`;
      reasons.push({
        id: `cluster-body:${cluster.id}`,
        message: `Story "${label}" has no source with non-empty body text in articles (publisher_id + canonical_url; includes rows from other runs when sources were skipped_existing).`,
      });
    }
  }

  if (reasons.length === 0) {
    return {
      kind: "available",
      headline:
        "Brief generation can be retried: selected stories exist and each has at least one stored article body for its sources.",
    };
  }

  return {
    kind: "unavailable",
    headline: "Brief generation retry is not available for this failed run.",
    reasons,
  };
}

/**
 * True when a failed run has persisted selected clusters with enough article
 * text for publish-stage retries (`generate_story_summaries` onward), based on
 * `articles` lookup scope (not only `run_id`).
 */
export function canRetryBriefGeneration(payload: RunDetailPayload): boolean {
  return getBriefRetryAvailability(payload).kind === "available";
}

export type FailedExtractionRetryAvailability =
  | { kind: "available"; headline: string; candidateCount: number }
  | { kind: "unavailable"; headline: string }
  | { kind: "not_applicable"; headline: string };

function hasBodyForSource(
  bodyKeys: Set<string>,
  publisherId: string,
  canonicalUrl: string,
) {
  return bodyKeys.has(articleBodyLookupKey(publisherId, canonicalUrl));
}

export function getFailedExtractionRetryAvailability(
  payload: RunDetailPayload,
): FailedExtractionRetryAvailability {
  if (payload.run.status !== "failed") {
    return {
      kind: "not_applicable",
      headline: "Extraction retry is only available for failed runs.",
    };
  }

  const selectedSources = payload.clusters
    .filter((cluster) => cluster.status === "selected")
    .flatMap((cluster) => cluster.sources);
  if (selectedSources.length === 0) {
    return {
      kind: "unavailable",
      headline:
        "No selected story-cluster sources are available to retry extraction for this run.",
    };
  }

  const bodyKeys = buildArticleBodyKeySet(payload);
  const candidateCount = selectedSources.filter(
    (source) =>
      !hasBodyForSource(bodyKeys, source.publisher_id, source.canonical_url),
  ).length;

  if (candidateCount <= 0) {
    return {
      kind: "unavailable",
      headline:
        "All selected story sources already have usable article body text.",
    };
  }

  return {
    kind: "available",
    headline: `Extraction retry is available for ${candidateCount} selected source(s) still missing usable body text.`,
    candidateCount,
  };
}

export function canRetryFailedExtractions(payload: RunDetailPayload): boolean {
  return getFailedExtractionRetryAvailability(payload).kind === "available";
}
