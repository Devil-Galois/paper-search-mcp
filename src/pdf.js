import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import pdfParse from "pdf-parse";
import { getCacheDir } from "./cache.js";

export async function readPdf({ pdfPath, url, maxChars = 24000 }) {
  const resolvedPath = pdfPath ? path.resolve(pdfPath) : await downloadPdf(url);
  const data = await readFile(resolvedPath);
  const parsed = await pdfParse(data);
  const text = normalizeText(parsed.text || "");
  return {
    pdfPath: resolvedPath,
    pageCount: parsed.numpages,
    textLength: text.length,
    truncated: text.length > maxChars,
    sections: extractSections(text, maxChars),
    note: text ? undefined : "PDF parsed, but no reliable text was extracted."
  };
}

async function downloadPdf(url) {
  if (!url) throw new Error("Either pdfPath or url is required.");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`PDF download failed: ${response.status} ${response.statusText}`);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("pdf")) {
    throw new Error(`URL did not return a PDF content-type: ${contentType || "unknown"}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const dir = path.join(getCacheDir(), "pdfs");
  await mkdir(dir, { recursive: true });
  const fileName = safeName(url) || `paper-${Date.now()}.pdf`;
  const outPath = path.join(dir, fileName.endsWith(".pdf") ? fileName : `${fileName}.pdf`);
  await writeFile(outPath, bytes);
  return outPath;
}

function extractSections(text, maxChars) {
  const sectionNames = [
    "abstract",
    "introduction",
    "background",
    "method",
    "methodology",
    "approach",
    "implementation",
    "experiment",
    "evaluation",
    "results",
    "discussion",
    "conclusion",
    "references"
  ];
  const lower = text.toLowerCase();
  const sections = {};
  for (const name of sectionNames) {
    const index = lower.search(new RegExp(`(^|\\n)\\s*(\\d+(\\.\\d+)*\\s+)?${name}s?\\s*(\\n|$)`, "i"));
    if (index < 0) continue;
    sections[name] = text.slice(index, findNextSection(text, index + name.length)).trim().slice(0, Math.floor(maxChars / 4));
  }
  if (!Object.keys(sections).length) {
    sections.preview = text.slice(0, maxChars);
  }
  return sections;
}

function findNextSection(text, start) {
  const rest = text.slice(start);
  const match = rest.match(/\n\s*(\d+(\.\d+)*\s+)?[A-Z][A-Za-z ]{3,60}\s*\n/);
  return match?.index ? start + match.index : text.length;
}

function normalizeText(text) {
  return text.replace(/\r/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function safeName(value) {
  try {
    const parsed = new URL(value);
    return path.basename(parsed.pathname).replace(/[^\w.-]/g, "_");
  } catch {
    return undefined;
  }
}
