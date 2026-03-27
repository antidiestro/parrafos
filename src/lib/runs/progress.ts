import type { Json } from "@/database.types";
import {
  RUN_CLUSTER_MODEL,
  RUN_EXTRACT_MODEL,
  RUN_RELEVANCE_MODEL,
  RUN_MODEL,
} from "@/lib/runs/constants";

export type RunError = { publisher_id?: string; url?: string; message: string };

export type RunPublisherStatus = "pending" | "running" | "completed" | "failed";
export type RunArticleStatus =
  | "pending"
  | "identified"
  | "metadata_fetching"
  | "metadata_ready"
  | "approving"
  | "approved"
  | "rejected"
  | "clustering"
  | "clustered"
  | "selected_for_extraction"
  | "not_selected_for_extraction"
  | "skipped_existing"
  | "fetching"
  | "extracted"
  | "upserted"
  | "failed";

export type RunPublisherProgress = {
  publisher_id: string;
  publisher_name: string;
  base_url: string;
  status: RunPublisherStatus;
  articles_found: number;
  articles_upserted: number;
  error_message: string | null;
};

export type RunArticleProgress = {
  publisher_id: string;
  url: string;
  canonical_url: string | null;
  title: string | null;
  published_at: string | null;
  status: RunArticleStatus;
  error_message: string | null;
};

export type RunMetadata = {
  model: string;
  models?: {
    identification: string;
    clustering: string;
    relevance_selection: string;
    extraction: string;
  };
  publisher_count: number;
  publishers_done: number;
  articles_found: number;
  articles_upserted: number;
  clusters_total: number;
  clusters_eligible: number;
  clusters_selected: number;
  sources_selected: number;
  errors: RunError[];
  publishers: RunPublisherProgress[];
  articles: RunArticleProgress[];
  publish?: {
    story_summaries?: Array<{
      cluster_id: string;
      title: string;
      detail_markdown: string;
    }>;
    brief_paragraphs?: Array<{
      cluster_id: string;
      markdown: string;
    }>;
  };
};

export function createInitialRunMetadata(): RunMetadata {
  return {
    model: RUN_MODEL,
    models: {
      identification: RUN_EXTRACT_MODEL,
      clustering: RUN_CLUSTER_MODEL,
      relevance_selection: RUN_RELEVANCE_MODEL,
      extraction: RUN_EXTRACT_MODEL,
    },
    publisher_count: 0,
    publishers_done: 0,
    articles_found: 0,
    articles_upserted: 0,
    clusters_total: 0,
    clusters_eligible: 0,
    clusters_selected: 0,
    sources_selected: 0,
    errors: [],
    publishers: [],
    articles: [],
    publish: {
      story_summaries: [],
      brief_paragraphs: [],
    },
  };
}

function isRunError(value: unknown): value is RunError {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { message?: unknown };
  return typeof candidate.message === "string";
}

function normalizePublisher(value: unknown): RunPublisherProgress | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.publisher_id !== "string" ||
    typeof row.publisher_name !== "string" ||
    typeof row.base_url !== "string"
  ) {
    return null;
  }
  const status = row.status;
  const isValidStatus =
    status === "pending" ||
    status === "running" ||
    status === "completed" ||
    status === "failed";
  if (!isValidStatus) return null;

  return {
    publisher_id: row.publisher_id,
    publisher_name: row.publisher_name,
    base_url: row.base_url,
    status,
    articles_found:
      typeof row.articles_found === "number" ? row.articles_found : 0,
    articles_upserted:
      typeof row.articles_upserted === "number" ? row.articles_upserted : 0,
    error_message:
      typeof row.error_message === "string" ? row.error_message : null,
  };
}

function normalizeArticle(value: unknown): RunArticleProgress | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.publisher_id !== "string" || typeof row.url !== "string") {
    return null;
  }
  const status = row.status;
  const isValidStatus =
    status === "pending" ||
    status === "identified" ||
    status === "metadata_fetching" ||
    status === "metadata_ready" ||
    status === "approving" ||
    status === "approved" ||
    status === "rejected" ||
    status === "clustering" ||
    status === "clustered" ||
    status === "selected_for_extraction" ||
    status === "not_selected_for_extraction" ||
    status === "skipped_existing" ||
    status === "fetching" ||
    status === "extracted" ||
    status === "upserted" ||
    status === "failed";
  if (!isValidStatus) return null;

  return {
    publisher_id: row.publisher_id,
    url: row.url,
    canonical_url:
      typeof row.canonical_url === "string" ? row.canonical_url : null,
    title: typeof row.title === "string" ? row.title : null,
    published_at: typeof row.published_at === "string" ? row.published_at : null,
    status,
    error_message:
      typeof row.error_message === "string" ? row.error_message : null,
  };
}

export function parseRunMetadata(value: Json | null): RunMetadata {
  const fallback = createInitialRunMetadata();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fallback;
  }

  const row = value as Record<string, unknown>;
  const errors = Array.isArray(row.errors) ? row.errors.filter(isRunError) : [];
  const publishers = Array.isArray(row.publishers)
    ? row.publishers
        .map((entry) => normalizePublisher(entry))
        .filter((entry): entry is RunPublisherProgress => Boolean(entry))
    : [];
  const articles = Array.isArray(row.articles)
    ? row.articles
        .map((entry) => normalizeArticle(entry))
        .filter((entry): entry is RunArticleProgress => Boolean(entry))
    : [];

  return {
    model: typeof row.model === "string" ? row.model : fallback.model,
    models:
      row.models &&
      typeof row.models === "object" &&
      !Array.isArray(row.models) &&
      typeof (row.models as Record<string, unknown>).identification === "string" &&
      typeof (row.models as Record<string, unknown>).clustering === "string" &&
      typeof (row.models as Record<string, unknown>).relevance_selection ===
        "string" &&
      typeof (row.models as Record<string, unknown>).extraction === "string"
        ? {
            identification: (row.models as Record<string, string>).identification,
            clustering: (row.models as Record<string, string>).clustering,
            relevance_selection: (row.models as Record<string, string>)
              .relevance_selection,
            extraction: (row.models as Record<string, string>).extraction,
          }
        : fallback.models,
    publisher_count:
      typeof row.publisher_count === "number" ? row.publisher_count : 0,
    publishers_done:
      typeof row.publishers_done === "number" ? row.publishers_done : 0,
    articles_found:
      typeof row.articles_found === "number" ? row.articles_found : 0,
    articles_upserted:
      typeof row.articles_upserted === "number" ? row.articles_upserted : 0,
    clusters_total: typeof row.clusters_total === "number" ? row.clusters_total : 0,
    clusters_eligible:
      typeof row.clusters_eligible === "number" ? row.clusters_eligible : 0,
    clusters_selected:
      typeof row.clusters_selected === "number" ? row.clusters_selected : 0,
    sources_selected:
      typeof row.sources_selected === "number" ? row.sources_selected : 0,
    errors,
    publishers,
    articles,
    publish:
      row.publish &&
      typeof row.publish === "object" &&
      !Array.isArray(row.publish)
        ? {
            story_summaries: Array.isArray(
              (row.publish as Record<string, unknown>).story_summaries,
            )
              ? (
                  (row.publish as Record<string, unknown>).story_summaries as Array<
                    Record<string, unknown>
                  >
                )
                  .map((entry) => ({
                    cluster_id:
                      typeof entry.cluster_id === "string" ? entry.cluster_id : "",
                    title: typeof entry.title === "string" ? entry.title : "",
                    detail_markdown:
                      typeof entry.detail_markdown === "string"
                        ? entry.detail_markdown
                        : "",
                  }))
                  .filter(
                    (entry) =>
                      entry.cluster_id.length > 0 &&
                      entry.title.length > 0 &&
                      entry.detail_markdown.length > 0,
                  )
              : [],
            brief_paragraphs: Array.isArray(
              (row.publish as Record<string, unknown>).brief_paragraphs,
            )
              ? (
                  (row.publish as Record<string, unknown>).brief_paragraphs as Array<
                    Record<string, unknown>
                  >
                )
                  .map((entry) => ({
                    cluster_id:
                      typeof entry.cluster_id === "string" ? entry.cluster_id : "",
                    markdown: typeof entry.markdown === "string" ? entry.markdown : "",
                  }))
                  .filter(
                    (entry) =>
                      entry.cluster_id.length > 0 && entry.markdown.length > 0,
                  )
              : [],
          }
        : fallback.publish,
  };
}
