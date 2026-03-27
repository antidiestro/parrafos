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

const OBJECTIVE_JOURNALISTIC_TONE_INSTRUCTION =
  "Adopt a strictly objective journalistic tone: eliminate value-laden adjectives, metaphors, and intensifiers. Limit yourself to reporting verifiable facts, actions, and direct quotes. Avoid interpreting intentions, predicting consequences, or labeling the severity of events. Specifically, avoid subjective Spanish terms such as: 'trágico', 'conmocionado', 'alarmante', 'agresivo', 'tormenta política', 'sistemáticamente', or 'razonable'.";

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

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 10)),
    )
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&aacute;/g, "á")
    .replace(/&eacute;/g, "é")
    .replace(/&iacute;/g, "í")
    .replace(/&oacute;/g, "ó")
    .replace(/&uacute;/g, "ú")
    .replace(/&Aacute;/g, "Á")
    .replace(/&Eacute;/g, "É")
    .replace(/&Iacute;/g, "Í")
    .replace(/&Oacute;/g, "Ó")
    .replace(/&Uacute;/g, "Ú")
    .replace(/&ntilde;/g, "ñ")
    .replace(/&Ntilde;/g, "Ñ")
    .replace(/&uuml;/g, "ü")
    .replace(/&Uuml;/g, "Ü")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&lsquo;|&rsquo;/g, "'")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&hellip;/g, "…")
    .replace(/&amp;/g, "&");
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
      "Write an in-depth story summary in Markdown with a clear journalistic structure.",
      "Instructions:",
      "1) Output MUST be in Spanish.",
      "2) Start with a short opening paragraph (no heading) that works like a lede.",
      "3) Organize the rest with a clear structure (short sections, bullets, or both) so it is easy to scan.",
      "4) You may include inline Markdown links using only source URLs from the input when they add context.",
      "5) Do not invent or alter URLs.",
      "6) Do not invent claims; use only the provided source material.",
      "7) Keep a skeptical and balanced tone: acknowledge source bias and possible institutional agendas.",
      "8) Keep that skepticism evidence-based and non-conspiratorial.",
      "9) Use proper Spanish orthography (UTF-8), including accents and ñ; never replace accented characters with ASCII placeholders, numbers, or entities.",
      `10) ${OBJECTIVE_JOURNALISTIC_TONE_INSTRUCTION}`,
      `Story title/topic: ${cluster.title}`,
      cluster.selection_reason
        ? `Why this story was selected: ${cluster.selection_reason}`
        : null,
      latestClusterSourceTime
        ? `Most recent source timestamp: ${new Date(latestClusterSourceTime).toISOString()}`
        : null,
      latestHoursAgo !== null
        ? `Most recent source is approximately ${latestHoursAgo} hours old.`
        : null,
      "Example format to imitate (structure and tone; do not copy facts verbatim):",
      [
        "Una comisión parlamentaria resolvió por mayoría que la legisladora enfrentará sanciones internas tras una audiencia extensa y confrontacional.",
        "",
        "**Por qué importa:**",
        "* El comité definirá sanciones en las próximas semanas, con opciones que van desde multa hasta censura.",
        "* Algunos legisladores ya impulsan medidas más duras, incluyendo una votación para apartarla del cargo.",
        "",
        "**Ponte al día rápido:**",
        "* El dictamen interno sostuvo que la mayoría de los cargos quedó acreditada con estándar elevado de prueba.",
        "* Las acusaciones combinan faltas de financiamiento de campaña, reportes financieros incompletos y uso indebido de recursos.",
        "",
        "**Entre líneas:**",
        "* La defensa alegó falta de tiempo para preparar el caso y pidió postergar el proceso.",
        "* El comité rechazó la demora y sostuvo que el cronograma respetaba garantías básicas.",
        "",
        "**Qué pasó:**",
        "* La defensa afirmó que la congresista no controlaba directamente la contabilidad de campaña.",
        "* También argumentó que parte de los pagos correspondía a labores previas en su empresa familiar.",
        "",
        "**Lo que sigue:**",
        "* La decisión disciplinaria final se conocerá tras la próxima reunión del comité.",
        "* El frente judicial sigue abierto en paralelo y puede condicionar el costo político del caso.",
        "",
        "* Revisa la cobertura del primer frente en [este reporte](https://example.com/fuente-1).",
        "* Contexto adicional del segundo frente en [este análisis](https://example.com/fuente-2).",
      ].join("\n"),
      "In your final answer, replace those example.com links with URLs from the allowed sources above when you include links.",
      "Relevant sources (full texts), each delimited by ---:",
      sourceTexts.map((text) => `---\n${text}\n---`).join("\n"),
      "Write the detailed summary now.",
    ]
      .filter(Boolean)
      .join("\n");

    const generated = await generateGeminiJson(prompt, storyDetailSchema, {
      model: RUN_BRIEF_MODEL,
      nativeStructuredOutput: {
        responseJsonSchema: storyDetailResponseJsonSchema,
      },
    });

    const detailMarkdown = decodeHtmlEntities(generated.detail_markdown).trim();

    summaries.push({
      cluster_id: cluster.id,
      title: cluster.title,
      detail_markdown: detailMarkdown,
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
    "You are composing a final multi-story news brief from detailed story summaries.",
    "Output MUST be in Spanish.",
    "Return exactly one markdown paragraph per story, in the same order.",
    "Each paragraph must be exactly 4 sentences.",
    "Start each paragraph with a short inline title in bold, ending with a period, then continue in the same paragraph.",
    'Required format at paragraph start: "**Título corto.** " followed by the rest of the paragraph.',
    "Keep the bold title short (2-6 words), neutral, and objective.",
    "The bold title must describe the latest concrete development in that story, not the broader ongoing theme.",
    "No headings, no bullet lists, no inline citations.",
    "Use a balanced rewrite: improve coherence and reduce repetition while preserving each story's facts.",
    "Make transitions between consecutive paragraphs flow naturally in the given order, using concise bridging language without adding new facts.",
    "Keep a skeptical and balanced tone: acknowledge possible source bias and potential agendas in official versions.",
    "Keep that tone cautious and evidence-based, not conspiratorial.",
    OBJECTIVE_JOURNALISTIC_TONE_INSTRUCTION,
    "Use proper Spanish orthography (UTF-8), including accents and ñ; never replace accented characters with ASCII placeholders, numbers, or entities.",
    "Do not merge stories or move facts across story boundaries.",
    `Number of stories: ${storySummaries.length}`,
    "Story summaries (ordered):",
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
    markdown: replaceNewlinesWithSpaces(decodeHtmlEntities(paragraph.markdown)),
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
