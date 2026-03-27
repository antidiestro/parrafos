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

function countBulletItems(markdown: string): number {
  const matches = markdown.match(/^\s*[*-]\s+/gm);
  return matches?.length ?? 0;
}

function getMarkdownLinkUrls(markdown: string): string[] {
  return Array.from(
    markdown.matchAll(/\[[^\]]+\]\((https?:\/\/[^)\s]+)\)/g),
    (match) => match[1],
  );
}

function getBoldLabelSectionHeadings(markdown: string): RegExpMatchArray[] {
  return Array.from(markdown.matchAll(/^\*\*[^*\n]+:\*\*$/gm));
}

function passesStorySummaryFormatChecks(
  markdown: string,
  allowedSourceUrls: Set<string>,
): boolean {
  const requiredLinks = Math.min(2, allowedSourceUrls.size);
  const linkUrls = getMarkdownLinkUrls(markdown);
  if (linkUrls.length < requiredLinks) return false;

  const headings = getBoldLabelSectionHeadings(markdown);
  if (headings.length < 4) return false;

  const firstHeadingIdx = headings[0]?.index ?? 0;
  const openingParagraph = markdown.slice(0, firstHeadingIdx).trim();
  if (openingParagraph.length < 40) return false;

  const sectionBulletCounts = headings.map((heading, idx) => {
    const sectionStart = (heading.index ?? 0) + heading[0].length;
    const sectionEnd = headings[idx + 1]?.index ?? markdown.length;
    const sectionBody = markdown.slice(sectionStart, sectionEnd).trim();
    return countBulletItems(sectionBody);
  });
  if (sectionBulletCounts.some((count) => count < 2)) return false;
  if (countBulletItems(markdown) < 8) return false;

  const linkedBulletUrls = Array.from(
    markdown.matchAll(
      /^\s*[*-]\s+.*\[[^\]]+\]\((https?:\/\/[^)\s]+)\).*$/gm,
    ),
    (match) => match[1],
  );
  if (linkedBulletUrls.length < requiredLinks) return false;

  let allowedLinkCount = 0;
  for (const url of linkUrls) {
    if (allowedSourceUrls.has(url)) {
      allowedLinkCount += 1;
    }
  }
  return allowedLinkCount >= requiredLinks;
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
    const allowedSourceUrls = new Set<string>();
    for (const source of clusterSources) {
      const key = `${source.publisher_id}::${source.canonical_url}`;
      const article = articleByKey.get(key);
      if (!article) continue;
      allowedSourceUrls.add(source.url);
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
    const requiredLinks = Math.min(2, allowedSourceUrls.size);

    const prompt = [
      "Write an in-depth story summary in Markdown with a clear journalistic structure.",
      "Instructions:",
      "1) Output MUST be in Spanish.",
      "2) Start with a short opening paragraph (no heading) that works like a lede.",
      "3) Then add 4 to 6 Markdown sections using bold labels with trailing colon on their own line.",
      "3a) Prefer labels like: **Por qué importa:**, **Ponte al día rápido:**, **Entre líneas:**, **Qué pasó:**, **El trasfondo:**, **Lo que sigue:**, **La otra versión:**, **En números:**.",
      "4) Every section must contain at least 2 bullet points using `*` and each bullet should contain concrete facts.",
      `5) Include at least ${requiredLinks} inline Markdown links in bullet points using [text](url).`,
      "6) Embed those links naturally inside factual bullets; do not dump links in a separate link-only section or at the end.",
      "7) Use only source URLs provided in the input; do not invent or alter URLs.",
      "8) Do not invent claims; use only the provided source material.",
      "9) Keep a skeptical and balanced tone: acknowledge source bias and possible institutional agendas.",
      "10) Keep that skepticism evidence-based and non-conspiratorial.",
      "11) Follow an Axios-like explainer structure closely: opening paragraph first, then labeled sections with bullets.",
      "12) Use proper Spanish orthography (UTF-8), including accents and ñ; never replace accented characters with ASCII placeholders, numbers, or entities.",
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
      "In your final answer, replace those example.com links with URLs from the allowed sources above.",
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

    const firstPassMarkdown = decodeHtmlEntities(
      generated.detail_markdown,
    ).trim();
    const detailMarkdown = passesStorySummaryFormatChecks(
      firstPassMarkdown,
      allowedSourceUrls,
    )
      ? firstPassMarkdown
      : decodeHtmlEntities(
          (
            await generateGeminiJson(
              [
                "Revise the previous summary to satisfy formatting constraints while preserving facts.",
                "Hard requirements:",
                "- Keep output in Spanish and Markdown.",
                "- Keep a short opening paragraph before any section heading.",
                "- Use 4 to 6 bold-label sections ending with colon on their own line.",
                "- Every section must contain at least 2 bullet points (`*`).",
                `- Include at least ${requiredLinks} inline links with source URLs from this exact allowed list.`,
                "- Put those inline links inside factual bullet points, not in a separate links block.",
                `Allowed URLs: ${Array.from(allowedSourceUrls).join(" | ")}`,
                "Do not invent facts or URLs.",
                "Previous draft:",
                firstPassMarkdown,
              ].join("\n"),
              storyDetailSchema,
              {
                model: RUN_BRIEF_MODEL,
                nativeStructuredOutput: {
                  responseJsonSchema: storyDetailResponseJsonSchema,
                },
              },
            )
          ).detail_markdown,
        ).trim();
    if (!passesStorySummaryFormatChecks(detailMarkdown, allowedSourceUrls)) {
      throw new Error(
        `Generated story summary for cluster ${cluster.id} failed markdown format checks.`,
      );
    }

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
    "Each paragraph should be medium length (5-6 sentences).",
    "No headings, no bullet lists, no inline citations.",
    "Use a balanced rewrite: improve coherence and reduce repetition while preserving each story's facts.",
    "Keep a skeptical and balanced tone: acknowledge possible source bias and potential agendas in official versions.",
    "Keep that tone cautious and evidence-based, not conspiratorial.",
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
