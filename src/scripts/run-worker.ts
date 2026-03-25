import { claimNextPendingRun, processRun } from "@/lib/runs/process";

async function processOne(): Promise<boolean> {
  const run = await claimNextPendingRun();
  if (!run) {
    return false;
  }
  await processRun(run.id);
  return true;
}

async function main() {
  const once = process.argv.includes("--once");

  if (once) {
    await processOne();
    return;
  }

  for (;;) {
    const claimed = await processOne();
    if (!claimed) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
