"use client";

import { useMemo } from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";

/** Same visual weight for h1–h6 (models emit mixed levels). */
const defaultHeadingBlock =
  "[&_h1]:mb-2 [&_h1]:mt-6 [&_h1]:text-base [&_h1]:font-semibold [&_h1:first-child]:mt-0 [&_h2]:mb-2 [&_h2]:mt-6 [&_h2]:text-base [&_h2]:font-semibold [&_h2:first-child]:mt-0 [&_h3]:mb-2 [&_h3]:mt-6 [&_h3]:text-base [&_h3]:font-semibold [&_h3:first-child]:mt-0 [&_h4]:mb-2 [&_h4]:mt-6 [&_h4]:text-base [&_h4]:font-semibold [&_h4:first-child]:mt-0 [&_h5]:mb-2 [&_h5]:mt-6 [&_h5]:text-base [&_h5]:font-semibold [&_h5:first-child]:mt-0 [&_h6]:mb-2 [&_h6]:mt-6 [&_h6]:text-base [&_h6]:font-semibold [&_h6:first-child]:mt-0";

const compactHeadingBlock =
  "[&_h1]:mb-1.5 [&_h1]:mt-4 [&_h1]:text-base [&_h1]:font-semibold [&_h1:first-child]:mt-0 [&_h2]:mb-1.5 [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-semibold [&_h2:first-child]:mt-0 [&_h3]:mb-1.5 [&_h3]:mt-4 [&_h3]:text-base [&_h3]:font-semibold [&_h3:first-child]:mt-0 [&_h4]:mb-1.5 [&_h4]:mt-4 [&_h4]:text-base [&_h4]:font-semibold [&_h4:first-child]:mt-0 [&_h5]:mb-1.5 [&_h5]:mt-4 [&_h5]:text-base [&_h5]:font-semibold [&_h5:first-child]:mt-0 [&_h6]:mb-1.5 [&_h6]:mt-4 [&_h6]:text-base [&_h6]:font-semibold [&_h6:first-child]:mt-0";

const defaultProseClass = `story-md text-lg leading-relaxed text-zinc-800 [&_a]:text-zinc-900 [&_a]:underline [&_code]:rounded [&_code]:bg-zinc-100 [&_code]:px-1 ${defaultHeadingBlock} [&_li]:mb-1 [&_p]:mb-4 [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_ul]:mb-4 [&_ul]:list-disc [&_ul]:pl-6`;

const compactProseClass = `story-md text-base leading-relaxed text-zinc-800 [&_a]:text-zinc-900 [&_a]:underline [&_code]:rounded [&_code]:bg-zinc-100 [&_code]:px-1 ${compactHeadingBlock} [&_li]:mb-0.5 [&_p]:mb-3 [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-5`;

/** Inline control styled like markdown emphasis + link (for brief bold → open sidebar). */
const strongOpenClass =
  "inline max-w-none border-0 bg-transparent p-0 align-baseline font-semibold text-zinc-900 underline decoration-zinc-400 underline-offset-2 hover:text-black focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400";

export function StoryMarkdown({
  markdown,
  variant = "default",
  onStrongClick,
}: {
  markdown: string;
  variant?: "default" | "compact";
  /** When set, each markdown **strong** opens the sidebar (or any caller action). */
  onStrongClick?: () => void;
}) {
  const proseClass =
    variant === "compact" ? compactProseClass : defaultProseClass;

  const components = useMemo<Components | undefined>(() => {
    if (!onStrongClick) return undefined;
    return {
      strong({ children }) {
        return (
          // biome-ignore lint/a11y/useValidAnchor: Inline tap target; native <button> centers wrapped label text.
          <a
            href="#"
            className={strongOpenClass}
            onClick={(e) => {
              e.preventDefault();
              onStrongClick();
            }}
          >
            {children}
          </a>
        );
      },
    };
  }, [onStrongClick]);

  return (
    <div className={proseClass}>
      <ReactMarkdown components={components} rehypePlugins={[rehypeSanitize]}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
