# paper-search-mcp

[中文文档](./README.zh-CN.md)

The aim of `paper-search-mcp` is to give MCP clients a practical paper-search workflow: search paper metadata, expand reference chains, download authenticated PDFs when cookies are available, and extract readable text from PDFs.

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

After reviewing the printed plan, you can write or update both MCP entries in `cc-switch.db` automatically:

```bash
npm run configure -- --apply-cc-switch --chrome-profile /path/to/chrome-profile-copy
```

This updates the cc-switch source of truth only. It does not directly write Claude Code or Codex config files. The script backs up the database first as `$HOME/.cc-switch/cc-switch.db.<timestamp>.bak`. Use `--cc-switch-db /path/to/cc-switch.db` when the database is not under `$HOME/.cc-switch/`.

If your cc-switch build exposes a CLI sync command, pass it explicitly:

```bash
npm run configure -- --apply-cc-switch --cc-switch-sync-command "cc-switch sync" --chrome-profile /path/to/chrome-profile-copy
```

If there is no CLI sync command, open cc-switch and apply or sync the MCP entries to Claude Code and Codex from the GUI.

Verify the three configuration layers:

```bash
npm run verify:config
```

The verification distinguishes:

- cc-switch DB contains `paper-search-mcp` and `playwright`, with `enabled_claude` / `enabled_codex` set.
- Claude Code `$HOME/.claude.json` contains the synced MCP entries.
- Codex `$HOME/.codex/config.toml` contains the synced MCP entries.

After sync, restart Claude Code / Codex or open a new session. Existing sessions may not hot-load MCP changes.

### Fallback: direct client config

Use direct mode only when cc-switch is not part of your setup, or when you intentionally want to manage client config files by hand.

Direct mode writes Claude Code / Codex config files directly and can diverge from cc-switch. Do not use it as the default repair path for cc-switch sync issues unless the user explicitly accepts that split.

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

Playwright is only a companion for small page checks, login pages, and authenticated PDF cookie extraction. If IEEE returns `418`, a CAPTCHA appears, an institutional login is required, or a paywall blocks access, stop and finish the step manually in the browser. This project does not automate bypasses.

## End-to-End Check

Run a compact check that avoids dumping large raw tool outputs:

```bash
npm run e2e:check -- "high-speed SAR ADC calibration ISSCC JSSC"
```

The script reports result count, selected paper metadata, reference node/edge counts, source errors, and whether a Playwright page check was attempted. Playwright page checks remain manual or MCP-client driven because login and publisher pages are session-specific.

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
