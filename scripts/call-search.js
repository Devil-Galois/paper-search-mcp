import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const query = process.argv.slice(2).join(" ") || "RISC-V AI accelerator memory hierarchy";
const transport = new StdioClientTransport({
  command: "node",
  args: ["./src/server.js"],
  env: {
    ...process.env,
    PAPER_SEARCH_CACHE_DIR: "./.cache"
  }
});

const client = new Client({ name: "paper-search-call-client", version: "0.1.0" });
await client.connect(transport);
const response = await client.callTool({
  name: "search_papers",
  arguments: {
    query,
    maxResults: 10
  }
});
console.log(response.content?.[0]?.text || JSON.stringify(response, null, 2));
await client.close();
