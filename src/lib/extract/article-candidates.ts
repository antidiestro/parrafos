import { load } from "cheerio";

export type HomepageArticleCandidate = {
  url: string;
};

export type ArticleMetadata = {
  canonicalUrl: string | null;
  title: string | null;
  description: string | null;
  publishedAt: string | null;
  source: "ldjson" | "meta";
};

function toCanonicalUrl(raw: string, baseUrl: string): string | null {
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

const BLOCKED_PATH_SEGMENTS = new Set([
  "category",
  "categoria",
  "categorias",
  "tag",
  "tags",
  "author",
  "autor",
  "site",
  "tax",
  "port",
  "topic",
  "topics",
  "buscar",
  "search",
  "newsletter",
  "podcast",
  "programa",
  "programas",
  "galeria",
  "galerias",
]);

function hostnameMatchesPublisher(
  candidateHost: string,
  publisherHost: string,
): boolean {
  if (candidateHost === publisherHost) return true;
  return (
    candidateHost.endsWith(`.${publisherHost}`) ||
    publisherHost.endsWith(`.${candidateHost}`)
  );
}

function hasDatePattern(segments: string[]): boolean {
  for (let index = 0; index <= segments.length - 3; index += 1) {
    const yyyy = segments[index];
    const mm = segments[index + 1];
    const dd = segments[index + 2];
    if (
      /^(19|20)\d{2}$/.test(yyyy) &&
      /^(0?[1-9]|1[0-2])$/.test(mm) &&
      /^(0?[1-9]|[12]\d|3[01])$/.test(dd)
    ) {
      return true;
    }
  }
  return segments.some(
    (segment) => /^\d{8}$/.test(segment) || /^\d{4}-\d{2}-\d{2}$/.test(segment),
  );
}

function getArticleUrlScore(raw: string, baseUrl: string): number | null {
  try {
    const resolved = new URL(raw, baseUrl);
    if (!/^https?:$/i.test(resolved.protocol)) return null;
    const baseHost = new URL(baseUrl).hostname.toLowerCase();
    const candidateHost = resolved.hostname.toLowerCase();
    if (!hostnameMatchesPublisher(candidateHost, baseHost)) return null;

    const segments = resolved.pathname.split("/").filter(Boolean);
    if (segments.length < 3) return null;

    const normalizedSegments = segments.map((segment) => segment.toLowerCase());
    const last = normalizedSegments[normalizedSegments.length - 1] ?? "";

    if (/\.(jpg|jpeg|png|gif|webp|svg|pdf|xml|json|mp4|mp3)$/i.test(last)) {
      return null;
    }

    if (
      normalizedSegments.some((segment) => BLOCKED_PATH_SEGMENTS.has(segment))
    ) {
      return null;
    }

    let score = 0;
    if (segments.length >= 4) score += 1;
    if (hasDatePattern(normalizedSegments)) score += 2;
    if (
      normalizedSegments.some((segment) =>
        /(^|[-_])(noticia|noticias)($|[-_])/.test(segment),
      )
    ) {
      score += 1;
    }
    if (/-/.test(last) && last.length >= 15) score += 1;
    if (/\d{5,}/.test(last)) score += 1;
    if (resolved.searchParams.toString()) score -= 1;

    return score;
  } catch {
    return null;
  }
}

function getMetaContent(
  $: ReturnType<typeof load>,
  key: string,
): string | null {
  const value =
    $(`meta[property="${key}"]`).attr("content") ??
    $(`meta[name="${key}"]`).attr("content");
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

const DEFAULT_PUBLISHED_AT_FALLBACK_TIMEZONE = "America/Santiago";

function getPublishedAtFallbackTimezone(): string {
  const configured = process.env.RUN_PUBLISHED_AT_FALLBACK_TIMEZONE?.trim();
  return configured || DEFAULT_PUBLISHED_AT_FALLBACK_TIMEZONE;
}

function hasExplicitTimezone(value: string): boolean {
  const trimmed = value.trim();
  if (/[zZ]$/.test(trimmed)) return true;
  return /[+-]\d{2}(?::?\d{2})$/.test(trimmed);
}

function parseNaiveDateTimeParts(value: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
} | null {
  const match = value
    .trim()
    .match(
      /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2})(?::(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?)?$/,
    );
  if (!match) return null;

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const hour = Number.parseInt(match[4] ?? "0", 10);
  const minute = Number.parseInt(match[5] ?? "0", 10);
  const second = Number.parseInt(match[6] ?? "0", 10);
  const millisecond = Number.parseInt((match[7] ?? "0").padEnd(3, "0"), 10);

  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  if (hour < 0 || hour > 23) return null;
  if (minute < 0 || minute > 59) return null;
  if (second < 0 || second > 59) return null;
  if (millisecond < 0 || millisecond > 999) return null;

  return { year, month, day, hour, minute, second, millisecond };
}

function getTimeZoneOffsetMinutes(timeZone: string, utcMs: number): number | null {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
    hour: "2-digit",
  });
  const parts = formatter.formatToParts(new Date(utcMs));
  const tzName = parts.find((part) => part.type === "timeZoneName")?.value;
  if (!tzName) return null;
  if (tzName === "GMT" || tzName === "UTC") return 0;

  const match = tzName.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/);
  if (!match) return null;
  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number.parseInt(match[2], 10);
  const minutes = Number.parseInt(match[3] ?? "0", 10);
  return sign * (hours * 60 + minutes);
}

function parseWithTimezoneFallback(value: string, timeZone: string): Date | null {
  const parts = parseNaiveDateTimeParts(value);
  if (!parts) return null;

  const naiveUtcMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  );

  const firstOffset = getTimeZoneOffsetMinutes(timeZone, naiveUtcMs);
  if (firstOffset === null) return null;
  const firstGuessMs = naiveUtcMs - firstOffset * 60_000;

  const secondOffset = getTimeZoneOffsetMinutes(timeZone, firstGuessMs);
  if (secondOffset === null) return new Date(firstGuessMs);
  const finalMs = naiveUtcMs - secondOffset * 60_000;

  return new Date(finalMs);
}

function toIsoOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const parsed = hasExplicitTimezone(trimmed)
    ? new Date(trimmed)
    : parseWithTimezoneFallback(trimmed, getPublishedAtFallbackTimezone()) ??
      new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function normalizeType(typeValue: unknown): string[] {
  if (typeof typeValue === "string") {
    return [typeValue.toLowerCase()];
  }
  if (Array.isArray(typeValue)) {
    return typeValue
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.toLowerCase());
  }
  return [];
}

function isSupportedArticleType(typeValue: unknown): boolean {
  const types = normalizeType(typeValue);
  return types.some(
    (item) =>
      item === "article" ||
      item === "newsarticle" ||
      item.endsWith("/article") ||
      item.endsWith("/newsarticle"),
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function collectNodes(value: unknown, out: Record<string, unknown>[]) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectNodes(item, out);
    }
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  out.push(record);
  if (record["@graph"]) {
    collectNodes(record["@graph"], out);
  }
}

function getString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function getLdJsonUrl(record: Record<string, unknown>): string | null {
  const direct = getString(record.url);
  if (direct) return direct;
  const mainEntity = asRecord(record.mainEntityOfPage);
  if (!mainEntity) return null;
  return getString(mainEntity["@id"]) ?? getString(mainEntity.url);
}

export function extractArticleCandidatesFromHomepage(
  baseUrl: string,
  homepageHtml: string,
): HomepageArticleCandidate[] {
  const $ = load(homepageHtml);
  const rankedByUrl = new Map<
    string,
    { url: string; score: number; firstSeenIndex: number }
  >();
  let index = 0;

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href")?.trim();
    if (!href) return;
    const score = getArticleUrlScore(href, baseUrl);
    if (score === null || score < 2) return;
    const canonical = toCanonicalUrl(href, baseUrl);
    if (!canonical) return;

    const existing = rankedByUrl.get(canonical);
    if (!existing || score > existing.score) {
      rankedByUrl.set(canonical, {
        url: canonical,
        score,
        firstSeenIndex: index,
      });
    }
    index += 1;
  });

  return Array.from(rankedByUrl.values())
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.firstSeenIndex - b.firstSeenIndex;
    })
    .slice(0, 20)
    .map((entry) => ({ url: entry.url }));
}

export function extractArticleMetadata(
  articleUrl: string,
  html: string,
): ArticleMetadata | null {
  const $ = load(html);

  const scripts = $('script[type*="ld+json"]')
    .toArray()
    .map((node) => $(node).contents().text())
    .map((text) => text.trim())
    .filter(Boolean);

  for (const raw of scripts) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      const nodes: Record<string, unknown>[] = [];
      collectNodes(parsed, nodes);
      const match = nodes.find((node) => isSupportedArticleType(node["@type"]));
      if (!match) continue;

      const canonicalUrl =
        toCanonicalUrl(getLdJsonUrl(match) ?? articleUrl, articleUrl) ??
        toCanonicalUrl(articleUrl, articleUrl);
      const title = getString(match.headline) ?? getString(match.name);
      const description =
        getString(match.description) ??
        getString(match.abstract) ??
        getString(match.alternativeHeadline);
      const publishedAt = toIsoOrNull(
        getString(match.datePublished) ??
          getString(match.dateCreated) ??
          getString(match.dateModified),
      );
      return {
        canonicalUrl,
        title,
        description,
        publishedAt,
        source: "ldjson",
      };
    } catch {
      // Ignore malformed JSON-LD blocks; continue with next block/fallback.
    }
  }

  const publishedMeta = getMetaContent($, "article:published_time");
  if (!publishedMeta) return null;

  const canonicalUrl =
    toCanonicalUrl(getMetaContent($, "og:url") ?? articleUrl, articleUrl) ??
    toCanonicalUrl(
      $('link[rel="canonical"]').attr("href")?.trim() ?? articleUrl,
      articleUrl,
    ) ??
    toCanonicalUrl(articleUrl, articleUrl);
  const pageTitle = $("title").first().text().trim();
  const title =
    getMetaContent($, "og:title") ??
    getMetaContent($, "twitter:title") ??
    (pageTitle || null);
  const description =
    getMetaContent($, "og:description") ??
    getMetaContent($, "twitter:description") ??
    getMetaContent($, "description");

  return {
    canonicalUrl,
    title,
    description,
    publishedAt: toIsoOrNull(publishedMeta),
    source: "meta",
  };
}
