export const RUN_STAGES = [
  "discover_candidates",
  "prefetch_metadata",
  "cluster_sources",
  "select_clusters",
  "extract_bodies",
  "upsert_articles",
  "generate_story_summaries",
  "compose_brief_paragraphs",
  "persist_brief_output",
] as const;

export type RunStage = (typeof RUN_STAGES)[number];

export type RunStageStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type RunSummaryPatch = {
  extract_model: string;
  cluster_model: string;
  relevance_model: string;
  publisher_count: number;
  publishers_done: number;
  articles_found: number;
  articles_upserted: number;
  clusters_total: number;
  clusters_eligible: number;
  clusters_selected: number;
  sources_selected: number;
};
