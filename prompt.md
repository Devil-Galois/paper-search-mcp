# 一键安装配置提示词

把下面这段提示词复制给 Codex 或 Claude Code，它会从 GitHub 拉取项目并配置到本地。

```text
请从 GitHub 安装并配置 paper-search-mcp 与 playwright mcp (https://github.com/microsoft/playwright.git)：

仓库地址：
https://github.com/Devil-Galois/paper-search-mcp.git

目标：
在本机配置一个用于论文检索、参考文献递归展开、认证 PDF 下载和 PDF 文本解析的 MCP 工作流。

执行要求：
1. 以 cc-switch 作为 MCP 配置源优先。不要默认分别维护 Claude Code 和 Codex 的 MCP 配置。
2. 先把仓库 clone 到一个合适的本地工具目录。
3. 进入项目目录后运行 npm install。
4. 运行 npm run verify:tools，确认 MCP server 至少暴露这些工具：
   - search_papers
   - get_paper
   - expand_references
   - build_literature_map
   - download_pdf
   - read_pdf
5. 先运行 cc-switch 优先的配置预览：
   npm run configure -- --chrome-profile ./browser-profiles/paper-search
6. 展示输出中的 ccSwitch.servers，确认会添加或更新 paper-search-mcp 和 playwright 两个 MCP server 条目。
7. 如果本机已安装并使用 cc-switch，在确认计划无误后运行：
   npm run configure -- --apply-cc-switch --chrome-profile ./browser-profiles/paper-search
   该命令会先备份 cc-switch.db，再写入或更新 paper-search-mcp 和 playwright。注意：它只更新 cc-switch 配置源，不直接写 Claude Code/Codex。
8. 如果 cc-switch 有命令行同步接口，可显式使用 --cc-switch-sync-command；否则打开 cc-switch GUI，把 MCP 条目同步到 Claude Code/Codex。
9. 运行 npm run verify:config:paper-search，分别汇报：
   - cc-switch DB 是否包含两个 MCP，enabled_claude / enabled_codex 是否开启
   - Claude Code 配置是否存在、validJson、hasBom、parseError、是否已同步
   - Codex 配置是否存在、是否通过 TOML 基础检查、是否已同步
10. 如果 .claude.json 报 hasBom=true 或 validJson=false，先运行 npm run repair:configs；该命令必须备份后只移除 UTF-8 BOM，不改变 JSON 语义内容。
11. 如果 cc-switch 没有 CLI sync 接口，需要打开 cc-switch GUI 手动同步/应用到 Claude Code/Codex。
12. 同步后重启 Claude Code/Codex 或重新打开会话；不要假设当前会话会热加载 MCP。
13. 如果必须使用 direct 模式，先备份真实配置，再运行：
   npm run configure:direct -- --apps claude,codex --chrome-profile ./browser-profiles/paper-search
   direct 模式只能作为没有 cc-switch 或用户明确要求时的备用方案。
14. 配置 Playwright MCP 时使用专用 Chrome profile，不要使用我的日常默认 Chrome profile。
15. 不要绕过登录、付费墙、验证码、IEEE 418 或机构认证。如果需要登录，暂停并让我手动完成。

配置完成后的默认使用规则：
- 用 paper-search-mcp 做批量论文元数据检索和参考文献递归。
- 只在登录页面、Google Scholar 少量核对和认证 PDF 下载时使用 Playwright MCP。
- 优先使用权威论文源和一手资料。
- 明确区分全文证据、摘要证据和仅元数据证据。

安装后请做一个小型端到端检查：
1. 运行：
   npm run e2e:check -- "high-speed SAR ADC calibration ISSCC JSSC"
2. 确认摘要里包含检索结果数量、选中论文 title/doi/venue/url、reference 节点数/边数、失败源和错误原因。
3. 只在需要页面核对或认证 PDF cookie 时使用 Playwright 打开 DOI/IEEE 页面。
4. 遇到 IEEE 418、验证码、机构登录或付费墙时暂停，让我手动处理。
5. 最后汇报：哪些步骤通过、哪些步骤失败、修改了哪些文件、备份文件在哪里。
```
