/**
 * Interview engine — orchestrates one turn of the Interviewer mode.
 *
 * Used by both the opening-question call (when the interviewee enters the
 * room and there are no turns yet) and the per-response loop. Pure with
 * respect to side effects: callers do the DB writes around it.
 */
import { ClaudeCliClient } from "./llm/claude-cli";
import { LLMError } from "./llm/client";
import {
  buildInterviewerSystemPrompt,
  buildInterviewerUserPrompt,
  type BlockStatus,
  type GuideBlock,
} from "./llm/modes/interviewer";

const LANGUAGE_LABELS: Record<string, string> = {
  es: "Spanish (Spanish/Latin American register, neutral)",
  en: "English",
  pt: "Portuguese",
  fr: "French",
  it: "Italian",
  de: "German",
  ca: "Catalan",
};

export function languageLabel(bcp47: string): string {
  return LANGUAGE_LABELS[bcp47.toLowerCase()] ?? bcp47;
}

export interface RunInterviewTurnInput {
  bookLanguage: string;
  bookClaudeMd: string;
  templateSystemPrompt: string;
  contextFiles: { path: string; content: string }[];
  blocks: GuideBlock[];
  blockCoverage: Record<string, BlockStatus>;
  currentBlockId: string;
  history: { role: "interviewer" | "interviewee"; text: string }[];
}

export interface RunInterviewTurnOutput {
  nextQuestion: string;
  blockCoverage: Record<string, BlockStatus>;
  currentBlockId: string;
  shouldClose: boolean;
  raw: string;
}

const InterviewerJsonShape = (() => {
  // Light runtime check; we keep the parser tolerant since the model may emit
  // surrounding whitespace or a leading/trailing fence even when told not to.
  return (raw: string): RunInterviewTurnOutput => {
    const cleaned = stripJsonFences(raw).trim();
    let obj: any;
    try {
      obj = JSON.parse(cleaned);
    } catch (err) {
      throw new LLMError(
        `interviewer model output is not valid JSON: ${(err as Error).message}\n--- raw output ---\n${raw}`,
      );
    }
    const nextQuestion = String(obj.next_question ?? "").trim();
    if (!nextQuestion) {
      throw new LLMError("interviewer model did not produce next_question");
    }
    const blockCoverage = (obj.block_coverage ?? {}) as Record<string, BlockStatus>;
    const currentBlockId = String(obj.current_block_id ?? "").trim();
    const shouldClose = obj.should_close === true;
    return { nextQuestion, blockCoverage, currentBlockId, shouldClose, raw };
  };
})();

function stripJsonFences(s: string): string {
  // Common case: model wraps JSON in ```json ... ``` despite instructions.
  const fenced = /^\s*```(?:json)?\s*\n([\s\S]*?)\n```\s*$/;
  const m = s.match(fenced);
  return m ? m[1] : s;
}

export async function runInterviewerTurn(
  input: RunInterviewTurnInput,
  client: ClaudeCliClient = new ClaudeCliClient(),
): Promise<RunInterviewTurnOutput> {
  const systemPrompt = buildInterviewerSystemPrompt({
    bookLanguage: input.bookLanguage,
    bookLanguageLabel: languageLabel(input.bookLanguage),
  });
  const userPrompt = buildInterviewerUserPrompt({
    bookLanguage: input.bookLanguage,
    bookLanguageLabel: languageLabel(input.bookLanguage),
    bookClaudeMd: input.bookClaudeMd,
    templateSystemPrompt: input.templateSystemPrompt,
    contextFiles: input.contextFiles,
    blocks: input.blocks,
    blockCoverage: input.blockCoverage,
    currentBlockId: input.currentBlockId,
    history: input.history,
  });

  const result = await client.complete({
    systemPrompt,
    userPrompt,
  });
  return InterviewerJsonShape(result.text);
}
