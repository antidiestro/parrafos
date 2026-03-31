"use client";

import { SourceFavicon } from "@/components/story-sidebar";
import type { BriefSectionSourceRow } from "@/lib/data/briefs";

function sourcePrimaryUrl(source: BriefSectionSourceRow): string | null {
  const raw = source.source_url ?? source.canonical_url;
  if (!raw?.trim()) return null;
  return raw.trim();
}

/** Hostname without www., for grouping sources by domain. */
function domainKeyFromUrl(urlString: string): string | null {
  try {
    const host = new URL(urlString).hostname.toLowerCase();
    if (!host) return null;
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return null;
  }
}

function sourcesForDistinctDomainFavicons(
  sources: BriefSectionSourceRow[],
  limit: number,
): BriefSectionSourceRow[] {
  const seenDomains = new Set<string>();
  const out: BriefSectionSourceRow[] = [];
  for (const source of sources) {
    const url = sourcePrimaryUrl(source);
    const domain = url ? domainKeyFromUrl(url) : null;
    const dedupeKey = domain ?? `__row:${source.id}`;
    if (seenDomains.has(dedupeKey)) continue;
    seenDomains.add(dedupeKey);
    out.push(source);
    if (out.length >= limit) break;
  }
  return out;
}

export function SourcePill({
  sources,
  onClick,
}: {
  sources: BriefSectionSourceRow[];
  onClick: () => void;
}) {
  const displaySources = sourcesForDistinctDomainFavicons(sources, 3);

  return (
    <button
      type="button"
      onClick={onClick}
      className="group inline-flex shrink-0 cursor-pointer items-center gap-2 p-0 text-xs font-sans text-zinc-700 dark:text-zinc-300"
    >
      <span className="inline-flex items-center gap-1 [&_.relative>:first-child]:opacity-75 [&_.relative>:first-child]:transition-[filter,opacity] [&_.relative>:first-child]:duration-150 group-hover:[&_.relative>:first-child]:opacity-100 group-hover:[&_.relative>:first-child]:grayscale-0">
        {displaySources.map((source) => (
          <span
            key={source.id}
            className="relative inline-block h-5 w-5 shrink-0"
          >
            <SourceFavicon
              faviconUrl={source.favicon_url}
              title={source.title ?? source.source_url ?? source.canonical_url}
              className="h-5 w-5 rounded-full object-contain"
            />
            <span
              className="pointer-events-none absolute inset-0 z-10 rounded-full ring-1 ring-inset ring-zinc-900/15 dark:ring-zinc-100/15"
              aria-hidden
            />
          </span>
        ))}
      </span>
      <span className="transition-colors group-hover:text-zinc-900 dark:group-hover:text-zinc-100">
        {sources.length} {sources.length === 1 ? "fuente" : "fuentes"}
      </span>
    </button>
  );
}
