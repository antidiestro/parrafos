import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/** Repo-root relative; uses `process.cwd()` (npm scripts run from repo root). */
export const LATEST_RUN_DIR = path.join(process.cwd(), ".tmp", "latest-run");

export async function prepareLatestRunArtifactsDir(): Promise<void> {
  await rm(LATEST_RUN_DIR, { recursive: true, force: true });
  await mkdir(LATEST_RUN_DIR, { recursive: true });
}

/** Deep-convert `Map`/`Set`/plain objects for stable JSON logs. */
export function serializeJsonValue(value: unknown): unknown {
  if (value instanceof Map) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of value) {
      out[String(k)] = serializeJsonValue(v);
    }
    return out;
  }
  if (value instanceof Set) {
    return [...value].map(serializeJsonValue);
  }
  if (Array.isArray(value)) {
    return value.map(serializeJsonValue);
  }
  if (value !== null && typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto === Object.prototype || proto === null) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = serializeJsonValue(v);
      }
      return out;
    }
  }
  return value;
}

function resolveUnderLatestRun(relPath: string): string {
  const normalized = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, "");
  return path.join(LATEST_RUN_DIR, normalized);
}

export async function writeLatestRunText(
  relPath: string,
  body: string,
): Promise<void> {
  const full = resolveUnderLatestRun(relPath);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, body, "utf8");
}

export async function writeLatestRunJson(
  relPath: string,
  value: unknown,
): Promise<void> {
  const serialized = serializeJsonValue(value);
  await writeLatestRunText(relPath, `${JSON.stringify(serialized, null, 2)}\n`);
}

export type LatestRunStageStatus = {
  stage: string;
  finishedAt: string;
  ok: true;
  durationMs?: number;
  /** Extra counters / fields for logs and status.json */
  [key: string]: unknown;
};

export async function writeLatestRunStageStatus(
  stageSlug: string,
  status: LatestRunStageStatus,
): Promise<void> {
  const base = path.join(stageSlug);
  await writeLatestRunJson(`${base}/status.json`, status);

  const lines: string[] = [`# ${status.stage}`, ""];
  lines.push(`- **Finished:** ${status.finishedAt}`);
  if (status.durationMs !== undefined) {
    lines.push(`- **Duration:** ${status.durationMs} ms`);
  }
  for (const [k, v] of Object.entries(status)) {
    if (k === "stage" || k === "finishedAt" || k === "ok" || k === "durationMs") {
      continue;
    }
    lines.push(`- **${k}:** ${JSON.stringify(v)}`);
  }
  lines.push("");
  await writeLatestRunText(`${base}/STATUS.md`, lines.join("\n"));
}

/** Safe basename for `llm/<name>.json` paths from `publisherId::canonicalUrl`. */
export function sanitizeArtifactBasename(key: string, maxLen = 160): string {
  const cleaned = key
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  const base = cleaned.slice(0, maxLen);
  return base || "source";
}
