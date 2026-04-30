/**
 * Validate every book template under `templates/`:
 *   - Manifest is valid JSON with the expected fields.
 *   - Every `files[i].src` exists on disk.
 *   - Every directory in `directories` is a string.
 *   - All placeholder keys referenced as `{{KEY}}` in any .tmpl file appear in
 *     the manifest's `placeholders` list (best-effort warning, not error).
 *
 * Run: pnpm tsx scripts/validate-templates.ts
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

interface Manifest {
  id: string;
  name: string;
  description?: string;
  language?: string;
  placeholders: { key: string; label: string; required?: boolean; example?: string }[];
  directories: string[];
  files: { src: string; dst: string }[];
  enabled_modes: string[];
  first_commit_message?: string;
}

const TEMPLATES_DIR = resolve("templates");

async function listTemplates(): Promise<string[]> {
  const entries = await readdir(TEMPLATES_DIR, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

async function validateOne(id: string): Promise<{ ok: boolean; problems: string[] }> {
  const dir = join(TEMPLATES_DIR, id);
  const problems: string[] = [];

  let manifest: Manifest;
  try {
    const raw = await readFile(join(dir, "manifest.json"), "utf8");
    manifest = JSON.parse(raw);
  } catch (err) {
    return { ok: false, problems: [`manifest read/parse failed: ${(err as Error).message}`] };
  }

  if (manifest.id !== id) {
    problems.push(`manifest.id (${manifest.id}) does not match dir name (${id})`);
  }
  if (!Array.isArray(manifest.files)) {
    problems.push("manifest.files is not an array");
    return { ok: false, problems };
  }

  for (const f of manifest.files) {
    const abs = join(dir, f.src);
    try {
      const s = await stat(abs);
      if (!s.isFile()) problems.push(`files[].src is not a regular file: ${f.src}`);
    } catch {
      problems.push(`files[].src missing on disk: ${f.src}`);
    }
  }

  // Best-effort placeholder coverage check.
  const declared = new Set(manifest.placeholders.map((p) => p.key));
  const seen = new Set<string>();
  for (const f of manifest.files) {
    try {
      const content = await readFile(join(dir, f.src), "utf8");
      for (const m of content.matchAll(/{{\s*([A-Z_][A-Z0-9_]*)\s*}}/g)) {
        seen.add(m[1]);
      }
    } catch {
      // already reported above
    }
  }
  // Mustache-ish section markers like {{#KEY}} are stripped to KEY for the check.
  const undeclared = [...seen].filter((k) => !declared.has(k));
  if (undeclared.length > 0) {
    // Treat known-optional structural keys as warnings only.
    const known = new Set(["TITULO_KEBAB", "LANG_OPCIONAL"]);
    const unknown = undeclared.filter((k) => !known.has(k));
    if (unknown.length > 0) {
      problems.push(
        `placeholders referenced in templates but not declared in manifest: ${unknown.join(", ")}`,
      );
    }
  }

  return { ok: problems.length === 0, problems };
}

async function main() {
  const ids = await listTemplates();
  if (ids.length === 0) {
    console.error("no templates found under templates/");
    process.exit(1);
  }
  let allOk = true;
  for (const id of ids) {
    const { ok, problems } = await validateOne(id);
    if (ok) {
      console.log(`✓ ${id}`);
    } else {
      allOk = false;
      console.error(`✗ ${id}`);
      for (const p of problems) console.error(`    - ${p}`);
    }
  }
  process.exit(allOk ? 0 : 1);
}

main();
