import { z } from "zod";
import { generateGeminiJson } from "@/lib/gemini/generate";
import { RUN_BRIEF_MODEL } from "@/lib/runs/constants";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

type SelectedCluster = {
  id: string;
  source_count: number;
  title: string;
  selection_reason: string | null;
  created_at: string;
};

type ClusterSource = {
  cluster_id: string;
  publisher_id: string;
  canonical_url: string;
  url: string;
  title: string | null;
  published_at: string | null;
  publishers: { name: string } | null;
};

type StorySummarySchemaRow = {
  cluster_id: string;
  title: string;
  detail_markdown: string;
};

type BriefParagraphSchemaRow = {
  cluster_id: string;
  markdown: string;
};

type ArticleBodyByKey = Map<
  string,
  {
    id: string;
    bodyText: string;
    title: string | null;
    publishedAt: string | null;
  }
>;

const storyDetailSchema = z.object({
  detail_markdown: z.string().trim().min(120),
});

const storyDetailResponseJsonSchema = {
  type: "object",
  properties: {
    detail_markdown: { type: "string", minLength: 120 },
  },
  required: ["detail_markdown"],
};

const briefParagraphSchema = z.object({
  markdown: z.string().trim().min(10),
});

const finalBriefParagraphsSchema = z.object({
  paragraphs: z.array(briefParagraphSchema).min(1),
});

const finalBriefParagraphsResponseJsonSchema = {
  type: "object",
  properties: {
    paragraphs: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          markdown: { type: "string", minLength: 10 },
        },
        required: ["markdown"],
      },
    },
  },
  required: ["paragraphs"],
};

function replaceNewlinesWithSpaces(value: string) {
  return value
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toHoursAgo(iso: string | null, nowMs: number): number | null {
  if (!iso) return null;
  const ts = +new Date(iso);
  if (!Number.isFinite(ts)) return null;
  const delta = nowMs - ts;
  if (delta < 0) return 0;
  return Math.round((delta / (1000 * 60 * 60)) * 10) / 10;
}

export async function loadSelectedClustersAndSources(runId: string): Promise<{
  sortedClusters: SelectedCluster[];
  sources: ClusterSource[];
}> {
  const supabase = createSupabaseServiceClient();
  const { data: clusterRows, error: clustersError } = await supabase
    .from("run_story_clusters")
    .select("id,source_count,title,selection_reason,created_at")
    .eq("run_id", runId)
    .eq("status", "selected");
  if (clustersError) throw new Error(clustersError.message);

  const selectedClusters = (clusterRows ?? []) as SelectedCluster[];
  if (selectedClusters.length === 0) {
    throw new Error("No selected story clusters available for publish stages.");
  }

  const clusterIds = selectedClusters.map((cluster) => cluster.id);
  const { data: sourceRows, error: sourcesError } = await supabase
    .from("run_story_cluster_sources")
    .select(
      "cluster_id,publisher_id,canonical_url,url,title,published_at,publishers(name)",
    )
    .in("cluster_id", clusterIds);
  if (sourcesError) throw new Error(sourcesError.message);
  const sources = (sourceRows ?? []) as ClusterSource[];

  const maxPublishedAtByCluster = new Map<string, string | null>();
  for (const cluster of selectedClusters) {
    const clusterPublishedAt = sources
      .filter((source) => source.cluster_id === cluster.id)
      .map((source) => source.published_at)
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => +new Date(b) - +new Date(a))[0];
    maxPublishedAtByCluster.set(cluster.id, clusterPublishedAt ?? null);
  }

  const sortedClusters = selectedClusters.slice().sort((a, b) => {
    if (b.source_count !== a.source_count)
      return b.source_count - a.source_count;
    const aMax = maxPublishedAtByCluster.get(a.id) ?? null;
    const bMax = maxPublishedAtByCluster.get(b.id) ?? null;
    if (aMax && bMax) return +new Date(bMax) - +new Date(aMax);
    if (aMax && !bMax) return -1;
    if (!aMax && bMax) return 1;
    return +new Date(a.created_at) - +new Date(b.created_at);
  });

  return { sortedClusters, sources };
}

async function loadArticleBodiesBySource(
  sources: ClusterSource[],
): Promise<ArticleBodyByKey> {
  const supabase = createSupabaseServiceClient();
  const urlsByPublisher = new Map<string, Set<string>>();
  for (const source of sources) {
    const set = urlsByPublisher.get(source.publisher_id) ?? new Set<string>();
    set.add(source.canonical_url);
    urlsByPublisher.set(source.publisher_id, set);
  }

  const articleByKey: ArticleBodyByKey = new Map();
  for (const [publisherId, canonicalUrlsSet] of urlsByPublisher.entries()) {
    const canonicalUrls = Array.from(canonicalUrlsSet);
    const { data: articleRows, error: articleError } = await supabase
      .from("articles")
      .select("id,publisher_id,canonical_url,title,published_at,body_text")
      .eq("publisher_id", publisherId)
      .in("canonical_url", canonicalUrls);
    if (articleError) throw new Error(articleError.message);
    for (const row of articleRows ?? []) {
      if (!row.body_text?.trim()) continue;
      articleByKey.set(`${row.publisher_id}::${row.canonical_url}`, {
        id: row.id,
        bodyText: row.body_text,
        title: row.title,
        publishedAt: row.published_at,
      });
    }
  }
  return articleByKey;
}

export async function generateStorySummariesForRun(
  runId: string,
): Promise<StorySummarySchemaRow[]> {
  const { sortedClusters, sources } =
    await loadSelectedClustersAndSources(runId);
  const articleByKey = await loadArticleBodiesBySource(sources);
  const nowMs = Date.now();
  const summaries: StorySummarySchemaRow[] = [];

  for (const cluster of sortedClusters) {
    const clusterSources = sources
      .filter((source) => source.cluster_id === cluster.id)
      .slice()
      .sort((a, b) => {
        if (a.published_at && b.published_at) {
          return +new Date(b.published_at) - +new Date(a.published_at);
        }
        if (a.published_at && !b.published_at) return -1;
        if (!a.published_at && b.published_at) return 1;
        return a.url.localeCompare(b.url);
      });
    const latestClusterSourceTime = clusterSources.find(
      (source) => source.published_at,
    )?.published_at;
    const latestHoursAgo = toHoursAgo(latestClusterSourceTime ?? null, nowMs);

    const sourceTexts: string[] = [];
    for (const source of clusterSources) {
      const key = `${source.publisher_id}::${source.canonical_url}`;
      const article = articleByKey.get(key);
      if (!article) continue;
      sourceTexts.push(
        [
          `Source URL: ${source.url}`,
          `Source: ${source.publishers?.name ?? source.publisher_id}`,
          source.title
            ? `Title hint: ${source.title}`
            : article.title
              ? `Title hint: ${article.title}`
              : null,
          source.published_at
            ? `Published at: ${new Date(source.published_at).toISOString()}`
            : article.publishedAt
              ? `Published at: ${new Date(article.publishedAt).toISOString()}`
              : null,
          "Full text:",
          article.bodyText,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }
    if (sourceTexts.length === 0) {
      throw new Error(
        `No extracted article text available for cluster ${cluster.id}`,
      );
    }

    const prompt = [
      "Escribe un resumen en profundidad en Markdown con estructura periodistica clara.",
      "Instrucciones:",
      "1) Escribe TODO en espanol.",
      "2) Usa exactamente estas secciones y en este orden: ## Punto clave, ## Contexto, ## Detalles, ## Implicaciones.",
      "3) En cada seccion, escribe 1 parrafo conciso.",
      "4) No incluyas citas en linea ni lista de fuentes.",
      "5) No inventes afirmaciones; usa solo las fuentes provistas.",
      "6) Manten un tono esceptico y equilibrado: reconoce que las fuentes pueden tener sesgos y que las versiones oficiales pueden responder a agendas.",
      "7) Ese escepticismo debe ser prudente y basado en evidencia, nunca conspirativo.",
      `Titulo/tema de la historia: ${cluster.title}`,
      cluster.selection_reason
        ? `Motivo de seleccion de la historia: ${cluster.selection_reason}`
        : null,
      latestClusterSourceTime
        ? `Marca temporal de la fuente mas reciente: ${new Date(latestClusterSourceTime).toISOString()}`
        : null,
      latestHoursAgo !== null
        ? `La fuente mas reciente tiene aproximadamente ${latestHoursAgo} horas.`
        : null,
      "Fuentes relevantes (textos completos), cada una delimitada por ---:",
      sourceTexts.map((text) => `---\n${text}\n---`).join("\n"),
      "Escribe ahora el resumen detallado.",
    ]
      .filter(Boolean)
      .join("\n");

    const generated = await generateGeminiJson(prompt, storyDetailSchema, {
      model: RUN_BRIEF_MODEL,
      nativeStructuredOutput: {
        responseJsonSchema: storyDetailResponseJsonSchema,
      },
    });

    summaries.push({
      cluster_id: cluster.id,
      title: cluster.title,
      detail_markdown: generated.detail_markdown.trim(),
    });
  }

  return summaries;
}

export async function composeBriefParagraphsFromSummaries(
  storySummaries: StorySummarySchemaRow[],
): Promise<BriefParagraphSchemaRow[]> {
  if (storySummaries.length === 0) {
    throw new Error("Cannot compose brief paragraphs without story summaries.");
  }
  const summaryBlocks = storySummaries
    .map((summary, idx) =>
      [
        `Story ${idx + 1}`,
        `Story cluster ID: ${summary.cluster_id}`,
        `Story title: ${summary.title}`,
        "Detailed summary:",
        summary.detail_markdown,
      ].join("\n"),
    )
    .join("\n\n---\n\n");

  const prompt = [
    "Estas componiendo un brief final de varias noticias a partir de resumenes detallados.",
    "Escribe TODO en espanol.",
    "La salida debe incluir exactamente un parrafo markdown por historia, en el mismo orden.",
    "Cada parrafo debe tener longitud media (5-6 oraciones).",
    "Sin encabezados, sin listas, sin citas en linea.",
    "Usa una reescritura equilibrada: mejora coherencia y reduce repeticion preservando los hechos de cada historia.",
    "Manten un tono esceptico y equilibrado: reconoce posibles sesgos en fuentes y posibles agendas en versiones oficiales.",
    "Ese tono debe ser prudente y basado en evidencia, no conspirativo.",
    "No mezcles historias ni traslades hechos entre historias.",
    `Numero de historias: ${storySummaries.length}`,
    "Resumenes de historias (ordenados):",
    summaryBlocks,
    'Return JSON with {"paragraphs":[{"markdown":"..."}, ...]}',
  ].join("\n");

  const generated = await generateGeminiJson(
    prompt,
    finalBriefParagraphsSchema,
    {
      model: RUN_BRIEF_MODEL,
      nativeStructuredOutput: {
        responseJsonSchema: finalBriefParagraphsResponseJsonSchema,
      },
    },
  );

  if (generated.paragraphs.length !== storySummaries.length) {
    throw new Error(
      `Final brief paragraph count mismatch: expected ${storySummaries.length}, got ${generated.paragraphs.length}`,
    );
  }

  return generated.paragraphs.map((paragraph, idx) => ({
    cluster_id: storySummaries[idx].cluster_id,
    markdown: replaceNewlinesWithSpaces(paragraph.markdown),
  }));
}

export async function persistBriefOutputForRun(input: {
  runId: string;
  storySummaries: StorySummarySchemaRow[];
  briefParagraphs: BriefParagraphSchemaRow[];
}) {
  const { runId, storySummaries, briefParagraphs } = input;
  if (storySummaries.length === 0) {
    throw new Error("Cannot persist brief output with no story summaries.");
  }
  if (briefParagraphs.length !== storySummaries.length) {
    throw new Error("Brief paragraph count must match story summary count.");
  }

  const { sortedClusters, sources } =
    await loadSelectedClustersAndSources(runId);
  const clusterOrder = sortedClusters.map((cluster) => cluster.id);
  const summaryClusterOrder = storySummaries.map(
    (summary) => summary.cluster_id,
  );
  if (clusterOrder.join(",") !== summaryClusterOrder.join(",")) {
    throw new Error(
      "Stored publish checkpoint does not match current selected cluster order.",
    );
  }

  const supabase = createSupabaseServiceClient();
  const { data: briefRow, error: briefInsertError } = await supabase
    .from("briefs")
    .insert({
      title: "Parrafos brief",
      status: "published",
      published_at: new Date().toISOString(),
    })
    .select("id")
    .maybeSingle();
  if (briefInsertError) throw new Error(briefInsertError.message);
  if (!briefRow?.id) throw new Error("Unable to create brief record");

  const storyInsertRows = storySummaries.map((summary, idx) => ({
    brief_id: briefRow.id,
    position: idx + 1,
    markdown: summary.detail_markdown,
    detail_markdown: summary.detail_markdown,
  }));
  const { data: insertedStories, error: storiesInsertError } = await supabase
    .from("stories")
    .insert(storyInsertRows)
    .select("id,position");
  if (storiesInsertError) throw new Error(storiesInsertError.message);
  if (!insertedStories || insertedStories.length !== storySummaries.length) {
    throw new Error("Unable to insert stories for brief publication");
  }

  const storyIdByPosition = new Map<number, string>();
  for (const row of insertedStories) {
    storyIdByPosition.set(row.position, row.id);
  }

  const { error: paragraphsInsertError } = await supabase
    .from("brief_paragraphs")
    .insert(
      briefParagraphs.map((paragraph, idx) => ({
        brief_id: briefRow.id,
        story_id: storyIdByPosition.get(idx + 1) as string,
        position: idx + 1,
        markdown: paragraph.markdown,
      })),
    );
  if (paragraphsInsertError) throw new Error(paragraphsInsertError.message);

  const articleIdsBySource = new Map<string, string>();
  for (const source of sources) {
    const { data: articleRow, error: articleError } = await supabase
      .from("articles")
      .select("id")
      .eq("publisher_id", source.publisher_id)
      .eq("canonical_url", source.canonical_url)
      .limit(1)
      .maybeSingle();
    if (articleError) throw new Error(articleError.message);
    if (articleRow?.id) {
      articleIdsBySource.set(
        `${source.publisher_id}::${source.canonical_url}`,
        articleRow.id,
      );
    }
  }

  const storyArticleInsertRows: Array<{
    story_id: string;
    article_id: string;
  }> = [];
  for (const [idx, cluster] of sortedClusters.entries()) {
    const storyId = storyIdByPosition.get(idx + 1);
    if (!storyId) continue;
    const seen = new Set<string>();
    const clusterSources = sources.filter(
      (source) => source.cluster_id === cluster.id,
    );
    for (const source of clusterSources) {
      const articleId = articleIdsBySource.get(
        `${source.publisher_id}::${source.canonical_url}`,
      );
      if (!articleId || seen.has(articleId)) continue;
      seen.add(articleId);
      storyArticleInsertRows.push({ story_id: storyId, article_id: articleId });
    }
  }
  if (storyArticleInsertRows.length > 0) {
    const { error: storyArticlesError } = await supabase
      .from("story_articles")
      .insert(storyArticleInsertRows);
    if (storyArticlesError) throw new Error(storyArticlesError.message);
  }

  return { briefId: briefRow.id, storyCount: storySummaries.length };
}

export type PublishStorySummaryCheckpoint = StorySummarySchemaRow[];
export type PublishBriefParagraphCheckpoint = BriefParagraphSchemaRow[];
