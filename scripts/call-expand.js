import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const identifier = process.argv[2] || "10.1109/JSSC.2022.3162602";
const transport = new StdioClientTransport({
  command: "node",
  args: ["./src/server.js"],
  env: {
    ...process.env,
    PAPER_SEARCH_CACHE_DIR: "./.cache"
  }
});

const client = new Client({ name: "paper-search-expand-client", version: "0.1.0" });
await client.connect(transport);
const response = await client.callTool({
  name: "expand_references",
  arguments: {
    identifier,
    depth: 1,
    perPaperLimit: 10
  }
});
console.log(response.content?.[0]?.text || JSON.stringify(response, null, 2));
await client.close();
