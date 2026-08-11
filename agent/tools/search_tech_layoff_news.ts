import { defineTool } from "eve/tools";
import { z } from "zod";

export default defineTool({
  description: "Searches recent news articles about tech layoffs",
  inputSchema: z.object({
    query: z.string().optional(),
    pageSize: z.number().max(20).optional(),
  }),
  async execute(input) {
    const apiKey = process.env.NEWS_API_KEY;
    if (!apiKey) {
      return { error: "NEWS_API_KEY environment variable is not set", articles: [] };
    }

    const query = input.query ?? "tech layoffs developers engineers";
    const pageSize = input.pageSize ?? 10;

    const url = new URL("https://newsapi.org/v2/everything");
    url.searchParams.set("q", query);
    url.searchParams.set("sortBy", "publishedAt");
    url.searchParams.set("language", "en");
    url.searchParams.set("pageSize", String(pageSize));
    url.searchParams.set("apiKey", apiKey);

    const res = await fetch(url.toString());
    if (!res.ok) {
      return { error: `NewsAPI returned ${res.status}`, articles: [] };
    }

    const data = await res.json();
    const articles = (data.articles ?? []).map((a: any) => ({
      title: a.title ?? "",
      source: a.source?.name ?? "",
      publishedAt: a.publishedAt ?? "",
      url: a.url ?? "",
      description: a.description ?? "",
    }));

    return { articles };
  },
});