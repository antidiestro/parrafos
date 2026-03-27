import { appendRunEvent } from "@/lib/runs/persistence/events-repo";
import {
  completeRunStage,
  startRunStage,
} from "@/lib/runs/persistence/stages-repo";
import {
  createAndPublishBriefForRun,
  isRunCancelled,
} from "@/lib/runs/process/shared";

export async function runPublishBriefStage(runId: string): Promise<boolean> {
  if (await isRunCancelled(runId)) return false;
  const publishStageAttempt = await startRunStage(runId, "publish_brief");
  await appendRunEvent({
    runId,
    stage: "publish_brief",
    eventType: "stage_started",
    message: "Publish brief stage started",
  });
  await createAndPublishBriefForRun(runId);
  await completeRunStage(runId, "publish_brief", publishStageAttempt);
  await appendRunEvent({
    runId,
    stage: "publish_brief",
    eventType: "stage_completed",
    message: "Publish brief stage completed",
  });
  return true;
}
