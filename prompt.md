# 一键安装配置提示词

把下面这段提示词复制给 Codex 或 Claude Code，它会从 GitHub 拉取项目并配置到本地。

```text
请从 GitHub 安装并配置 paper-search-mcp：

仓库地址：
https://github.com/Devil-Galois/paper-search-mcp.git

目标：
在本机配置一个用于论文检索、参考文献递归展开、认证 PDF 下载和 PDF 文本解析的 MCP 工作流。

执行要求：
1. 不要直接覆盖我现有的 Claude Code、Codex 或 cc-switch 配置。任何真实配置写入前，必须先备份原配置。
2. 先把仓库 clone 到一个合适的本地工具目录。
3. 进入项目目录后运行 npm install。
4. 运行 npm run verify:tools，确认 MCP server 至少暴露这些工具：
   - search_papers
   - get_paper
   - expand_references
   - build_literature_map
   - download_pdf
   - read_pdf
5. 在修改真实配置前，先用临时 home 目录做预检：
   npm run configure -- --home ./tmp-home --apps claude,codex --chrome-profile ./tmp-home/chrome-profile
6. 展示临时输出的配置内容，并说明将要添加哪些 MCP server 条目。
7. 如果临时配置正确，再备份我的真实 MCP 配置文件，然后配置我实际使用的客户端。
8. 如果我使用 cc-switch 作为 MCP 配置源，请优先通过 cc-switch 配置 paper-search-mcp，而不是分别手工维护 Claude Code 和 Codex 配置。
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
