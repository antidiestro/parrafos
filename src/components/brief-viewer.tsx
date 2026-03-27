"use client";
/* eslint-disable @next/next/no-img-element */

import { useMemo, useState } from "react";
import type { LatestBriefBundle } from "@/lib/data/briefs";
import { StoryMarkdown } from "@/components/story-markdown";

type Paragraph = LatestBriefBundle["paragraphs"][number];
type SourceRow = Paragraph["sources"][number];

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
  sources: Paragraph["sources"],
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

function SourceFavicon({
  faviconUrl,
  title,
  className,
}: {
  faviconUrl: string | null;
  title: string;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  if (!faviconUrl || broken) {
    return (
      <span
        className={`inline-flex items-center justify-center rounded-full bg-zinc-200 text-zinc-600 grayscale ${className ?? "h-5 w-5 text-xs"}`}
        aria-hidden="true"
      >
        🌐
      </span>
    );
  }
  return (
    // biome-ignore lint/performance/noImgElement: favicon chips need lightweight raw img tags.
    <img
      src={faviconUrl}
      alt=""
      title={title}
      className={`grayscale ${className ?? "h-5 w-5 rounded-full"}`}
      onError={() => setBroken(true)}
    />
  );
}

function SourcePill({
  paragraph,
  onClick,
}: {
  paragraph: Paragraph;
  onClick: () => void;
}) {
  const displaySources = sourcesForDistinctDomainFavicons(
    paragraph.sources,
    3,
  );

  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-3 inline-flex items-center gap-2 p-0 text-xs font-sans text-zinc-700"
    >
      <span className="inline-flex -space-x-1.5">
        {displaySources.map((source) => (
          <SourceFavicon
            key={source.id}
            faviconUrl={source.favicon_url}
            title={source.title ?? source.source_url ?? source.canonical_url}
            className="h-5 w-5 rounded-full border border-[var(--paper)] bg-[var(--paper)]"
          />
        ))}
      </span>
      <span>
        {paragraph.sources.length}{" "}
        {paragraph.sources.length === 1 ? "fuente" : "fuentes"}
      </span>
    </button>
  );
}

export function BriefViewer({ bundle }: { bundle: LatestBriefBundle }) {
  const [selectedParagraphId, setSelectedParagraphId] = useState<string | null>(
    null,
  );
  const selectedParagraph = useMemo(
    () =>
      bundle.paragraphs.find(
        (paragraph) => paragraph.id === selectedParagraphId,
      ) ?? null,
    [bundle.paragraphs, selectedParagraphId],
  );

  return (
    <>
      <div className="space-y-10">
        {bundle.paragraphs.length === 0 ? (
          <p className="text-zinc-600">This brief has no story blocks yet.</p>
        ) : (
          bundle.paragraphs.map((paragraph) => (
            <section key={paragraph.id}>
              <button
                type="button"
                onClick={() => setSelectedParagraphId(paragraph.id)}
                className="w-full text-left"
              >
                <StoryMarkdown markdown={paragraph.markdown} />
              </button>
              <SourcePill
                paragraph={paragraph}
                onClick={() => setSelectedParagraphId(paragraph.id)}
              />
            </section>
          ))
        )}
      </div>

      {selectedParagraph ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Story details"
        >
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <h3 className="text-lg font-semibold text-zinc-900">
                Story {selectedParagraph.position}
              </h3>
              <button
                type="button"
                onClick={() => setSelectedParagraphId(null)}
                className="rounded-md border border-zinc-300 px-2 py-1 text-sm text-zinc-700 hover:bg-zinc-50"
              >
                Close
              </button>
            </div>

            <StoryMarkdown
              markdown={
                selectedParagraph.story.detail_markdown ??
                selectedParagraph.story.markdown
              }
            />

            <div className="mt-8 border-t border-zinc-200 pt-4">
              <h4 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
                Sources
              </h4>
              <ul className="space-y-2">
                {selectedParagraph.sources.map((source) => {
                  const url = source.source_url ?? source.canonical_url;
                  return (
                    <li
                      key={source.id}
                      className="flex items-start gap-2 text-sm text-zinc-700"
                    >
                      <SourceFavicon
                        faviconUrl={source.favicon_url}
                        title={source.title ?? url}
                        className="mt-0.5 h-4 w-4 rounded-full"
                      />
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="underline"
                      >
                        {source.title?.trim() || url}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
