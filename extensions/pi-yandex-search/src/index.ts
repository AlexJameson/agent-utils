import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { searchYandex } from "./search.js";
import type { QueryResult } from "./types.js";

function normalizeQueryList(raw: unknown[]): string[] {
  const out: string[] = [];
  for (const q of raw) {
    if (typeof q === "string") {
      const trimmed = q.trim();
      if (trimmed.length > 0) out.push(trimmed);
    }
  }
  return out;
}

function formatResults(results: QueryResult[]): string {
  const parts: string[] = [];
  for (const r of results) {
    if (r.error) {
      parts.push(`## Query: "${r.query}"\n\nError: ${r.error}\n`);
      continue;
    }
    if (r.results.length === 0) {
      parts.push(`## Query: "${r.query}"\n\nNo results found.\n`);
      continue;
    }
    if (results.length > 1) {
      parts.push(`## Query: "${r.query}"\n`);
    }
    for (let i = 0; i < r.results.length; i++) {
      const res = r.results[i];
      parts.push(`${i + 1}. **${res.title}**\n   ${res.url}\n   ${res.snippet}\n`);
      if (res.content) {
        parts.push(`   Content: ${res.content}\n`);
      }
    }
  }
  return parts.join("\n").trim();
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "yandex_search",
    label: "Yandex Search",
    description:
      "Search the web using Yandex Search API. Returns search results with titles, URLs, and short snippets (~300 chars each). Default 3 results per query. Set includeContent to true to fetch truncated page markdown (~2000 chars) inline — this avoids expensive separate fetch_content calls. For comprehensive research, prefer queries (plural) with 2-4 varied angles over a single query. Uses IAM token auth from Yandex Cloud metadata service (no API keys required on this VM).",
    promptSnippet:
      "Use yandex_search for web research. Prefer {queries:[...]} with 2-4 varied angles over a single query for broader coverage.",
    promptGuidelines: [
      "Use yandex_search when the user asks for documentation, facts, current information, or any web content.",
      "Use yandex_search instead of web_search on this system — web_search providers are blocked by DPI.",
      "For research tasks, call yandex_search with multiple varied queries rather than one broad query.",
    ],
    parameters: Type.Object({
      query: Type.Optional(Type.String({ description: "Single search query. For research tasks, prefer 'queries' with multiple varied angles instead." })),
      queries: Type.Optional(Type.Array(Type.String(), { description: "Multiple queries searched in sequence. Vary phrasing, scope, and angle across 2-4 queries to maximize coverage." })),
      numResults: Type.Optional(Type.Number({ description: "Results per query (default: 3, max: 20)" })),
      includeContent: Type.Optional(Type.Boolean({ description: "Fetch truncated page markdown (~2000 chars) inline. Avoids expensive separate fetch_content calls." })),
      recencyFilter: Type.Optional(
        StringEnum(["day", "week", "month", "year"], { description: "Filter by recency" }),
      ),
      searchRegion: Type.Optional(
        StringEnum(["ru", "com", "tr"], { description: "Search region (default: com)" }),
      ),
    }),

    async execute(_toolCallId, params, signal, onUpdate) {
      const rawList: unknown[] = Array.isArray(params.queries)
        ? params.queries
        : params.query !== undefined
          ? [params.query]
          : [];
      const queryList = normalizeQueryList(rawList);

      if (queryList.length === 0) {
        return {
          content: [{ type: "text", text: "Error: No query provided. Use 'query' or 'queries' parameter." }],
          details: { error: "No query provided" },
        };
      }

      const results: QueryResult[] = [];

      for (let i = 0; i < queryList.length; i++) {
        const query = queryList[i];
        onUpdate?.({
          content: [{ type: "text", text: `Searching ${i + 1}/${queryList.length}: "${query}"...` }],
          details: { phase: "searching", progress: i / queryList.length, currentQuery: query },
        });

        try {
          const result = await searchYandex(query, {
            numResults: params.numResults,
            recencyFilter: params.recencyFilter as "day" | "week" | "month" | "year" | undefined,
            searchRegion: params.searchRegion as "ru" | "com" | "tr" | undefined,
            includeContent: params.includeContent ?? false,
          }, signal);
          results.push(result);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          results.push({ query, results: [], error: message });
        }
      }

      const output = formatResults(results);
      const successful = results.filter((r) => !r.error && r.results.length > 0).length;
      const total = results.reduce((sum, r) => sum + r.results.length, 0);

      return {
        content: [{ type: "text", text: output }],
        details: {
          queries: queryList,
          queryCount: queryList.length,
          successfulQueries: successful,
          totalResults: total,
          includeContent: params.includeContent ?? false,
        },
      };
    },
  });
}
