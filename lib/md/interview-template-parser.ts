/**
 * Best-effort parser: a free-form interview guide written as Markdown into the
 * structured shape Ghost Writer's `interview_templates` table expects.
 *
 * The author's existing book repo uses freeform headers like:
 *
 *   # Entrevista 03 — Daniela
 *
 *   ## Objetivo
 *   ...
 *
 *   ## Estructura de la conversación
 *
 *   ## Bloque 1 — Cómo nos conocimos
 *   - ¿Te acordás cómo nos conocimos?
 *   - ¿Qué pensaste de mí esa primera vez?
 *
 *   ## Bloque 2 — Una escena memorable
 *   ...
 *
 * The parser is intentionally tolerant: it tries to extract block structure
 * but never throws. The author always reviews and edits the result before
 * saving.
 */

export interface ParsedInterviewTemplate {
  /** From the H1 title. Falls back to filename when missing. */
  name: string;
  /** Optional intro text (often the "Objetivo" section, lightly massaged). */
  introMd: string | null;
  /** Detected guide blocks. Always at least one entry. */
  guideBlocks: ParsedGuideBlock[];
  /** Notes about what the parser had to guess — surfaced in the UI. */
  warnings: string[];
}

export interface ParsedGuideBlock {
  id: string;
  title: string;
  objective: string;
  seedQuestions: string[];
  mustCover: boolean;
}

// Block headers may live at H2 (## Bloque 1 — ...) or H3
// (### Bloque 1 — ...) depending on how the author structured the file.
// Some files use a top-level "## Bloques de preguntas" wrapper with H3
// children; others put the blocks directly at H2.
const BLOCK_HEADER = /^(#{2,3})\s+(?:bloque\s+(\d+|[ivxlcdm]+)\s*[—:\-.]\s*(.+)|(\d+)\.\s*(.+))$/i;
const SECTION_HEADER = /^##\s+(.+)$/;
const LIST_ITEM = /^\s*(?:[-*•]|\d+\.|[a-z]\))\s+(.+)$/;
const OBJECTIVE_LABEL = /^\s*\*\*?(?:objetivo(?:\s+del\s+bloque)?|goal|aim)\*?\*?\s*:?\s*(.*)$/i;
const MUST_COVER_LABEL = /(must[-_\s]?cover|cobertura\s+m[ií]nima|obligatorio)/i;

export function parseInterviewMd(
  raw: string,
  fallbackName: string,
): ParsedInterviewTemplate {
  const warnings: string[] = [];
  const lines = raw.split(/\r?\n/);

  // Extract H1 title.
  const h1 = lines.find((l) => /^#\s+/.test(l));
  const name = h1 ? h1.replace(/^#\s+/, "").trim() : fallbackName;
  if (!h1) warnings.push("no H1 found, used filename as title");

  // Pass 1: find every block-header line (regardless of nesting level).
  type BlockHit = {
    lineIndex: number;
    numberToken: string;
    titleToken: string;
  };
  const blockHits: BlockHit[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(BLOCK_HEADER);
    if (m) {
      blockHits.push({
        lineIndex: i,
        numberToken: m[2] ?? m[4] ?? "",
        titleToken: (m[3] ?? m[5] ?? "").trim(),
      });
    }
  }

  // Pass 2: extract H2 sections (used to find a top-level "Objetivo" intro).
  type Section = { title: string; startLine: number; body: string[] };
  const sections: Section[] = [];
  let current: Section | null = null;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(SECTION_HEADER);
    if (m) {
      current = { title: m[1].trim(), startLine: i, body: [] };
      sections.push(current);
    } else if (current) {
      current.body.push(lines[i]);
    }
  }
  const introSection = sections.find((s) => /^objetivo\s*$/i.test(s.title));
  const introMd = introSection ? introSection.body.join("\n").trim() || null : null;

  const blocks: ParsedGuideBlock[] = [];
  if (blockHits.length === 0) {
    warnings.push(
      "no 'Bloque N — ...' headers detected; produced a single block from the document body",
    );
    blocks.push({
      id: "block-1",
      title: name,
      objective:
        lines
          .filter((l) => !/^#\s/.test(l))
          .join("\n")
          .trim()
          .slice(0, 1000) || "Conversación abierta sobre el tema del libro.",
      seedQuestions: extractListItems(lines.join("\n")).slice(0, 6),
      mustCover: true,
    });
  } else {
    for (let idx = 0; idx < blockHits.length; idx++) {
      const hit = blockHits[idx];
      const next = blockHits[idx + 1];
      const bodyLines = lines.slice(
        hit.lineIndex + 1,
        next ? next.lineIndex : lines.length,
      );
      const body = bodyLines.join("\n");
      const n = idx + 1;
      const id = `block-${slug(hit.numberToken || String(n))}`;
      const objective = extractObjective(body) || `Bloque ${n}`;
      const seedQuestions = extractListItems(body).slice(0, 8);
      const mustCover = MUST_COVER_LABEL.test(body) || true; // default true; author edits down
      blocks.push({
        id,
        title: hit.titleToken || `Bloque ${n}`,
        objective,
        seedQuestions,
        mustCover,
      });
    }
  }

  return { name, introMd, guideBlocks: blocks, warnings };
}

function extractObjective(body: string): string {
  // Look for an "**Objetivo**: ..." line first, then fall back to the first
  // non-list paragraph.
  const lines = body.split(/\r?\n/);
  for (const l of lines) {
    const m = l.match(OBJECTIVE_LABEL);
    if (m && m[1].trim()) return m[1].trim();
  }
  const firstParagraph: string[] = [];
  for (const l of lines) {
    if (/^\s*$/.test(l)) {
      if (firstParagraph.length) break;
      continue;
    }
    if (LIST_ITEM.test(l)) break;
    if (/^#{1,6}\s/.test(l)) break;
    firstParagraph.push(l.trim());
  }
  return firstParagraph.join(" ").trim();
}

function extractListItems(text: string): string[] {
  const out: string[] = [];
  for (const l of text.split(/\r?\n/)) {
    const m = l.match(LIST_ITEM);
    if (m) {
      const item = m[1].replace(/\*\*/g, "").trim();
      // Skip lines that are sub-headers in disguise like "Cobertura mínima:".
      if (/[:?]$/.test(item) && item.length < 40) continue;
      out.push(item);
    }
  }
  return out;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30) || "x";
}
