export type CandidateSource = {
  publisherId: string;
  publisherName: string;
  url: string;
  canonicalUrl: string;
  title: string | null;
  description: string | null;
  publishedAt: string | null;
};

export type PrefetchedArticle = CandidateSource & {
  sourceUrl: string;
  html: string;
};

export type ExtractedArticle = CandidateSource & {
  sourceUrl: string;
  bodyText: string;
};

export type ClusterDraft = {
  id: string;
  title: string;
  sourceKeys: string[];
  selectionReason: string | null;
};

export type StorySummaryRow = {
  clusterId: string;
  title: string;
  detailMarkdown: string;
};

export type BriefSectionRow = {
  clusterId: string;
  markdown: string;
};
