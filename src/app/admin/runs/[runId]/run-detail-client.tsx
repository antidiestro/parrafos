"use client";

import { useEffect, useMemo, useState } from "react";
import type { Json } from "@/database.types";
import {
  retryBriefGenerationAction,
  retryFailedExtractionsAction,
} from "@/app/admin/runs/run-actions";
import { RUN_STAGES, type RunStage } from "@/lib/runs/workflow";
import type {
  RunArticleWithPublisher,
  RunDetailPayload,
} from "@/lib/data/runs";
import {
  canRetryFailedExtractions,
  canRetryBriefGeneration,
  getFailedExtractionRetryAvailability,
  getBriefRetryAvailability,
} from "@/lib/runs/brief-retry";

type Props = {
  runId: string;
  initialData: RunDetailPayload;
};

type ArticleProgress = RunDetailPayload["metadata"]["articles"][number];
type StageUiState =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

const STAGE_META: Record<
  RunStage,
  {
    label: string;
    description: string;
  }
> = {
  discover_candidates: {
    label: "Discover candidates",
    description: "Find likely article URLs from publisher homepages.",
  },
  prefetch_metadata: {
    label: "Prefetch metadata",
    description: "Validate candidates and extract canonical article metadata.",
  },
  cluster_sources: {
    label: "Cluster sources",
    description: "Group related sources into story clusters.",
  },
  select_clusters: {
    label: "Select clusters",
    description: "Choose the most relevant clusters for this run.",
  },
  extract_bodies: {
    label: "Extract bodies",
    description: "Extract full body text for selected sources.",
  },
  upsert_articles: {
    label: "Upsert articles",
    description: "Persist extracted articles in the database.",
  },
  generate_story_summaries: {
    label: "Generate story summaries",
    description: "Create detailed summaries for each selected story cluster.",
  },
  compose_brief_paragraphs: {
    label: "Compose brief paragraphs",
    description: "Generate one coherent paragraph per selected story.",
  },
  persist_brief_output: {
    label: "Persist brief output",
    description: "Write brief, stories, source links, and paragraph rows.",
  },
};

/** Fixed locale so SSR (Node) and the browser agree during hydration. */
function formatTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatPercent(completed: number, total: number) {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((completed / total) * 100)));
}

function isTerminalStatus(status: string) {
  return (
    status === "completed" || status === "failed" || status === "cancelled"
  );
}

function statusClass(status: string) {
  if (
    status === "completed" ||
    status === "upserted" ||
    status === "selected" ||
    status === "selected_for_extraction"
  ) {
    return "bg-green-100 text-green-800";
  }
  if (status === "failed") {
    return "bg-red-100 text-red-800";
  }
  if (
    status === "running" ||
    status === "fetching" ||
    status === "extracted" ||
    status === "clustering" ||
    status === "clustered" ||
    status === "eligible"
  ) {
    return "bg-blue-100 text-blue-800";
  }
  if (
    status === "not_selected" ||
    status === "not_selected_for_extraction" ||
    status === "discarded_low_sources"
  ) {
    return "bg-amber-100 text-amber-800";
  }
  if (status === "skipped_existing") {
    return "bg-violet-100 text-violet-800";
  }
  return "bg-zinc-100 text-zinc-700";
}

function stageStateClass(state: StageUiState) {
  if (state === "completed") return "bg-green-100 text-green-800";
  if (state === "running") return "bg-blue-100 text-blue-800";
  if (state === "failed") return "bg-red-100 text-red-800";
  if (state === "cancelled") return "bg-zinc-200 text-zinc-800";
  return "bg-amber-100 text-amber-800";
}

function stageStateLabel(state: StageUiState) {
  if (state === "completed") return "Completed";
  if (state === "running") return "Running";
  if (state === "failed") return "Failed";
  if (state === "cancelled") return "Cancelled";
  return "Pending";
}

function getStageUiState(
  run: RunDetailPayload["run"],
  stageIndex: number,
): StageUiState {
  if (run.status === "completed") {
    return "completed";
  }

  const currentStage = run.current_stage as RunStage | null;
  if (!currentStage) {
    return stageIndex === 0 && run.status === "running" ? "running" : "pending";
  }

  const currentStageIndex = RUN_STAGES.indexOf(currentStage);
  if (stageIndex < currentStageIndex) return "completed";
  if (stageIndex > currentStageIndex) return "pending";

  if (run.status === "failed") return "failed";
  if (run.status === "cancelled") return "cancelled";
  return "running";
}

function StageIcon({ state }: { state: StageUiState }) {
  if (state === "completed") {
    return (
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-green-200 bg-green-50 text-green-700">
        <svg
          viewBox="0 0 20 20"
          className="h-4 w-4 fill-current"
          aria-hidden="true"
        >
          <path d="M7.8 13.7 4.5 10.4l-1.1 1.1 4.4 4.4L16.6 7l-1.1-1.1z" />
        </svg>
      </span>
    );
  }
  if (state === "running") {
    return (
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-blue-200 bg-blue-50 text-blue-700">
        <span
          className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden="true"
        />
      </span>
    );
  }
  if (state === "failed") {
    return (
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-red-200 bg-red-50 text-red-700">
        <svg
          viewBox="0 0 20 20"
          className="h-4 w-4 fill-current"
          aria-hidden="true"
        >
          <path d="M10 2.5A7.5 7.5 0 1 0 17.5 10 7.5 7.5 0 0 0 10 2.5Zm.8 11h-1.6v-1.6h1.6Zm0-3.2h-1.6V6.5h1.6Z" />
        </svg>
      </span>
    );
  }
  if (state === "cancelled") {
    return (
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-zinc-300 bg-zinc-100 text-zinc-700">
        <svg
          viewBox="0 0 20 20"
          className="h-4 w-4 fill-current"
          aria-hidden="true"
        >
          <path d="M10 2.5A7.5 7.5 0 1 0 17.5 10 7.5 7.5 0 0 0 10 2.5Zm3.2 8.3H6.8V9.2h6.4Z" />
        </svg>
      </span>
    );
  }
  return (
    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-amber-200 bg-amber-50 text-amber-700">
      <svg
        viewBox="0 0 20 20"
        className="h-4 w-4 fill-current"
        aria-hidden="true"
      >
        <path d="M10 2.5A7.5 7.5 0 1 0 17.5 10 7.5 7.5 0 0 0 10 2.5Zm.8 7.8V5.8H9.2V11l3.6 2.1.8-1.4Z" />
      </svg>
    </span>
  );
}

function getArticleByProgress(
  progress: ArticleProgress,
  articles: RunArticleWithPublisher[],
) {
  return (
    articles.find(
      (article) =>
        article.publisher_id === progress.publisher_id &&
        (article.canonical_url === progress.canonical_url ||
          article.canonical_url === progress.url),
    ) ?? null
  );
}

function getSourceUrl(metadata: Json | null): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const row = metadata as Record<string, unknown>;
  return typeof row.source_url === "string" ? row.source_url : null;
}

export function RunDetailClient({ runId, initialData }: Props) {
  const [data, setData] = useState<RunDetailPayload>(initialData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedArticle, setSelectedArticle] =
    useState<ArticleProgress | null>(null);
  const [cancelPending, setCancelPending] = useState(false);
  const [retryExtractionPending, setRetryExtractionPending] = useState(false);
  const [retryBriefPending, setRetryBriefPending] = useState(false);

  useEffect(() => {
    if (isTerminalStatus(data.run.status)) return;

    let cancelled = false;
    const poll = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/admin/runs/${runId}/data`, {
          method: "GET",
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(`Polling failed (${response.status})`);
        }
        const nextData = (await response.json()) as RunDetailPayload;
        if (!cancelled) {
          setData(nextData);
          setError(null);
        }
      } catch (pollError) {
        if (!cancelled) {
          setError(
            pollError instanceof Error
              ? pollError.message
              : "Unable to refresh run status.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void poll();
    const interval = window.setInterval(() => {
      void poll();
    }, 2500);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [data.run.status, runId]);

  const publishersDone = data.metadata.publishers_done ?? 0;
  const publisherCount = data.metadata.publisher_count ?? 0;
  const percent = formatPercent(publishersDone, publisherCount);
  const clusters = Array.isArray(data.clusters) ? data.clusters : [];
  const canCancel =
    data.run.status === "pending" || data.run.status === "running";
  const canRetryBrief =
    data.run.status === "failed" && canRetryBriefGeneration(data);
  const canRetryExtractions =
    data.run.status === "failed" && canRetryFailedExtractions(data);
  const briefRetryAvailability = useMemo(
    () => getBriefRetryAvailability(data),
    [data],
  );
  const extractionRetryAvailability = useMemo(
    () => getFailedExtractionRetryAvailability(data),
    [data],
  );
  const modalArticle = useMemo(() => {
    if (!selectedArticle) return null;
    return {
      progress: selectedArticle,
      stored: getArticleByProgress(selectedArticle, data.articles),
    };
  }, [data.articles, selectedArticle]);
  const articleStatusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const article of data.metadata.articles) {
      counts[article.status] = (counts[article.status] ?? 0) + 1;
    }
    return counts;
  }, [data.metadata.articles]);
  const stageUiStates = useMemo(
    () =>
      RUN_STAGES.map((stage, index) => ({
        stage,
        state: getStageUiState(data.run, index),
        meta: STAGE_META[stage],
      })),
    [data.run],
  );
  const [expandedStages, setExpandedStages] = useState<Record<string, boolean>>(
    {},
  );
  useEffect(() => {
    const current = data.run.current_stage as RunStage | null;
    const failedOrCancelled =
      data.run.status === "failed" || data.run.status === "cancelled";
    if (!current) return;
    setExpandedStages((existing) => ({
      ...existing,
      [current]: true,
      ...(failedOrCancelled ? { [current]: true } : {}),
    }));
  }, [data.run.current_stage, data.run.status]);

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-zinc-200 bg-white p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-zinc-700">Status</span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusClass(data.run.status)}`}
            >
              {data.run.status}
            </span>
            {loading ? (
              <span className="text-xs text-zinc-500">Refreshing…</span>
            ) : null}
            {data.run.current_stage ? (
              <span className="text-xs text-zinc-500">
                Stage: {data.run.current_stage} (attempt{" "}
                {data.run.stage_attempt ?? 0})
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-3">
            {canCancel ? (
              <button
                type="button"
                onClick={async () => {
                  try {
                    setCancelPending(true);
                    const response = await fetch(
                      `/admin/runs/${runId}/cancel`,
                      {
                        method: "POST",
                      },
                    );
                    if (!response.ok) {
                      const body = (await response.json()) as {
                        error?: string;
                      };
                      throw new Error(body.error ?? "Unable to cancel run.");
                    }
                    setData((current) => ({
                      ...current,
                      run: {
                        ...current.run,
                        status: "cancelled",
                        ended_at: new Date().toISOString(),
                      },
                    }));
                  } catch (cancelError) {
                    setError(
                      cancelError instanceof Error
                        ? cancelError.message
                        : "Unable to cancel run.",
                    );
                  } finally {
                    setCancelPending(false);
                  }
                }}
                disabled={cancelPending}
                className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {cancelPending ? "Cancelling..." : "Cancel run"}
              </button>
            ) : null}
            {canRetryBrief ? (
              <button
                type="button"
                onClick={async () => {
                  try {
                    setRetryBriefPending(true);
                    setError(null);
                    const result = await retryBriefGenerationAction(runId);
                    if (result?.error) {
                      throw new Error(result.error);
                    }
                    const response = await fetch(`/admin/runs/${runId}/data`, {
                      method: "GET",
                      cache: "no-store",
                    });
                    if (!response.ok) {
                      throw new Error(`Refresh failed (${response.status})`);
                    }
                    setData((await response.json()) as RunDetailPayload);
                  } catch (retryError) {
                    setError(
                      retryError instanceof Error
                        ? retryError.message
                        : "Unable to retry brief generation.",
                    );
                  } finally {
                    setRetryBriefPending(false);
                  }
                }}
                disabled={retryBriefPending}
                className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {retryBriefPending
                  ? "Publishing brief…"
                  : "Retry brief generation"}
              </button>
            ) : null}
            {canRetryExtractions ? (
              <button
                type="button"
                onClick={async () => {
                  try {
                    setRetryExtractionPending(true);
                    setError(null);
                    const result = await retryFailedExtractionsAction(runId);
                    if (result?.error) {
                      throw new Error(result.error);
                    }
                    const response = await fetch(`/admin/runs/${runId}/data`, {
                      method: "GET",
                      cache: "no-store",
                    });
                    if (!response.ok) {
                      throw new Error(`Refresh failed (${response.status})`);
                    }
                    setData((await response.json()) as RunDetailPayload);
                  } catch (retryError) {
                    setError(
                      retryError instanceof Error
                        ? retryError.message
                        : "Unable to retry failed extractions.",
                    );
                  } finally {
                    setRetryExtractionPending(false);
                  }
                }}
                disabled={retryExtractionPending}
                className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {retryExtractionPending
                  ? "Retrying extractions…"
                  : "Retry missing extractions"}
              </button>
            ) : null}
            <span className="text-xs text-zinc-500">Run ID: {data.run.id}</span>
          </div>
        </div>

        <div
          className={`mt-3 rounded-lg border p-3 text-sm ${
            briefRetryAvailability.kind === "available"
              ? "border-green-200 bg-green-50 text-green-900"
              : briefRetryAvailability.kind === "unavailable"
                ? "border-amber-200 bg-amber-50 text-amber-950"
                : "border-zinc-200 bg-zinc-50 text-zinc-800"
          }`}
        >
          <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-zinc-600">
            Extraction retry
          </p>
          <p className="mt-1 leading-snug">
            {extractionRetryAvailability.headline}
          </p>
          <p
            className={`text-xs font-semibold uppercase tracking-wide ${
              briefRetryAvailability.kind === "available"
                ? "text-green-800"
                : briefRetryAvailability.kind === "unavailable"
                  ? "text-amber-900"
                  : "text-zinc-600"
            }`}
          >
            Brief generation (manual retry)
          </p>
          <p className="mt-1 font-medium leading-snug">
            {briefRetryAvailability.headline}
          </p>
          {briefRetryAvailability.kind === "not_applicable" &&
          briefRetryAvailability.detail ? (
            <p className="mt-1.5 text-sm leading-relaxed opacity-90">
              {briefRetryAvailability.detail}
            </p>
          ) : null}
          {briefRetryAvailability.kind === "unavailable" &&
          briefRetryAvailability.reasons.length > 0 ? (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed">
              {briefRetryAvailability.reasons.map((reason) => (
                <li key={reason.id}>{reason.message}</li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="mb-2 h-3 w-full overflow-hidden rounded-full bg-zinc-100">
          <div
            className="h-full rounded-full bg-zinc-900 transition-all"
            style={{ width: `${percent}%` }}
          />
        </div>
        <p className="text-sm text-zinc-700">
          {publishersDone}/{publisherCount} publishers completed ({percent}%)
        </p>
        <p className="mt-1 text-sm text-zinc-600">
          Articles found: {data.metadata.articles_found} - upserted:{" "}
          {data.metadata.articles_upserted}
        </p>
        <p className="mt-1 text-sm text-zinc-600">
          Story clusters: {data.metadata.clusters_total} - eligible:{" "}
          {data.metadata.clusters_eligible} - selected:{" "}
          {data.metadata.clusters_selected} - selected sources:{" "}
          {data.metadata.sources_selected}
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          Started: {formatTime(data.run.started_at)} - Ended:{" "}
          {formatTime(data.run.ended_at)}
        </p>
        {data.run.error_message ? (
          <p className="mt-2 rounded-md bg-red-50 p-2 text-sm text-red-700">
            {data.run.error_message}
          </p>
        ) : null}
        {error ? (
          <p className="mt-2 rounded-md bg-amber-50 p-2 text-sm text-amber-800">
            {error}
          </p>
        ) : null}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Pipeline progress
        </h2>
        <div className="rounded-xl border border-zinc-200 bg-white">
          <ol className="divide-y divide-zinc-100">
            {stageUiStates.map(({ stage, state, meta }, index) => {
              const isExpanded =
                expandedStages[stage] ??
                (state === "running" || state === "failed");
              return (
                <li key={stage} className="p-4">
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedStages((current) => ({
                        ...current,
                        [stage]: !(current[stage] ?? false),
                      }))
                    }
                    className="flex w-full items-start gap-3 text-left"
                  >
                    <div className="flex flex-col items-center">
                      <StageIcon state={state} />
                      {index < RUN_STAGES.length - 1 ? (
                        <span
                          className="mt-1 h-8 w-px bg-zinc-200"
                          aria-hidden="true"
                        />
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-zinc-900">
                            {meta.label}
                          </p>
                          <p className="text-xs text-zinc-600">
                            {meta.description}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${stageStateClass(state)}`}
                          >
                            {stageStateLabel(state)}
                          </span>
                          <span className="text-xs text-zinc-500">
                            {isExpanded ? "Hide details" : "Show details"}
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>

                  {isExpanded ? (
                    <div className="ml-11 mt-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700">
                      {stage === "discover_candidates" ? (
                        <p>
                          Publishers processed:{" "}
                          <span className="font-semibold text-zinc-900">
                            {data.metadata.publishers_done}/
                            {data.metadata.publisher_count}
                          </span>
                        </p>
                      ) : null}
                      {stage === "prefetch_metadata" ? (
                        <p>
                          Candidate articles with metadata records:{" "}
                          <span className="font-semibold text-zinc-900">
                            {data.metadata.articles.length}
                          </span>
                        </p>
                      ) : null}
                      {stage === "cluster_sources" ? (
                        <p>
                          Story clusters created:{" "}
                          <span className="font-semibold text-zinc-900">
                            {data.metadata.clusters_total}
                          </span>
                        </p>
                      ) : null}
                      {stage === "select_clusters" ? (
                        <p>
                          Eligible clusters:{" "}
                          <span className="font-semibold text-zinc-900">
                            {data.metadata.clusters_eligible}
                          </span>
                          {" · "}Selected clusters:{" "}
                          <span className="font-semibold text-zinc-900">
                            {data.metadata.clusters_selected}
                          </span>
                          {" · "}Selected sources:{" "}
                          <span className="font-semibold text-zinc-900">
                            {data.metadata.sources_selected}
                          </span>
                        </p>
                      ) : null}
                      {stage === "extract_bodies" ? (
                        <div className="space-y-2">
                          <p>
                            Extracted:{" "}
                            <span className="font-semibold text-zinc-900">
                              {articleStatusCounts.extracted ?? 0}
                            </span>
                            {" · "}Skipped existing:{" "}
                            <span className="font-semibold text-zinc-900">
                              {articleStatusCounts.skipped_existing ?? 0}
                            </span>
                            {" · "}Failed:{" "}
                            <span className="font-semibold text-zinc-900">
                              {articleStatusCounts.failed ?? 0}
                            </span>
                          </p>
                          {canRetryExtractions ? (
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  setRetryExtractionPending(true);
                                  setError(null);
                                  const result =
                                    await retryFailedExtractionsAction(runId);
                                  if (result?.error) {
                                    throw new Error(result.error);
                                  }
                                  const response = await fetch(
                                    `/admin/runs/${runId}/data`,
                                    {
                                      method: "GET",
                                      cache: "no-store",
                                    },
                                  );
                                  if (!response.ok) {
                                    throw new Error(
                                      `Refresh failed (${response.status})`,
                                    );
                                  }
                                  setData(
                                    (await response.json()) as RunDetailPayload,
                                  );
                                } catch (retryError) {
                                  setError(
                                    retryError instanceof Error
                                      ? retryError.message
                                      : "Unable to retry failed extractions.",
                                  );
                                } finally {
                                  setRetryExtractionPending(false);
                                }
                              }}
                              disabled={retryExtractionPending}
                              className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-70"
                            >
                              {retryExtractionPending
                                ? "Retrying extractions…"
                                : "Retry missing extractions"}
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                      {stage === "upsert_articles" ? (
                        <p>
                          Articles upserted:{" "}
                          <span className="font-semibold text-zinc-900">
                            {data.metadata.articles_upserted}
                          </span>
                        </p>
                      ) : null}
                      {stage === "persist_brief_output" ? (
                        <div className="space-y-2">
                          <p className="leading-relaxed">
                            {briefRetryAvailability.headline}
                          </p>
                          {canRetryBrief ? (
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  setRetryBriefPending(true);
                                  setError(null);
                                  const result =
                                    await retryBriefGenerationAction(runId);
                                  if (result?.error) {
                                    throw new Error(result.error);
                                  }
                                  const response = await fetch(
                                    `/admin/runs/${runId}/data`,
                                    {
                                      method: "GET",
                                      cache: "no-store",
                                    },
                                  );
                                  if (!response.ok) {
                                    throw new Error(
                                      `Refresh failed (${response.status})`,
                                    );
                                  }
                                  setData(
                                    (await response.json()) as RunDetailPayload,
                                  );
                                } catch (retryError) {
                                  setError(
                                    retryError instanceof Error
                                      ? retryError.message
                                      : "Unable to retry brief generation.",
                                  );
                                } finally {
                                  setRetryBriefPending(false);
                                }
                              }}
                              disabled={retryBriefPending}
                              className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-70"
                            >
                              {retryBriefPending
                                ? "Publishing brief…"
                                : "Retry brief generation"}
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      <section className="space-y-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Detailed data
        </h2>

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Publishers being scraped
          </h2>
          <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
            <table className="w-full min-w-2xl text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-3">Publisher</th>
                  <th className="px-4 py-3">Base URL</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Found</th>
                  <th className="px-4 py-3">Upserted</th>
                  <th className="px-4 py-3">Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {data.metadata.publishers.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-8 text-center text-zinc-500"
                    >
                      No publishers recorded yet.
                    </td>
                  </tr>
                ) : (
                  data.metadata.publishers.map((publisher) => (
                    <tr key={publisher.publisher_id}>
                      <td className="px-4 py-3 font-medium text-zinc-900">
                        {publisher.publisher_name}
                      </td>
                      <td className="max-w-xl truncate px-4 py-3 text-zinc-600">
                        {publisher.base_url}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusClass(publisher.status)}`}
                        >
                          {publisher.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-zinc-700">
                        {publisher.articles_found}
                      </td>
                      <td className="px-4 py-3 text-zinc-700">
                        {publisher.articles_upserted}
                      </td>
                      <td className="max-w-sm truncate px-4 py-3 text-zinc-600">
                        {publisher.error_message ?? "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Story clusters ({clusters.length})
          </h2>
          <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
            <table className="w-full min-w-2xl text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-3">Story</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Sources</th>
                  <th className="px-4 py-3">Relevant sources</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {clusters.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-4 py-8 text-center text-zinc-500"
                    >
                      No story clusters persisted yet.
                    </td>
                  </tr>
                ) : (
                  clusters.map((cluster) => (
                    <tr key={cluster.id}>
                      <td className="max-w-xl px-4 py-3">
                        <div className="font-medium text-zinc-900">
                          {cluster.title}
                        </div>
                        {cluster.summary ? (
                          <div className="mt-0.5 line-clamp-2 text-xs text-zinc-600">
                            {cluster.summary}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusClass(cluster.status)}`}
                        >
                          {cluster.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-zinc-700">
                        {cluster.source_count}
                      </td>
                      <td className="max-w-2xl px-4 py-3 text-xs text-zinc-700">
                        {cluster.sources.length === 0
                          ? "—"
                          : cluster.sources
                              .map(
                                (source) =>
                                  `${source.publisher_name ?? source.publisher_id}: ${source.title ?? source.canonical_url}`,
                              )
                              .join(" | ")}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Identified articles ({data.metadata.articles.length})
          </h2>
          <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
            <table className="w-full min-w-2xl text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-3">Article</th>
                  <th className="px-4 py-3">Publisher</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Stored</th>
                  <th className="px-4 py-3">Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {data.metadata.articles.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-8 text-center text-zinc-500"
                    >
                      No identified articles yet.
                    </td>
                  </tr>
                ) : (
                  data.metadata.articles.map((article) => {
                    const stored = getArticleByProgress(article, data.articles);
                    const publisher = data.metadata.publishers.find(
                      (entry) => entry.publisher_id === article.publisher_id,
                    );
                    return (
                      <tr key={`${article.publisher_id}:${article.url}`}>
                        <td className="max-w-xl px-4 py-3">
                          <button
                            type="button"
                            onClick={() => setSelectedArticle(article)}
                            className="truncate text-left font-medium text-zinc-900 underline-offset-4 hover:underline"
                          >
                            {article.title ??
                              article.canonical_url ??
                              article.url}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-zinc-700">
                          {publisher?.publisher_name ?? article.publisher_id}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusClass(article.status)}`}
                          >
                            {article.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-zinc-700">
                          {stored ? "yes" : "no"}
                        </td>
                        <td className="max-w-sm truncate px-4 py-3 text-zinc-600">
                          {article.error_message ?? "—"}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>

      {modalArticle ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <h3 className="text-lg font-semibold text-zinc-900">
                Article details
              </h3>
              <button
                type="button"
                onClick={() => setSelectedArticle(null)}
                className="rounded-md border border-zinc-200 px-2 py-1 text-sm text-zinc-600 hover:bg-zinc-50"
              >
                Close
              </button>
            </div>

            <div className="space-y-3 text-sm">
              <p>
                <span className="font-semibold text-zinc-900">Status:</span>{" "}
                {modalArticle.progress.status}
              </p>
              <p className="wrap-break-word">
                <span className="font-semibold text-zinc-900">URL:</span>{" "}
                {modalArticle.progress.url}
              </p>
              <p className="wrap-break-word">
                <span className="font-semibold text-zinc-900">Canonical:</span>{" "}
                {modalArticle.progress.canonical_url ?? "—"}
              </p>
              <p>
                <span className="font-semibold text-zinc-900">Title:</span>{" "}
                {modalArticle.stored?.title ??
                  modalArticle.progress.title ??
                  "—"}
              </p>
              <p>
                <span className="font-semibold text-zinc-900">
                  Published at:
                </span>{" "}
                {formatTime(
                  modalArticle.stored?.published_at ??
                    modalArticle.progress.published_at,
                )}
              </p>
              <p className="wrap-break-word">
                <span className="font-semibold text-zinc-900">Source URL:</span>{" "}
                {getSourceUrl(modalArticle.stored?.metadata ?? null) ?? "—"}
              </p>
              <div>
                <p className="mb-1 font-semibold text-zinc-900">Body text:</p>
                <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 text-xs text-zinc-800">
                  {modalArticle.stored?.body_text ?? "No extracted body text."}
                </pre>
              </div>
              <div>
                <p className="mb-1 font-semibold text-zinc-900">Metadata:</p>
                <pre className="overflow-x-auto rounded-lg bg-zinc-50 p-3 text-xs text-zinc-800">
                  {JSON.stringify(
                    modalArticle.stored?.metadata ?? null,
                    null,
                    2,
                  )}
                </pre>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
