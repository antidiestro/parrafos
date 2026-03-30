import { logLine } from "@/lib/runs/console/logging";
import { runDiscoverClusterSelectDryRun } from "@/lib/runs/console";

runDiscoverClusterSelectDryRun().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  logLine("pipeline dry-run failed", { err: message });
  console.error(error);
  process.exit(1);
});
