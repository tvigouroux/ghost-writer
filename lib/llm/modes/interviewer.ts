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

OUTPUT FORMAT (strict)
Return a single JSON object and nothing else, with this exact shape:
{
  "next_question": "<one question, in the interaction language>",
  "block_coverage": { "<block_id>": "pending" | "partial" | "covered" },
  "current_block_id": "<block_id of the block the next question targets>",
  "should_close": false
}`;
}

/**
 * Build the user-prompt body for one turn. Pure — easy to unit-test without
 * spawning the CLI.
 */
export function buildInterviewerUserPrompt(input: InterviewerTurnInput): string {
  const ctx =
    input.contextFiles.length > 0
      ? input.contextFiles
          .map((f) => `### ${f.path}\n\n${f.content}`)
          .join("\n\n---\n\n")
      : "(no additional context files)";

  const blocks = input.blocks
    .map(
      (b) =>
        `- id: ${b.id}\n  title: ${b.title}\n  objective: ${b.objective}\n  must_cover: ${b.mustCover}\n  seed_questions: ${JSON.stringify(b.seedQuestions ?? [])}`,
    )
    .join("\n");

  const history =
    input.history.length === 0
      ? "(the interview has not started: emit the opening question for the current block)"
      : input.history
          .map((t) => `${t.role === "interviewer" ? "Interviewer" : "Interviewee"}: ${t.text}`)
          .join("\n\n");

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
field must be written in the book's interaction language.`;
}
