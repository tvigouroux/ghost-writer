/**
 * Renderer mode — at session close, asks the model to compose a processed
 * `.md` transcript that mirrors the format of the reference book repo's
 * existing per-session response files (e.g. `entrevistas/tomas/NN-...-respuestas.md`).
 *
 * The model is given the full conversation history minus vetoed interviewee
 * turns, the block list with final coverage, and metadata about the session.
 * It returns a single markdown document (no JSON wrapper, no code fences).
 */

import type { BlockStatus, GuideBlock } from "./interviewer";

export interface RendererInput {
  bookLanguage: string;
  bookLanguageLabel: string;
  bookClaudeMd: string;
  templateName: string;
  intervieweeName: string;
  intervieweeRelation: string | null;
  blocks: GuideBlock[];
  blockCoverage: Record<string, BlockStatus>;
  /**
   * Conversation turns in order. Vetoed interviewee turns MUST still be
   * passed in (with `vetoed: true`) so the renderer knows what to exclude
   * from prose and list under "Vetos del entrevistado".
   */
  turns: {
    ordinal: number;
    role: "interviewer" | "interviewee";
    blockId: string | null;
    text: string;
    vetoed: boolean;
  }[];
  /** ISO date string in YYYY-MM-DD form. */
  sessionDate: string;
  closedBy: "agent" | "interviewee";
  sessionId: string;
  /**
   * Existing transcript at the destination path. When present, the renderer
   * is told to ENRICH this document with the current session's material
   * instead of producing a standalone transcript. This is the multi-session
   * accumulation path: each session adds to the same file.
   */
  existingTranscript?: string;
}

export function buildRendererSystemPrompt(input: {
  bookLanguage: string;
  bookLanguageLabel: string;
  hasExistingTranscript: boolean;
}): string {
  const enrichmentClause = input.hasExistingTranscript
    ? `

ENRICHMENT MODE (critical — read carefully)
The user prompt includes an "## Existing transcript" section. That document
is the cumulative transcript of PRIOR sessions for the same template /
interviewee. Your task is NOT to produce a standalone transcript of the
current session. Your task is to produce the **next version** of that
existing document, enriched with the material from the current session.

Hard rules for enrichment:

1. **Preserve everything.** Every paragraph, quote, "Pendientes detectados"
   item, and "<!-- FUENTES: -->" comment from the existing document MUST
   appear in your output, except where the current session resolves a gap
   that was previously listed as a pending item — in that case move the
   resolution into the appropriate Bloque section and remove the now-closed
   pending bullet.
2. **Add new material only where it belongs.** A new fact about Bloque 9
   gets appended to that section's prose. A new verbatim quote becomes a
   new blockquote inside the section, after the existing ones. Do not
   restructure or rewrite paragraphs that were already there.
3. **Update header metadata.** "Fecha de la sesión" should reflect the
   most recent session date. "Cobertura" reflects the cumulative coverage
   across all sessions, not just this one. "Estado" reflects the latest
   session's close type.
4. **Track the session timeline.** Either keep a small chronological note
   inside each Bloque marking which session contributed what (e.g.
   "[sesión 02c, 2026-04-30]" before a new paragraph), or maintain a
   small "## Línea de sesiones" section near the top listing each
   session that has contributed.
5. **The trailing "<!-- FUENTES: -->" comment** must list ALL sessions
   that have contributed, not just the current one. Format:
   "<!-- FUENTES: turns N-M de session <id1>; turns N-M de session
   <id2>; ... -->"
6. **Pendientes detectados** is rebuilt from scratch each time. List only
   what's still open AFTER this session. If the current session resolved
   a previously pending item, do NOT keep it in the list.
7. **Vetos del entrevistado** accumulates across sessions, indexed by
   "(sesión X) Turno Y" so the source is unambiguous.
8. **Never invent.** If the current session contributes nothing new to a
   block, leave that section as it was.

If the existing transcript is somehow malformed or unparseable, fall back
to producing a standalone transcript of the current session and add a
top-of-file warning comment.

`
    : "";

  return `You are processing a finished interview into a polished markdown
transcript that will be deposited into the book's repository.

OUTPUT LANGUAGE
The processed transcript MUST be written in ${input.bookLanguageLabel}
(BCP-47 ${input.bookLanguage}). Use the natural register of that language
variant for prose. Section headings remain in the source language used by
the book repo conventions (Spanish for an es-language book) — those are
documented in the user prompt.
${enrichmentClause}
OUTPUT FORMAT
Return ONE markdown document and nothing else. No JSON wrapper. No code
fences. No prefatory or trailing prose outside the document.

The document MUST follow this exact skeleton (Spanish headings are
expected by the book repo's convention; do not translate them):

# Entrevista — Respuestas: <título descriptivo, una frase>

**Entrevistado**: <nombre> (<relación, si aplica>)
**Fecha de la sesión**: YYYY-MM-DD
**Cobertura**: <bloques cubiertos> · <bloques parciales> · <bloques pendientes>
**Estado**: cerrado por <agente|entrevistado>

## Bloque <N> — <título del bloque>
Prose that synthesizes what the interviewee actually said in this block.
Preserve verbatim quotes as standalone blockquotes:

> "cita textual del entrevistado"

Do not paraphrase quotes. Do not invent details. If the block was only
partially covered, end with a single line:

[PARCIAL: <qué falta cubrir>]

If a must_cover block was never reached, still emit the section with:

[PENDIENTE: el bloque no se llegó a tocar]

## Pendientes detectados
A bullet list of concrete things the interviewee said that need follow-up
or that the author should resolve later. Empty list is fine; if nothing,
write "Ninguno." on a single line.

## Vetos del entrevistado
A bullet list of every interviewee turn marked vetoed=true, identified by
their ordinal number, with a one-line summary of the topic (NOT the
content). If there are no vetoes write "Ninguno." on a single line.

<!-- FUENTES: turns 1-<N> de session <session_id> -->

NON-NEGOTIABLE RULES
- Never invent facts the interviewee did not state.
- Never include the literal text of vetoed turns anywhere in the prose.
- Quotes are verbatim; everything else is paraphrase.
- Keep block order matching the template's order.
- No YAML frontmatter (the book repo's convention is plain markdown).
- No links, no images.
- The interviewee's words drive the prose. Do not editorialize, do not
  add a moral, do not soften.`;
}

export function buildRendererUserPrompt(input: RendererInput): string {
  const blocks = input.blocks
    .map((b) => {
      const cov = input.blockCoverage[b.id] ?? "pending";
      return `- id: ${b.id}\n  title: ${b.title}\n  must_cover: ${b.mustCover}\n  coverage: ${cov}`;
    })
    .join("\n");

  const conversation = input.turns
    .map((t) => {
      const who = t.role === "interviewer" ? "Interviewer" : "Interviewee";
      const veto = t.vetoed ? " [VETOED — exclude from prose]" : "";
      const blockTag = t.blockId ? ` (block=${t.blockId})` : "";
      return `${t.ordinal}. ${who}${blockTag}${veto}:\n${t.text}`;
    })
    .join("\n\n");

  const totalTurns = input.turns.length;

  const existing = input.existingTranscript
    ? `\n## Existing transcript (PRIOR sessions — preserve and enrich)\n\n${input.existingTranscript}\n\n## End of existing transcript\n`
    : "";

  return `${existing}## Book rules (CLAUDE.md of the book repo)

${input.bookClaudeMd}

## Session metadata

- Template name: ${input.templateName}
- Interviewee: ${input.intervieweeName}${input.intervieweeRelation ? ` (${input.intervieweeRelation})` : ""}
- Session id: ${input.sessionId}
- Session date: ${input.sessionDate}
- Closed by: ${input.closedBy}
- Total turns: ${totalTurns}

## Block list (in order)

${blocks}

## Final block coverage

${JSON.stringify(input.blockCoverage, null, 2)}

## Conversation history

${conversation}

## Task

Compose the processed transcript per the system prompt's skeleton. The
trailing HTML comment must be:
<!-- FUENTES: turns 1-${totalTurns} de session ${input.sessionId} -->`;
}
