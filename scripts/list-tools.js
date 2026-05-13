import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["./src/server.js"],
  env: {
    ...process.env,
    PAPER_SEARCH_CACHE_DIR: "./.cache"
  }
});

const client = new Client({ name: "paper-search-smoke-client", version: "0.1.0" });
await client.connect(transport);
const tools = await client.listTools();

const requiredTools = [
  "search_papers",
  "get_paper",
  "expand_references",
  "build_literature_map",
  "download_pdf",
  "read_pdf"
];
const toolNames = new Set((tools.tools || []).map((tool) => tool.name));
const missingTools = requiredTools.filter((name) => !toolNames.has(name));

console.log(JSON.stringify({
  ok: missingTools.length === 0,
  requiredTools,
  exposedTools: [...toolNames].sort(),
  missingTools
}, null, 2));

await client.close();

if (missingTools.length) {
  process.exitCode = 1;
}
