import { Server, Tool } from "@modelcontextprotocol/sdk";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import YAML from "yaml";

const execp = promisify(execFile);

type Allow = { blocks: string[], inline: string[] };

// --- Minimal conservative allowlist (works as a starting point) ---
const BUILTIN_ALLOW: Allow = {
  blocks: [
    "list","emlist","source","cmd","quote","image","figure","table",
    "note","memo","column","dialog","footnote","reviewlistblock"
  ],
  inline: [
    "href","code","tt","b","strong","em","i","u","m","rb","kw","key","sup","sub"
  ]
};

type Config = {
  profile?: "review-5.8"|"review-2.5"|"dual",
  target?: "latex"|"html"|"idgxml",
  blockOnUnknownTags?: boolean,
  autoFixIdsOnSave?: boolean
};

async function loadConfig(cwd: string): Promise<Config> {
  const p = path.join(cwd, "review-mcp.json");
  try {
    const raw = await readFile(p, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { profile: "dual", target: "latex", blockOnUnknownTags: true, autoFixIdsOnSave: true };
  }
}

async function withBundle(cwd: string, argv: string[]) {
  try {
    // If Bundler works, prefer bundle exec to respect project Gemfile
    await execp("bundle", ["exec", "ruby", "-v"], { cwd, timeout: 8000 });
    return await execp("bundle", ["exec", ...argv], { cwd, timeout: 60000, maxBuffer: 10*1024*1024 });
  } catch {
    // Fallback to direct command
    const [cmd, ...rest] = argv;
    return await execp(cmd, rest, { cwd, timeout: 60000, maxBuffer: 10*1024*1024 });
  }
}

function slugifyBase(filename: string): string {
  const base = path.basename(filename, path.extname(filename));
  return base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Regex helpers
const RE_BLOCK_OPEN = /^\/\/([A-Za-z0-9_]+)(\[[^\]]*\])?\s*\{\s*$/;
const RE_BLOCK_OPEN_G = /^\/\/([A-Za-z0-9_]+)(\[[^\]]*\])?\s*\{\s*$/m;
const RE_BLOCK_CLOSE = /^\/\/\}\s*$/;
const RE_INLINE_G = /@<([A-Za-z0-9_]+)>\{[^}]*\}/g;
const RE_BRACKET = /\[([^\]]*)\]/;
const RE_ID_KV = /(?:^|,\s*)id\s*=\s*("?)([^",\]]+)\1/;
const RE_CAPTION_ID = /\\review\w*caption\[(.*?)\]\{/;

function isIdTargetBlock(name: string) {
  return new Set(["list","emlist","image","figure","table","source","cmd","quote"]).has(name);
}

function pickFilesFromCatalog(cwd: string, catalogPath="catalog.yml"): Promise<string[]> {
  return fs.readFile(path.join(cwd, catalogPath), "utf-8")
    .then(txt => {
      const y = YAML.parse(txt);
      const sections = ["PREDEF","CHAPS","APPENDIX"];
      const files: string[] = [];
      for (const sec of sections) {
        if (Array.isArray(y?.[sec])) files.push(...y[sec]);
      }
      return files;
    });
}

function* scanTags(file: string, text: string, allow: Allow) {
  const allowB = new Set(allow.blocks);
  const allowI = new Set(allow.inline);
  const lines = text.split(/\r?\n/);

  for (let i=0;i<lines.length;i++) {
    const m = lines[i].match(RE_BLOCK_OPEN);
    if (m) {
      const name = m[1];
      if (!allowB.has(name)) {
        yield { file, line: i+1, kind: "block", name, snippet: lines[i].trim() };
      }
    }
  }
  for (const m of text.matchAll(RE_INLINE_G)) {
    const name = m[1];
    if (!allowI.has(name)) {
      const idx = text.slice(0, m.index!).split(/\r?\n/).length;
      yield { file, line: idx, kind: "inline", name, snippet: m[0] };
    }
  }
}

async function gatherUsedIds(cwd: string, files: string[]) {
  const used = new Set<string>();
  for (const f of files) {
    const txt = await fs.readFile(path.join(cwd, f), "utf-8");
    // blocks
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(RE_BLOCK_OPEN);
      if (!m) continue;
      const bracket = m[2] ?? "";
      if (bracket) {
        const b = bracket.match(RE_BRACKET);
        if (b) {
          const attrs = b[1];
          const kv = attrs.match(RE_ID_KV);
          if (kv) used.add(kv[2].trim());
        }
      }
    }
    // captions
    for (const m of txt.matchAll(RE_CAPTION_ID)) {
      const id = (m[1] || "").trim();
      if (id) used.add(id);
    }
  }
  return used;
}

function planFixIdsForFile(file: string, text: string, usedIds: Set<string>, prefixBase: string) {
  const fixes: any[] = [];
  const lines = text.split(/\r?\n/);

  for (let i=0;i<lines.length;i++) {
    const m = lines[i].match(RE_BLOCK_OPEN);
    if (!m) continue;
    const name = m[1];
    const bracket = m[2] ?? "";
    if (!isIdTargetBlock(name)) continue;

    let idVal: string | null = null;
    if (bracket) {
      const b = bracket.match(RE_BRACKET);
      if (b) {
        const attrs = b[1];
        const kv = attrs.match(RE_ID_KV);
        idVal = kv ? kv[2].trim() : null;
      }
    }

    const mkId = (base: string) => {
      let n = 1, cand = `${base}-${String(n).padStart(3,"0")}`;
      while (usedIds.has(cand)) { n++; cand = `${base}-${String(n).padStart(3,"0")}`; }
      usedIds.add(cand);
      return cand;
    };

    if (!idVal || idVal === "") {
      const cand = mkId(`${prefixBase}-${name}`);
      const before = lines[i];
      let after: string;
      if (bracket) {
        after = before.replace(RE_BRACKET, (_all, inner) => {
          const sep = String(inner).trim().length ? `${inner}, id=${cand}` : `id=${cand}`;
          return `[${sep}]`;
        });
      } else {
        after = before.replace(/^\/\/([A-Za-z0-9_]+)/, `//$1[id=${cand}]`);
      }
      fixes.push({ file, lineStart: i+1, lineEnd: i+1, before, after, reason: "empty" });
    } else if (usedIds.has(idVal)) {
      const cand = mkId(`${prefixBase}-${name}`);
      const before = lines[i];
      const after = before.replace(RE_ID_KV, (_a, q) => `${q ? `id=${q}${cand}${q}` : `id=${cand}`}`);
      fixes.push({ file, lineStart: i+1, lineEnd: i+1, before, after, reason: "duplicate" });
    } else {
      usedIds.add(idVal);
    }
  }

  // captions
  for (let i=0;i<lines.length;i++) {
    const m = lines[i].match(RE_CAPTION_ID);
    if (!m) continue;
    const id = (m[1] || "").trim();
    const mkId = (base: string) => {
      let n = 1, cand = `${base}-${String(n).padStart(3,"0")}`;
      while (usedIds.has(cand)) { n++; cand = `${base}-${String(n).padStart(3,"0")}`; }
      usedIds.add(cand);
      return cand;
    };
    if (!id || usedIds.has(id)) {
      const cand = mkId(`${prefixBase}-cap`);
      const before = lines[i];
      const after = before.replace(RE_CAPTION_ID, (_all) => `\\reviewlistcaption[${cand}]{`);
      fixes.push({ file, lineStart: i+1, lineEnd: i+1, before, after, reason: id ? "duplicate" : "empty" });
    } else {
      usedIds.add(id);
    }
  }
  return fixes;
}

async function applyFixes(cwd: string, fixes: any[]) {
  const byFile = new Map<string, any[]>();
  for (const f of fixes) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file)!.push(f);
  }
  let applied = 0;
  for (const [file, list] of byFile) {
    const full = path.join(cwd, file);
    const txt = await fs.readFile(full, "utf-8");
    const lines = txt.split(/\r?\n/);
    for (const f of list.sort((a,b)=>b.lineStart-a.lineStart)) {
      lines[f.lineStart-1] = f.after;
      applied++;
    }
    await fs.copyFile(full, full + ".bak");
    await fs.writeFile(full, lines.join("\n"), "utf-8");
  }
  return applied;
}

const server = new Server({ name: "review-mcp", version: "0.1.0" });

server.tool(new Tool({
  name: "review.version",
  description: "Return Re:VIEW CLI version (prefers bundle exec).",
  inputSchema: { type: "object", properties: { cwd: { type: "string" } }, required: ["cwd"] },
  handler: async ({ cwd }) => {
    const { stdout } = await withBundle(cwd, ["review", "--version"]);
    return { version: stdout.trim() };
  }
}));

server.tool(new Tool({
  name: "review.tags.list",
  description: "Return allowed tags (built-in conservative list; replace with dynamic probe later).",
  inputSchema: { type: "object", properties: { cwd: { type: "string" }, profile: { type: "string" } }, required: ["cwd"] },
  handler: async ({ cwd }) => {
    // TODO: add dynamic probe & cache per profile/version/target
    return { blocks: BUILTIN_ALLOW.blocks, inline: BUILTIN_ALLOW.inline, meta: { source: "builtin" } };
  }
}));

server.tool(new Tool({
  name: "review.enforceTags.check",
  description: "Scan .re files for unknown tags using allowlist; returns violations.",
  inputSchema: { type: "object",
    properties: { cwd: { type: "string" }, allow: { type: "object" } },
    required: ["cwd"]
  },
  handler: async ({ cwd, allow }) => {
    const cfg = await loadConfig(cwd);
    const files = await pickFilesFromCatalog(cwd);
    const a: Allow = allow ?? BUILTIN_ALLOW;
    const violations: any[] = [];
    for (const f of files) {
      const p = path.join(cwd, f);
      try {
        const txt = await fs.readFile(p, "utf-8");
        for (const v of scanTags(f, txt, a)) violations.push(v);
      } catch (e) {
        violations.push({ file: f, error: String(e) });
      }
    }
    return { profile: cfg.profile, violations };
  }
}));

server.tool(new Tool({
  name: "review.fixIds.plan",
  description: "Plan auto-fixes for empty/duplicate IDs across all .re files.",
  inputSchema: { type: "object", properties: { cwd: { type: "string" } }, required: ["cwd"] },
  handler: async ({ cwd }) => {
    const files = await pickFilesFromCatalog(cwd);
    const used = await gatherUsedIds(cwd, files);
    const fixes: any[] = [];
    for (const f of files) {
      const p = path.join(cwd, f);
      const txt = await fs.readFile(p, "utf-8");
      const prefix = slugifyBase(f);
      const plan = planFixIdsForFile(f, txt, used, prefix);
      fixes.push(...plan);
    }
    return { count: fixes.length, fixes };
  }
}));

server.tool(new Tool({
  name: "review.fixIds.apply",
  description: "Apply a previously calculated ID-fix plan; creates .bak backups.",
  inputSchema: {
    type: "object",
    properties: { cwd: { type: "string" }, fixes: { type: "array", items: { type: "object" } } },
    required: ["cwd","fixes"]
  },
  handler: async ({ cwd, fixes }) => {
    const applied = await applyFixes(cwd, fixes);
    return { applied };
  }
}));

server.tool(new Tool({
  name: "review.lint",
  description: "Run a fast sanity check by compiling each .re to latex and parsing stderr warnings.",
  inputSchema: { type: "object", properties: { cwd: { type: "string" } }, required: ["cwd"] },
  handler: async ({ cwd }) => {
    const files = await pickFilesFromCatalog(cwd);
    const diagnostics: any[] = [];
    for (const f of files) {
      try {
        await withBundle(cwd, ["review-compile", "--target=latex", "--footnotetext", f]);
      } catch (e: any) {
        const stderr = e?.stderr || e?.message || "";
        diagnostics.push(...parseStderr(stderr, f));
        continue;
      }
    }
    return { diagnostics };
  }
}));

function parseStderr(stderr: string, fallbackFile?: string) {
  const diags: any[] = [];
  const lines = stderr.split(/\r?\n/);
  const reInvalid = /^([^\s:]+):(\d+):\s+`\/\/'\s+seen.*?:\s+"(.+)"$/; // 09_xx.re:42: `//' seen ...
  const reDupId = /warning:\s+duplicate ID:/i;

  for (let raw of lines) {
    const line = raw.replace(/^\p{So}|^\s*⚠\s*WARN\s*/u, "").trim();
    const m = line.match(reInvalid);
    if (m) {
      diags.push({ file: m[1], line: Number(m[2]), severity: "warning", message: `Invalid block start '//': ${m[3]}` });
      continue;
    }
    if (reDupId.test(line)) {
      diags.push({ file: fallbackFile ?? null, line: null, severity: "warning", message: "Duplicate/empty ID detected" });
    }
  }
  return diags;
}

server.start();
console.log("[review-mcp] Minimal MCP server started.");
