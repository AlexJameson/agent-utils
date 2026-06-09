export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
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
}

export interface CachedToken {
  token: string;
  expiresAt: number;
}

export interface CachedSearch {
  results: QueryResult[];
  timestamp: number;
}
