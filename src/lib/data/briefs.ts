import type { Database } from "@/database.types";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

type BriefRow = Database["public"]["Tables"]["briefs"]["Row"];
type StoryRow = Database["public"]["Tables"]["stories"]["Row"];
type BriefSectionRow =
  Database["public"]["Tables"]["brief_sections"]["Row"];
type ArticleRow = Database["public"]["Tables"]["articles"]["Row"];

export type BriefSectionSourceRow = Pick<
  ArticleRow,
  "id" | "title" | "canonical_url" | "source_url" | "publisher_id"
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
    }
  >;
};

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
      "id" | "title" | "canonical_url" | "source_url" | "publisher_id"
    >
  >();
  if (articleIds.length > 0) {
    const { data: articles, error: articlesError } = await supabase
      .from("articles")
      .select("id,title,canonical_url,source_url,publisher_id")
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
      };
    })
    .filter(
      (
        section,
      ): section is BriefSectionRow & {
        story: StoryRow;
        sources: BriefSectionSourceRow[];
      } => Boolean(section),
    );

  return { brief, sections: hydratedSections };
}
