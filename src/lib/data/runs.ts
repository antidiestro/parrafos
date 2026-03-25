import type { Database } from "@/database.types";
import { parseRunMetadata } from "@/lib/runs/progress";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export type RunRow = Database["public"]["Tables"]["runs"]["Row"];
export type ArticleRow = Database["public"]["Tables"]["articles"]["Row"];

export type RunArticleWithPublisher = Pick<
  ArticleRow,
  | "id"
  | "run_id"
  | "publisher_id"
  | "canonical_url"
  | "title"
  | "published_at"
  | "body_text"
  | "extracted_at"
  | "metadata"
> & {
  publisher_name: string | null;
};

export type RunDetailPayload = {
  run: RunRow;
  metadata: ReturnType<typeof parseRunMetadata>;
  articles: RunArticleWithPublisher[];
};

export async function listRecentRuns(limit = 20): Promise<RunRow[]> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }
  return data ?? [];
}

export async function getRunById(runId: string): Promise<RunRow | null> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("runs")
    .select("*")
    .eq("id", runId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  return data;
}

export async function listRunArticles(
  runId: string,
): Promise<RunArticleWithPublisher[]> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("articles")
    .select(
      "id,run_id,publisher_id,canonical_url,title,published_at,body_text,extracted_at,metadata,publishers(name)",
    )
    .eq("run_id", runId)
    .order("extracted_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    run_id: row.run_id,
    publisher_id: row.publisher_id,
    canonical_url: row.canonical_url,
    title: row.title,
    published_at: row.published_at,
    body_text: row.body_text,
    extracted_at: row.extracted_at,
    metadata: row.metadata,
    publisher_name:
      row.publishers && !Array.isArray(row.publishers)
        ? row.publishers.name
        : null,
  }));
}

export async function getRunDetailPayload(
  runId: string,
): Promise<RunDetailPayload | null> {
  const run = await getRunById(runId);
  if (!run) return null;
  const articles = await listRunArticles(runId);

  return {
    run,
    metadata: parseRunMetadata(run.metadata),
    articles,
  };
}
