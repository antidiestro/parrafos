import { generateGeminiJson } from "@/lib/gemini/generate";
import {
  parseBriefSectionComposeConstraints,
  RUN_BRIEF_MODEL,
} from "@/lib/runs/constants";
import {
  OBJECTIVE_JOURNALISTIC_TONE_INSTRUCTION,
  finalBriefSectionsResponseJsonSchema,
  finalBriefSectionsSchema,
  simpleStorySummarySchema,
  type StorySummaryJson,
} from "@/lib/runs/console/pipeline-constants";
import { divider, logLine } from "@/lib/runs/console/logging";
import type { BriefSectionRow, StorySummaryRow } from "@/lib/runs/console/types";
import { normalizeBriefSectionMarkdown } from "@/lib/runs/console/utils";

function parseStoredStorySummaryJson(detailMarkdown: string): StorySummaryJson {
  let raw: unknown;
  try {
    raw = JSON.parse(detailMarkdown);
  } catch {
    throw new Error("Story summary is not valid JSON (expected structured summary payload).");
  }
  return simpleStorySummarySchema.parse(raw);
}

function briefSectionFormattingInstructions(
  paragraphCount: number,
  charTarget: number,
): string[] {
  const lengthPhrase = `Aim for roughly ${charTarget} characters per paragraph as a guide only (Spanish text, spaces included)—stay natural; do not pad or truncate to hit an exact count. Include the bold title in the first paragraph only.`;
  if (paragraphCount <= 1) {
    return [
      "Each section is markdown for that story. Within each section, write exactly one markdown paragraph (no line breaks inside the section body).",
      lengthPhrase.replace(" per paragraph", " for that paragraph"),
      "Start the paragraph with a short inline title in bold, ending with a period, then continue in the same paragraph.",
      'Required format at section start: "**Título corto.** " followed by the rest of the paragraph.',
    ];
  }
  return [
    `Each section is markdown for that story. Within each section, write exactly ${paragraphCount} markdown paragraphs, separated by a single blank line (no extra blank lines).`,
    lengthPhrase,
    "Separate paragraphs with real line breaks in the markdown field: press Enter twice between paragraphs. Do not write the two characters backslash and n; the JSON string must contain actual newline characters.",
    "Start the first paragraph with a short inline title in bold, ending with a period, then continue in that paragraph.",
    'Required format at the start of the first paragraph: "**Título corto.** " followed by the rest of that paragraph.',
    "Do not use a bold lead-in title on the second or later paragraphs unless quoting requires it.",
    "Later paragraphs continue the story with context or background; no bullet lists inside any paragraph.",
  ];
}

export async function composeBriefSections(
  storySummaries: StorySummaryRow[],
): Promise<BriefSectionRow[]> {
  divider("compose_brief_sections");
  const constraints = parseBriefSectionComposeConstraints();
  logLine("compose_brief_sections: input prepared", {
    storySummaries: storySummaries.length,
    ...constraints,
  });
  if (storySummaries.length === 0) {
    throw new Error("Cannot compose brief sections without story summaries.");
  }
  const referenceNowIso = new Date().toISOString();

  const summaryBlocks = storySummaries
    .map((summary, idx) => {
      const payload = parseStoredStorySummaryJson(summary.detailMarkdown);
      const headlineLines =
        summary.sourceHeadlines.length > 0
          ? summary.sourceHeadlines.map((headline) => `- ${headline}`).join("\n")
          : "- (none)";
      return [
        `Story ${idx + 1}`,
        `Story cluster ID: ${summary.clusterId}`,
        `Story title: ${summary.title}`,
        "Source headlines for angle selection (signals for what to highlight; do not quote verbatim unless necessary):",
        headlineLines,
        "Structured story summary (JSON):",
        JSON.stringify(payload, null, 2),
      ].join("\n");
    })
    .join("\n\n---\n\n");

  const prompt = [
    "You are composing a final multi-story news brief from structured per-story summaries (JSON objects with summary, timeline, key_facts, quotes, and latest_development fields).",
    "Output MUST be in Spanish.",
    "Return exactly one brief section per story, in the same order.",
    ...briefSectionFormattingInstructions(
      constraints.paragraphCount,
      constraints.charTarget,
    ),
    "Keep the bold title short (2-6 words), neutral, and objective.",
    "The bold title must describe the latest concrete development in that story, not the broader ongoing theme. Prefer `latest_development` and the timeline entry with is_latest=true.",
    "No headings, no bullet lists, no inline citations.",
    "Use each story's source headlines primarily for angle selection and emphasis decisions; they are signals, not standalone facts.",
    "If a story occurs outside Chile, explicitly mention the country in that section.",
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

  const rows = generated.sections.map((section, idx) => {
    const markdown = normalizeBriefSectionMarkdown(
      section.markdown,
      constraints.paragraphCount,
    );
    if (constraints.paragraphCount > 1) {
      const paragraphBlocks = markdown.split(/\n\n+/).filter(Boolean);
      if (paragraphBlocks.length !== constraints.paragraphCount) {
        logLine("compose_brief_sections: paragraph count mismatch (continuing)", {
          storyIndex: idx + 1,
          expected: constraints.paragraphCount,
          got: paragraphBlocks.length,
        });
      }
    }
    return {
      clusterId: storySummaries[idx].clusterId,
      markdown,
    };
  });
  logLine("compose_brief_sections: done", { sections: rows.length });
  return rows;
}
