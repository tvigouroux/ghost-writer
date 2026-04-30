/**
 * Summarizer mode — runs once per session at first room-open. Reads the full
 * curated context (post denylist filtering) and produces a compact JSON
 * summary that the interviewer turn loop can use in place of re-sending
 * hundreds of KB of raw markdown on every call.
 *
 * Output shape (validated tolerantly at parse time):
 *   {
 *     "block_summaries": {
 *       "<block_id>": {
 *         "coverage_in_context": "covered" | "partial" | "absent",
 *         "key_facts": string[],
 *         "open_threads": string[]
 *       }
 *     },
 *     "general_notes": string[],
 *     "interviewee_specific_notes": string[]
 *   }
 *
 * Why this shape:
 * - block_summaries is keyed by block_id so the interviewer can decide per-
 *   block whether to advance, deepen, or open fresh.
 * - key_facts and open_threads are bullet arrays (not prose) to keep the
 *   interviewer prompt small and easy to scan.
 * - general_notes and interviewee_specific_notes carry context that doesn't
 *   fit a specific block (rules of the project, sensitivities about the
 *   interviewee).
 */

export interface SummarizerInput {
  bookLanguage: string;
  bookLanguageLabel: string;
  bookClaudeMd: string;
  templateName: string;
  templateSystemPrompt: string;
  intervieweeName: string;
  intervieweeRelation: string | null;
  blocks: { id: string; title: string; objective: string; mustCover: boolean }[];
  contextFiles: { path: string; content: string }[];
}

export interface ContextSummary {
  block_summaries: Record<
    string,
    {
      coverage_in_context: "covered" | "partial" | "absent";
      key_facts: string[];
      open_threads: string[];
    }
  >;
  general_notes: string[];
  interviewee_specific_notes: string[];
}

export function buildSummarizerSystemPrompt(input: {
  bookLanguage: string;
  bookLanguageLabel: string;
}): string {
  return `You are reading a book's working materials and distilling them into
a compact JSON summary for use by an interviewer agent. The summary will be
fed to the interviewer on every turn instead of the raw materials, so it
must capture what the interviewer needs and nothing else.

LANGUAGE
The "key_facts", "open_threads", "general_notes", and
"interviewee_specific_notes" string values MUST be written in
${input.bookLanguageLabel} (BCP-47 ${input.bookLanguage}). JSON keys remain
in English exactly as specified.

OUTPUT FORMAT (strict)
Return ONE JSON object and nothing else. No prose before, no prose after,
no code fences. The object has this exact shape:

{
  "block_summaries": {
    "<block_id>": {
      "coverage_in_context": "covered" | "partial" | "absent",
      "key_facts": ["bullet conciso", "..."],
      "open_threads": ["pregunta no resuelta de la sesión previa", "..."]
    }
  },
  "general_notes": ["regla del libro relevante para conducir la entrevista"],
  "interviewee_specific_notes": ["nota relevante sobre este entrevistado puntual"]
}

RULES
- One block_summaries entry per block_id from the input. No other keys.
- coverage_in_context: "covered" if the curated context already provides
  substantive material on this block's objective; "partial" if some material
  exists but real gaps remain; "absent" if nothing relevant.
- key_facts: short concrete bullets (one fact per bullet). Quote the
  interviewee verbatim only when the wording matters; otherwise paraphrase
  briefly. Aim for at most 6 bullets per block.
- open_threads: explicit unresolved questions or contradictions the
  interviewer should pick up. Empty array if none. Aim for at most 3 per
  block.
- general_notes: project-level rules from CLAUDE.md that should shape every
  question (tone, what's off-limits, must-not-prescribe, etc.). Empty array
  if none.
- interviewee_specific_notes: anything in the materials about this specific
  interviewee that affects how to talk to them. Empty array if none.
- Never invent. If the context is silent on a block, say "absent" with
  empty bullet arrays.
- Do not echo the raw materials. Compress aggressively. The whole JSON
  should be on the order of a few KB, not the size of the input.`;
}

export function buildSummarizerUserPrompt(input: SummarizerInput): string {
  const ctx =
    input.contextFiles.length > 0
      ? input.contextFiles.map((f) => `### ${f.path}\n${f.content}`).join("\n\n")
      : "(no curated context files)";

  const blocks = input.blocks
    .map(
      (b) => `- ${b.id}${b.mustCover ? " must_cover" : ""} | ${b.title} | ${b.objective}`,
    )
    .join("\n");

  return `## Book rules (CLAUDE.md)

${input.bookClaudeMd}

## Template metadata

- Template name: ${input.templateName}
- Template-specific rules: ${input.templateSystemPrompt}
- Interviewee: ${input.intervieweeName}${input.intervieweeRelation ? ` (${input.intervieweeRelation})` : ""}

## Blocks of the upcoming interview

${blocks}

## Curated context

${ctx}

## Task

Produce the JSON summary described in the system prompt. Strictly one block
entry per block_id above, in the same order.`;
}
