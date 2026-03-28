import { generateGeminiJson } from "@/lib/gemini/generate";
import { RUN_BRIEF_MODEL } from "@/lib/runs/constants";
import {
  OBJECTIVE_JOURNALISTIC_TONE_INSTRUCTION,
  finalBriefSectionsResponseJsonSchema,
  finalBriefSectionsSchema,
  simpleStorySummarySchema,
  type StorySummaryJson,
} from "@/lib/runs/console/pipeline-constants";
import { divider, logLine } from "@/lib/runs/console/logging";
import type { BriefSectionRow, StorySummaryRow } from "@/lib/runs/console/types";
import { decodeHtmlEntities, replaceNewlinesWithSpaces } from "@/lib/runs/console/utils";

function parseStoredStorySummaryJson(detailMarkdown: string): StorySummaryJson {
  let raw: unknown;
  try {
    raw = JSON.parse(detailMarkdown);
  } catch {
    throw new Error("Story summary is not valid JSON (expected structured summary payload).");
  }
  return simpleStorySummarySchema.parse(raw);
}

export async function composeBriefSections(
  storySummaries: StorySummaryRow[],
): Promise<BriefSectionRow[]> {
  divider("compose_brief_sections");
  logLine("compose_brief_sections: input prepared", {
    storySummaries: storySummaries.length,
  });
  if (storySummaries.length === 0) {
    throw new Error("Cannot compose brief sections without story summaries.");
  }
  const referenceNowIso = new Date().toISOString();

  const summaryBlocks = storySummaries
    .map((summary, idx) => {
      const payload = parseStoredStorySummaryJson(summary.detailMarkdown);
      return [
        `Story ${idx + 1}`,
        `Story cluster ID: ${summary.clusterId}`,
        `Story title: ${summary.title}`,
        "Structured story summary (JSON):",
        JSON.stringify(payload, null, 2),
      ].join("\n");
    })
    .join("\n\n---\n\n");

  const prompt = [
    "You are composing a final multi-story news brief from structured per-story summaries (JSON objects with summary, timeline, key_facts, quotes, and latest_development fields).",
    "Output MUST be in Spanish.",
    "Return exactly one brief section per story, in the same order.",
    "Each section is markdown for that story. Within each section, write exactly one markdown paragraph (no line breaks inside the section body).",
    "Target about 480–520 characters for that paragraph (Spanish text, spaces included), including the bold title.",
    "Start the paragraph with a short inline title in bold, ending with a period, then continue in the same paragraph.",
    'Required format at section start: "**Título corto.** " followed by the rest of the paragraph.',
    "Keep the bold title short (2-6 words), neutral, and objective.",
    "The bold title must describe the latest concrete development in that story, not the broader ongoing theme. Prefer `latest_development` and the timeline entry with is_latest=true.",
    "No headings, no bullet lists, no inline citations.",
    "Use a balanced rewrite: improve coherence and reduce repetition while preserving each story's facts from the JSON.",
    "Prioritize newer developments over older background context when deciding emphasis within each section.",
    "Use `as_of` on each JSON object and timeline timestamps as the primary guide to recency; treat the most recent verified updates as primary.",
    `Reference date/time for writing criteria: ${referenceNowIso}. Use this timestamp as "now" when assessing recency and temporal context.`,
    "Keep a skeptical and balanced tone: acknowledge possible source bias and potential agendas in official versions.",
    "Keep that tone cautious and evidence-based, not conspiratorial.",
    OBJECTIVE_JOURNALISTIC_TONE_INSTRUCTION,
    "Use proper Spanish orthography (UTF-8), including accents and ñ; never replace accented characters with ASCII placeholders, numbers, or entities.",
    "Do not merge stories or move facts across story boundaries.",
    `Number of stories: ${storySummaries.length}`,
    "Structured story summaries (ordered):",
    summaryBlocks,
    'Return JSON with {"sections":[{"markdown":"..."}, ...]}',
  ].join("\n");

  const generated = await generateGeminiJson(prompt, finalBriefSectionsSchema, {
    model: RUN_BRIEF_MODEL,
    nativeStructuredOutput: {
      responseJsonSchema: finalBriefSectionsResponseJsonSchema,
    },
  });
  logLine("compose_brief_sections: model response received", {
    sectionsReturned: generated.sections.length,
  });

  if (generated.sections.length !== storySummaries.length) {
    throw new Error(
      `Final brief section count mismatch: expected ${storySummaries.length}, got ${generated.sections.length}`,
    );
  }

  const rows = generated.sections.map((section, idx) => ({
    clusterId: storySummaries[idx].clusterId,
    markdown: replaceNewlinesWithSpaces(decodeHtmlEntities(section.markdown)),
  }));
  logLine("compose_brief_sections: done", { sections: rows.length });
  return rows;
}
