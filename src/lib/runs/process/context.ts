import type {
  CandidateSource,
  ExtractedArticle,
  PersistedCluster,
  PrefetchedArticle,
  SelectionDecision,
} from "@/lib/runs/process/shared";
import type { RunMetadata } from "@/lib/runs/progress";

export type ProcessRunContext = {
  runId: string;
  metadata: RunMetadata;
  extractConcurrency: number;
  prefetchedByCandidateKey: Map<string, PrefetchedArticle>;
  identifiedCandidates: CandidateSource[];
  sourceByKey: Map<string, CandidateSource>;
  clustersWithEligibility: PersistedCluster[];
  selectionDecisions: SelectionDecision | null;
  selectedCandidates: CandidateSource[];
  extractedArticles: Array<ExtractedArticle | null>;
};

export function createProcessRunContext(
  runId: string,
  metadata: RunMetadata,
  extractConcurrency: number,
): ProcessRunContext {
  return {
    runId,
    metadata,
    extractConcurrency,
    prefetchedByCandidateKey: new Map<string, PrefetchedArticle>(),
    identifiedCandidates: [],
    sourceByKey: new Map<string, CandidateSource>(),
    clustersWithEligibility: [],
    selectionDecisions: null,
    selectedCandidates: [],
    extractedArticles: [],
  };
}
