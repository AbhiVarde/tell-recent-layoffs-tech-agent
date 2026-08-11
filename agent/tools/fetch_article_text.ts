import { defineTool } from "eve/tools";
import { z } from "zod";

export default defineTool({
  description: "Fetches the readable text of a news article from its URL",
  inputSchema: z.object({
    url: z.string(),
  }),
  async execute(input) {
    const readerUrl = `https://r.jina.ai/http://${input.url}`;
    const res = await fetch(readerUrl);
    if (!res.ok) {
      return { error: `Could not fetch article: ${res.status}`, text: "" };
    }

    const text = await res.text();
    return { text: text.slice(0, 12000) };
  },
});