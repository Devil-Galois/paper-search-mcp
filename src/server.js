#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { cacheQuery, findCachedPaper, recordEvent, upsertPapers } from "./cache.js";
import { downloadWithCookies } from "./downloader.js";
import { dedupePapers, getPaper, searchAll } from "./providers.js";
import { readPdf } from "./pdf.js";

const server = new McpServer({
  name: "paper-search-mcp",
  version: "0.1.0"
});

server.tool(
  "search_papers",
  "Search papers with API-first mixed retrieval. Uses Semantic Scholar, OpenAlex, Crossref, and IEEE Xplore when IEEE_API_KEY is configured.",
  {
    query: z.string().min(1),
    maxResults: z.number().int().min(1).max(50).default(10),
    yearFrom: z.number().int().min(1800).max(2100).optional(),
    yearTo: z.number().int().min(1800).max(2100).optional(),
    venue: z.string().optional(),
    sources: z.array(z.enum(["semantic_scholar", "openalex", "crossref", "ieee"])).default(["semantic_scholar", "openalex", "crossref", "ieee"])
  },
  async (args) => {
    const result = await searchAll(args);
    const papers = await upsertPapers(result.papers, "search");
    await cacheQuery(JSON.stringify({ tool: "search_papers", ...args }), papers);
    await recordEvent("search_papers", { args, count: papers.length, errors: result.errors });
    return jsonResult({ papers, errors: result.errors, policy: mixedSearchPolicy() });
  }
);

server.tool(
  "get_paper",
  "Fetch a paper by Semantic Scholar paperId, DOI, or exact cached title.",
  {
    identifier: z.string().min(1)
  },
  async ({ identifier }) => {
    const cached = await findCachedPaper(identifier);
    const paper = await getPaper(identifier).catch(() => null) || cached;
    if (!paper) return jsonResult({ found: false, identifier });
    const stored = await upsertPapers([paper], "get_paper");
    await recordEvent("get_paper", { identifier, found: true });
    return jsonResult({ found: true, paper: stored[0], policy: mixedSearchPolicy() });
  }
);

server.tool(
  "expand_references",
  "Recursively expand references from a root paper. Defaults are depth=2 and perPaperLimit=10 to prevent runaway crawling.",
  {
    identifier: z.string().min(1),
    depth: z.number().int().min(1).max(3).default(2),
    perPaperLimit: z.number().int().min(1).max(30).default(10)
  },
  async ({ identifier, depth, perPaperLimit }) => {
    const seen = new Set();
    const nodes = [];
    const edges = [];
    await expand(identifier, 0, depth, perPaperLimit, seen, nodes, edges);
    const papers = await upsertPapers(nodes, "expand_references");
    await recordEvent("expand_references", { identifier, depth, perPaperLimit, nodes: nodes.length, edges: edges.length });
    return jsonResult({ root: identifier, depth, perPaperLimit, papers, edges, policy: mixedSearchPolicy() });
  }
);

server.tool(
  "read_pdf",
  "Extract paper text from a local PDF path or a direct PDF URL. If parsing is unreliable, the result says so instead of inventing content.",
  {
    pdfPath: z.string().optional(),
    url: z.string().url().optional(),
    maxChars: z.number().int().min(2000).max(80000).default(24000)
  },
  async ({ pdfPath, url, maxChars }) => {
    if (!pdfPath && !url) throw new Error("Either pdfPath or url is required.");
    const result = await readPdf({ pdfPath, url, maxChars });
    await recordEvent("read_pdf", { pdfPath: result.pdfPath, pageCount: result.pageCount, textLength: result.textLength });
    return jsonResult({
      ...result,
      analysisGuide: [
        "problem definition",
        "core principle",
        "method assumptions",
        "experimental setup",
        "reproducibility",
        "limitations",
        "relation to the current research task"
      ]
    });
  }
);

server.tool(
  "download_pdf",
  "Download a PDF using explicitly supplied browser cookies. Use Playwright page.context().cookies() first for authenticated IEEE/ACM pages.",
  {
    pdfUrl: z.string().url(),
    outputDir: z.string().default("./papers"),
    fileName: z.string().optional(),
    referer: z.string().url().optional(),
    userAgent: z.string().optional(),
    cookies: z.array(z.object({
      name: z.string(),
      value: z.string(),
      domain: z.string().optional(),
      path: z.string().optional()
    })).default([])
  },
  async ({ pdfUrl, outputDir, fileName, referer, userAgent, cookies }) => {
    const result = await downloadWithCookies({ pdfUrl, outputDir, fileName, referer, userAgent, cookies });
    await recordEvent("download_pdf", { pdfUrl, outputDir, pdfPath: result.pdfPath, size: result.size, contentType: result.contentType });
    return jsonResult({
      ...result,
      nextStep: "Call read_pdf with pdfPath to parse the downloaded file.",
      policy: mixedSearchPolicy()
    });
  }
);

server.tool(
  "build_literature_map",
  "Search papers and recursively expand references for the top results, returning a deduplicated citation map.",
  {
    query: z.string().min(1),
    maxSeedPapers: z.number().int().min(1).max(10).default(3),
    yearFrom: z.number().int().min(1800).max(2100).optional(),
    yearTo: z.number().int().min(1800).max(2100).optional(),
    venue: z.string().optional(),
    depth: z.number().int().min(1).max(3).default(2),
    perPaperLimit: z.number().int().min(1).max(30).default(10)
  },
  async ({ query, maxSeedPapers, yearFrom, yearTo, venue, depth, perPaperLimit }) => {
    const search = await searchAll({ query, maxResults: maxSeedPapers, yearFrom, yearTo, venue });
    const seen = new Set();
    const nodes = [];
    const edges = [];
    for (const paper of search.papers.slice(0, maxSeedPapers)) {
      const identifier = paper.paperId || paper.doi || paper.title;
      if (!identifier) continue;
      await expand(identifier, 0, depth, perPaperLimit, seen, nodes, edges);
    }
    const papers = await upsertPapers(dedupePapers([...search.papers, ...nodes]), "build_literature_map");
    await recordEvent("build_literature_map", { query, maxSeedPapers, yearFrom, yearTo, venue, depth, perPaperLimit, nodes: papers.length, edges: edges.length });
    return jsonResult({ query, seedPapers: search.papers, papers, edges, errors: search.errors, policy: mixedSearchPolicy() });
  }
);

async function expand(identifier, level, maxDepth, perPaperLimit, seen, nodes, edges) {
  if (!identifier || level > maxDepth) return;
  const key = identifier.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);

  const cached = await findCachedPaper(identifier);
  const paper = await getPaper(identifier).catch(() => null) || cached;
  if (!paper) return;

  const visitedPaper = { ...paper, visitedDepth: level };
  nodes.push(visitedPaper);
  if (level === maxDepth) return;

  const references = (paper.references || [])
    .filter((ref) => ref.title || ref.doi || ref.paperId || ref.openAlexId)
    .sort((a, b) => (b.citationCount || 0) - (a.citationCount || 0))
    .slice(0, perPaperLimit);

  for (const ref of references) {
    const refId = ref.paperId || ref.doi || ref.openAlexId || ref.title;
    if (!refId) continue;
    edges.push({
      from: paper.paperId || paper.doi || paper.title,
      to: refId,
      relation: "references"
    });
    await expand(refId, level + 1, maxDepth, perPaperLimit, seen, nodes, edges);
  }
}

function jsonResult(value) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}

function mixedSearchPolicy() {
  return {
    retrieval: "API-first mixed retrieval",
    scholar: "Use Playwright MCP for small, manual-assisted Google Scholar lookup only; do not use it as the bulk recursive source.",
    ieee: "Use IEEE Xplore API when IEEE_API_KEY is set; otherwise use browser/metadata fallback and manual login for subscribed full text.",
    recursionDefault: "depth=2, perPaperLimit=10",
    fullText: "Read PDF/HTML when available; for authenticated PDF URLs, get Playwright context cookies, call download_pdf, then call read_pdf on the local pdfPath."
  };
}

const transport = new StdioServerTransport();
await server.connect(transport);
