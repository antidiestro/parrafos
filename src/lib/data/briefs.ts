import type { Database } from "@/database.types";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

type BriefRow = Database["public"]["Tables"]["briefs"]["Row"];
type StoryRow = Database["public"]["Tables"]["stories"]["Row"];
type BriefSectionRow = Database["public"]["Tables"]["brief_sections"]["Row"];
type ArticleRow = Database["public"]["Tables"]["articles"]["Row"];

export type BriefSectionSourceRow = Pick<
  ArticleRow,
  | "id"
  | "title"
  | "canonical_url"
  | "source_url"
  | "publisher_id"
  | "published_at"
  | "extracted_at"
> & {
  favicon_url: string | null;
  publisher_name: string;
};

export type LatestBriefBundle = {
  brief: BriefRow;
  sections: Array<
    BriefSectionRow & {
      story: StoryRow;
      sources: BriefSectionSourceRow[];
      /** Long-form `summary` from structured story JSON (`stories.markdown`), for sidebar. */
      longSummaryText: string | null;
    }
  >;
};

function sourceRecencyTimeMs(source: BriefSectionSourceRow): number | null {
  const iso = source.published_at ?? source.extracted_at;
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function medianSortedNumbers(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return Number.NaN;
  const mid = Math.floor(n / 2);
  if (n % 2 === 1) return sorted[mid] as number;
  return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

function sectionMedianSourceRecencyTimeMs(section: {
  sources: BriefSectionSourceRow[];
}): number {
  if (section.sources.length === 0) return Number.NEGATIVE_INFINITY;
  const times: number[] = [];
  for (const s of section.sources) {
    const ms = sourceRecencyTimeMs(s);
    if (ms !== null) times.push(ms);
  }
  if (times.length === 0) return Number.NEGATIVE_INFINITY;
  times.sort((x, y) => x - y);
  return medianSortedNumbers(times);
}

/**
 * Homepage ordering: “most fresh” clusters first using the **median** per-source
 * recency (`published_at` when set, else `extracted_at`). Tie-break: stored `brief_sections.position`.
 */
export function sortBriefSectionsByMedianSourceRecency(
  sections: LatestBriefBundle["sections"],
): LatestBriefBundle["sections"] {
  return [...sections].sort((a, b) => {
    const tb = sectionMedianSourceRecencyTimeMs(b);
    const ta = sectionMedianSourceRecencyTimeMs(a);
    if (tb !== ta) return tb - ta;
    return a.position - b.position;
  });
}

/** Defensive extract of pipeline `summary` field; null if JSON missing or invalid. */
function longSummaryTextFromStoryMarkdown(storyMarkdown: string): string | null {
  try {
    const parsed: unknown = JSON.parse(storyMarkdown);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("summary" in parsed)
    ) {
      return null;
    }
    const summary = (parsed as { summary: unknown }).summary;
    if (typeof summary !== "string") return null;
    const trimmed = summary.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

export async function getLatestPublishedBriefWithStories(): Promise<LatestBriefBundle | null> {
  const supabase = createSupabaseServiceClient();

  const { data: brief, error: briefError } = await supabase
    .from("briefs")
    .select("*")
    .eq("status", "published")
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (briefError) {
    throw new Error(briefError.message);
  }
  if (!brief) {
    return null;
  }

  const { data: sectionRowsRaw, error: sectionsError } = await supabase
    .from("brief_sections")
    .select("id,brief_id,story_id,position,markdown,created_at,updated_at")
    .eq("brief_id", brief.id)
    .order("position", { ascending: true });

  if (sectionsError) {
    throw new Error(sectionsError.message);
  }

  const sectionRows = sectionRowsRaw ?? [];
  if (sectionRows.length === 0) {
    return { brief, sections: [] };
  }

  const storyIds = sectionRows.map((row) => row.story_id);
  const { data: stories, error: storiesError } = await supabase
    .from("stories")
    .select(
      "id,brief_id,position,markdown,detail_markdown,created_at,updated_at",
    )
    .in("id", storyIds);
  if (storiesError) {
    throw new Error(storiesError.message);
  }

  const { data: storyArticles, error: storyArticlesError } = await supabase
    .from("story_articles")
    .select("story_id,article_id")
    .in("story_id", storyIds)
    .order("article_id", { ascending: true });
  if (storyArticlesError) {
    throw new Error(storyArticlesError.message);
  }

  const articleIds = Array.from(
    new Set((storyArticles ?? []).map((row) => row.article_id)),
  );
  const articleById = new Map<
    string,
    Pick<
      ArticleRow,
      | "id"
      | "title"
      | "canonical_url"
      | "source_url"
      | "publisher_id"
      | "published_at"
      | "extracted_at"
    >
  >();
  if (articleIds.length > 0) {
    const { data: articles, error: articlesError } = await supabase
      .from("articles")
      .select(
        "id,title,canonical_url,source_url,publisher_id,published_at,extracted_at",
      )
      .in("id", articleIds);
    if (articlesError) {
      throw new Error(articlesError.message);
    }
    for (const article of articles ?? []) {
      articleById.set(article.id, {
        id: article.id,
        title: article.title,
        canonical_url: article.canonical_url,
        source_url: article.source_url,
        publisher_id: article.publisher_id,
        published_at: article.published_at,
        extracted_at: article.extracted_at,
      });
    }
  }

  const publisherIds = Array.from(
    new Set(
      [...articleById.values()]
        .map((a) => a.publisher_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const publisherNameById = new Map<string, string>();
  if (publisherIds.length > 0) {
    const { data: publishers, error: publishersError } = await supabase
      .from("publishers")
      .select("id,name")
      .in("id", publisherIds);
    if (publishersError) {
      throw new Error(publishersError.message);
    }
    for (const row of publishers ?? []) {
      publisherNameById.set(row.id, row.name);
    }
  }

  const storyById = new Map<string, StoryRow>();
  for (const story of stories ?? []) {
    storyById.set(story.id, story as StoryRow);
  }

  const articleIdsByStoryId = new Map<string, string[]>();
  for (const row of storyArticles ?? []) {
    const existing = articleIdsByStoryId.get(row.story_id) ?? [];
    existing.push(row.article_id);
    articleIdsByStoryId.set(row.story_id, existing);
  }

  const hydratedSections = sectionRows
    .map((section) => {
      const story = storyById.get(section.story_id);
      if (!story) return null;
      const sourceRows =
        articleIdsByStoryId
          .get(section.story_id)
          ?.map((articleId) => articleById.get(articleId))
          .filter((article): article is NonNullable<typeof article> =>
            Boolean(article),
          )
          .map((article) => {
            const url = article.source_url ?? article.canonical_url;
            let faviconUrl: string | null = null;
            let hostnameFallback = "";
            try {
              const hostname = new URL(url).hostname;
              hostnameFallback = hostname.startsWith("www.")
                ? hostname.slice(4)
                : hostname;
              faviconUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=64`;
            } catch {
              faviconUrl = null;
            }
            const publisherName =
              publisherNameById.get(article.publisher_id) ?? hostnameFallback;
            return {
              ...article,
              favicon_url: faviconUrl,
              publisher_name: publisherName,
            };
          }) ?? [];
      return {
        ...section,
        story,
        sources: sourceRows,
        longSummaryText: longSummaryTextFromStoryMarkdown(story.markdown),
      };
    })
    .filter(
      (
        section,
      ): section is BriefSectionRow & {
        story: StoryRow;
        sources: BriefSectionSourceRow[];
        longSummaryText: string | null;
      } => Boolean(section),
    );

  return { brief, sections: hydratedSections };
}

/** Same “latest published brief” ordering as `getLatestPublishedBriefWithStories`. */
export async function touchLatestPublishedBriefPublishedAt(): Promise<{
  briefId: string;
} | null> {
  const supabase = createSupabaseServiceClient();
  const { data: brief, error: briefError } = await supabase
    .from("briefs")
    .select("id")
    .eq("status", "published")
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (briefError) {
    throw new Error(briefError.message);
  }
  if (!brief) {
    return null;
  }

  const publishedAt = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("briefs")
    .update({ published_at: publishedAt })
    .eq("id", brief.id);
  if (updateError) {
    throw new Error(updateError.message);
  }
  return { briefId: brief.id };
}
