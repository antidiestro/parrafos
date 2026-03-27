import { generateGeminiJson } from "@/lib/gemini/generate";
import { RUN_BRIEF_MODEL } from "@/lib/runs/constants";
import {
  OBJECTIVE_JOURNALISTIC_TONE_INSTRUCTION,
  finalBriefParagraphsResponseJsonSchema,
  finalBriefParagraphsSchema,
} from "@/scripts/workflow-console/constants";
import { divider, logLine } from "@/scripts/workflow-console/logging";
import type {
  BriefParagraphRow,
  StorySummaryRow,
} from "@/scripts/workflow-console/types";
import { decodeHtmlEntities, replaceNewlinesWithSpaces } from "@/scripts/workflow-console/utils";

export async function composeBriefParagraphs(
  storySummaries: StorySummaryRow[],
): Promise<BriefParagraphRow[]> {
  divider("compose_brief_paragraphs");
  logLine("compose_brief_paragraphs: input prepared", {
    storySummaries: storySummaries.length,
  });
  if (storySummaries.length === 0) {
    throw new Error("Cannot compose brief paragraphs without story summaries.");
  }
  const referenceNowIso = new Date().toISOString();
  const summaryBlocks = storySummaries
    .map((summary, idx) =>
      [
        `Story ${idx + 1}`,
        `Story cluster ID: ${summary.clusterId}`,
        `Story title: ${summary.title}`,
        "Detailed summary:",
        summary.detailMarkdown,
      ].join("\n"),
    )
    .join("\n\n---\n\n");

  const prompt = [
    "You are composing a final multi-story news brief from detailed story summaries.",
    "Output MUST be in Spanish.",
    "Return exactly one markdown paragraph per story, in the same order.",
    "Each paragraph must be exactly 4 sentences.",
    "Start each paragraph with a short inline title in bold, ending with a period, then continue in the same paragraph.",
    'Required format at paragraph start: "**Título corto.** " followed by the rest of the paragraph.',
    "Keep the bold title short (2-6 words), neutral, and objective.",
    "The bold title must describe the latest concrete development in that story, not the broader ongoing theme.",
    "No headings, no bullet lists, no inline citations.",
    "Use a balanced rewrite: improve coherence and reduce repetition while preserving each story's facts.",
    "Prioritize newer developments over older background context when deciding emphasis within each paragraph.",
    "Pay close attention to source publication dates/timestamps mentioned in each story summary and treat the most recent verified updates as primary.",
    `Reference date/time for writing criteria: ${referenceNowIso}. Use this timestamp as "now" when assessing recency and temporal context.`,
    "Make transitions between consecutive paragraphs flow naturally in the given order, using concise bridging language without adding new facts.",
    "Keep a skeptical and balanced tone: acknowledge possible source bias and potential agendas in official versions.",
    "Keep that tone cautious and evidence-based, not conspiratorial.",
    OBJECTIVE_JOURNALISTIC_TONE_INSTRUCTION,
    "Use proper Spanish orthography (UTF-8), including accents and ñ; never replace accented characters with ASCII placeholders, numbers, or entities.",
    "Do not merge stories or move facts across story boundaries.",
    `Number of stories: ${storySummaries.length}`,
    "Story summaries (ordered):",
    summaryBlocks,
    'Return JSON with {"paragraphs":[{"markdown":"..."}, ...]}',
  ].join("\n");

  const generated = await generateGeminiJson(
    prompt,
    finalBriefParagraphsSchema,
    {
      model: RUN_BRIEF_MODEL,
      nativeStructuredOutput: {
        responseJsonSchema: finalBriefParagraphsResponseJsonSchema,
      },
    },
  );
  logLine("compose_brief_paragraphs: model response received", {
    paragraphsReturned: generated.paragraphs.length,
  });

  if (generated.paragraphs.length !== storySummaries.length) {
    throw new Error(
      `Final brief paragraph count mismatch: expected ${storySummaries.length}, got ${generated.paragraphs.length}`,
    );
  }

  const rows = generated.paragraphs.map((paragraph, idx) => ({
    clusterId: storySummaries[idx].clusterId,
    markdown: replaceNewlinesWithSpaces(decodeHtmlEntities(paragraph.markdown)),
  }));
  logLine("compose_brief_paragraphs: done", { paragraphs: rows.length });
  return rows;
}
