export const RUN_EXTRACT_MODEL = "gemini-3.1-flash-lite-preview";
export const RUN_CLUSTER_MODEL = "gemini-3.1-flash-lite-preview";
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

const BRIEF_SECTION_DEFAULT_PARAGRAPH_COUNT = 1;
const BRIEF_SECTION_MAX_PARAGRAPH_COUNT = 3;
const BRIEF_SECTION_DEFAULT_CHAR_TARGET = 500;
const BRIEF_SECTION_CHAR_TARGET_ABS_MIN = 50;
const BRIEF_SECTION_CHAR_TARGET_ABS_MAX = 4000;

export type BriefSectionComposeConstraints = {
  paragraphCount: number;
  charTarget: number;
};

function parseOptionalInt(
  raw: string | undefined,
  defaultValue: number,
  envName: string,
  min: number,
  max: number,
): number {
  const trimmed = raw?.trim();
  if (!trimmed) return defaultValue;
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(
      `${envName} must be an integer between ${min} and ${max} when set.`,
    );
  }
  return n;
}

/**
 * Controls brief section shape in `composeBriefSections` (Gemini prompt + markdown normalization).
 * Unset vars use defaults: 1 paragraph, ~500 characters per paragraph as a soft target (Spanish, spaces included).
 */
export function parseBriefSectionComposeConstraints(): BriefSectionComposeConstraints {
  const paragraphCount = parseOptionalInt(
    process.env.BRIEF_SECTION_PARAGRAPH_COUNT,
    BRIEF_SECTION_DEFAULT_PARAGRAPH_COUNT,
    "BRIEF_SECTION_PARAGRAPH_COUNT",
    1,
    BRIEF_SECTION_MAX_PARAGRAPH_COUNT,
  );
  const charTarget = parseOptionalInt(
    process.env.BRIEF_SECTION_CHAR_TARGET,
    BRIEF_SECTION_DEFAULT_CHAR_TARGET,
    "BRIEF_SECTION_CHAR_TARGET",
    BRIEF_SECTION_CHAR_TARGET_ABS_MIN,
    BRIEF_SECTION_CHAR_TARGET_ABS_MAX,
  );
  return { paragraphCount, charTarget };
}
