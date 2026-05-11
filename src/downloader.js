import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export async function downloadWithCookies({ pdfUrl, outputDir = "./papers", cookies = [], fileName, referer, userAgent }) {
  if (!pdfUrl) throw new Error("pdfUrl is required.");
  const url = new URL(pdfUrl);
  await mkdir(outputDir, { recursive: true });

  const response = await fetch(pdfUrl, {
    redirect: "follow",
    headers: {
      Cookie: cookieHeaderForUrl(cookies, url),
      Referer: referer || `${url.origin}/`,
      "User-Agent": userAgent || defaultUserAgent()
    }
  });
  if (!response.ok) {
    throw new Error(`PDF download failed: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("pdf")) {
    const preview = await response.text().catch(() => "");
    throw new Error(`URL did not return a PDF content-type: ${contentType || "unknown"}. Body preview: ${preview.slice(0, 200)}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const outPath = path.resolve(outputDir, safeFileName(fileName || responseFileName(response) || urlFileName(url) || `paper-${Date.now()}.pdf`));
  await writeFile(outPath, bytes);
  return {
    pdfPath: outPath,
    size: bytes.length,
    contentType,
    finalUrl: response.url
  };
}

function cookieHeaderForUrl(cookies, url) {
  return (cookies || [])
    .filter((cookie) => cookie?.name && cookieApplies(cookie, url))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

function cookieApplies(cookie, url) {
  const host = url.hostname.toLowerCase();
  const domain = (cookie.domain || host).replace(/^\./, "").toLowerCase();
  const pathPrefix = cookie.path || "/";
  return (host === domain || host.endsWith(`.${domain}`)) && url.pathname.startsWith(pathPrefix);
}

function responseFileName(response) {
  const disposition = response.headers.get("content-disposition") || "";
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match) return decodeURIComponent(utf8Match[1]);
  const asciiMatch = disposition.match(/filename="?([^";]+)"?/i);
  return asciiMatch?.[1];
}

function urlFileName(url) {
  const arnumber = url.searchParams.get("arnumber");
  if (arnumber) return `${arnumber}.pdf`;
  const base = path.basename(url.pathname);
  return base && base !== "/" ? base : undefined;
}

function safeFileName(name) {
  const cleaned = name.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").replace(/\s+/g, "-");
  return cleaned.toLowerCase().endsWith(".pdf") ? cleaned : `${cleaned}.pdf`;
}

function defaultUserAgent() {
  return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";
}
