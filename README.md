# paper-search-mcp

[中文文档](./README.zh-CN.md)

I built `paper-search-mcp` to give MCP clients a practical paper-search workflow: search paper metadata, expand reference chains, download authenticated PDFs when cookies are available, and extract readable text from PDFs.

The default workflow is API first. Semantic Scholar, OpenAlex, Crossref, and IEEE Xplore API provide the structured metadata path. Browser workflows are kept separate through Playwright MCP, mainly for login-gated pages, manual Google Scholar checks, and authenticated PDF downloads.

## Features

- Search papers through Semantic Scholar, OpenAlex, Crossref, and IEEE Xplore.
- Fetch paper metadata by DOI, Semantic Scholar paper ID, OpenAlex work ID, or cached title.
- Merge metadata from multiple sources for the same paper.
- Recursively expand references with bounded depth and per-paper limits.
- Filter OpenAlex results by venue/source, such as `JSSC|ISSCC|CICC|VLSI`.
- Download PDFs with explicitly supplied browser cookies.
- Extract text from local PDFs or direct PDF URLs.
- Cache metadata locally to reduce repeated lookups.

## Requirements

- Node.js 18 or newer.
- npm.
- Network access to metadata APIs.
- Recommended: cc-switch as the MCP configuration source of truth.
- Optional: Semantic Scholar API key for higher rate limits.
- Optional: IEEE Xplore API key for IEEE metadata search.
- Optional: Playwright MCP for browser-assisted login and cookie extraction.

This project does not bypass CAPTCHA, institutional login, paywalls, or Google Scholar rate limits. If a page requires login or verification, finish that step manually in the browser and continue from the authenticated session.

## Install

```bash
git clone https://github.com/Devil-Galois/paper-search-mcp.git
cd paper-search-mcp
npm install
npm run verify:tools
```

Optional environment variables:

```bash
SEMANTIC_SCHOLAR_API_KEY=your_semantic_scholar_key
IEEE_API_KEY=your_ieee_xplore_key
PAPER_SEARCH_CACHE_DIR=/path/to/cache
```

## Configure MCP Clients

I recommend managing this MCP through cc-switch first. cc-switch should be the single source of truth, and Claude Code or Codex should receive MCP entries through cc-switch sync. Direct per-client config is a fallback for setups that do not use cc-switch.

### Recommended: cc-switch

Preview the cc-switch-first configuration plan:

```bash
npm run configure
```

or explicitly:

```bash
npm run configure:cc-switch
```

The output contains the `paper-search-mcp` and optional `playwright` server definitions. Add or update those entries in cc-switch, enable sync for the clients you use, then let cc-switch write the client-specific config.

With a dedicated Chrome profile:

```bash
npm run configure -- --chrome-profile /path/to/chrome-profile-copy
```

### Fallback: direct client config

Use direct mode only when cc-switch is not part of your setup, or when you intentionally want to manage client config files by hand.

Preview direct writes:

```bash
npm run configure:direct -- --dry-run
```

Write both Claude Code and Codex entries directly:

```bash
npm run configure:direct -- --apps claude,codex
```

Write only Claude Code directly:

```bash
npm run configure:direct -- --apps claude
```

Direct mode writes:

- Claude Code: `$HOME/.claude.json`
- Codex: `$HOME/.codex/config.toml`

To test direct mode safely without touching your real config:

```bash
npm run configure:direct -- --home ./tmp-home --apps claude,codex --chrome-profile ./tmp-home/chrome-profile
```

## Manual MCP Entries

Paper search server:

```json
{
  "command": "node",
  "args": ["/absolute/path/to/paper-search-mcp/src/server.js"],
  "env": {
    "PAPER_SEARCH_CACHE_DIR": "/absolute/path/to/cache"
  }
}
```

Playwright MCP companion:

```json
{
  "command": "npx",
  "args": [
    "@playwright/mcp@latest",
    "--browser=chrome",
    "--user-data-dir",
    "/absolute/path/to/non-default-chrome-profile"
  ]
}
```

Do not point Playwright at your daily default Chrome profile. Use a copied or dedicated profile so Chrome session locks and profile conflicts do not break browser automation.

## Tools

### `search_papers`

Search paper metadata through the configured sources.

Main inputs:

- `query`
- `maxResults`
- `yearFrom`
- `yearTo`
- `venue`
- `sources`

Useful venue filters:

- `IEEE Journal of Solid-State Circuits`
- `JSSC|ISSCC|CICC|VLSI|A-SSCC|ESSCIRC`

### `get_paper`

Fetch one paper by DOI, Semantic Scholar paper ID, OpenAlex work ID, or cached exact title.

### `expand_references`

Recursively expand references from a root paper.

Defaults:

- `depth = 2`
- `perPaperLimit = 10`

### `build_literature_map`

Search seed papers and recursively expand references into a deduplicated citation map.

### `download_pdf`

Download a PDF with explicitly supplied browser cookies.

For authenticated IEEE/ACM pages:

1. Open the page with Playwright MCP.
2. Complete login manually when needed.
3. Extract cookies from the browser context.
4. Call `download_pdf({ pdfUrl, outputDir, cookies })`.
5. Call `read_pdf({ pdfPath })`.

Do not call `read_pdf(url=...)` directly for session-protected PDF URLs such as IEEE `stamp.jsp`.

### `read_pdf`

Extract text from a local PDF path or a direct PDF URL.

## Usage Policy

When I use this server for literature work, I keep these rules:

- Use API metadata for bulk search and recursive references.
- Use Playwright only for login-gated pages, Google Scholar spot checks, and authenticated PDF download.
- Do not invent papers, DOIs, metrics, or conclusions.
- Mark whether a conclusion comes from full text, abstract, or metadata only.
- Prefer authoritative venues and primary sources for technical claims.

## Quick Checks

```bash
npm run verify:tools
npm run smoke -- "high-speed SAR ADC"
node ./scripts/call-expand.js 10.1109/ISSCC42615.2023.10067573
```

## Privacy

Do not commit:

- `.env`
- `.cache/`
- `.npm-cache/`
- `.playwright-mcp/`
- `browser-profiles/`
- copied browser profiles
- downloaded PDFs
- API keys
- local Claude Code, Codex, or cc-switch config files

Before publishing, scan for local paths and secrets:

```bash
rg -n "sk-[A-Za-z0-9]|api[_-]?key|token|password|secret" . \
  --glob '!node_modules/**' --glob '!.cache/**' --glob '!.npm-cache/**' --glob '!.playwright-mcp/**'
```

## Release

```bash
git init
git add .
git commit -m "Initial release"
git branch -M main
git remote add origin https://github.com/Devil-Galois/paper-search-mcp.git
git push -u origin main
```
