"use client";

import { useMemo, useState } from "react";
import { StoryMarkdown } from "@/components/story-markdown";
import { SourceFavicon, StorySidebar } from "@/components/story-sidebar";
import type { LatestBriefBundle } from "@/lib/data/briefs";

type Section = LatestBriefBundle["sections"][number];
type SourceRow = Section["sources"][number];

function sourcePrimaryUrl(source: SourceRow): string | null {
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
  sources: Section["sources"],
  limit: number,
): SourceRow[] {
  const seenDomains = new Set<string>();
  const out: SourceRow[] = [];
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

function SourcePill({
  section,
  onClick,
}: {
  section: Section;
  onClick: () => void;
}) {
  const displaySources = sourcesForDistinctDomainFavicons(section.sources, 3);

  return (
    <button
      type="button"
      onClick={onClick}
      className="group inline-flex shrink-0 cursor-pointer items-center gap-2 p-0 text-xs font-sans text-zinc-700"
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
              className="h-5 w-5 rounded-full mix-blend-multiply object-contain"
            />
            <span
              className="pointer-events-none absolute inset-0 z-10 rounded-full ring-1 ring-inset ring-zinc-900/15"
              aria-hidden
            />
          </span>
        ))}
      </span>
      <span className="transition-colors group-hover:text-black">
        {section.sources.length}{" "}
        {section.sources.length === 1 ? "fuente" : "fuentes"}
      </span>
    </button>
  );
}

export function BriefViewer({ bundle }: { bundle: LatestBriefBundle }) {
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(
    null,
  );
  const selectedSection = useMemo(
    () =>
      bundle.sections.find((section) => section.id === selectedSectionId) ??
      null,
    [bundle.sections, selectedSectionId],
  );

  return (
    <>
      <div className="space-y-20">
        {bundle.sections.length === 0 ? (
          <p className="text-zinc-600">This brief has no sections yet.</p>
        ) : (
          bundle.sections.map((section) => (
            <section key={section.id}>
              <div className="w-full text-left">
                <StoryMarkdown markdown={section.markdown} />
                <div className="mt-4 flex w-full items-center gap-4">
                  <SourcePill
                    section={section}
                    onClick={() => setSelectedSectionId(section.id)}
                  />
                </div>
              </div>
            </section>
          ))
        )}
      </div>

      {selectedSection ? (
        <StorySidebar
          key={selectedSection.id}
          longSummaryText={selectedSection.longSummaryText}
          sources={selectedSection.sources}
          onClose={() => setSelectedSectionId(null)}
        />
      ) : null}
    </>
  );
}
