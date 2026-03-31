"use client";

import { useMemo, useState } from "react";
import { SourcePill } from "@/components/source-pill";
import { StoryMarkdown } from "@/components/story-markdown";
import { StorySidebar } from "@/components/story-sidebar";
import type { LatestBriefBundle } from "@/lib/data/briefs";

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
                <StoryMarkdown
                  markdown={section.markdown}
                  onStrongClick={() => setSelectedSectionId(section.id)}
                />
                <div className="mt-4 flex w-full items-center gap-4">
                  <SourcePill
                    sources={section.sources}
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
