import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { generateGeminiJson } from "@/lib/gemini/generate";
import { RUN_CLUSTER_MODEL } from "@/lib/runs/constants";

const baselineClusterSchema = z.object({
  stories: z.array(
    z.object({
      title: z.string().trim().min(1),
      source_keys: z.array(z.string().trim().min(1)).min(1),
    }),
  ),
});

const precisionClusterSchema = z.object({
  stories: z.array(
    z.object({
      title: z.string().trim().min(1),
      source_keys: z.array(z.string().trim().min(1)).min(1),
      cohesion_score: z.number().min(0).max(1),
      specificity_score: z.number().min(0).max(1),
    }),
  ),
  abstained_source_keys: z.array(z.string().trim().min(1)).default([]),
});

const clusterJudgeSchema = z.object({
  ratings: z.array(
    z.object({
      title: z.string().trim().min(1),
      specific_story: z.boolean(),
      broad_or_mixed: z.boolean(),
    }),
  ),
});

const datasetSchema = z.object({
  samples: z
    .array(
      z.object({
        sample_id: z.string().trim().min(1),
        candidates: z.array(
          z.object({
            source_key: z.string().trim().min(1),
            publisher_id: z.string().trim().min(1),
            publisher_name: z.string().trim().min(1).nullable().optional(),
            url: z.string().trim().min(1),
            canonical_url: z.string().trim().min(1).nullable().optional(),
            title: z.string().trim().min(1).nullable().optional(),
            published_at: z.string().trim().min(1).nullable().optional(),
          }),
        ),
      }),
    )
    .min(1),
});

type ClusterResult = {
  stories: { title: string; source_keys: string[] }[];
};

function parseArgs() {
  const args = process.argv.slice(2);
  const inputIndex = args.indexOf("--input");
  const outIndex = args.indexOf("--out");
  const inputPath = inputIndex >= 0 ? args[inputIndex + 1] : "";
  const outPath = outIndex >= 0 ? args[outIndex + 1] : "";
  if (!inputPath) {
    throw new Error("Missing --input <path-to-json>");
  }
  return { inputPath: resolve(inputPath), outPath: outPath ? resolve(outPath) : null };
}

async function clusterBaseline(candidates: unknown[]) {
  return generateGeminiJson(
    [
      "Cluster these article sources into stories they are covering.",
      "Each source_key can appear in at most one story.",
      "Use as many story clusters as needed to cover all available sources.",
      "Return JSON object with key stories and source_keys.",
      "Candidate sources:",
      JSON.stringify(candidates),
    ].join("\n"),
    baselineClusterSchema,
    { model: RUN_CLUSTER_MODEL },
  );
}

async function clusterPrecision(candidates: unknown[]) {
  return generateGeminiJson(
    [
      "Identify only specific stories that multiple publishers are clearly covering.",
      "Each source_key can appear in at most one story.",
      "It is acceptable to leave many sources unassigned when they are uncertain or weak matches.",
      "Do not create broad thematic, umbrella, or miscellaneous clusters.",
      "Every cluster must represent a single concrete event or development.",
      "For each story return cohesion_score (0..1) and specificity_score (0..1).",
      "Return JSON object with stories and abstained_source_keys.",
      "Candidate sources:",
      JSON.stringify(candidates),
    ].join("\n"),
    precisionClusterSchema,
    { model: RUN_CLUSTER_MODEL },
  );
}

async function judgeClusterSpecificity(stories: ClusterResult["stories"]) {
  if (stories.length === 0) {
    return { ratings: [] };
  }
  return generateGeminiJson(
    [
      "Judge whether each story cluster is a single specific story versus broad/mixed.",
      "A specific story is one concrete event/development.",
      "A broad or mixed cluster merges multiple unrelated developments or generic themes.",
      "Return ratings for every story title.",
      "Stories:",
      JSON.stringify(stories),
    ].join("\n"),
    clusterJudgeSchema,
    { model: RUN_CLUSTER_MODEL },
  );
}

function countAssignedSources(stories: ClusterResult["stories"]) {
  return new Set(stories.flatMap((story) => story.source_keys)).size;
}

async function evaluateSample(sample: z.infer<typeof datasetSchema.shape.samples.element>) {
  const baseline = await clusterBaseline(sample.candidates);
  const precision = await clusterPrecision(sample.candidates);
  const baselineJudge = await judgeClusterSpecificity(baseline.stories);
  const precisionJudge = await judgeClusterSpecificity(precision.stories);

  const totalCandidates = sample.candidates.length;
  const baselineAssigned = countAssignedSources(baseline.stories);
  const precisionAssigned = countAssignedSources(precision.stories);

  const baselineSpecific = baselineJudge.ratings.filter((r) => r.specific_story).length;
  const precisionSpecific = precisionJudge.ratings.filter((r) => r.specific_story).length;
  const baselineBroad = baselineJudge.ratings.filter((r) => r.broad_or_mixed).length;
  const precisionBroad = precisionJudge.ratings.filter((r) => r.broad_or_mixed).length;

  return {
    sample_id: sample.sample_id,
    candidate_count: totalCandidates,
    baseline: {
      clusters_total: baseline.stories.length,
      assigned_sources: baselineAssigned,
      assigned_coverage: totalCandidates ? baselineAssigned / totalCandidates : 0,
      specific_cluster_rate: baseline.stories.length
        ? baselineSpecific / baseline.stories.length
        : 0,
      broad_cluster_rate: baseline.stories.length ? baselineBroad / baseline.stories.length : 0,
    },
    precision: {
      clusters_total: precision.stories.length,
      assigned_sources: precisionAssigned,
      assigned_coverage: totalCandidates ? precisionAssigned / totalCandidates : 0,
      specific_cluster_rate: precision.stories.length
        ? precisionSpecific / precision.stories.length
        : 0,
      broad_cluster_rate: precision.stories.length
        ? precisionBroad / precision.stories.length
        : 0,
      abstained_sources: precision.abstained_source_keys.length,
    },
  };
}

async function main() {
  const { inputPath, outPath } = parseArgs();
  const raw = await readFile(inputPath, "utf8");
  const dataset = datasetSchema.parse(JSON.parse(raw));

  const samples = [];
  for (const sample of dataset.samples) {
    // Keep evaluation deterministic per sample by running baseline then precision.
    const evaluated = await evaluateSample(sample);
    samples.push(evaluated);
  }

  const summary = {
    sample_count: samples.length,
    baseline_avg_broad_cluster_rate:
      samples.reduce((acc, sample) => acc + sample.baseline.broad_cluster_rate, 0) /
      samples.length,
    precision_avg_broad_cluster_rate:
      samples.reduce((acc, sample) => acc + sample.precision.broad_cluster_rate, 0) /
      samples.length,
    baseline_avg_specific_cluster_rate:
      samples.reduce((acc, sample) => acc + sample.baseline.specific_cluster_rate, 0) /
      samples.length,
    precision_avg_specific_cluster_rate:
      samples.reduce((acc, sample) => acc + sample.precision.specific_cluster_rate, 0) /
      samples.length,
    baseline_avg_assigned_coverage:
      samples.reduce((acc, sample) => acc + sample.baseline.assigned_coverage, 0) /
      samples.length,
    precision_avg_assigned_coverage:
      samples.reduce((acc, sample) => acc + sample.precision.assigned_coverage, 0) /
      samples.length,
  };

  const report = { summary, samples };
  const encoded = JSON.stringify(report, null, 2);
  if (outPath) {
    await writeFile(outPath, encoded, "utf8");
  }
  console.log(encoded);
}

main().catch((error) => {
  console.error(
    "[scripts:evaluate-clustering] failed:",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
