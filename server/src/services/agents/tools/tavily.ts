import { tool } from "@langchain/core/tools";
import { z } from "zod";

// Tavily search tool for web research
export const tavilySearch = tool(
  async ({ query }: { query: string }) => {
    const apiKey = process.env.TAVILY_API_KEY;

    if (!apiKey) {
      throw new Error("TAVILY_API_KEY not configured");
    }

    try {
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          api_key: apiKey,
          query,
          search_depth: "advanced",
          include_domains: [
            "docs.sui.io",
            "blog.sui.io",
            "medium.com",
            "coinmarketcap.com",
            "coingecko.com",
            "defillama.com"
          ],
          max_results: 5,
        }),
      });

      if (!response.ok) {
        throw new Error(`Tavily API error: ${response.statusText}`);
      }

      const data: any = await response.json();

      // Format results for the LLM
      const results = data.results.map((r: any) => ({
        title: r.title,
        url: r.url,
        content: r.content,
        score: r.score,
      }));

      return JSON.stringify(results, null, 2);
    } catch (error) {
      console.error("Tavily search error:", error);
      return JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  },
  {
    name: "web_search",
    description: "Search the web for information about Sui projects, tokens, protocols, news, and documentation. Use this for recent events, project updates, market data, and technical documentation.",
    schema: z.object({
      query: z.string().describe("The search query to find relevant information"),
    }),
  }
);
