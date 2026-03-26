"use client";

import { useEffect, useMemo, useState } from "react";
import type { Json } from "@/database.types";
import {
  retryBriefGenerationAction,
  retryFailedExtractionsAction,
} from "@/app/admin/runs/run-actions";
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
  return status === "completed" || status === "failed" || status === "cancelled";
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
  const [selectedArticle, setSelectedArticle] = useState<ArticleProgress | null>(
    null,
  );
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
                Stage: {data.run.current_stage} (attempt {data.run.stage_attempt ?? 0})
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
                    const response = await fetch(`/admin/runs/${runId}/cancel`, {
                      method: "POST",
                    });
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
                {retryBriefPending ? "Publishing brief…" : "Retry brief generation"}
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
                  <td colSpan={6} className="px-4 py-8 text-center text-zinc-500">
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
                  <td colSpan={4} className="px-4 py-8 text-center text-zinc-500">
                    No story clusters persisted yet.
                  </td>
                </tr>
              ) : (
                clusters.map((cluster) => (
                  <tr key={cluster.id}>
                    <td className="max-w-xl px-4 py-3">
                      <div className="font-medium text-zinc-900">{cluster.title}</div>
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
                    <td className="px-4 py-3 text-zinc-700">{cluster.source_count}</td>
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
                  <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
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
                          {article.title ?? article.canonical_url ?? article.url}
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
                <span className="font-semibold text-zinc-900">Published at:</span>{" "}
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
                  {JSON.stringify(modalArticle.stored?.metadata ?? null, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
