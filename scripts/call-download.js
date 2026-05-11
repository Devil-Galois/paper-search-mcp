import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const pdfUrl = process.argv[2] || "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf";
const transport = new StdioClientTransport({
  command: "node",
  args: ["./src/server.js"],
  env: {
    ...process.env,
    PAPER_SEARCH_CACHE_DIR: "./.cache"
  }
});

const client = new Client({ name: "paper-search-download-client", version: "0.1.0" });
await client.connect(transport);
const response = await client.callTool({
  name: "download_pdf",
  arguments: {
    pdfUrl,
    outputDir: "./.cache/download-test",
    fileName: "download-test.pdf",
    cookies: []
  }
});
console.log(response.content?.[0]?.text || JSON.stringify(response, null, 2));
await client.close();
