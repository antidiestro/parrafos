export const RUN_EXTRACT_MODEL = "gemini-3.1-flash-lite-preview";
export const RUN_CLUSTER_MODEL = "gemini-3-flash-preview";
export const RUN_RELEVANCE_MODEL = "gemini-3-flash-preview";
export const RUN_BRIEF_MODEL = "gemini-3-flash-preview";
export const RUN_MODEL = RUN_EXTRACT_MODEL;
export const RUN_RECENCY_WINDOW_SHORT_HOURS = 6;
export const RUN_RECENCY_WINDOW_MEDIUM_HOURS = 24;

/**
 * When set (0–100), `generate-brief` aborts after discovery if the share of
 * canonical URLs not present in the latest saved snapshot is below this value.
 * Unset or empty = no gate.
 */
export function parseRunMinPctNewCandidates(): number | null {
  const raw = process.env.RUN_MIN_PCT_NEW_CANDIDATES?.trim();
  if (!raw) return null;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    throw new Error(
      "RUN_MIN_PCT_NEW_CANDIDATES must be a number between 0 and 100 when set.",
    );
  }
  return n;
}
