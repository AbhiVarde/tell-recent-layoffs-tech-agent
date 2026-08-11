import { Sandbox } from "@vercel/sandbox";
import { nanoid } from "nanoid";

export const runtime = "nodejs";
export const maxDuration = 120;

const AGENT_FILES: { filename: string; content: string }[] = [{"filename":"agent/instructions.md","content":"# Tech Layoff News Agent\nYou report recent tech layoffs in the tech market. For each item, give the company name and the number of developers or tech employees laid off, with a source and date.\n\nSteps:\n1. Call `search_tech_layoff_news` to find the latest articles.\n2. For articles that look relevant, call `fetch_article_text` to read the full content.\n3. From the returned text, identify company names and the reported layoff counts (especially developers/engineers/tech staff). If a count isn't stated, say \"not specified\".\n4. Return a concise bullet list: Company — laid-off count — source — date. Cite the article URL.\n\nIf the user asks about a specific company or region, pass that as the `query` to the search tool."},{"filename":"agent/tools/search_tech_layoff_news.ts","content":"import { defineTool } from \"eve/tools\";\nimport { z } from \"zod\";\n\nexport default defineTool({\n  description: \"Searches recent news articles about tech layoffs\",\n  inputSchema: z.object({\n    query: z.string().optional(),\n    pageSize: z.number().max(20).optional(),\n  }),\n  async execute(input) {\n    const apiKey = process.env.NEWS_API_KEY;\n    if (!apiKey) {\n      return { error: \"NEWS_API_KEY environment variable is not set\", articles: [] };\n    }\n\n    const query = input.query ?? \"tech layoffs developers engineers\";\n    const pageSize = input.pageSize ?? 10;\n\n    const url = new URL(\"https://newsapi.org/v2/everything\");\n    url.searchParams.set(\"q\", query);\n    url.searchParams.set(\"sortBy\", \"publishedAt\");\n    url.searchParams.set(\"language\", \"en\");\n    url.searchParams.set(\"pageSize\", String(pageSize));\n    url.searchParams.set(\"apiKey\", apiKey);\n\n    const res = await fetch(url.toString());\n    if (!res.ok) {\n      return { error: `NewsAPI returned ${res.status}`, articles: [] };\n    }\n\n    const data = await res.json();\n    const articles = (data.articles ?? []).map((a: any) => ({\n      title: a.title ?? \"\",\n      source: a.source?.name ?? \"\",\n      publishedAt: a.publishedAt ?? \"\",\n      url: a.url ?? \"\",\n      description: a.description ?? \"\",\n    }));\n\n    return { articles };\n  },\n});"},{"filename":"agent/tools/fetch_article_text.ts","content":"import { defineTool } from \"eve/tools\";\nimport { z } from \"zod\";\n\nexport default defineTool({\n  description: \"Fetches the readable text of a news article from its URL\",\n  inputSchema: z.object({\n    url: z.string(),\n  }),\n  async execute(input) {\n    const readerUrl = `https://r.jina.ai/http://${input.url}`;\n    const res = await fetch(readerUrl);\n    if (!res.ok) {\n      return { error: `Could not fetch article: ${res.status}`, text: \"\" };\n    }\n\n    const text = await res.text();\n    return { text: text.slice(0, 12000) };\n  },\n});"}];

const OPEN_CHANNEL_AUTH = `import { eveChannel } from "eve/channels/eve";
import { none } from "eve/channels/auth";

export default eveChannel({ auth: [none()] });
`;

async function waitForServer(url: string, timeoutMs: number) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.status < 500) return true;
    } catch {
      // sandbox not accepting connections yet, keep polling
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function getModelEnv() {
  const env: Record<string, string> = {};
  if (process.env.AI_GATEWAY_API_KEY) env.AI_GATEWAY_API_KEY = process.env.AI_GATEWAY_API_KEY;
  if (process.env.VERCEL_OIDC_TOKEN) env.VERCEL_OIDC_TOKEN = process.env.VERCEL_OIDC_TOKEN;
  if (process.env.ANTHROPIC_API_KEY) env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (process.env.OPENAI_API_KEY) env.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  return env;
}

function getDirectories(files: { filename: string }[]): string[] {
  const dirs = new Set<string>();
  for (const f of files) {
    const parts = f.filename.split("/");
    parts.pop();
    if (parts.length > 0) dirs.add(parts.join("/"));
  }
  return [...dirs];
}

export async function POST() {
  const modelEnv = getModelEnv();

  if (Object.keys(modelEnv).length === 0) {
    return Response.json({
      ok: false,
      needsCredentials: true,
      error:
        "no model credentials set on this project. add AI_GATEWAY_API_KEY (or ANTHROPIC_API_KEY / OPENAI_API_KEY) in this project's vercel settings, then redeploy",
    });
  }

  const sandboxName = `eve-agent-${nanoid(8)}`;
  let sandbox;

  try {
    sandbox = await Sandbox.create({
      name: sandboxName,
      runtime: "node24",
      timeout: 600_000,
      ports: [3000],
      env: modelEnv,
      persistent: false,
    });
  } catch (err) {
    console.error("sandbox create failed:", err);
    return Response.json({
      ok: false,
      error: "couldn't start your agent right now, try again in a moment",
    });
  }

  await Promise.all(
    [...getDirectories(AGENT_FILES), "agent/channels"].map((dir) =>
      sandbox.fs.mkdir(dir, { recursive: true }),
    ),
  );

  await sandbox.writeFiles([
    ...AGENT_FILES.map((f) => ({
      path: f.filename,
      content: Buffer.from(f.content),
    })),
    {
      path: "package.json",
      content: Buffer.from(
        JSON.stringify(
          { name: "deployed-eve-agent", private: true, type: "module", dependencies: { eve: "latest" } },
          null,
          2,
        ),
      ),
    },
    { path: "agent/channels/eve.ts", content: Buffer.from(OPEN_CHANNEL_AUTH) },
  ]);

  const install = await sandbox.runCommand({
    cmd: "npm",
    args: ["install", "--no-audit", "--no-fund"],
  });

  if (install.exitCode !== 0) {
    const err = await install.stderr();
    await sandbox.stop();
    return Response.json({ ok: false, error: `install failed: ${err}` });
  }

  await sandbox.runCommand({
    cmd: "npx",
    args: ["eve", "dev", "--no-ui", "--port", "3000"],
    detached: true,
  });

  const url = sandbox.domain(3000);
  const ready = await waitForServer(url, 45_000);

  if (!ready) {
    await sandbox.stop();
    return Response.json({ ok: false, error: "agent didn't start in time" });
  }

  return Response.json({ ok: true, sandboxName, url });
}
