"use client";
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useRef, useState } from "react";
import type { BriefSectionSourceRow } from "@/lib/data/briefs";

const UTM_SOURCE = "parrafos.com";
const TRANSITION_MS = 300;

/** Append utm_source for outbound attribution; invalid URLs returned unchanged. */
function hrefWithUtmSource(href: string): string {
  try {
    const u = new URL(href);
    u.searchParams.set("utm_source", UTM_SOURCE);
    return u.toString();
  } catch {
    return href;
  }
}

export function SourceFavicon({
  faviconUrl,
  title,
  className,
  grayscale = true,
}: {
  faviconUrl: string | null;
  title: string;
  className?: string;
  /** When false, icon keeps color (e.g. for mix-blend on the paper background). */
  grayscale?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  const grayCls = grayscale ? "grayscale " : "";
  if (!faviconUrl || broken) {
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded-full bg-zinc-200 text-zinc-600 ${grayCls} ${className ?? "h-5 w-5 text-xs"}`}
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
      className={`shrink-0 ${grayCls} ${className ?? "h-5 w-5 rounded-full"}`}
      onError={() => setBroken(true)}
    />
  );
}

export type StorySidebarProps = {
  sources: BriefSectionSourceRow[];
  onClose: () => void;
};

export function StorySidebar({ sources, onClose }: StorySidebarProps) {
  const [uiOpen, setUiOpen] = useState(false);
  const exitPendingRef = useRef(false);
  const finishedRef = useRef(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const finishClose = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    onClose();
  }, [onClose]);

  const requestClose = useCallback(() => {
    if (exitPendingRef.current) return;
    exitPendingRef.current = true;
    setUiOpen(false);
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      finishClose();
    }, TRANSITION_MS + 80);
  }, [finishClose]);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => setUiOpen(true));
    });
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestClose]);

  const handleAsideTransitionEnd = (e: React.TransitionEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.propertyName !== "transform") return;
    if (uiOpen) return;
    finishClose();
  };

  return (
    <div className="fixed inset-0 z-50" role="presentation">
      <button
        type="button"
        className={`absolute inset-0 bg-black/40 transition-opacity duration-300 ease-out ${
          uiOpen ? "opacity-100" : "opacity-0"
        }`}
        aria-label="Cerrar fuentes"
        onClick={requestClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Fuentes"
        onTransitionEnd={handleAsideTransitionEnd}
        className={`absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l border-zinc-200 bg-[var(--paper)] shadow-2xl transition-transform duration-300 ease-out ${
          uiOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="flex shrink-0 items-center justify-end border-b border-zinc-200 px-5 py-4">
          <button
            type="button"
            onClick={requestClose}
            className="rounded-md border border-zinc-300 bg-white px-2.5 py-1 font-sans text-sm text-zinc-700 hover:bg-zinc-50"
          >
            Cerrar
          </button>
        </header>

        <ul className="min-h-0 flex-1 overflow-y-auto px-3 py-4 font-sans">
          {sources.map((source) => {
            const rawUrl = source.source_url ?? source.canonical_url;
            const href = hrefWithUtmSource(rawUrl);
            const titleText =
              source.title?.trim() || rawUrl || "Sin título";
            return (
              <li
                key={source.id}
                className="border-b border-zinc-200/80 py-3 last:border-b-0"
              >
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex gap-3 rounded-lg p-2 outline-none transition-colors hover:bg-zinc-100/80 focus-visible:ring-2 focus-visible:ring-zinc-400"
                >
                  <SourceFavicon
                    faviconUrl={source.favicon_url}
                    title={titleText}
                    className="mt-0.5 h-9 w-9 rounded-lg border border-zinc-200 bg-white object-contain p-0.5"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium leading-snug text-zinc-900 group-hover:underline">
                      {titleText}
                    </p>
                    {source.publisher_name ? (
                      <p className="mt-0.5 text-xs text-zinc-500">
                        {source.publisher_name}
                      </p>
                    ) : null}
                  </div>
                </a>
              </li>
            );
          })}
        </ul>
      </aside>
    </div>
  );
}
