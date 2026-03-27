import { appendRunEvent } from "@/lib/runs/persistence/events-repo";
import {
  completeRunStage,
  startRunStage,
} from "@/lib/runs/persistence/stages-repo";
import { persistBriefOutputForRun } from "@/lib/runs/process/publish-brief";
import { isRunCancelled } from "@/lib/runs/process/shared";
import type { RunMetadata } from "@/lib/runs/progress";

export async function runPersistBriefOutputStage(input: {
  runId: string;
  metadata: RunMetadata;
}): Promise<boolean> {
  const { runId, metadata } = input;
  if (await isRunCancelled(runId)) return false;
  const storySummaries = metadata.publish?.story_summaries ?? [];
  const briefParagraphs = metadata.publish?.brief_paragraphs ?? [];
  if (storySummaries.length === 0) {
    throw new Error(
      "Cannot persist brief output before story summaries exist.",
    );
  }
  if (briefParagraphs.length === 0) {
    throw new Error(
      "Cannot persist brief output before brief paragraphs exist.",
    );
  }

  const attempt = await startRunStage(runId, "persist_brief_output");
  await appendRunEvent({
    runId,
    stage: "persist_brief_output",
    eventType: "stage_started",
    message: "Persist brief output stage started",
  });

  await persistBriefOutputForRun({ runId, storySummaries, briefParagraphs });

  await completeRunStage(runId, "persist_brief_output", attempt);
  await appendRunEvent({
    runId,
    stage: "persist_brief_output",
    eventType: "stage_completed",
    message: "Persist brief output stage completed",
  });
  return true;
}
