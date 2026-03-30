import { z } from "zod";

export const EXISTING_ARTICLE_BATCH_SIZE = 200;
export const EXISTING_ARTICLE_MAX_ENCODED_URL_CHARS = 7_000;

const clusterEventDiscoveryItemSchema = z.object({
  event_ref: z.string().trim().min(1),
  description: z.string().trim().min(1),
});

/** `minEvents` is typically ceil(articleCount / 4) from clustering; must be >= 1. */
export function createClusterEventDiscoverySchema(minEvents: number) {
  const floor = Math.max(1, Math.floor(minEvents));
  return z.object({
    events: z.array(clusterEventDiscoveryItemSchema).min(floor),
  });
}

export function createClusterEventDiscoveryResponseJsonSchema(minEvents: number) {
  const floor = Math.max(1, Math.floor(minEvents));
  return {
    type: "object",
    properties: {
      events: {
        type: "array",
        minItems: floor,
        items: {
          type: "object",
          properties: {
            event_ref: { type: "string" },
            description: { type: "string" },
          },
          required: ["event_ref", "description"],
        },
      },
    },
    required: ["events"],
  };
}

/**
 * Pass B: one row per event cluster. `source_refs` is comma-separated candidate aliases (c1,c2,…).
 * We use a string (not a JSON array) so Gemini `responseJsonSchema` accepts the shape: nested arrays
 * inside array-of-objects often trigger INVALID_ARGUMENT.
 */
export const clusterEventAssignmentSchema = z.object({
  clusters: z.array(
    z.object({
      event_ref: z.string().trim().min(1),
      source_refs: z.string().trim().min(1),
    }),
  ),
});

export const clusterEventAssignmentResponseJsonSchema = {
  type: "object",
  properties: {
    clusters: {
      type: "array",
      items: {
        type: "object",
        properties: {
          event_ref: {
            type: "string",
            description: "Event id from pass A (e.g. e1).",
          },
          source_refs: {
            type: "string",
            description:
              "Comma-separated source_ref ids for this event (e.g. c1,c3,c7). No spaces required.",
          },
        },
        required: ["event_ref", "source_refs"],
      },
    },
  },
  required: ["clusters"],
};

/** Pre-clustering pass: refs (e.g. c1, c2) to drop as routine non-history-making sports. */
export const clusterSportsFilterSchema = z.object({
  remove_source_refs: z.array(z.string().trim().min(1)),
});

export const clusterSportsFilterResponseJsonSchema = {
  type: "object",
  properties: {
    remove_source_refs: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["remove_source_refs"],
};

const rankedClusterSelectionItemSchema = z.object({
  cluster_id: z.string().trim().min(1),
  selection_reason: z.string().trim().min(1).max(220),
  position: z.number().int().min(1).max(200),
});

const diffuseClusterSelectionItemSchema = z.object({
  cluster_id: z.string().trim().min(1),
  reason: z.string().trim().min(1).max(220).optional(),
});

export function createTieredRelevantStoriesSchema(
  maxPrimary: number,
  maxSecondary: number,
) {
  return z.object({
    primary_clusters: z.array(rankedClusterSelectionItemSchema).max(maxPrimary),
    secondary_clusters: z
      .array(rankedClusterSelectionItemSchema)
      .max(maxSecondary),
    diffuse_clusters: z.array(diffuseClusterSelectionItemSchema),
  });
}

export function createTieredRelevantStoriesResponseJsonSchema(
  maxPrimary: number,
  maxSecondary: number,
) {
  return {
    type: "object",
    properties: {
      primary_clusters: {
        type: "array",
        items: {
          type: "object",
          properties: {
            cluster_id: { type: "string" },
            selection_reason: { type: "string" },
            position: { type: "number" },
          },
          required: ["cluster_id", "selection_reason", "position"],
        },
        ...(maxPrimary > 0 ? { maxItems: maxPrimary } : {}),
      },
      secondary_clusters: {
        type: "array",
        items: {
          type: "object",
          properties: {
            cluster_id: { type: "string" },
            selection_reason: { type: "string" },
            position: { type: "number" },
          },
          required: ["cluster_id", "selection_reason", "position"],
        },
        ...(maxSecondary > 0 ? { maxItems: maxSecondary } : {}),
      },
      diffuse_clusters: {
        type: "array",
        items: {
          type: "object",
          properties: {
            cluster_id: { type: "string" },
            reason: { type: "string" },
          },
          required: ["cluster_id"],
        },
      },
    },
    required: ["primary_clusters", "secondary_clusters", "diffuse_clusters"],
  };
}

export type TieredRelevantStories = z.infer<
  ReturnType<typeof createTieredRelevantStoriesSchema>
>;

/**
 * Normalizes model timestamps without Zod's strict `datetime` string format (which can reject
 * valid instants like `...50.612Z`). Unparseable strings become null.
 */
const instantOrNull = z.preprocess(
  (val: unknown): string | null => {
    if (val === null || val === undefined) return null;
    const s = typeof val === "string" ? val.trim() : String(val).trim();
    if (!s) return null;
    const ms = Date.parse(s);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  },
  z.union([z.string(), z.null()]),
);

const timelineItemSchema = z.object({
  timestamp: instantOrNull.describe(
    "When this development happened or surfaced. Align with source dates when possible.",
  ),
  summary: z
    .string()
    .trim()
    .min(1)
    .max(280)
    .describe(
      "One concise sentence in Spanish describing a development in the story. Factual and specific; prefer concrete updates over vague background.",
    ),
  is_latest: z
    .boolean()
    .describe(
      "True for exactly one entry: the newest and most important development in this timeline.",
    ),
});

const quoteSchema = z.object({
  speaker: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .describe(
      "Short name of who is quoted: person or institution, as in the articles.",
    ),
  speaker_context: z
    .string()
    .trim()
    .min(1)
    .max(320)
    .describe(
      "Who they are in context: current office, role, affiliation, party, or capacity (e.g. presidente de Estados Unidos, portavoz del Ministerio de Relaciones Exteriores de Irán, canciller federal de Alemania). Spanish. Ground only in the articles.",
    ),
  text: z
    .string()
    .trim()
    .min(1)
    .max(800)
    .describe(
      "Direct quote, faithfully reproduced from the article text. Do not paraphrase. Spanish if the source is Spanish.",
    ),
});

export const simpleStorySummarySchema = z
  .object({
    story_id: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .describe(
        "Stable story identifier from the pipeline (cluster id). The server may overwrite this.",
      ),

    story_title: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe(
        "Model-written short neutral headline in Spanish from the article texts (not copied from clustering or source headlines). Clear topic, no opinion or hype.",
      ),

    as_of: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .describe(
        "Reference instant for recency (prefer ISO 8601 UTC). The server overwrites this with the pipeline clock.",
      ),

    summary: z
      .string()
      .trim()
      .min(400)
      .max(4000)
      .describe(
        "Detailed Spanish synthesis of all input articles: coherent narrative, newest verified developments first, then necessary context. Objective journalistic tone; only facts supported by the sources.",
      ),

    latest_development: z
      .string()
      .trim()
      .min(1)
      .max(400)
      .describe(
        "Single Spanish sentence: the most important new development. Must match the timeline entry where is_latest is true.",
      ),

    latest_development_at: instantOrNull.describe(
      "Timestamp of that newest development when known from sources; otherwise null. Must equal the timestamp of the timeline entry with is_latest=true.",
    ),

    timeline: z
      .array(timelineItemSchema)
      .min(1)
      .max(10)
      .describe(
        "Main developments ordered from oldest to newest. Omit minor steps; keep the arc understandable.",
      ),

    key_facts: z
      .array(
        z
          .string()
          .trim()
          .min(80)
          .max(900)
          .describe(
            "One substantial verifiable fact in Spanish (roughly 1–3 sentences). Include specifics: actors, actions, places, figures, dates, or institutional details when the sources provide them. One main claim per item; no opinion; no stacking unrelated claims.",
          ),
      )
      .min(3)
      .max(12)
      .describe(
        "The most important facts for downstream use, each written with enough detail to stand alone without the full article text.",
      ),

    quotes: z
      .array(quoteSchema)
      .max(8)
      .describe(
        "Optional direct quotes that are central; omit if none are substantial.",
      ),
  })
  .superRefine((value, ctx) => {
    const latestItems = value.timeline.filter((item) => item.is_latest);
    if (latestItems.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["timeline"],
        message: "Exactly one timeline item must have is_latest=true.",
      });
      return;
    }
    const latest = latestItems[0];
    if (!latest) return;
    if (latest.timestamp !== value.latest_development_at) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["latest_development_at"],
        message:
          "latest_development_at must match the timestamp field of the timeline entry with is_latest=true (both may be null).",
      });
    }
  });

export type StorySummaryJson = z.infer<typeof simpleStorySummarySchema>;

/** Gemini JSON Schema subset aligned with `simpleStorySummarySchema`. */
export const simpleStorySummaryResponseJsonSchema = {
  type: "object",
  properties: {
    story_id: { type: "string", minLength: 1, maxLength: 120 },
    story_title: { type: "string", minLength: 1, maxLength: 200 },
    as_of: { type: "string" },
    summary: { type: "string", minLength: 400, maxLength: 4000 },
    latest_development: { type: "string", minLength: 1, maxLength: 400 },
    latest_development_at: { type: "string", nullable: true },
    timeline: {
      type: "array",
      minItems: 1,
      maxItems: 10,
      items: {
        type: "object",
        properties: {
          timestamp: { type: "string", nullable: true },
          summary: { type: "string", minLength: 1, maxLength: 280 },
          is_latest: { type: "boolean" },
        },
        required: ["timestamp", "summary", "is_latest"],
      },
    },
    key_facts: {
      type: "array",
      minItems: 3,
      maxItems: 12,
      items: { type: "string", minLength: 80, maxLength: 900 },
    },
    quotes: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        properties: {
          speaker: { type: "string", minLength: 1, maxLength: 120 },
          speaker_context: { type: "string", minLength: 1, maxLength: 320 },
          text: { type: "string", minLength: 1, maxLength: 800 },
        },
        required: ["speaker", "speaker_context", "text"],
      },
    },
  },
  required: [
    "story_id",
    "story_title",
    "as_of",
    "summary",
    "latest_development",
    "latest_development_at",
    "timeline",
    "key_facts",
    "quotes",
  ],
};

export const briefSectionSchema = z.object({
  markdown: z.string().trim().min(10),
});

export const finalBriefSectionsSchema = z.object({
  sections: z.array(briefSectionSchema).min(1),
});

export const finalBriefSectionsResponseJsonSchema = {
  type: "object",
  properties: {
    sections: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          markdown: { type: "string", minLength: 10 },
        },
        required: ["markdown"],
      },
    },
  },
  required: ["sections"],
};

export const OBJECTIVE_JOURNALISTIC_TONE_INSTRUCTION =
  "Adopt a strictly objective journalistic tone: eliminate value-laden adjectives, metaphors, and intensifiers. Limit yourself to reporting verifiable facts, actions, and direct quotes. Avoid interpreting intentions, predicting consequences, or labeling the severity of events. Specifically, avoid subjective Spanish terms such as: 'trágico', 'conmocionado', 'alarmante', 'agresivo', 'tormenta política', 'sistemáticamente', or 'razonable'.";
