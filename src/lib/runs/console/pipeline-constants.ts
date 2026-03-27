import { z } from "zod";

export const MIN_SOURCES_PER_CLUSTER = 3;
export const TARGET_CLUSTER_COUNT = 10;
export const MAX_RELEVANT_STORIES = 6;
export const EXISTING_ARTICLE_BATCH_SIZE = 200;
export const EXISTING_ARTICLE_MAX_ENCODED_URL_CHARS = 7_000;

export const clusterSchema = z.object({
  stories: z.array(
    z.object({
      title: z.string().trim().min(1),
      source_keys: z.array(z.string().trim().min(1)).min(1).max(100),
    }),
  ),
});

export const clusterResponseJsonSchema = {
  type: "object",
  properties: {
    stories: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          source_keys: { type: "array", items: { type: "string" } },
        },
        required: ["title", "source_keys"],
      },
    },
  },
  required: ["stories"],
};

export const relevantStoriesSchema = z.object({
  selected_clusters: z
    .array(
      z.object({
        cluster_id: z.string().trim().min(1),
        selection_reason: z.string().trim().min(1).max(220),
        latest_development: z.string().trim().min(1).max(280),
      }),
    )
    .max(MAX_RELEVANT_STORIES),
});

export const relevantStoriesResponseJsonSchema = {
  type: "object",
  properties: {
    selected_clusters: {
      type: "array",
      items: {
        type: "object",
        properties: {
          cluster_id: { type: "string" },
          selection_reason: { type: "string" },
          latest_development: { type: "string" },
        },
        required: ["cluster_id", "selection_reason", "latest_development"],
      },
      maxItems: MAX_RELEVANT_STORIES,
    },
  },
  required: ["selected_clusters"],
};

export const storyDetailSchema = z.object({
  detail_markdown: z.string().trim().min(120),
});

export const storyDetailResponseJsonSchema = {
  type: "object",
  properties: {
    detail_markdown: { type: "string", minLength: 120 },
  },
  required: ["detail_markdown"],
};

export const briefParagraphSchema = z.object({
  markdown: z.string().trim().min(10),
});

export const finalBriefParagraphsSchema = z.object({
  paragraphs: z.array(briefParagraphSchema).min(1),
});

export const finalBriefParagraphsResponseJsonSchema = {
  type: "object",
  properties: {
    paragraphs: {
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
  required: ["paragraphs"],
};

export const OBJECTIVE_JOURNALISTIC_TONE_INSTRUCTION =
  "Adopt a strictly objective journalistic tone: eliminate value-laden adjectives, metaphors, and intensifiers. Limit yourself to reporting verifiable facts, actions, and direct quotes. Avoid interpreting intentions, predicting consequences, or labeling the severity of events. Specifically, avoid subjective Spanish terms such as: 'trágico', 'conmocionado', 'alarmante', 'agresivo', 'tormenta política', 'sistemáticamente', or 'razonable'.";
