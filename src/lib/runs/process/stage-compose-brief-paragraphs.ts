import { appendRunEvent } from "@/lib/runs/persistence/events-repo";
import { listRunStorySummaries } from "@/lib/runs/persistence/story-summaries-repo";
import {
  completeRunStage,
  startRunStage,
} from "@/lib/runs/persistence/stages-repo";
import {
  composeBriefParagraphsFromSummaries,
  type PublishBriefParagraphCheckpoint,
} from "@/lib/runs/process/publish-brief";
import { isRunCancelled, updateRunProgress } from "@/lib/runs/process/shared";
import type { RunMetadata } from "@/lib/runs/progress";

export async function runComposeBriefParagraphsStage(input: {
  runId: string;
  metadata: RunMetadata;
}): Promise<boolean> {
  const { runId, metadata } = input;
  if (await isRunCancelled(runId)) return false;
  const storySummaries = await listRunStorySummaries(runId);
  if (storySummaries.length === 0) {
    throw new Error(
      "Cannot compose brief paragraphs before story summaries are generated.",
    );
  }

  const attempt = await startRunStage(runId, "compose_brief_paragraphs");
  await appendRunEvent({
    runId,
    stage: "compose_brief_paragraphs",
    eventType: "stage_started",
    message: "Compose brief paragraphs stage started",
  });

  const briefParagraphs: PublishBriefParagraphCheckpoint =
    await composeBriefParagraphsFromSummaries(storySummaries);
  metadata.publish = {
    ...(metadata.publish ?? {}),
    brief_paragraphs: briefParagraphs,
  };
  await updateRunProgress(runId, { metadata });

  await completeRunStage(runId, "compose_brief_paragraphs", attempt);
  await appendRunEvent({
    runId,
    stage: "compose_brief_paragraphs",
    eventType: "stage_completed",
    message: "Compose brief paragraphs stage completed",
  });
  return true;
}
