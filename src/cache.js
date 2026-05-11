import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";

const cacheDir = process.env.PAPER_SEARCH_CACHE_DIR
  ? path.resolve(process.env.PAPER_SEARCH_CACHE_DIR)
  : path.resolve(process.cwd(), ".cache");

const cacheJsonPath = path.join(cacheDir, "papers.json");
const eventsPath = path.join(cacheDir, "events.jsonl");

let loaded = false;
let cache = {
  papers: {},
  queries: {}
};

export function getCacheDir() {
  return cacheDir;
}

export async function loadCache() {
  if (loaded) return cache;
  await mkdir(cacheDir, { recursive: true });
  try {
    const raw = await readFile(cacheJsonPath, "utf8");
    cache = JSON.parse(raw);
    cache.papers ||= {};
    cache.queries ||= {};
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  loaded = true;
  return cache;
}

export async function saveCache() {
  await mkdir(cacheDir, { recursive: true });
  await writeFile(cacheJsonPath, JSON.stringify(cache, null, 2), "utf8");
}

export async function recordEvent(type, payload) {
  await mkdir(cacheDir, { recursive: true });
  const event = {
    type,
    payload,
    at: new Date().toISOString()
  };
  await appendFile(eventsPath, `${JSON.stringify(event)}\n`, "utf8");
}

export function paperKey(paper) {
  const doi = paper?.doi || paper?.externalIds?.DOI;
  if (doi) return `doi:${doi.toLowerCase()}`;
  if (paper?.paperId) return `s2:${paper.paperId}`;
  if (paper?.openAlexId) return `openalex:${paper.openAlexId}`;
  if (paper?.title) return `title:${paper.title.toLowerCase().replace(/\s+/g, " ").trim()}`;
  return null;
}

export async function upsertPapers(papers, sourceTag) {
  await loadCache();
  const stored = [];
  for (const paper of papers.filter(Boolean)) {
    const key = paperKey(paper);
    if (!key) continue;
    const previous = cache.papers[key] || {};
    const merged = {
      ...previous,
      ...paper,
      source: unique([...(previous.source || []), ...(paper.source || []), sourceTag].filter(Boolean)),
      updatedAt: new Date().toISOString()
    };
    cache.papers[key] = merged;
    stored.push(merged);
  }
  await saveCache();
  return stored;
}

export async function cacheQuery(queryKey, papers) {
  await loadCache();
  cache.queries[queryKey] = {
    paperKeys: papers.map(paperKey).filter(Boolean),
    updatedAt: new Date().toISOString()
  };
  await saveCache();
}

export async function findCachedPaper(identifier) {
  await loadCache();
  if (!identifier) return null;
  const normalized = identifier.toLowerCase();
  for (const [key, paper] of Object.entries(cache.papers)) {
    if (key.toLowerCase() === normalized) return paper;
    if (paper.paperId?.toLowerCase() === normalized) return paper;
    if (paper.doi?.toLowerCase() === normalized) return paper;
    if (paper.title?.toLowerCase() === normalized) return paper;
  }
  return null;
}

function unique(values) {
  return [...new Set(values)];
}
