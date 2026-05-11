import { searchAll } from "../src/providers.js";

const query = process.argv.slice(2).join(" ") || "RISC-V AI accelerator memory hierarchy";
const result = await searchAll({ query, maxResults: 10 });

console.log(JSON.stringify({
  query,
  count: result.papers.length,
  errors: result.errors,
  papers: result.papers.map((paper) => ({
    title: paper.title,
    year: paper.year,
    venue: paper.venue,
    doi: paper.doi,
    url: paper.url,
    citationCount: paper.citationCount,
    source: paper.source
  }))
}, null, 2));
