import { createHash } from "node:crypto";
import {
  EXISTING_ARTICLE_BATCH_SIZE,
  EXISTING_ARTICLE_MAX_ENCODED_URL_CHARS,
} from "@/lib/runs/console/pipeline-constants";

export function toCanonicalUrl(raw: string, baseUrl: string): string | null {
  try {
    const url = new URL(raw, baseUrl);
    url.hash = "";
    const removable = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "fbclid",
      "gclid",
    ];
    for (const key of removable) {
      url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function chunkCanonicalUrlsForLookup(urls: string[]): string[][] {
  if (urls.length === 0) return [];
  const chunks: string[][] = [];
  let currentChunk: string[] = [];
  let currentEncodedChars = 0;

  for (const url of urls) {
    const encodedLength = encodeURIComponent(url).length;
    const nextEncodedChars =
      currentChunk.length === 0
        ? encodedLength
        : currentEncodedChars + 1 + encodedLength;
    const wouldExceedCount = currentChunk.length >= EXISTING_ARTICLE_BATCH_SIZE;
    const wouldExceedEncodedChars =
      currentChunk.length > 0 &&
      nextEncodedChars > EXISTING_ARTICLE_MAX_ENCODED_URL_CHARS;

    if (wouldExceedCount || wouldExceedEncodedChars) {
      chunks.push(currentChunk);
      currentChunk = [url];
      currentEncodedChars = encodedLength;
      continue;
    }

    currentChunk.push(url);
    currentEncodedChars = nextEncodedChars;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

export function sourceKeyFor(publisherId: string, canonicalUrl: string) {
  const digest = createHash("sha256")
    .update(publisherId)
    .update("\0")
    .update(canonicalUrl)
    .digest("hex")
    .slice(0, 16);
  return `s_${digest}`;
}

/** Compact id for one line in the clustering LLM prompt only; maps back to `sourceKeyFor` via a per-run map. */
export function clusterPromptAliasForCandidateIndex(index: number): string {
  return `c${index + 1}`;
}

export function replaceNewlinesWithSpaces(value: string) {
  return value
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Models often return the characters `\` + `n` instead of a newline inside JSON strings.
 * Normalize those (and `\r\n`, `\t`) before splitting paragraphs.
 */
export function unescapeBriefMarkdownEscapes(value: string): string {
  return value
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n")
    .replace(/\\t/g, " ");
}

function splitBriefSectionParagraphs(
  normalized: string,
  expected: number,
): string[] {
  const trimmed = normalized.trim();
  if (expected <= 1) {
    return trimmed ? [trimmed] : [];
  }

  const blocksDoubleBreak = trimmed
    .split(/\n\s*\n+/)
    .map((b) => b.trim())
    .filter(Boolean);

  if (blocksDoubleBreak.length >= expected) {
    if (blocksDoubleBreak.length > expected) {
      const head = blocksDoubleBreak.slice(0, expected - 1);
      const rest = blocksDoubleBreak.slice(expected - 1).join("\n\n");
      return [...head, rest];
    }
    return blocksDoubleBreak;
  }

  if (blocksDoubleBreak.length === 1) {
    const lines = trimmed
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length >= expected) {
      if (lines.length > expected) {
        const head = lines.slice(0, expected - 1);
        const tail = lines.slice(expected - 1).join(" ");
        return [...head, tail];
      }
      return lines;
    }
  }

  return blocksDoubleBreak;
}

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 10)),
    )
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&aacute;/g, "á")
    .replace(/&eacute;/g, "é")
    .replace(/&iacute;/g, "í")
    .replace(/&oacute;/g, "ó")
    .replace(/&uacute;/g, "ú")
    .replace(/&Aacute;/g, "Á")
    .replace(/&Eacute;/g, "É")
    .replace(/&Iacute;/g, "Í")
    .replace(/&Oacute;/g, "Ó")
    .replace(/&Uacute;/g, "Ú")
    .replace(/&ntilde;/g, "ñ")
    .replace(/&Ntilde;/g, "Ñ")
    .replace(/&uuml;/g, "ü")
    .replace(/&Uuml;/g, "Ü")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&lsquo;|&rsquo;/g, "'")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&hellip;/g, "…")
    .replace(/&amp;/g, "&");
}

/** Collapse whitespace inside each markdown paragraph; preserve blank lines between paragraphs when count > 1. */
export function normalizeBriefSectionMarkdown(
  markdown: string,
  paragraphCount: number,
): string {
  const withRealBreaks = unescapeBriefMarkdownEscapes(markdown);
  const decoded = decodeHtmlEntities(withRealBreaks);
  const normalizedBreaks = decoded
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  if (paragraphCount <= 1) {
    return replaceNewlinesWithSpaces(normalizedBreaks);
  }
  const blocks = splitBriefSectionParagraphs(normalizedBreaks, paragraphCount);
  return blocks.map((block) => replaceNewlinesWithSpaces(block)).join("\n\n");
}

export function isPublishedWithinHours(
  publishedAt: string | null,
  nowMs: number,
  windowHours: number,
): boolean {
  if (!publishedAt) return false;
  const ts = +new Date(publishedAt);
  if (!Number.isFinite(ts)) return false;
  const delta = nowMs - ts;
  if (delta < 0) return false;
  return delta <= windowHours * 60 * 60 * 1000;
}

export function toSingleLine(value: string | null | undefined) {
  return replaceNewlinesWithSpaces(value ?? "");
}

export function toRecentCount(
  values: Array<string | null>,
  nowMs: number,
  windowHours: number,
): number {
  const windowMs = windowHours * 60 * 60 * 1000;
  return values.filter((value) => {
    if (!value) return false;
    const ts = +new Date(value);
    if (!Number.isFinite(ts)) return false;
    const delta = nowMs - ts;
    return delta >= 0 && delta <= windowMs;
  }).length;
}

export function toHoursAgo(iso: string | null, nowMs: number): number | null {
  if (!iso) return null;
  const ts = +new Date(iso);
  if (!Number.isFinite(ts)) return null;
  const delta = nowMs - ts;
  if (delta < 0) return 0;
  return Math.round((delta / (1000 * 60 * 60)) * 10) / 10;
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }
  const workers = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}
