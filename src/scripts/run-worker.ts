import { claimNextPendingRun, processRun } from "@/lib/runs/process";

function log(message: string, context?: Record<string, unknown>) {
  if (context) {
    console.log(
      `[worker:runs] ${new Date().toISOString()} ${message}`,
      context,
    );
  } else {
    console.log(`[worker:runs] ${new Date().toISOString()} ${message}`);
  }
}

async function processOne(): Promise<boolean> {
  log("claiming next pending run");
  const run = await claimNextPendingRun();
  if (!run) {
    log("no pending run found");
    return false;
  }
  log("claimed run", { runId: run.id });
  await processRun(run.id);
  log("finished processing run", { runId: run.id });
  return true;
}

async function main() {
  const once = process.argv.includes("--once");

  if (once) {
    log("starting in --once mode");
    await processOne();
    return;
  }

  log("starting in polling mode");
  for (;;) {
    const claimed = await processOne();
    if (!claimed) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

main().catch((error) => {
  log("worker crashed", {
    error: error instanceof Error ? error.message : String(error),
  });
  console.error(error);
  process.exit(1);
});
