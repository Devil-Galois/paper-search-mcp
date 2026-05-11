const DEFAULT_FIELDS = [
  "paperId",
  "title",
  "abstract",
  "year",
  "venue",
  "authors",
  "citationCount",
  "referenceCount",
  "externalIds",
  "url",
  "openAccessPdf"
].join(",");

const DETAIL_FIELDS = [
  DEFAULT_FIELDS,
  "references.paperId",
  "references.title",
  "references.abstract",
  "references.year",
  "references.venue",
  "references.authors",
  "references.citationCount",
  "references.referenceCount",
  "references.externalIds",
  "references.url",
  "references.openAccessPdf"
].join(",");

export async function searchAll({ query, maxResults = 10, yearFrom, yearTo, venue, sources = ["semantic_scholar", "openalex", "crossref", "ieee"] }) {
  const wanted = new Set(sources);
  const jobs = [];
  if (wanted.has("semantic_scholar")) jobs.push(withSource("semantic_scholar", () => searchSemanticScholar({ query, maxResults, yearFrom, yearTo, venue })));
  if (wanted.has("openalex")) jobs.push(withSource("openalex", () => searchOpenAlex({ query, maxResults, yearFrom, yearTo, venue })));
  if (wanted.has("crossref")) jobs.push(withSource("crossref", () => searchCrossref({ query, maxResults, yearFrom, yearTo, venue })));
  if (wanted.has("ieee")) jobs.push(withSource("ieee", () => searchIeee({ query, maxResults, yearFrom, yearTo })));

  const settled = await Promise.allSettled(jobs);
  const errors = [];
  const papers = [];
  for (const result of settled) {
    if (result.status === "fulfilled") {
      papers.push(...result.value.papers);
      if (result.value.error) errors.push(result.value.error);
    } else {
      errors.push({ source: "unknown", message: result.reason?.message || String(result.reason) });
    }
  }
  return { papers: dedupePapers(papers).slice(0, maxResults), errors };
}

export async function getPaper(identifier) {
  const candidates = [];
  const paper = await getSemanticScholarPaper(identifier).catch(() => null);
  if (paper) candidates.push(paper);
  const openAlex = await getOpenAlexWork(identifier).catch(() => null);
  if (openAlex) candidates.push(openAlex);
  if (looksLikeDoi(identifier)) {
    const crossref = await getCrossrefWork(identifier).catch(() => null);
    if (crossref) candidates.push(crossref);
  }
  return candidates.length ? dedupePapers(candidates)[0] : null;
}

export async function getSemanticScholarPaper(identifier) {
  const id = looksLikeDoi(identifier) ? `DOI:${identifier}` : identifier;
  const url = `https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(id)}?fields=${encodeURIComponent(DETAIL_FIELDS)}`;
  const response = await fetchJson(url, semanticHeaders());
  if (!response || response.error) return null;
  return normalizeSemanticPaper(response, "semantic_scholar");
}

async function searchSemanticScholar({ query, maxResults, yearFrom, yearTo, venue }) {
  const params = new URLSearchParams({
    query,
    limit: String(Math.min(maxResults, 100)),
    fields: DEFAULT_FIELDS
  });
  if (yearFrom || yearTo) params.set("year", `${yearFrom || ""}-${yearTo || ""}`);
  if (venue) params.set("venue", venue);
  const response = await fetchJson(`https://api.semanticscholar.org/graph/v1/paper/search?${params}`, semanticHeaders());
  return (response?.data || []).map((paper) => normalizeSemanticPaper(paper, "semantic_scholar"));
}

async function searchOpenAlex({ query, maxResults, yearFrom, yearTo, venue }) {
  const filterParts = [];
  if (yearFrom) filterParts.push(`from_publication_date:${yearFrom}-01-01`);
  if (yearTo) filterParts.push(`to_publication_date:${yearTo}-12-31`);
  const venueSourceIds = venue ? await resolveOpenAlexSourceIds(venue) : [];
  if (venueSourceIds.length) filterParts.push(`primary_location.source.id:${venueSourceIds.join("|")}`);
  const params = new URLSearchParams({
    search: query,
    per_page: String(Math.min(maxResults, 100))
  });
  if (filterParts.length) params.set("filter", filterParts.join(","));
  const response = await fetchJson(`https://api.openalex.org/works?${params}`);
  return (response?.results || [])
    .map((work) => normalizeOpenAlexWork(work))
    .filter((paper) => venueSourceIds.length || venueMatches(paper.venue, venue));
}

async function resolveOpenAlexSourceIds(venue) {
  const terms = splitVenueTerms(venue);
  const ids = [];
  for (const term of terms) {
    const aliases = venueAliases(term);
    for (const alias of aliases) {
      const params = new URLSearchParams({ search: alias, per_page: "5" });
      const response = await fetchJson(`https://api.openalex.org/sources?${params}`).catch(() => null);
      const matches = (response?.results || []).filter((source) => sourceMatchesVenue(source, term, alias));
      const selected = matches.length ? matches : (response?.results || []).slice(0, 1);
      for (const source of selected) {
        if (source?.id) ids.push(source.id);
      }
      if (selected.length) break;
    }
  }
  return [...new Set(ids)];
}

async function getOpenAlexWork(identifier) {
  let id;
  if (looksLikeDoi(identifier)) {
    id = `https://doi.org/${identifier.toLowerCase()}`;
  } else if (/^https:\/\/openalex\.org\/W\d+$/i.test(identifier)) {
    id = identifier;
  } else if (/^W\d+$/i.test(identifier)) {
    id = identifier;
  } else {
    return null;
  }
  const response = await fetchJson(`https://api.openalex.org/works/${encodeURIComponent(id)}`);
  return response?.id ? normalizeOpenAlexWork(response) : null;
}

async function searchCrossref({ query, maxResults, yearFrom, yearTo, venue }) {
  const filters = [];
  if (yearFrom) filters.push(`from-pub-date:${yearFrom}`);
  if (yearTo) filters.push(`until-pub-date:${yearTo}`);
  const params = new URLSearchParams({
    query,
    rows: String(Math.min(maxResults, 100))
  });
  if (filters.length) params.set("filter", filters.join(","));
  const response = await fetchJson(`https://api.crossref.org/works?${params}`);
  return (response?.message?.items || [])
    .map((work) => normalizeCrossrefWork(work))
    .filter((paper) => venueMatches(paper.venue, venue));
}

async function getCrossrefWork(doi) {
  const response = await fetchJson(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
  return response?.message ? normalizeCrossrefWork(response.message) : null;
}

async function searchIeee({ query, maxResults, yearFrom, yearTo }) {
  const apiKey = process.env.IEEE_API_KEY;
  if (!apiKey) return [];
  const params = new URLSearchParams({
    apikey: apiKey,
    querytext: query,
    max_records: String(Math.min(maxResults, 200)),
    start_record: "1",
    sort_order: "desc",
    sort_field: "article_number"
  });
  if (yearFrom) params.set("start_year", String(yearFrom));
  if (yearTo) params.set("end_year", String(yearTo));
  const response = await fetchJson(`https://ieeexploreapi.ieee.org/api/v1/search/articles?${params}`);
  return (response?.articles || []).map(normalizeIeeeArticle);
}

async function withSource(source, fn) {
  try {
    return { source, papers: await fn() };
  } catch (error) {
    return { source, papers: [], error: { source, message: error.message } };
  }
}

async function fetchJson(url, headers = {}) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${response.status} ${response.statusText}: ${body.slice(0, 200)}`);
  }
  return response.json();
}

function semanticHeaders() {
  return process.env.SEMANTIC_SCHOLAR_API_KEY
    ? { "x-api-key": process.env.SEMANTIC_SCHOLAR_API_KEY }
    : {};
}

export function normalizeSemanticPaper(paper, source) {
  const externalIds = paper.externalIds || {};
  return {
    paperId: paper.paperId,
    title: paper.title,
    authors: (paper.authors || []).map((author) => author.name).filter(Boolean),
    year: paper.year,
    venue: paper.venue || undefined,
    doi: externalIds.DOI,
    url: paper.url,
    abstract: paper.abstract || undefined,
    citationCount: paper.citationCount,
    referenceCount: paper.referenceCount,
    references: (paper.references || []).map((ref) => normalizeSemanticPaper(ref, source)).filter((ref) => ref.title),
    pdfPath: undefined,
    openAccessPdf: paper.openAccessPdf?.url,
    externalIds,
    source: [source]
  };
}

function normalizeOpenAlexWork(work) {
  const doi = work.doi?.replace(/^https:\/\/doi.org\//i, "");
  const referencedWorks = work.referenced_works || [];
  return {
    openAlexId: work.id,
    title: work.title,
    authors: (work.authorships || []).map((item) => item.author?.display_name).filter(Boolean),
    year: work.publication_year,
    venue: work.primary_location?.source?.display_name || work.host_venue?.display_name,
    doi,
    url: work.primary_location?.landing_page_url || work.id,
    abstract: invertOpenAlexAbstract(work.abstract_inverted_index),
    citationCount: work.cited_by_count,
    referenceCount: work.referenced_works_count,
    references: referencedWorks.map((openAlexId) => ({
      openAlexId,
      title: undefined,
      authors: [],
      url: openAlexId,
      references: [],
      externalIds: { OpenAlex: openAlexId },
      source: ["openalex_reference"]
    })),
    openAccessPdf: work.open_access?.oa_url || work.primary_location?.pdf_url,
    externalIds: { DOI: doi, OpenAlex: work.id },
    source: ["openalex"]
  };
}

function normalizeCrossrefWork(work) {
  const year = work.issued?.["date-parts"]?.[0]?.[0] || work.published?.["date-parts"]?.[0]?.[0];
  const authors = (work.author || []).map((author) => [author.given, author.family].filter(Boolean).join(" ")).filter(Boolean);
  return {
    title: work.title?.[0],
    authors,
    year,
    venue: work["container-title"]?.[0],
    doi: work.DOI,
    url: work.URL,
    abstract: stripTags(work.abstract),
    citationCount: work["is-referenced-by-count"],
    referenceCount: work.reference?.length,
    references: (work.reference || []).slice(0, 100).map((ref) => ({
      title: ref["article-title"],
      authors: ref.author ? [ref.author] : [],
      year: Number(ref.year) || undefined,
      venue: ref["journal-title"],
      doi: ref.DOI,
      url: ref.DOI ? `https://doi.org/${ref.DOI}` : undefined,
      referenceCount: undefined,
      references: [],
      externalIds: { DOI: ref.DOI },
      source: ["crossref_reference"]
    })).filter((ref) => ref.title || ref.doi),
    externalIds: { DOI: work.DOI },
    source: ["crossref"]
  };
}

function normalizeIeeeArticle(article) {
  return {
    title: article.title,
    authors: (article.authors?.authors || []).map((author) => author.full_name).filter(Boolean),
    year: Number(article.publication_year) || undefined,
    venue: article.publication_title,
    doi: article.doi,
    url: article.html_url || article.pdf_url,
    abstract: stripTags(article.abstract),
    citationCount: article.citing_paper_count,
    referenceCount: undefined,
    references: [],
    openAccessPdf: article.pdf_url,
    externalIds: { DOI: article.doi, IEEE: article.article_number },
    source: ["ieee"]
  };
}

export function dedupePapers(papers) {
  const byKey = new Map();
  for (const paper of papers.filter((item) => item?.title || item?.doi || item?.paperId)) {
    const key = paper.doi?.toLowerCase() || paper.paperId || paper.title?.toLowerCase().replace(/\s+/g, " ").trim();
    const previous = byKey.get(key);
    if (!previous) {
      byKey.set(key, paper);
      continue;
    }
    byKey.set(key, mergePaper(previous, paper));
  }
  return [...byKey.values()].sort((a, b) => (b.citationCount || 0) - (a.citationCount || 0));
}

function mergePaper(a, b) {
  return {
    ...a,
    ...b,
    abstract: a.abstract || b.abstract,
    authors: a.authors?.length ? a.authors : b.authors,
    citationCount: Math.max(a.citationCount || 0, b.citationCount || 0),
    references: a.references?.length ? a.references : b.references,
    source: [...new Set([...(a.source || []), ...(b.source || [])])]
  };
}

function looksLikeDoi(value) {
  return /^10\.\d{4,9}\//i.test(value || "");
}

function splitVenueTerms(venue) {
  return (venue || "")
    .split("|")
    .map((value) => value.trim())
    .filter(Boolean);
}

function venueMatches(actual, requested) {
  const terms = splitVenueTerms(requested);
  if (!terms.length) return true;
  const normalizedActual = normalizeVenueText(actual);
  return terms.some((term) => normalizeVenueText(term).split(/\s+/).every((token) => normalizedActual.includes(token)));
}

function venueAliases(term) {
  const normalized = normalizeVenueText(term);
  const aliases = [term];
  const aliasMap = [
    [/^jssc$|journal of solid state circuits/, "IEEE Journal of Solid-State Circuits"],
    [/^isscc$|solid state circuits conference/, "IEEE International Solid-State Circuits Conference"],
    [/^cicc$|custom integrated circuits conference/, "IEEE Custom Integrated Circuits Conference"],
    [/^tcas\b|transactions on circuits and systems/, "IEEE Transactions on Circuits and Systems"],
    [/^vlsi$|vlsi circuits/, "Symposium on VLSI Circuits"],
    [/^a sscc$|asian solid state circuits conference/, "IEEE Asian Solid-State Circuits Conference"],
    [/^esscirc$|european solid state circuits conference/, "European Solid-State Circuits Conference"]
  ];
  for (const [pattern, alias] of aliasMap) {
    if (pattern.test(normalized) && !aliases.includes(alias)) aliases.push(alias);
  }
  return aliases;
}

function sourceMatchesVenue(source, term, alias) {
  const haystack = normalizeVenueText([
    source.display_name,
    source.abbreviated_title,
    ...(source.alternate_titles || []),
    ...(source.alternate_titles_abbreviations || [])
  ].filter(Boolean).join(" "));
  const candidates = [term, alias].map(normalizeVenueText).filter(Boolean);
  return candidates.some((candidate) => candidate.split(/\s+/).every((token) => haystack.includes(token)));
}

function normalizeVenueText(value) {
  return (value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function invertOpenAlexAbstract(index) {
  if (!index) return undefined;
  const words = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const position of positions) words[position] = word;
  }
  return words.join(" ");
}

function stripTags(value) {
  return value ? value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : undefined;
}
