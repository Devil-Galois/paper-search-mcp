# 一键安装配置提示词

把下面这段提示词复制给 Codex 或 Claude Code，它会从 GitHub 拉取项目并配置到本地。

```text
请从 GitHub 安装并配置 paper-search-mcp：

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
6. 展示输出中的 ccSwitch.servers，并说明需要在 cc-switch 中添加哪些 MCP server 条目。
7. 如果本机已安装并使用 cc-switch，请通过 cc-switch 添加或更新 paper-search-mcp 和 playwright，再从 cc-switch 同步到 Claude Code/Codex。
8. 如果必须使用 direct 模式，先备份真实配置，再运行：
   npm run configure:direct -- --apps claude,codex --chrome-profile ./browser-profiles/paper-search
   direct 模式只能作为没有 cc-switch 或用户明确要求时的备用方案。
9. 配置 Playwright MCP 时使用专用 Chrome profile，不要使用我的日常默认 Chrome profile。
10. 不要绕过登录、付费墙、验证码或机构认证。如果需要登录，暂停并让我手动完成。

配置完成后的默认使用规则：
- 用 paper-search-mcp 做批量论文元数据检索和参考文献递归。
- 只在登录页面、Google Scholar 少量核对和认证 PDF 下载时使用 Playwright MCP。
- 优先使用权威论文源和一手资料。
- 明确区分全文证据、摘要证据和仅元数据证据。

安装后请做一个小型端到端检查：
1. 检索：
   high-speed SAR ADC calibration ISSCC JSSC
2. 确认至少返回一篇相关论文。
3. 选一篇有 DOI 的论文，运行 expand_references，参数 depth=1、perPaperLimit=5。
4. 用 Playwright 打开该 DOI 或 IEEE 页面，核对浏览器页面与检索元数据一致。
5. 最后汇报：哪些步骤通过、哪些步骤失败、修改了哪些文件、备份文件在哪里。
```
