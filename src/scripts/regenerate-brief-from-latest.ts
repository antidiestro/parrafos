import { logLine } from "@/lib/runs/console/logging";
import { republishBriefFromLatestStories } from "@/lib/runs/console/republish-brief-from-latest";

republishBriefFromLatestStories()
  .then(({ briefId }) => {
    logLine("regenerate-brief-from-latest succeeded", { briefId });
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    logLine("regenerate-brief-from-latest failed", { err: message });
    console.error(error);
    process.exit(1);
  });
