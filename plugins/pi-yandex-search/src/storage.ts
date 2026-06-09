import type { CachedSearch, CachedToken } from "./types.js";

const TOKEN_CACHE_KEY = "yandex-search:token";
const SEARCH_TTL_MS = 5 * 60 * 1000; // 5 minutes

export class YandexSearchCache {
  private memory = new Map<string, unknown>();

  getToken(): CachedToken | null {
    const cached = this.memory.get(TOKEN_CACHE_KEY) as CachedToken | undefined;
    if (!cached) return null;
    // Refresh 60 seconds before expiry
    if (Date.now() >= cached.expiresAt - 60_000) {
      this.memory.delete(TOKEN_CACHE_KEY);
      return null;
    }
    return cached;
  }

  setToken(token: string, expiresInSeconds: number): void {
    this.memory.set(TOKEN_CACHE_KEY, {
      token,
      expiresAt: Date.now() + expiresInSeconds * 1000,
    });
  }

  getSearch(cacheKey: string): CachedSearch | null {
    const cached = this.memory.get(cacheKey) as CachedSearch | undefined;
    if (!cached) return null;
    if (Date.now() - cached.timestamp > SEARCH_TTL_MS) {
      this.memory.delete(cacheKey);
      return null;
    }
    return cached;
  }

  setSearch(cacheKey: string, results: CachedSearch["results"]): void {
    this.memory.set(cacheKey, { results, timestamp: Date.now() });
  }
}
