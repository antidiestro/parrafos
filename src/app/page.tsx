import Link from "next/link";
import { StoryMarkdown } from "@/components/story-markdown";
import { getLatestPublishedBriefWithStories } from "@/lib/data/briefs";

export const dynamic = "force-dynamic";

function formatBriefDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "long",
  }).format(d);
}

export default async function HomePage() {
  const bundle = await getLatestPublishedBriefWithStories();

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-6 py-16 pb-24">
      <header className="mb-12 border-b border-zinc-200 pb-8">
        <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">
          Parrafos
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900">
          Latest brief
        </h1>
      </header>

      {!bundle ? (
        <p className="text-lg text-zinc-600">
          No published brief is available yet. Check back soon.
        </p>
      ) : (
        <article className="space-y-10">
          <div>
            <h2 className="text-2xl font-semibold text-zinc-900">
              {bundle.brief.title?.trim() || "Untitled brief"}
            </h2>
            {(formatBriefDate(bundle.brief.published_at) ??
              formatBriefDate(bundle.brief.created_at)) && (
              <p className="mt-2 text-sm text-zinc-500">
                {bundle.brief.published_at
                  ? `Published ${formatBriefDate(bundle.brief.published_at)}`
                  : formatBriefDate(bundle.brief.created_at)}
              </p>
            )}
          </div>

          <div className="space-y-10">
            {bundle.stories.length === 0 ? (
              <p className="text-zinc-600">
                This brief has no story blocks yet.
              </p>
            ) : (
              bundle.stories.map((story) => (
                <section
                  key={story.id}
                  className="border-l-2 border-zinc-200 pl-6"
                >
                  <StoryMarkdown markdown={story.markdown} />
                </section>
              ))
            )}
          </div>
        </article>
      )}

      <footer className="mt-16 border-t border-zinc-100 pt-8 text-center text-sm text-zinc-400">
        <Link href="/admin" className="hover:text-zinc-600">
          Admin
        </Link>
      </footer>
    </main>
  );
}
