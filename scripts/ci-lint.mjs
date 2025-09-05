
#!/usr/bin/env node
/**
 * Headless checker for Re:VIEW projects (no MCP client needed).
 * - Enforce allowlist tags
 * - Plan/apply ID fixes (optional via flag)
 * - Run fast lint (review-compile --target=latex)
 *
 * Usage:
 *   node scripts/ci-lint.mjs --cwd /path/to/book [--apply-ids]
 * Exit codes:
 *   0: ok
 *   1: violations found (unknown tags) or lint warnings
 *   2: usage error
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, copyFile } from "node:fs/promises";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import YAML from "yaml";

const execp = promisify(execFile);
const args = process.argv.slice(2);
const get = (k, dv=null) => {
  const i = args.indexOf(k);
  return i >= 0 ? (args[i+1] ?? null) : dv;
};
const has = (k) => args.includes(k);

if (!has("--cwd")) {
  console.error("Usage: node scripts/ci-lint.mjs --cwd <projectRoot> [--apply-ids]");
  process.exit(2);
}
const cwd = get("--cwd");
const applyIds = has("--apply-ids");

// Conservative allowlist (same as server MVP)
const ALLOW = {
  blocks: [
    "list","emlist","source","cmd","quote","image","figure","table",
    "note","memo","column","dialog","footnote","reviewlistblock"
  ],
  inline: [
    "href","code","tt","b","strong","em","i","u","m","rb","kw","key","sup","sub"
  ]
};

const RE_BLOCK_OPEN = /^\/\/([A-Za-z0-9_]+)(\[[^\]]*\])?\s*\{\s*$/;
const RE_INLINE_G = /@<([A-Za-z0-9_]+)>\{[^}]*\}/g;
const RE_BRACKET = /\[([^\]]*)\]/;
const RE_ID_KV = /(?:^|,\s*)id\s*=\s*("?)([^",\]]+)\1/;
const RE_CAPTION_ID = /\\review\w*caption\[(.*?)\]\{/;
const RE_INVALID_SLASH = /^([^\s:]+):(\d+):\s+`\/\/'\s+seen.*?:\s+"(.+)"$/i;
const RE_DUP_ID = /warning:\s+duplicate ID:/i;

function allowSets() {
  return { B: new Set(ALLOW.blocks), I: new Set(ALLOW.inline) };
}

async function pickCatalogFiles(cwd) {
  const ctPath = path.join(cwd, "catalog.yml");
  const txt = await fs.readFile(ctPath, "utf-8");
  const y = YAML.parse(txt);
  const out = [];
  for (const sec of ["PREDEF","CHAPS","APPENDIX"]) {
    if (Array.isArray(y?.[sec])) out.push(...y[sec]);
  }
  return out;
}

async function enforceTags(cwd, files) {
  const violations = [];
  const { B, I } = allowSets();
  for (const f of files) {
    const p = path.join(cwd, f);
    const text = await fs.readFile(p, "utf-8");
    const lines = text.split(/\r?\n/);
    for (let i=0;i<lines.length;i++) {
      const m = lines[i].match(RE_BLOCK_OPEN);
      if (m) {
        const name = m[1];
        if (!B.has(name)) {
          violations.push({ file: f, line: i+1, kind: "block", name, snippet: lines[i].trim() });
        }
      }
    }
    for (const m of text.matchAll(RE_INLINE_G)) {
      const name = m[1];
      if (!I.has(name)) {
        const idx = text.slice(0, m.index).split(/\r?\n/).length;
        violations.push({ file: f, line: idx, kind: "inline", name, snippet: m[0] });
      }
    }
  }
  return violations;
}

function isIdTargetBlock(name) {
  return new Set(["list","emlist","image","figure","table","source","cmd","quote"]).has(name);
}

async function gatherUsedIds(cwd, files) {
  const used = new Set();
  for (const f of files) {
    const txt = await fs.readFile(path.join(cwd, f), "utf-8");
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
    for (const m of txt.matchAll(RE_CAPTION_ID)) {
      const id = (m[1] || "").trim();
      if (id) used.add(id);
    }
  }
  return used;
}

function slugifyBase(filename) {
  const base = path.basename(filename, path.extname(filename));
  return base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function planFixIdsForFile(file, text, used) {
  const fixes = [];
  const lines = text.split(/\r?\n/);
  const prefix = slugifyBase(file);

  const mkId = (base) => {
    let n = 1, cand = `${base}-${String(n).padStart(3,"0")}`;
    while (used.has(cand)) { n++; cand = `${base}-${String(n).padStart(3,"0")}`; }
    used.add(cand);
    return cand;
  };

  for (let i=0;i<lines.length;i++) {
    const m = lines[i].match(RE_BLOCK_OPEN);
    if (!m) continue;
    const name = m[1];
    const bracket = m[2] ?? "";
    if (!isIdTargetBlock(name)) continue;

    let idVal = null;
    if (bracket) {
      const b = bracket.match(RE_BRACKET);
      if (b) {
        const attrs = b[1];
        const kv = attrs.match(RE_ID_KV);
        idVal = kv ? kv[2].trim() : null;
      }
    }
    if (!idVal || idVal === "") {
      const cand = mkId(`${prefix}-${name}`);
      const before = lines[i];
      let after;
      if (bracket) {
        after = before.replace(RE_BRACKET, (_all, inner) => {
          const sep = String(inner).trim().length ? `${inner}, id=${cand}` : `id=${cand}`;
          return `[${sep}]`;
        });
      } else {
        after = before.replace(/^\/\/([A-Za-z0-9_]+)/, `//$1[id=${cand}]`);
      }
      fixes.push({ file, lineStart: i+1, before, after, reason: "empty" });
    } else if (used.has(idVal)) {
      const cand = mkId(`${prefix}-${name}`);
      const before = lines[i];
      const after = before.replace(RE_ID_KV, (_a, q) => `${q ? `id=${q}${cand}${q}` : `id=${cand}`}`);
      fixes.push({ file, lineStart: i+1, before, after, reason: "duplicate" });
    } else {
      used.add(idVal);
    }
  }

  for (let i=0;i<lines.length;i++) {
    const m = lines[i].match(RE_CAPTION_ID);
    if (!m) continue;
    const id = (m[1] || "").trim();
    if (!id || used.has(id)) {
      const cand = mkId(`${prefix}-cap`);
      const before = lines[i];
      const after = before.replace(RE_CAPTION_ID, (_all) => `\\reviewlistcaption[${cand}]{`);
      fixes.push({ file, lineStart: i+1, before, after, reason: id ? "duplicate" : "empty" });
    } else {
      used.add(id);
    }
  }
  return fixes;
}

async function applyFixes(cwd, fixes) {
  const byFile = new Map();
  for (const f of fixes) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
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
    await copyFile(full, full + ".bak");
    await writeFile(full, lines.join("\n"), "utf-8");
  }
  return applied;
}

async function withBundle(cwd, argv) {
  try {
    await execp("bundle", ["exec", "ruby", "-v"], { cwd, timeout: 8000 });
    return await execp("bundle", ["exec", ...argv], { cwd, timeout: 60000, maxBuffer: 10*1024*1024 });
  } catch {
    const [cmd, ...rest] = argv;
    return await execp(cmd, rest, { cwd, timeout: 60000, maxBuffer: 10*1024*1024 });
  }
}

function parseStderr(stderr, fallbackFile=null) {
  const out = [];
  for (const raw of stderr.split(/\r?\n/)) {
    const line = raw.replace(/^\s*⚠\s*WARN\s*/u, "").trim();
    const m = line.match(RE_INVALID_SLASH);
    if (m) {
      out.push({ file: m[1], line: Number(m[2]), severity: "warning", message: `Invalid block start '//': ${m[3]}` });
      continue;
    }
    if (RE_DUP_ID.test(line)) {
      out.push({ file: fallbackFile, line: null, severity: "warning", message: "Duplicate/empty ID detected" });
    }
  }
  return out;
}

(async () => {
  try {
    const files = await pickCatalogFiles(cwd);

    // 1) unknown tags
    const violations = await enforceTags(cwd, files);
    if (violations.length) {
      console.error("Unknown tags detected:");
      for (const v of violations) {
        console.error(`  ${v.file}:${v.line} [${v.kind}] ${v.name} :: ${v.snippet}`);
      }
    }

    // 2) ids plan/apply
    const used = await gatherUsedIds(cwd, files);
    const plan = [];
    for (const f of files) {
      const txt = await fs.readFile(path.join(cwd, f), "utf-8");
      plan.push(...planFixIdsForFile(f, txt, used));
    }
    if (plan.length) {
      console.error(`ID issues found: ${plan.length} fixes planned.`);
      if (applyIds) {
        const count = await applyFixes(cwd, plan);
        console.error(`Applied: ${count} fixes.`);
      } else {
        for (const p of plan.slice(0, 20)) {
          console.error(`  ${p.file}:${p.lineStart} (${p.reason}) -> ${p.after}`);
        }
        if (plan.length > 20) console.error(`  ...(and ${plan.length-20} more)`);
      }
    }

    // 3) fast lint
    const diagnostics = [];
    for (const f of files) {
      try {
        await withBundle(cwd, ["review-compile", "--target=latex", "--footnotetext", f]);
      } catch (e) {
        const stderr = e?.stderr || e?.message || "";
        diagnostics.push(...parseStderr(stderr, f));
      }
    }
    if (diagnostics.length) {
      console.error("Lint warnings:");
      for (const d of diagnostics) {
        console.error(`  ${d.file ?? "(unknown)"}:${d.line ?? "-"} ${d.message}`);
      }
    }

    const failed = (violations.length > 0) || (diagnostics.length > 0);
    process.exit(failed ? 1 : 0);
  } catch (e) {
    console.error(String(e?.stack || e));
    process.exit(2);
  }
})();
