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
}

export function buildRendererSystemPrompt(input: {
  bookLanguage: string;
  bookLanguageLabel: string;
}): string {
  return `You are processing a finished interview into a polished markdown
transcript that will be deposited into the book's repository.

OUTPUT LANGUAGE
The processed transcript MUST be written in ${input.bookLanguageLabel}
(BCP-47 ${input.bookLanguage}). Use the natural register of that language
variant for prose. Section headings remain in the source language used by
the book repo conventions (Spanish for an es-language book) — those are
documented in the user prompt.

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

  return `## Book rules (CLAUDE.md of the book repo)

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
