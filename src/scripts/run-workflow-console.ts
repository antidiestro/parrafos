import { logLine } from "@/scripts/workflow-console/logging";
import { runConsoleWorkflow } from "@/scripts/workflow-console/index";

runConsoleWorkflow().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  logLine("console workflow failed", { error: message });
  console.error(error);
  process.exit(1);
});
