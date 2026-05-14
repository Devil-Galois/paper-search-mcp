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
const verifySync = Boolean(args.verifySync);
const repairClientConfigs = Boolean(args.repairClientConfigs || args.fixJsonBom);
const withPlaywright = args.withPlaywright !== "false";
const configureStatePath = path.join(projectDir, ".cache", "configure-state.json");
const previousState = await readJsonLenientOrDefault(configureStatePath, {});
const chromeProfile = args.chromeProfile
  ? path.resolve(args.chromeProfile)
  : previousState.chromeProfile;
const ccSwitchDb = path.resolve(args.ccSwitchDb || path.join(homeDir, ".cc-switch", "cc-switch.db"));
const sqliteCommand = args.sqlite || "sqlite3";
const ccSwitchSyncCommand = args.ccSwitchSyncCommand;

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
  verifySync,
  repairClientConfigs,
  apps: [...apps],
  ccSwitchDb,
  chromeProfile,
  configureStatePath,
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
  let repair = undefined;
  if (repairClientConfigs) {
    repair = await repairClientConfigFiles(plan);
  }
  let ccSwitchWrite = undefined;
  let ccSwitchSync = undefined;
  if (applyCcSwitch) {
    ccSwitchWrite = await configureCcSwitch(plan);
    if (!dryRun) {
      await writeConfigureState(plan);
    }
    if (ccSwitchSyncCommand && !dryRun) {
      ccSwitchSync = await runShellCommand(ccSwitchSyncCommand);
    }
  }
  const syncStatus = (verifySync || applyCcSwitch || repairClientConfigs) ? await verifyConfig(plan) : undefined;
  console.log(JSON.stringify({ ok: true, ...plan, repair, ccSwitchWrite, ccSwitchSync, syncStatus, ccSwitch: ccSwitchPlan(plan), nextSteps: ccSwitchNextSteps(plan) }, null, 2));
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

async function writeConfigureState({ configureStatePath, chromeProfile, cacheDir, apps, servers }) {
  await mkdir(path.dirname(configureStatePath), { recursive: true });
  await writeFile(configureStatePath, `${JSON.stringify({
    updatedAt: new Date().toISOString(),
    chromeProfile,
    cacheDir,
    apps,
    servers: Object.keys(servers)
  }, null, 2)}\n`, "utf8");
}

async function repairClientConfigFiles({ homeDir, dryRun }) {
  const claudePath = path.join(homeDir, ".claude.json");
  const claudeBefore = await inspectJsonFile(claudePath);
  const result = {
    claude: {
      path: claudePath,
      before: fileRepairSummary(claudeBefore),
      changed: false
    }
  };

  if (!claudeBefore.exists) {
    result.claude.skipped = "file missing";
    return result;
  }
  if (!claudeBefore.hasBom) {
    result.claude.skipped = "no UTF-8 BOM detected";
    return result;
  }

  const backupPath = `${claudePath}.${timestamp()}.bom.bak`;
  result.claude.backupPath = backupPath;

  if (!dryRun) {
    await copyFile(claudePath, backupPath);
    await writeFile(claudePath, claudeBefore.bytes.subarray(3));
  }

  const claudeAfter = dryRun
    ? inspectJsonBytes(claudeBefore.bytes.subarray(3), claudePath)
    : await inspectJsonFile(claudePath);
  result.claude.after = fileRepairSummary(claudeAfter);
  result.claude.changed = !dryRun;
  return result;
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
    "After review, --apply-cc-switch writes only the cc-switch source of truth.",
    "It does not directly write Claude Code or Codex config unless cc-switch itself syncs them.",
    "If your cc-switch build has a CLI sync command, pass it with --cc-switch-sync-command.",
    `Enable and sync these clients in cc-switch: ${apps.join(", ")}.`,
    "Run npm run verify:config to distinguish source-updated from client-synced state.",
    "If .claude.json reports hasBom=true or validJson=false, run npm run repair:configs before syncing clients.",
    "Restart the affected client or open a new session after sync; existing sessions may not hot-load MCP changes.",
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

async function verifyConfig({ homeDir, ccSwitchDb, apps, servers }) {
  const serverNames = Object.keys(servers);
  const ccSwitch = await verifyCcSwitchDb(ccSwitchDb, serverNames);
  const claude = await verifyClaudeConfig(path.join(homeDir, ".claude.json"), serverNames);
  const codex = await verifyCodexConfig(path.join(homeDir, ".codex", "config.toml"), serverNames);
  const wantsClaude = apps.includes("claude");
  const wantsCodex = apps.includes("codex");
  const sourceReady = serverNames.every((name) => {
    const row = ccSwitch.servers[name];
    return row?.present && (!wantsClaude || row.enabled_claude === 1) && (!wantsCodex || row.enabled_codex === 1);
  });
  const claudeSynced = !wantsClaude || serverNames.every((name) => claude.servers[name]?.present);
  const codexSynced = !wantsCodex || serverNames.every((name) => codex.servers[name]?.present);
  const warnings = [];

  if (!sourceReady) warnings.push("cc-switch DB is not ready for every requested MCP server/client.");
  if (wantsClaude && claude.status === "invalid") warnings.push("Claude Code config is invalid. Repair it before relying on cc-switch GUI sync.");
  if (wantsCodex && codex.status === "invalid") warnings.push("Codex config appears invalid. Repair it before relying on cc-switch GUI sync.");
  if (wantsClaude && claude.status === "missing") warnings.push("Claude Code config file is missing.");
  if (wantsCodex && codex.status === "missing") warnings.push("Codex config file is missing.");
  if (wantsClaude && claude.status === "valid-not-synced") warnings.push("Claude Code config is valid but MCP entries are not synced yet.");
  if (wantsCodex && codex.status === "valid-not-synced") warnings.push("Codex config is valid but MCP entries are not synced yet.");
  if (sourceReady && (!claudeSynced || !codexSynced)) {
    warnings.push("Source is updated, but target client config still needs cc-switch apply/sync and usually a client restart or new session.");
  }

  return {
    summary: {
      sourceReady,
      claudeSynced,
      codexSynced,
      fullySynced: sourceReady && claudeSynced && codexSynced
    },
    ccSwitch,
    clients: {
      claude,
      codex
    },
    warnings
  };
}

async function verifyCcSwitchDb(dbPath, serverNames) {
  const servers = Object.fromEntries(serverNames.map((name) => [name, { present: false }]));
  try {
    const quoted = serverNames.map(sqlString).join(", ");
    const sql = `SELECT id, name, enabled_claude, enabled_codex FROM mcp_servers WHERE id IN (${quoted}) OR name IN (${quoted}) ORDER BY id;`;
    const { stdout } = await runSqlite(sqliteCommand, dbPath, sql);
    for (const line of stdout.trim().split(/\r?\n/).filter(Boolean)) {
      const [id, name, enabledClaude, enabledCodex] = line.split("|");
      const key = serverNames.includes(id) ? id : name;
      if (!key || !servers[key]) continue;
      servers[key] = {
        present: true,
        id,
        name,
        enabled_claude: Number(enabledClaude),
        enabled_codex: Number(enabledCodex)
      };
    }
    return { db: dbPath, ok: true, servers };
  } catch (error) {
    return { db: dbPath, ok: false, error: error.message, servers };
  }
}

async function verifyClaudeConfig(configPath, serverNames) {
  const servers = Object.fromEntries(serverNames.map((name) => [name, { present: false }]));
  const inspection = await inspectJsonFile(configPath);
  const base = {
    path: configPath,
    exists: inspection.exists,
    validJson: inspection.validJson,
    hasBom: inspection.hasBom,
    firstBytes: inspection.firstBytes,
    parseError: inspection.parseError,
    suggestedFix: inspection.suggestedFix,
    servers
  };
  if (!inspection.exists) return { ...base, ok: false, status: "missing" };
  if (!inspection.validJson) return { ...base, ok: false, status: "invalid" };
  for (const name of serverNames) {
    servers[name] = { present: Boolean(inspection.value?.mcpServers?.[name]) };
  }
  const synced = serverNames.every((name) => servers[name].present);
  return { ...base, ok: true, status: synced ? "synced" : "valid-not-synced", servers };
}

async function verifyCodexConfig(configPath, serverNames) {
  const servers = Object.fromEntries(serverNames.map((name) => [name, { present: false }]));
  try {
    const text = await readFile(configPath, "utf8");
    const validation = validateCodexToml(text);
    for (const name of serverNames) {
      servers[name] = { present: new RegExp(`^\\s*\\[mcp_servers\\.${escapeRegExp(name)}\\]`, "m").test(text) };
    }
    if (!validation.validToml) {
      return { path: configPath, ok: false, status: "invalid", exists: true, validToml: false, parseError: validation.parseError, servers };
    }
    const synced = serverNames.every((name) => servers[name].present);
    return { path: configPath, ok: true, status: synced ? "synced" : "valid-not-synced", exists: true, validToml: true, servers };
  } catch (error) {
    if (error.code === "ENOENT") return { path: configPath, ok: false, status: "missing", exists: false, validToml: false, servers };
    return { path: configPath, ok: false, status: "invalid", exists: true, validToml: false, parseError: error.message, servers };
  }
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
    const text = await readFile(file, "utf8");
    return JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function readJsonLenientOrDefault(file, fallback) {
  try {
    const text = await readFile(file, "utf8");
    return JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    return fallback;
  }
}

async function inspectJsonFile(file) {
  try {
    const bytes = await readFile(file);
    return inspectJsonBytes(bytes, file);
  } catch (error) {
    if (error.code === "ENOENT") {
      return {
        path: file,
        exists: false,
        validJson: false,
        hasBom: false,
        firstBytes: [],
        parseError: "file missing",
        suggestedFix: "Create or sync the client config from cc-switch."
      };
    }
    return {
      path: file,
      exists: false,
      validJson: false,
      hasBom: false,
      firstBytes: [],
      parseError: error.message,
      suggestedFix: "Check file permissions and path."
    };
  }
}

function inspectJsonBytes(bytes, file) {
  const firstBytes = [...bytes.subarray(0, 3)];
  const hasBom = firstBytes[0] === 0xEF && firstBytes[1] === 0xBB && firstBytes[2] === 0xBF;
  const text = bytes.toString("utf8");
  try {
    const value = JSON.parse(text);
    return {
      path: file,
      exists: true,
      validJson: true,
      hasBom,
      firstBytes,
      parseError: null,
      suggestedFix: hasBom ? "Back up and rewrite as UTF-8 without BOM: npm run repair:configs" : null,
      value,
      bytes
    };
  } catch (error) {
    return {
      path: file,
      exists: true,
      validJson: false,
      hasBom,
      firstBytes,
      parseError: error.message,
      suggestedFix: hasBom
        ? "Back up and rewrite as UTF-8 without BOM: npm run repair:configs"
        : "Back up the file and repair the JSON syntax before syncing MCP entries.",
      bytes
    };
  }
}

function fileRepairSummary(inspection) {
  return {
    exists: inspection.exists,
    validJson: inspection.validJson,
    hasBom: inspection.hasBom,
    firstBytes: inspection.firstBytes,
    parseError: inspection.parseError,
    suggestedFix: inspection.suggestedFix
  };
}

function validateCodexToml(text) {
  const seenSections = new Set();
  const sectionPattern = /^\s*\[([^\]\r\n]+)\]\s*$/;
  const malformedSectionPattern = /^\s*\[[^\]\r\n]*$/;
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    if (malformedSectionPattern.test(line)) {
      return { validToml: false, parseError: `Malformed TOML section at line ${index + 1}.` };
    }
    const match = line.match(sectionPattern);
    if (!match) continue;
    if (seenSections.has(match[1])) {
      return { validToml: false, parseError: `Duplicate TOML section [${match[1]}] at line ${index + 1}.` };
    }
    seenSections.add(match[1]);
  }
  return { validToml: true };
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

function runShellCommand(command) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [], { shell: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      const result = { command, code, stdout: stdout.trim(), stderr: stderr.trim() };
      if (code === 0) resolve(result);
      else reject(new Error(`cc-switch sync command failed with ${code}: ${result.stderr || result.stdout}`));
    });
  });
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
