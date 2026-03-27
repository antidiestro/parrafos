import { logLine } from "@/lib/runs/console/logging";
import { runConsoleWorkflow } from "@/lib/runs/console";

runConsoleWorkflow().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  logLine("console workflow failed", { error: message });
  console.error(error);
  process.exit(1);
});
