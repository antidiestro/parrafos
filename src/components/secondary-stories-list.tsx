"use client";

import { useMemo } from "react";
import { SourceFavicon } from "@/components/story-sidebar";
import type {
  BriefSectionSourceRow,
  LatestBriefBundle,
} from "@/lib/data/briefs";

type SecondaryStory = LatestBriefBundle["secondaryStories"][number];
const UTM_SOURCE = "parrafos.com";

function sourceHref(source: BriefSectionSourceRow): string | null {
  const raw = source.source_url ?? source.canonical_url;
  if (!raw?.trim()) return null;
  return raw.trim();
}

function hostnameFromHref(href: string): string | null {
  try {
    const host = new URL(href).hostname.toLowerCase();
    if (!host) return null;
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return null;
  }
}

function publisherKeyForRotation(source: BriefSectionSourceRow): string | null {
  const publisherName = source.publisher_name?.trim().toLowerCase();
  if (publisherName) return `publisher:${publisherName}`;
  const href = sourceHref(source);
  if (!href) return null;
  const host = hostnameFromHref(href);
  return host ? `host:${host}` : null;
}

function sourceLabel(source: BriefSectionSourceRow): string {
  const publisherDomain = hostnameFromHref(source.canonical_url);
  if (publisherDomain) return publisherDomain;
  const href = sourceHref(source);
  if (!href) return "Fuente";
  return hostnameFromHref(href) ?? "Fuente";
}

function hrefWithUtmSource(href: string): string {
  try {
    const u = new URL(href);
    u.searchParams.set("utm_source", UTM_SOURCE);
    return u.toString();
  } catch {
    return href;
  }
}

export function SecondaryStoriesList({
  stories,
}: {
  stories: SecondaryStory[];
}) {
  const selectedSourcesByStoryId = useMemo(() => {
    const usedPublishers = new Set<string>();
    const out = new Map<string, BriefSectionSourceRow | null>();

    for (const story of stories) {
      const linkableSources = story.sources.filter((source) =>
        sourceHref(source),
      );
      if (linkableSources.length === 0) {
        out.set(story.id, null);
        continue;
      }

      const preferred =
        linkableSources.find((source) => {
          const key = publisherKeyForRotation(source);
          return key ? !usedPublishers.has(key) : false;
        }) ?? linkableSources[0];

      const key = publisherKeyForRotation(preferred);
      if (key) usedPublishers.add(key);
      out.set(story.id, preferred);
    }

    return out;
  }, [stories]);

  return (
    <ul className="list-disc space-y-3 pl-5 text-lg text-(--text) marker:text-(--muted)">
      {stories.map((story) => {
        const selectedSource = selectedSourcesByStoryId.get(story.id) ?? null;
        const href = selectedSource ? sourceHref(selectedSource) : null;
        const hrefWithUtm = href ? hrefWithUtmSource(href) : null;
        return (
          <li key={story.id} className="leading-relaxed">
            <span>{story.title}</span>{" "}
            {selectedSource && hrefWithUtm ? (
              <a
                href={hrefWithUtm}
                target="_blank"
                rel="noopener noreferrer"
                className="group ml-0.5 inline-flex shrink-0 -translate-y-1 cursor-pointer items-center p-0 align-middle"
                aria-label={`Abrir fuente: ${sourceLabel(selectedSource)}`}
                title={sourceLabel(selectedSource)}
              >
                <span className="inline-flex items-center gap-1 [&_.relative>:first-child]:opacity-75 [&_.relative>:first-child]:transition-[filter,opacity] [&_.relative>:first-child]:duration-150 group-hover:[&_.relative>:first-child]:opacity-100 group-hover:[&_.relative>:first-child]:grayscale-0">
                  <span className="relative inline-block h-5 w-5 shrink-0">
                    <SourceFavicon
                      faviconUrl={selectedSource.favicon_url}
                      title={
                        selectedSource.title ??
                        selectedSource.source_url ??
                        selectedSource.canonical_url
                      }
                      className="h-5 w-5 rounded-full object-contain"
                    />
                    <span
                      className="pointer-events-none absolute inset-0 z-10 rounded-full ring-1 ring-inset ring-zinc-900/15 dark:ring-zinc-100/15"
                      aria-hidden
                    />
                  </span>
                </span>
              </a>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
