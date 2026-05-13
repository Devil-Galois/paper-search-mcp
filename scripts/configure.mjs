#!/usr/bin/env node
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const homeDir = path.resolve(args.home || process.env.HOME || process.env.USERPROFILE || ".");
const cacheDir = path.resolve(args.cacheDir || path.join(homeDir, ".paper-search-mcp", "cache"));
const apps = new Set((args.apps || "claude,codex").split(",").map((item) => item.trim()).filter(Boolean));
const manager = args.manager || "cc-switch";
const dryRun = Boolean(args.dryRun);
const applyCcSwitch = Boolean(args.applyCcSwitch);
const withPlaywright = args.withPlaywright !== "false";
const chromeProfile = args.chromeProfile ? path.resolve(args.chromeProfile) : undefined;
const ccSwitchDb = path.resolve(args.ccSwitchDb || path.join(homeDir, ".cc-switch", "cc-switch.db"));
const sqliteCommand = args.sqlite || "sqlite3";

const paperServer = {
  type: "stdio",
  command: "node",
  args: [path.join(projectDir, "src", "server.js")],
  env: {
    PAPER_SEARCH_CACHE_DIR: cacheDir
  }
};

const playwrightServer = {
  type: "stdio",
  command: "npx",
  args: [
    "@playwright/mcp@latest",
    "--browser=chrome",
    ...(chromeProfile ? ["--user-data-dir", chromeProfile] : [])
  ],
  env: {}
};

const plan = {
  homeDir,
  projectDir,
  manager,
  dryRun,
  applyCcSwitch,
  apps: [...apps],
  ccSwitchDb,
  servers: {
    "paper-search-mcp": paperServer,
    ...(withPlaywright ? { playwright: playwrightServer } : {})
  }
};

if (manager === "direct") {
  if (apps.has("claude")) await configureClaude(plan);
  if (apps.has("codex")) await configureCodex(plan);
  console.log(JSON.stringify({ ok: true, ...plan, nextSteps: directNextSteps(plan) }, null, 2));
} else if (manager === "cc-switch") {
  let ccSwitchWrite = undefined;
  if (applyCcSwitch) {
    ccSwitchWrite = await configureCcSwitch(plan);
  }
  console.log(JSON.stringify({ ok: true, ...plan, ccSwitchWrite, ccSwitch: ccSwitchPlan(plan), nextSteps: ccSwitchNextSteps(plan) }, null, 2));
} else {
  throw new Error("Unsupported manager. Use --manager cc-switch or --manager direct.");
}

async function configureCcSwitch({ apps, servers, ccSwitchDb, dryRun }) {
  const rows = Object.entries(servers).map(([name, server]) => ({
    id: name,
    name,
    server_config: JSON.stringify(server),
    description: descriptionForServer(name),
    tags: JSON.stringify(["research", "mcp"]),
    enabled_claude: apps.includes("claude") ? 1 : 0,
    enabled_codex: apps.includes("codex") ? 1 : 0,
    enabled_gemini: apps.includes("gemini") ? 1 : 0,
    enabled_opencode: apps.includes("opencode") ? 1 : 0,
    enabled_hermes: apps.includes("hermes") ? 1 : 0
  }));
  const sql = renderCcSwitchUpsertSql(rows);

  if (dryRun) {
    return {
      dryRun: true,
      db: ccSwitchDb,
      servers: rows.map(({ id, name, enabled_claude, enabled_codex, enabled_gemini, enabled_opencode, enabled_hermes }) => ({
        id,
        name,
        enabled_claude,
        enabled_codex,
        enabled_gemini,
        enabled_opencode,
        enabled_hermes
      }))
    };
  }

  const backupPath = `${ccSwitchDb}.${timestamp()}.bak`;
  await copyFile(ccSwitchDb, backupPath);
  await runSqlite(sqliteCommand, ccSwitchDb, sql);
  return {
    dryRun: false,
    db: ccSwitchDb,
    backupPath,
    servers: rows.map(({ id, name }) => ({ id, name }))
  };
}

async function configureClaude({ homeDir, servers, dryRun }) {
  const claudePath = path.join(homeDir, ".claude.json");
  const config = await readJsonOrDefault(claudePath, {});
  config.mcpServers = {
    ...(config.mcpServers || {}),
    ...servers
  };
  if (!dryRun) {
    await mkdir(path.dirname(claudePath), { recursive: true });
    await writeFile(claudePath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  }
}

async function configureCodex({ homeDir, servers, dryRun }) {
  const codexDir = path.join(homeDir, ".codex");
  const configPath = path.join(codexDir, "config.toml");
  const existing = await readTextOrDefault(configPath, "");
  const stripped = stripManagedMcp(existing);
  const block = renderCodexMcp(servers);
  if (!dryRun) {
    await mkdir(codexDir, { recursive: true });
    await writeFile(configPath, `${stripped.trimEnd()}\n\n${block}`, "utf8");
  }
}

function renderCodexMcp(servers) {
  const lines = ["# MCP servers managed by paper-search-mcp configure script."];
  for (const [name, server] of Object.entries(servers)) {
    lines.push(`[mcp_servers.${name}]`);
    lines.push(`command = ${tomlString(server.command)}`);
    lines.push(`args = [${server.args.map(tomlString).join(", ")}]`);
    const env = server.env || {};
    if (Object.keys(env).length) {
      lines.push(`[mcp_servers.${name}.env]`);
      for (const [key, value] of Object.entries(env)) lines.push(`${key} = ${tomlString(value)}`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function renderClaudeMcp(servers) {
  return {
    mcpServers: servers
  };
}

function ccSwitchPlan({ apps, servers }) {
  return {
    preferred: true,
    reason: "Use cc-switch as the single MCP source of truth, then sync to selected clients.",
    apps,
    servers,
    claudeSnippet: renderClaudeMcp(servers),
    codexSnippet: renderCodexMcp(servers)
  };
}

function ccSwitchNextSteps({ apps }) {
  return [
    "Default mode prints a cc-switch plan without writing cc-switch.db.",
    "To write cc-switch.db automatically, rerun with --apply-cc-switch after reviewing the printed servers.",
    `Enable sync for: ${apps.join(", ")}.`,
    "Apply or sync from cc-switch, then restart the affected client if that client requires it.",
    "Use --manager direct only when cc-switch is not part of your setup or you intentionally want per-client config files."
  ];
}

function directNextSteps({ apps }) {
  return [
    `Direct config mode wrote or previewed entries for: ${apps.join(", ")}.`,
    "Use this mode only when cc-switch is not the source of truth.",
    "If you later adopt cc-switch, import the current client config into cc-switch and manage MCP servers there."
  ];
}

function stripManagedMcp(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let skip = false;
  for (const line of lines) {
    if (/^\s*# MCP servers managed by paper-search-mcp configure script\./.test(line)) {
      skip = true;
      continue;
    }
    if (/^\s*\[mcp_servers[.\]]/.test(line)) {
      skip = true;
      continue;
    }
    if (skip && /^\s*\[/.test(line) && !/^\s*\[mcp_servers[.\]]/.test(line)) {
      skip = false;
    }
    if (!skip) out.push(line);
  }
  return out.join("\n");
}

async function readJsonOrDefault(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function readTextOrDefault(file, fallback) {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = camelCase(arg.slice(2));
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

function camelCase(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function tomlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function descriptionForServer(name) {
  if (name === "paper-search-mcp") return "Paper search, reference expansion, PDF download, and PDF text extraction MCP server.";
  if (name === "playwright") return "Browser automation companion MCP for login-gated pages and authenticated PDF cookie extraction.";
  return "";
}

function renderCcSwitchUpsertSql(rows) {
  const statements = rows.map((row) => `
INSERT INTO mcp_servers (
  id, name, server_config, description, homepage, docs, tags,
  enabled_claude, enabled_codex, enabled_gemini, enabled_opencode, enabled_hermes
) VALUES (
  ${sqlString(row.id)}, ${sqlString(row.name)}, ${sqlString(row.server_config)}, ${sqlString(row.description)},
  NULL, NULL, ${sqlString(row.tags)},
  ${row.enabled_claude}, ${row.enabled_codex}, ${row.enabled_gemini}, ${row.enabled_opencode}, ${row.enabled_hermes}
)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  server_config = excluded.server_config,
  description = excluded.description,
  tags = excluded.tags,
  enabled_claude = excluded.enabled_claude,
  enabled_codex = excluded.enabled_codex,
  enabled_gemini = excluded.enabled_gemini,
  enabled_opencode = excluded.enabled_opencode,
  enabled_hermes = excluded.enabled_hermes;`);
  return `BEGIN;\n${statements.join("\n")}\nCOMMIT;\n`;
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function runSqlite(command, dbPath, sql) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [dbPath], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`sqlite3 exited with ${code}: ${stderr || stdout}`));
    });
    child.stdin.end(sql);
  });
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
}
