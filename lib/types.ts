export type RawRanking = {
  keyword: string;
  ranking_page: string;
  rank_position: number | null;
  volume: number | null;
  difficulty: number | null;
};

export type CompetingUrl = { url: string; position: number | null };

export type PageInfo = {
  url: string;
  title: string | null;
  datePublished: string | null;
  pageAuthority: number | null;
  inboundLinks: number | null;
  linkingDomains: number | null;
  error?: string;
};

export type KeywordRow = {
  keyword: string;
  topUrl: string;
  position: number | null;
  volume: number | null;
  difficulty: number | null;
  cannibalized: boolean;
  competing: CompetingUrl[];
};

export type ViewSpec = {
  cannibalized?: boolean | null;
  keyword_contains?: string[];
  keyword_excludes?: string[];
  url_contains?: string[];
  min_volume?: number | null;
  max_volume?: number | null;
  min_position?: number | null;
  max_position?: number | null;
  min_pa?: number | null;
  min_competing_urls?: number | null;
  sort_field?: "volume" | "position" | "pa" | "competing" | "keyword" | "difficulty" | null;
  sort_dir?: "asc" | "desc" | null;
  limit?: number | null;
};

export type Keys = { mozToken: string; anthropicKey: string; model: string };
