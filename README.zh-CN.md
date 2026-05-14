# paper-search-mcp

[English README](./README.md)

`paper-search-mcp` 的目标很直接：给 MCP 客户端提供一套可落地的论文检索流程，包括论文元数据检索、参考文献递归展开、带 cookie 的认证 PDF 下载，以及 PDF 文本解析。

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
- 推荐：使用 cc-switch 作为 MCP 配置源。
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

我推荐优先通过 cc-switch 管理这个 MCP。cc-switch 应该作为唯一配置源，再同步到 Claude Code 或 Codex。直接写入各客户端配置文件只作为不使用 cc-switch 时的备用方案。

### 推荐：cc-switch

预览 cc-switch 优先的配置计划：

```bash
npm run configure
```

或显式运行：

```bash
npm run configure:cc-switch
```

输出内容会包含 `paper-search-mcp` 和可选 `playwright` 的 server 定义。在 cc-switch 中添加或更新这些条目，开启需要的客户端同步，再让 cc-switch 写入对应客户端配置。

使用专用 Chrome profile：

```bash
npm run configure -- --chrome-profile /path/to/chrome-profile-copy
```

检查输出计划无误后，可以自动写入或更新 `cc-switch.db` 中的两个 MCP 条目：

```bash
npm run configure -- --apply-cc-switch --chrome-profile /path/to/chrome-profile-copy
```

这个命令只更新 cc-switch 这个配置源，不会直接写 Claude Code 或 Codex 的配置文件。脚本会先备份数据库，备份路径形如 `$HOME/.cc-switch/cc-switch.db.<timestamp>.bak`。如果数据库不在 `$HOME/.cc-switch/` 下，可使用 `--cc-switch-db /path/to/cc-switch.db` 指定。

如果你的 cc-switch 版本提供命令行同步接口，可以显式传入：

```bash
npm run configure -- --apply-cc-switch --cc-switch-sync-command "cc-switch sync" --chrome-profile /path/to/chrome-profile-copy
```

如果没有命令行同步接口，请打开 cc-switch GUI，把 MCP 条目应用或同步到 Claude Code 和 Codex。

检查三层配置状态：

```bash
npm run verify:config
```

这个检查会区分：

- cc-switch DB 中是否有 `paper-search-mcp` 和 `playwright`，以及 `enabled_claude` / `enabled_codex` 是否开启。
- Claude Code 的 `$HOME/.claude.json` 是否已经同步对应 MCP 条目。
- Codex 的 `$HOME/.codex/config.toml` 是否已经同步对应 MCP 条目。

同步后建议重启 Claude Code / Codex，或重新打开会话。已有会话不一定会热加载 MCP 改动。

### 备用：直接写客户端配置

只有在不使用 cc-switch，或明确要手工维护各客户端配置时，才使用 direct 模式。

direct 模式会直接写 Claude Code / Codex 配置文件，可能和 cc-switch 配置源分叉。不要把 direct 当作 cc-switch 同步失败后的默认补救，除非用户明确接受这种分叉。

预览 direct 模式将写入的内容：

```bash
npm run configure:direct -- --dry-run
```

直接写入 Claude Code 和 Codex：

```bash
npm run configure:direct -- --apps claude,codex
```

只直接写入 Claude Code：

```bash
npm run configure:direct -- --apps claude
```

direct 模式写入位置：

- Claude Code：`$HOME/.claude.json`
- Codex：`$HOME/.codex/config.toml`

如果想先安全测试 direct 模式，不碰真实配置：

```bash
npm run configure:direct -- --home ./tmp-home --apps claude,codex --chrome-profile ./tmp-home/chrome-profile
```

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

Playwright 只是配套工具，用于少量页面核对、登录页和认证 PDF cookie 提取。遇到 IEEE `418`、验证码、机构登录或付费墙时必须暂停并手动在浏览器中处理，本项目不会自动绕过这些限制。

## 端到端检查

运行一个紧凑检查，避免输出大量原始 JSON：

```bash
npm run e2e:check -- "high-speed SAR ADC calibration ISSCC JSSC"
```

脚本会输出检索结果数量、选中论文元数据、参考文献节点/边数量、数据源错误，以及是否进行了 Playwright 页面核对。Playwright 页面核对保留为手动或 MCP 客户端驱动，因为登录和出版社页面依赖具体会话。

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

## Windows / cc-switch 故障排查

### verify:config 和 Chrome profile 一致性

如果 `--apply-cc-switch` 时使用了专用 Chrome profile，验证时也应使用同一个 profile：

```bash
npm run configure -- --verify-sync --chrome-profile ./browser-profiles/paper-search
npm run verify:config:paper-search
```

`--apply-cc-switch` 会把上次使用的 Chrome profile 记录到 `.cache/configure-state.json`，因此不传 `--chrome-profile` 时，`npm run verify:config` 会优先复用上次配置。

`verify:config` 会区分三层状态：

- cc-switch DB 中是否有 `paper-search-mcp` 和 `playwright`，以及 `enabled_claude` / `enabled_codex` 是否开启。
- Claude Code 的 `$HOME/.claude.json` 是否存在、是否是严格 JSON、`validJson` / `hasBom` / `parseError` 状态，以及是否已经同步对应 MCP 条目。
- Codex 的 `$HOME/.codex/config.toml` 是否存在、是否通过脚本的 TOML 基础检查，以及是否已经同步对应 MCP 条目。

### `.claude.json: expected value at line 1 column 1`

常见原因：`$HOME/.claude.json` 带 UTF-8 BOM，或 JSON 文件损坏。Windows 上可以检查前三个字节：

```bash
node -e "const fs=require('fs'); const b=fs.readFileSync(process.env.USERPROFILE+'/.claude.json'); console.log([...b.slice(0,3)])"
```

如果输出 `[239,187,191]`，说明文件以 `EF BB BF` 开头。

修复：

```bash
npm run repair:configs
npm run verify:config
```

修复命令会先把 `.claude.json` 备份为 `$HOME/.claude.json.<timestamp>.bom.bak`，只移除文件开头的 UTF-8 BOM，然后重新验证 JSON。它不会改变 JSON 语义内容。

### `cc-switch.db` 已更新但 Claude/Codex 没有 MCP

原因：`--apply-cc-switch` 只更新了 cc-switch 配置源，cc-switch 还没有把条目同步或应用到客户端配置文件。当前常见 Windows 安装中 `C:\CC-Switch\cc-switch.exe --help` 可能没有输出，也不一定有可用 CLI sync 接口。

处理方式：打开 cc-switch GUI，同步或应用到 Claude Code 和 Codex，然后重启客户端或新开会话。

### `sourceReady=true` 但 `claudeSynced=false` 或 `codexSynced=false`

这不是 server 安装失败，而是配置源已经准备好，但客户端派生配置还没有同步或当前会话还没有加载。请通过 cc-switch 同步/应用后，再运行：

```bash
npm run verify:config
```
