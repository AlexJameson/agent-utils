export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  content?: string;
}

export interface QueryResult {
  query: string;
  results: SearchResult[];
  error: string | null;
}

export interface SearchOptions {
  numResults?: number;
  recencyFilter?: "day" | "week" | "month" | "year";
  searchRegion?: "ru" | "com" | "tr";
  includeContent?: boolean;
}

export interface CachedToken {
  token: string;
  expiresAt: number;
}

export interface CachedSearch {
  results: QueryResult[];
  timestamp: number;
}
