# paper-search-mcp

[English README](./README.md)

我做 `paper-search-mcp` 的目标很直接：给 MCP 客户端提供一套可落地的论文检索流程，包括论文元数据检索、参考文献递归展开、带 cookie 的认证 PDF 下载，以及 PDF 文本解析。

默认流程是 API 优先。Semantic Scholar、OpenAlex、Crossref 和 IEEE Xplore API 负责结构化元数据；浏览器流程交给 Playwright MCP，主要用于需要登录的页面、Google Scholar 少量人工核对，以及认证 PDF 下载。

## 功能

- 通过 Semantic Scholar、OpenAlex、Crossref、IEEE Xplore 检索论文。
- 按 DOI、Semantic Scholar paper ID、OpenAlex work ID 或缓存标题获取论文元数据。
- 对同一篇论文合并多个数据源的元数据。
- 按限制深度和每篇数量递归展开参考文献。
- 支持 OpenAlex venue/source 过滤，例如 `JSSC|ISSCC|CICC|VLSI`。
- 使用显式传入的浏览器 cookie 下载 PDF。
- 从本地 PDF 或直链 PDF 中提取文本。
- 使用本地缓存减少重复查询。

## 环境要求

- Node.js 18 或更高版本。
- npm。
- 能访问论文元数据 API 的网络环境。
- 可选：Semantic Scholar API key，用于提高限流额度。
- 可选：IEEE Xplore API key，用于 IEEE 元数据检索。
- 可选：Playwright MCP，用于浏览器登录和 cookie 提取。

这个项目不会绕过验证码、机构登录、付费墙或 Google Scholar 限流。遇到登录或验证时，在浏览器中手动完成，再继续使用已认证的会话。

## 安装

```bash
git clone https://github.com/Devil-Galois/paper-search-mcp.git
cd paper-search-mcp
npm install
npm run verify:tools
```

可选环境变量：

```bash
SEMANTIC_SCHOLAR_API_KEY=your_semantic_scholar_key
IEEE_API_KEY=your_ieee_xplore_key
PAPER_SEARCH_CACHE_DIR=/path/to/cache
```

## 配置 MCP 客户端

配置脚本可以为 Claude Code 和 Codex 写入 MCP server 条目。

先预览将写入的内容：

```bash
npm run configure -- --dry-run
```

同时配置 Claude Code 和 Codex：

```bash
npm run configure -- --apps claude,codex
```

只配置 Claude Code：

```bash
npm run configure -- --apps claude
```

配置 Playwright MCP，并使用独立 Chrome profile：

```bash
npm run configure -- --apps claude,codex --chrome-profile /path/to/chrome-profile-copy
```

脚本写入位置：

- Claude Code：`$HOME/.claude.json`
- Codex：`$HOME/.codex/config.toml`

如果想先安全测试，不碰真实配置：

```bash
npm run configure -- --home ./tmp-home --apps claude,codex --chrome-profile ./tmp-home/chrome-profile
```

如果你把 cc-switch 当作 MCP 配置源，需要在 cc-switch 中添加相同的 MCP 命令和参数，再让 cc-switch 同步到 Claude Code 和 Codex。

## 手动 MCP 条目

论文检索 server：

```json
{
  "command": "node",
  "args": ["/absolute/path/to/paper-search-mcp/src/server.js"],
  "env": {
    "PAPER_SEARCH_CACHE_DIR": "/absolute/path/to/cache"
  }
}
```

配套 Playwright MCP：

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

不要把 Playwright 指向日常默认 Chrome profile。建议使用复制出来的 profile 或专用 profile，避免 Chrome 会话锁和 profile 冲突影响浏览器自动化。

## 工具

### `search_papers`

通过配置的数据源检索论文元数据。

主要输入：

- `query`
- `maxResults`
- `yearFrom`
- `yearTo`
- `venue`
- `sources`

常用 venue 过滤：

- `IEEE Journal of Solid-State Circuits`
- `JSSC|ISSCC|CICC|VLSI|A-SSCC|ESSCIRC`

### `get_paper`

按 DOI、Semantic Scholar paper ID、OpenAlex work ID 或缓存标题获取单篇论文。

### `expand_references`

从一篇根论文递归展开参考文献。

默认值：

- `depth = 2`
- `perPaperLimit = 10`

### `build_literature_map`

先检索种子论文，再递归展开参考文献，输出去重后的引用图。

### `download_pdf`

用显式传入的浏览器 cookie 下载 PDF。

对于 IEEE/ACM 等需要登录的页面：

1. 用 Playwright MCP 打开页面。
2. 需要时手动完成登录。
3. 从浏览器 context 中提取 cookies。
4. 调用 `download_pdf({ pdfUrl, outputDir, cookies })`。
5. 调用 `read_pdf({ pdfPath })`。

不要直接对 IEEE `stamp.jsp` 这类受 session 保护的 PDF URL 调用 `read_pdf(url=...)`。

### `read_pdf`

从本地 PDF 路径或 PDF 直链中提取文本。

## 使用原则

我用这套服务做文献工作时遵循这些规则：

- 批量检索和参考文献递归优先使用 API 元数据。
- Playwright 只用于登录页面、Google Scholar 少量核对和认证 PDF 下载。
- 不编造论文、DOI、指标或结论。
- 明确区分结论来自全文、摘要，还是仅来自元数据。
- 技术判断优先依赖权威 venue 和一手资料。

## 快速检查

```bash
npm run verify:tools
npm run smoke -- "high-speed SAR ADC"
node ./scripts/call-expand.js 10.1109/ISSCC42615.2023.10067573
```

## 隐私

不要提交：

- `.env`
- `.cache/`
- `.npm-cache/`
- `.playwright-mcp/`
- 复制出来的浏览器 profile
- 下载的 PDF
- API keys
- 本机 Claude Code、Codex 或 cc-switch 配置文件

发布前扫描本地路径和密钥：

```bash
rg -n "sk-[A-Za-z0-9]|api[_-]?key|token|password|secret" . \
  --glob '!node_modules/**' --glob '!.cache/**' --glob '!.npm-cache/**' --glob '!.playwright-mcp/**'
```

## 发布

```bash
git init
git add .
git commit -m "Initial release"
git branch -M main
git remote add origin https://github.com/Devil-Galois/paper-search-mcp.git
git push -u origin main
```
