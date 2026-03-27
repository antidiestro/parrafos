import { appendRunEvent } from "@/lib/runs/persistence/events-repo";
import { completeRunStage, startRunStage } from "@/lib/runs/persistence/stages-repo";
import {
  generateStorySummariesForRun,
  type PublishStorySummaryCheckpoint,
} from "@/lib/runs/process/publish-brief";
import { isRunCancelled, updateRunProgress } from "@/lib/runs/process/shared";
import type { RunMetadata } from "@/lib/runs/progress";

export async function runGenerateStorySummariesStage(input: {
  runId: string;
  metadata: RunMetadata;
}): Promise<boolean> {
  const { runId, metadata } = input;
  if (await isRunCancelled(runId)) return false;
  const attempt = await startRunStage(runId, "generate_story_summaries");
  await appendRunEvent({
    runId,
    stage: "generate_story_summaries",
    eventType: "stage_started",
    message: "Generate story summaries stage started",
  });

  const storySummaries: PublishStorySummaryCheckpoint =
    await generateStorySummariesForRun(runId);
  metadata.publish = {
    ...(metadata.publish ?? {}),
    story_summaries: storySummaries,
    brief_paragraphs: [],
  };
  await updateRunProgress(runId, { metadata });

  await completeRunStage(runId, "generate_story_summaries", attempt);
  await appendRunEvent({
    runId,
    stage: "generate_story_summaries",
    eventType: "stage_completed",
    message: "Generate story summaries stage completed",
  });
  return true;
}
