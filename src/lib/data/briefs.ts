import type { Database } from "@/database.types";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

type BriefRow = Database["public"]["Tables"]["briefs"]["Row"];
type StoryRow = Database["public"]["Tables"]["stories"]["Row"];
type BriefParagraphRow = Database["public"]["Tables"]["brief_paragraphs"]["Row"];
type ArticleRow = Database["public"]["Tables"]["articles"]["Row"];

export type LatestBriefBundle = {
  brief: BriefRow;
  paragraphs: Array<
    BriefParagraphRow & {
      story: StoryRow;
      sources: Array<
        Pick<ArticleRow, "id" | "title" | "canonical_url" | "source_url"> & {
          favicon_url: string | null;
        }
      >;
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

  const { data: paragraphs, error: paragraphsError } = await supabase
    .from("brief_paragraphs")
    .select("id,brief_id,story_id,position,markdown,created_at,updated_at")
    .eq("brief_id", brief.id)
    .order("position", { ascending: true });

  if (paragraphsError) {
    throw new Error(paragraphsError.message);
  }

  const paragraphRows = paragraphs ?? [];
  if (paragraphRows.length === 0) {
    return { brief, paragraphs: [] };
  }

  const storyIds = paragraphRows.map((row) => row.story_id);
  const { data: stories, error: storiesError } = await supabase
    .from("stories")
    .select("id,brief_id,position,markdown,detail_markdown,created_at,updated_at")
    .in("id", storyIds);
  if (storiesError) {
    throw new Error(storiesError.message);
  }

  const { data: storyArticles, error: storyArticlesError } = await supabase
    .from("story_articles")
    .select("story_id,article_id")
    .in("story_id", storyIds);
  if (storyArticlesError) {
    throw new Error(storyArticlesError.message);
  }

  const articleIds = Array.from(
    new Set((storyArticles ?? []).map((row) => row.article_id)),
  );
  const articleById = new Map<
    string,
    Pick<ArticleRow, "id" | "title" | "canonical_url" | "source_url">
  >();
  if (articleIds.length > 0) {
    const { data: articles, error: articlesError } = await supabase
      .from("articles")
      .select("id,title,canonical_url,source_url")
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
      });
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

  const hydratedParagraphs = paragraphRows
    .map((paragraph) => {
      const story = storyById.get(paragraph.story_id);
      if (!story) return null;
      const sourceRows =
        articleIdsByStoryId
          .get(paragraph.story_id)
          ?.map((articleId) => articleById.get(articleId))
          .filter((article): article is NonNullable<typeof article> => Boolean(article))
          .map((article) => {
            const url = article.source_url ?? article.canonical_url;
            let faviconUrl: string | null = null;
            try {
              const hostname = new URL(url).hostname;
              faviconUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=64`;
            } catch {
              faviconUrl = null;
            }
            return {
              ...article,
              favicon_url: faviconUrl,
            };
          }) ?? [];
      return {
        ...paragraph,
        story,
        sources: sourceRows,
      };
    })
    .filter(
      (
        paragraph,
      ): paragraph is BriefParagraphRow & {
        story: StoryRow;
        sources: Array<
          Pick<ArticleRow, "id" | "title" | "canonical_url" | "source_url"> & {
            favicon_url: string | null;
          }
        >;
      } => Boolean(paragraph),
    );

  return { brief, paragraphs: hydratedParagraphs };
}
