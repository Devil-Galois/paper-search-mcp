import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const args = parseArgs(process.argv.slice(2));
const identifier = args.positionals[0] || "10.1109/JSSC.2022.3162602";
const depth = Number.parseInt(args.depth || "1", 10);
const perPaperLimit = Number.parseInt(args.perPaperLimit || "10", 10);
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
    depth,
    perPaperLimit
  }
});
console.log(response.content?.[0]?.text || JSON.stringify(response, null, 2));
await client.close();

function parseArgs(argv) {
  const result = { positionals: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      result.positionals.push(arg);
      continue;
    }
    const key = arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      result[key] = true;
    } else {
      result[key] = next;
      index += 1;
    }
  }
  return result;
}
