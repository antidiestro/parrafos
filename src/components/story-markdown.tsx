"use client";

import { useMemo } from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";

/** Inline control styled like markdown emphasis + link (for brief bold → open sidebar). */
const proseClass = "story-md";
const strongOpenClass = "story-md-strong-open";

export function StoryMarkdown({
  markdown,
  onStrongClick,
}: {
  markdown: string;
  /** When set, each markdown **strong** opens the sidebar (or any caller action). */
  onStrongClick?: () => void;
}) {
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
