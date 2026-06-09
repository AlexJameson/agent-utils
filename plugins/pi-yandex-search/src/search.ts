import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { QueryResult, SearchOptions } from "./types.js";
import { YandexSearchCache } from "./storage.js";

const SEARCH_API_URL = "https://searchapi.api.cloud.yandex.net/v2/web/search";
const METADATA_URL = "http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token";
const FOLDER_ID = process.env.YANDEX_FOLDER_ID ?? "b1gohoimamtqv2mmeb4j";

const cache = new YandexSearchCache();

interface MetadataTokenResponse {
  access_token: string;
  expires_in: number;
}

function getTokenFromEnv(): string | null {
  const token = process.env.YANDEX_IAM_TOKEN?.trim();
  return token?.length ? token : null;
}

function getTokenFromFile(): string | null {
  const path = join(homedir(), ".pi", "yandex-iam-token");
  if (!existsSync(path)) return null;
  const token = readFileSync(path, "utf-8").trim();
  return token.length ? token : null;
}

function getTokenFromYcCli(): string | null {
  try {
    const output = execFileSync("yc", ["iam", "create-token"], {
      encoding: "utf-8",
      timeout: 10000,
      stdio: ["pipe", "pipe", "ignore"],
    });
    const token = output.trim();
    return token.length ? token : null;
  } catch {
    return null;
  }
}

async function getTokenFromMetadata(signal?: AbortSignal): Promise<string | null> {
  try {
    const response = await fetch(METADATA_URL, {
      headers: { "Metadata-Flavor": "Google" },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as MetadataTokenResponse;
    if (!data.access_token) return null;
    cache.setToken(data.access_token, data.expires_in);
    return data.access_token;
  } catch {
    return null;
  }
}

async function fetchIamToken(signal?: AbortSignal): Promise<string> {
  const cached = cache.getToken();
  if (cached) return cached.token;

  // 1. Yandex Cloud metadata service (VM)
  const metadataToken = await getTokenFromMetadata(signal);
  if (metadataToken) return metadataToken;

  // 2. YC CLI (laptop with yc authenticated)
  const ycToken = getTokenFromYcCli();
  if (ycToken) {
    cache.setToken(ycToken, 3600); // yc tokens last ~12h but we conservatively cache 1h
    return ycToken;
  }

  // 3. Environment variable
  const envToken = getTokenFromEnv();
  if (envToken) {
    cache.setToken(envToken, 3600);
    return envToken;
  }

  // 4. Local file fallback
  const fileToken = getTokenFromFile();
  if (fileToken) {
    cache.setToken(fileToken, 3600);
    return fileToken;
  }

  throw new Error(
    "No Yandex IAM token available. Options:\n" +
    "  1. Run on a Yandex Cloud VM with metadata service\n" +
    "  2. Install YC CLI and run 'yc iam create-token'\n" +
    "  3. Set YANDEX_IAM_TOKEN environment variable\n" +
    "  4. Write token to ~/.pi/yandex-iam-token"
  );
}

interface YandexSearchBody {
  query: {
    searchType: string;
    queryText: string;
    familyMode: string;
    fixTypoMode: string;
  };
  folderId: string;
  groupSpec: { groupsOnPage: number };
  l10n: string;
  region: string;
  responseFormat: string;
}

function buildSearchBody(query: string, options: SearchOptions): YandexSearchBody {
  const region = options.searchRegion ?? "com";
  const searchType = region === "tr" ? "SEARCH_TYPE_TR" : "SEARCH_TYPE_COM";
  const l10n = region === "tr" ? "LOCALIZATION_TR" : "LOCALIZATION_EN";

  return {
    query: {
      searchType,
      queryText: query,
      familyMode: "FAMILY_MODE_NONE",
      fixTypoMode: "FIX_TYPO_MODE_OFF",
    },
    folderId: FOLDER_ID,
    groupSpec: { groupsOnPage: Math.min(options.numResults ?? 5, 20) },
    l10n,
    region,
    responseFormat: "FORMAT_XML",
  };
}

function extractDocuments(xml: string): string[] {
  const docs: string[] = [];
  const docRegex = /<doc\s+[^>]*id="[^"]*"[^>]*>[\s\S]*?<\/doc>/g;
  let match: RegExpExecArray | null;
  while ((match = docRegex.exec(xml)) !== null) {
    docs.push(match[0]);
  }
  return docs;
}

function extractText(tag: string, xml: string): string | null {
  const regex = new RegExp(`<${tag}>(.*?)</${tag}>`, "s");
  const m = regex.exec(xml);
  return m ? m[1].trim() : null;
}

function extractPassages(xml: string): string[] {
  const passages: string[] = [];
  const regex = /<passage>(.*?)<\/passage>/gs;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    passages.push(match[1].trim());
  }
  return passages;
}

function cleanHlword(text: string): string {
  return text.replace(/<hlword>|<\/hlword>/g, "").trim();
}

function getBestSnippet(doc: string): string {
  const headline = extractText("headline", doc);
  if (headline) return cleanHlword(headline);

  const passages = extractPassages(doc);
  if (passages.length > 0) return cleanHlword(passages.join(" "));

  const extended = extractText("extended-text", doc);
  if (extended) return cleanHlword(extended);

  return "";
}

function parseResults(xml: string): import("./types.js").SearchResult[] {
  const docs = extractDocuments(xml);
  const results: import("./types.js").SearchResult[] = [];

  for (const doc of docs) {
    const url = extractText("url", doc);
    const title = extractText("title", doc);
    if (!url) continue;

    results.push({
      title: title || url,
      url,
      snippet: getBestSnippet(doc),
    });
  }

  return results;
}

function buildCacheKey(query: string, options: SearchOptions): string {
  return `search:${query}:${options.numResults ?? 5}:${options.recencyFilter ?? "none"}:${options.searchRegion ?? "com"}`;
}

export async function searchYandex(
  query: string,
  options: SearchOptions = {},
  signal?: AbortSignal,
): Promise<QueryResult> {
  const cacheKey = buildCacheKey(query, options);
  const cached = cache.getSearch(cacheKey);
  if (cached) {
    return { query, results: cached.results[0]?.results ?? [], error: null };
  }

  const token = await fetchIamToken(signal);
  const body = buildSearchBody(query, options);

  const response = await fetch(SEARCH_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Yandex Search API error ${response.status}: ${text.slice(0, 500)}`);
  }

  const json = (await response.json()) as { rawData?: string };
  if (!json.rawData) {
    throw new Error("Yandex Search API returned no rawData");
  }

  const xml = Buffer.from(json.rawData, "base64").toString("utf-8");
  const results = parseResults(xml);

  const result: QueryResult = { query, results, error: null };
  cache.setSearch(cacheKey, [result]);
  return result;
}
