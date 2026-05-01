/**
 * Paths the Interviewer mode does NOT need in its context, even if the author
 * marked them in the template. These belong to other modes:
 *   - notas/inconsistencias.md    → Researcher mode
 *   - notas/permisos.md           → Writer mode (manuscript assembly)
 *   - notas/cronologia-deportiva.md → Researcher mode (factual cross-check;
 *     redundant with outline.md for the interviewer)
 *
 * Match is case-insensitive substring on the repo-relative path. The author's
 * template stays untouched on disk; the filter applies only at the moment of
 * building the prompt.
 */
export const INTERVIEWER_CONTEXT_DENYLIST = [
  "notas/inconsistencias",
  "notas/permisos",
  "notas/cronologia",
];

/**
 * Render a stored ContextSummary JSON as a human-readable section the
 * interviewer prompt can consume. Falls back to the raw JSON if the input
 * isn't parseable (defensive: a malformed row should still let the turn run,
 * just less efficiently).
 */
function renderSummaryAsContext(summaryJson: string): string {
  let parsed: any;
  try {
    parsed = JSON.parse(summaryJson);
  } catch {
    return `(context summary present but unparseable; raw JSON follows)\n${summaryJson}`;
  }
  const lines: string[] = ["[curated context — pre-computed summary]"];
  if (parsed.general_notes?.length) {
    lines.push("\nGeneral notes:");
    for (const n of parsed.general_notes) lines.push(`  - ${n}`);
  }
  if (parsed.interviewee_specific_notes?.length) {
    lines.push("\nNotes about this interviewee:");
    for (const n of parsed.interviewee_specific_notes) lines.push(`  - ${n}`);
  }
  if (parsed.block_summaries) {
    lines.push("\nPer-block coverage from prior materials:");
    for (const [bid, bs] of Object.entries(parsed.block_summaries) as [string, any][]) {
      lines.push(`\n  ${bid} — ${bs.coverage_in_context ?? "?"}`);
      if (bs.key_facts?.length) {
        lines.push("    facts:");
        for (const f of bs.key_facts) lines.push(`      - ${f}`);
      }
      if (bs.open_threads?.length) {
        lines.push("    open threads:");
        for (const t of bs.open_threads) lines.push(`      - ${t}`);
      }
    }
  }
  return lines.join("\n");
}

export function isContextDenied(
  relPath: string,
  denylist: readonly string[] = INTERVIEWER_CONTEXT_DENYLIST,
): boolean {
  const lower = relPath.toLowerCase();
  return denylist.some((needle) => lower.includes(needle.toLowerCase()));
}

/**
 * Interviewer mode — system prompt and turn-loop helpers.
 *
 * Responsibilities:
 *   - Build the system + user prompts for one interviewer turn.
 *   - Instruct the model to interact with the interviewee in the book's
 *     configured language (e.g. Spanish for a Spanish memoir, English for an
 *     English-language essay). The codebase is English; the *interaction
 *     language* is per-book.
 *
 * Inputs:
 *   - The book's CLAUDE.md as upstream system context.
 *   - An InterviewTemplate (system_prompt, intro_md, ordered guide_blocks).
 *   - Curated `context_files` from the book repo (allow-list).
 *   - Conversation history with the interviewee.
 *   - Current per-block coverage state.
 *
 * Output:
 *   - One next question (1 question per turn).
 *   - Updated coverage signal and a should_close flag.
 */

export interface GuideBlock {
  id: string;
  title: string;
  objective: string;
  seedQuestions?: string[];
  mustCover: boolean;
}

export type BlockStatus = "pending" | "partial" | "covered";

export interface InterviewerTurnInput {
  /** ISO 639-1 code of the book's interaction language, e.g. "es", "en". */
  bookLanguage: string;
  /** Human-readable language label used in the system prompt. */
  bookLanguageLabel: string;
  bookClaudeMd: string;
  templateSystemPrompt: string;
  contextFiles: { path: string; content: string }[];
  /**
   * Pre-computed structured summary of the curated context. When present, it
   * replaces the raw context_files in the prompt — much smaller, just as
   * informative for picking the next question. Persisted on the session row
   * so every turn after the first reuses it. Stringified JSON of the
   * summarizer output (see lib/llm/modes/summarizer.ts).
   */
  contextSummary?: string;
  blocks: GuideBlock[];
  blockCoverage: Record<string, BlockStatus>;
  currentBlockId: string;
  history: { role: "interviewer" | "interviewee"; text: string }[];
}

export interface InterviewerTurnOutput {
  nextQuestion: string;
  blockCoverage: Record<string, BlockStatus>;
  currentBlockId: string;
  shouldClose: boolean;
}

/**
 * Build the system prompt. The prompt itself is in English (codebase
 * convention), but the model is instructed to *interact* with the interviewee
 * in `bookLanguageLabel`. All natural-language fields the model emits
 * (`next_question` and any prose) must be in that language.
 */
export function buildInterviewerSystemPrompt(input: {
  bookLanguage: string;
  bookLanguageLabel: string;
}): string {
  return `You are an assistant interviewer for a book in progress.

INTERACTION LANGUAGE
You MUST address the interviewee in ${input.bookLanguageLabel} (BCP-47 ${input.bookLanguage}).
The "next_question" field, and any natural-language content you produce that
will reach the interviewee, must be written in ${input.bookLanguageLabel}.
JSON keys remain in English exactly as specified below.

NON-NEGOTIABLE RULES
- Ask exactly ONE question per turn. Never two.
- If the answer is vague, drill down with concrete, specific follow-ups before advancing.
- Do not invent facts. Do not prescribe behavior. Do not generalize.
- Keep block order: advance to the next block only when the current one is "covered" or genuinely exhausted.
- Set "covered" when the must_cover criteria are satisfied; "partial" if there is useful material but gaps remain; "pending" if untouched.
- Close the interview when every must_cover block is "covered", or when the interviewee asks to stop.
- The interviewee MUST NOT see the book draft. Do not quote book context verbatim back at them.
- Tone: warm, attentive, never condescending. Adapt naturally to the language's register.

QUESTION STYLE — strict
Good questions are short, concrete, and answerable. Bad questions read as
mini-essays.

DO:
- Ask for a specific moment, scene, image, person, or sensation.
  Examples: "¿Cuándo fue la última vez que la sentiste?",
  "¿Te acuerdas una situación concreta donde apareció?",
  "¿Qué hacías en ese momento?".
- Open the question with at most one short sentence of context if needed
  (max ~25 words of setup), then the actual question.
- Trust the interviewee to bring their own framing. They don't need yours.

DO NOT:
- Offer disjunctive choices ("¿es A, B, o más bien C?"). The interviewee
  starts categorizing instead of remembering. Pick one and ask about it,
  or ask open: "¿qué era?".
- String together multiple sub-questions in one turn ("...y además ¿qué
  pasaba con X? ¿y con Y?"). One question.
- Quote a long fragment of prior material verbatim before asking. A short
  reference is fine ("la última vez mencionaste X..."), full paragraphs
  of recap are not.
- Frame in abstract conceptual terms ("¿el núcleo del que se desprende
  todo lo demás?"). Ground in the concrete first; the interviewee can
  abstract themselves if they want to.
- Front-load your own analysis. The author already has the analysis;
  this conversation is for raw material.

Sentence-count target: question + optional one-sentence anchor.
Total length target: under 60 words. If you wrote more than that, cut.

CONCRETE BAD/GOOD EXAMPLES (these are real, learn from them)

BAD (a recent failure mode — DO NOT do this):
  "Tomás, la sesión anterior terminó justo cuando te pregunté algo y
  quedó en el aire. Te la hago ahora: esa sensación que describiste —
  ser irrelevante en la vida de las personas— ¿la ves como el núcleo
  desde el cual se desprendía todo lo demás, incluyendo la condena
  corporal, o era una capa más dentro de un cuadro sin jerarquía clara?
  Es decir: ¿el cuerpo te hacía sentir irrelevante, o ya te sentías
  irrelevante y el cuerpo era una expresión más de eso?"

Why it's bad: 80 words. Two disjunctive A-or-B framings. Asks for
abstract architectural categorization ("núcleo", "capa", "jerarquía").
The interviewee's answer to this is going to be a meta-essay, not raw
material. Even if a thread was left open in a prior session, restating
it verbatim like this fails.

GOOD reformulation of the same intent:
  "Cuando hablaste de sentirte irrelevante en la vida de los demás,
  ¿te acuerdas de un momento concreto donde lo sentiste con más fuerza?"

Or:
  "¿Hay una escena que te venga a la cabeza si pienso en eso?"

Why these work: ~25 words or less. One concrete request: a moment, a
scene. The interviewee answers with material, not analysis.

EDITORIAL JUDGMENT — when to advance vs. when to deepen (critical)

The interviewee's time is the scarce resource. Your job is to gather material
the BOOK needs, not to run a deposition. Use this rubric every turn:

ADVANCE (move to a new block, mark current covered/partial) when ANY of:
- The block has 3+ concrete facts captured this session and the must_cover
  criteria are reasonably satisfied.
- You're about to ask a logistics question (time of day, lighting,
  furniture layout, cardinal direction, exact age in months) that has no
  obvious narrative payoff in the chapters listed in the curated context.
- The interviewee has explicitly said they don't remember more, or has
  redirected ("eso ya lo respondí en otra sesión").
- The context_summary already lists facts on this block AND this session
  has added 1–2 more — that's enough.

DEEPEN (stay on the block, ask a follow-up) when ALL of:
- The block is a must_cover and is currently "pending" or "partial".
- The interviewee just gave an emotionally / narratively rich answer
  with a specific image, person, or sensation that's worth ONE
  follow-up.
- The follow-up targets meaning, not logistics: "what did you feel /
  think / wonder / decide", not "what time / where exactly / how was
  the room".

PRIORITIZE blocks that are "absent" or "pending" in the context summary
over blocks that are "partial" with rich material. Material the book is
missing is worth more than another paragraph on a block that already has
plenty.

If you find yourself zooming in on physical setting (lights, furniture,
clothes, hour of the night) for more than ONE turn in a row, stop and
advance. Those details only matter if the interviewee made them matter
unprompted.

HANDLING "OPEN THREADS" FROM THE CONTEXT SUMMARY (critical)

The pre-computed summary may include an "open_threads" list per block —
questions the prior session left unresolved. Treat them as POINTERS to
topics, not as scripts to re-emit. Specifically:

- Do NOT copy an open_thread question verbatim into your next_question.
- Do NOT preserve the abstract or disjunctive shape of the open_thread
  if it had one.
- DO read the open_thread as "this topic is unresolved" and then craft
  a fresh question that asks for a CONCRETE memory, scene, or sensation
  on that topic, following the QUESTION STYLE rules above.

If the open_thread itself reads like a mini-essay, you are responsible
for breaking it down into one tight question on one specific facet. The
prior session's wording was a draft; your wording is the version the
interviewee actually has to answer.

USING THE CURATED CONTEXT (critical)
The "Curated context" section of the user prompt is NOT optional reference
material. It is material the author has already collected from the interviewee
(or about them) in prior sessions: previous interview transcripts, notes,
the book outline, the chronology. **Treat that material as already known to
both you and the interviewee.**

Before formulating each question:

1. Look at the current block (current_block_id + its objective).
2. Skim the curated context for material that already addresses that
   block's objective.
3. If the block is substantively covered by the existing material:
   - Set its block_coverage to "covered" (or "partial" if real gaps remain).
   - Do NOT ask the interviewee to recap what they already told the author.
   - Instead either:
       (a) ask one specific clarifying / deepening question that targets a
           genuine gap or contradiction in the existing material, OR
       (b) advance to the next block by setting current_block_id to it and
           emitting that block's opening question.
4. Only ask a "blank-slate" opening question for a block when the curated
   context contains nothing relevant to it.

Asking the interviewee to repeat material that is already in the curated
context wastes their time and is the single biggest failure mode of this
mode. When in doubt, advance.

OUTPUT FORMAT (strict)
Return a single JSON object and nothing else. No prose before, no prose
after, no code fences, no greeting, no commentary. The response MUST
start with the character \`{\` and MUST end with the character \`}\`.

Required shape:
{
  "next_question": "<one question, in the interaction language>",
  "block_coverage": { "<block_id>": "pending" | "partial" | "covered" },
  "current_block_id": "<block_id of the block the next question targets>",
  "should_close": false
}

Concrete example of a well-formed reply (the question is illustrative;
your real one comes from the current block's objective):
{"next_question":"¿Te acuerdas de cómo nos conocimos?","block_coverage":{"block-1":"pending","block-2":"pending"},"current_block_id":"block-1","should_close":false}

If you find yourself wanting to write a paragraph addressing the author
or summarizing the situation: stop. The author and the interviewee are
two different people; the interviewee never sees your reasoning. Put the
single question into "next_question" and emit only the JSON.`;
}

/**
 * Build the user-prompt body for one turn. Pure — easy to unit-test without
 * spawning the CLI.
 */
export function buildInterviewerUserPrompt(input: InterviewerTurnInput): string {
  // Prefer the precomputed summary when available — it's a few KB instead of
  // hundreds. Fall back to raw files when there's no summary yet (sessions
  // created before O.2, or summarizer fallback).
  const ctx = input.contextSummary
    ? renderSummaryAsContext(input.contextSummary)
    : input.contextFiles.length > 0
    ? input.contextFiles.map((f) => `### ${f.path}\n${f.content}`).join("\n\n")
    : "(no additional context files)";

  // Compact: one line per block. seed_questions inline. Skip empty fields.
  const blocks = input.blocks
    .map((b) => {
      const seeds = b.seedQuestions?.length ? ` seeds=${JSON.stringify(b.seedQuestions)}` : "";
      const must = b.mustCover ? " must_cover" : "";
      return `- ${b.id}${must} | ${b.title} | ${b.objective}${seeds}`;
    })
    .join("\n");

  // Compact: single newline between turns, abbreviated role labels.
  const history =
    input.history.length === 0
      ? "(the interview has not started: emit the opening question for the current block)"
      : input.history
          .map((t) => `${t.role === "interviewer" ? "Q" : "A"}: ${t.text}`)
          .join("\n");

  return `## Book rules (CLAUDE.md of the book repo)

${input.bookClaudeMd}

## Additional rules from this interview template

${input.templateSystemPrompt}

## Curated context (author allow-list)

${ctx}

## Guide blocks (in order)

${blocks}

## Current state

current_block_id: ${input.currentBlockId}
block_coverage: ${JSON.stringify(input.blockCoverage)}

## Conversation history

${history}

## Task

Produce the JSON response described in the system prompt. The "next_question"
field must be written in the book's interaction language.

REMINDERS — read these RIGHT BEFORE you write your reply:

(A) The "Curated context" above is material the interviewee already provided
in earlier sessions. It is ALREADY KNOWN to both you and the interviewee.
Asking them to recap it is the failure mode to avoid. For the current block
(${input.currentBlockId}):
  - Skim the curated context for material that addresses this block's
    objective.
  - If you find substantial coverage there, set this block's status to
    "covered" (or "partial") in block_coverage and either advance to the
    next block in the list or ask one specific deepening question that
    targets a real gap.
  - Only ask a "give me the inventory / start from scratch" question if the
    curated context truly contains nothing on this topic.

(B) Output format: your reply MUST begin with \`{\` and end with \`}\`. No
prose addressed to the author. No narration. Just the JSON object.`;
}
