"use client";

import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";

export function StoryMarkdown({ markdown }: { markdown: string }) {
  return (
    <div className="story-md text-lg leading-relaxed text-zinc-800 [&_a]:text-zinc-900 [&_a]:underline [&_code]:rounded [&_code]:bg-zinc-100 [&_code]:px-1 [&_h2]:mb-2 [&_h2]:mt-6 [&_h2]:text-base [&_h2]:font-semibold [&_h2:first-child]:mt-0 [&_li]:mb-1 [&_p]:mb-4 [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_ul]:mb-4 [&_ul]:list-disc [&_ul]:pl-6">
      <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{markdown}</ReactMarkdown>
    </div>
  );
}
