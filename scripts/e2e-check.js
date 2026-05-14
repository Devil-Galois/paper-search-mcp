import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const args = parseArgs(process.argv.slice(2));
const query = args.query || args.positionals.join(" ") || "high-speed SAR ADC calibration ISSCC JSSC";
const depth = Number.parseInt(args.depth || "1", 10);
const perPaperLimit = Number.parseInt(args.perPaperLimit || "5", 10);
const maxResults = Number.parseInt(args.maxResults || "5", 10);

const transport = new StdioClientTransport({
  command: "node",
  args: ["./src/server.js"],
  env: {
    ...process.env,
    PAPER_SEARCH_CACHE_DIR: "./.cache"
  }
});

const client = new Client({ name: "paper-search-e2e-client", version: "0.1.0" });

try {
  await client.connect(transport);
  const search = await callJsonTool("search_papers", { query, maxResults });
  const papers = search.papers || [];
  const selected = selectPaper(papers);
  let expansion = null;
  let expandError = null;

  if (selected?.identifier) {
    try {
      expansion = await callJsonTool("expand_references", {
        identifier: selected.identifier,
        depth,
        perPaperLimit
      });
    } catch (error) {
      expandError = error.message;
    }
  }

  console.log(JSON.stringify({
    ok: papers.length > 0 && Boolean(selected) && !expandError,
    query,
    search: {
      resultCount: papers.length,
      errors: search.errors || []
    },
    selectedPaper: selected ? {
      title: selected.title,
      doi: selected.doi,
      venue: selected.venue,
      year: selected.year,
      url: selected.url,
      source: selected.source
    } : null,
    references: expansion ? {
      depth: expansion.depth,
      perPaperLimit: expansion.perPaperLimit,
      nodeCount: (expansion.papers || []).length,
      edgeCount: (expansion.edges || []).length
    } : {
      nodeCount: 0,
      edgeCount: 0,
      error: expandError || "No paper with DOI, paperId, OpenAlex ID, URL, or title was available."
    },
    playwrightCheck: {
      attempted: false,
      reason: "Use Playwright MCP only for a small manual page check, login page, or authenticated PDF cookie extraction. Stop for IEEE 418, CAPTCHA, institutional login, or paywall."
    }
  }, null, 2));
} finally {
  await client.close();
}

async function callJsonTool(name, toolArgs) {
  const response = await client.callTool({ name, arguments: toolArgs });
  const text = response.content?.[0]?.text || "{}";
  return JSON.parse(text);
}

function selectPaper(papers) {
  const paper = papers.find((item) => item.doi) || papers[0];
  if (!paper) return null;
  return {
    ...paper,
    identifier: paper.doi || paper.paperId || paper.openAlexId || paper.url || paper.title
  };
}

function parseArgs(argv) {
  const result = { positionals: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      result.positionals.push(arg);
      continue;
    }
    const key = arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      result[key] = true;
    } else {
      result[key] = next;
      index += 1;
    }
  }
  return result;
}
