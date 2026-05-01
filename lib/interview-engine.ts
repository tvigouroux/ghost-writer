/**
 * Interview engine — orchestrates one turn of the Interviewer mode.
 *
 * Used by both the opening-question call (when the interviewee enters the
 * room and there are no turns yet) and the per-response loop. Pure with
 * respect to side effects: callers do the DB writes around it.
 */
import { ClaudeCliClient } from "./llm/claude-cli";
import { LLMError } from "./llm/client";
import { MODELS } from "./llm/models";
import {
  buildInterviewerSystemPrompt,
  buildInterviewerUserPrompt,
  isContextDenied,
  type BlockStatus,
  type GuideBlock,
} from "./llm/modes/interviewer";
import {
  buildRendererSystemPrompt,
  buildRendererUserPrompt,
  type RendererInput,
} from "./llm/modes/renderer";
import {
  buildSummarizerSystemPrompt,
  buildSummarizerUserPrompt,
  type ContextSummary,
  type SummarizerInput,
} from "./llm/modes/summarizer";

const LANGUAGE_LABELS: Record<string, string> = {
  // Default Spanish register: Chilean. Use tuteo (tú/te/tu, NOT vos/te/tu in
  // voseo form). Vocabulary leans Chilean but avoids strong colloquialisms
  // (no "po", no "cachái") so written prose stays clean. If a different
  // Spanish variant is needed for a specific book, the author can override
  // the language code (e.g. "es-AR" → Rioplatense).
  es: "Spanish (Chilean register, tuteo — never voseo)",
  "es-cl": "Spanish (Chilean register, tuteo — never voseo)",
  "es-ar": "Spanish (Rioplatense register, voseo)",
  "es-mx": "Spanish (Mexican register, tuteo)",
  "es-es": "Spanish (Peninsular register, tuteo)",
  en: "English",
  "en-us": "English (US)",
  "en-gb": "English (British)",
  pt: "Portuguese",
  "pt-br": "Portuguese (Brazilian)",
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
  /** Stringified JSON ContextSummary; when present, replaces contextFiles in the prompt. */
  contextSummary?: string;
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

/**
 * Parse the interviewer model's reply. Tolerant in three layers, in order:
 *   1. Try direct JSON.parse on the whole string (after stripping a single
 *      surrounding ```json fence).
 *   2. Extract the first balanced {...} block that appears in the string and
 *      JSON.parse that. Handles "preamble prose then JSON" and "JSON then
 *      trailing prose".
 *   3. Throw an LLMError so the caller can decide whether to retry.
 */
function parseInterviewerReply(raw: string): RunInterviewTurnOutput {
  const cleaned = stripJsonFences(raw).trim();
  const candidates: string[] = [cleaned];
  const extracted = extractFirstBalancedJson(cleaned);
  if (extracted && extracted !== cleaned) candidates.push(extracted);

  let lastErr: unknown = null;
  for (const c of candidates) {
    try {
      const obj = JSON.parse(c);
      const nextQuestion = String(obj.next_question ?? "").trim();
      if (!nextQuestion) {
        lastErr = new Error("missing next_question");
        continue;
      }
      const blockCoverage = (obj.block_coverage ?? {}) as Record<string, BlockStatus>;
      const currentBlockId = String(obj.current_block_id ?? "").trim();
      const shouldClose = obj.should_close === true;
      return { nextQuestion, blockCoverage, currentBlockId, shouldClose, raw };
    } catch (err) {
      lastErr = err;
    }
  }

  throw new LLMError(
    `interviewer model output is not valid JSON: ${(lastErr as Error)?.message ?? "unknown"}\n--- raw output ---\n${raw}`,
  );
}

function stripJsonFences(s: string): string {
  const fenced = /^\s*```(?:json)?\s*\n([\s\S]*?)\n```\s*$/;
  const m = s.match(fenced);
  return m ? m[1] : s;
}

/**
 * Find the first balanced {...} block in a string, respecting strings (so
 * braces inside JSON string literals don't break the depth count). Returns
 * null if no balanced block is found.
 */
function extractFirstBalancedJson(s: string): string | null {
  const start = s.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Compute the per-session context summary. Called once on first room-open
 * and persisted to sessions.context_summary; subsequent turns of the
 * interviewer use this summary instead of re-sending raw context files.
 *
 * The cost lives here on purpose: this single call is heavy (full context
 * materials in, structured JSON out), but every following turn becomes ~85%
 * cheaper.
 */
export async function summarizeContext(
  input: Omit<SummarizerInput, "bookLanguageLabel">,
  client: ClaudeCliClient = new ClaudeCliClient(),
): Promise<ContextSummary> {
  const bookLanguageLabel = languageLabel(input.bookLanguage);
  const systemPrompt = buildSummarizerSystemPrompt({
    bookLanguage: input.bookLanguage,
    bookLanguageLabel,
  });
  const userPrompt = buildSummarizerUserPrompt({ ...input, bookLanguageLabel });

  const ctxBytes = input.contextFiles.reduce((n, f) => n + f.content.length, 0);
  console.log(
    `[summarizer] computing: model=${MODELS.summarizer} ctxFiles=${input.contextFiles.length} ` +
      `ctxBytes=${ctxBytes} promptBytes=${userPrompt.length}`,
  );
  const start = Date.now();
  const result = await client.complete({
    systemPrompt,
    userPrompt,
    model: MODELS.summarizer,
  });
  const cleaned = stripJsonFencesGeneric(result.text).trim();
  const balanced = extractFirstBalancedJson(cleaned) ?? cleaned;
  let parsed: ContextSummary;
  try {
    parsed = JSON.parse(balanced) as ContextSummary;
  } catch (err) {
    throw new LLMError(
      `summarizer output is not valid JSON: ${(err as Error).message}\n--- raw output ---\n${result.text}`,
    );
  }
  console.log(
    `[summarizer] done in ${Date.now() - start}ms, summaryBytes=${JSON.stringify(parsed).length}`,
  );
  return parsed;
}

function stripJsonFencesGeneric(s: string): string {
  const fenced = /^\s*```(?:json)?\s*\n([\s\S]*?)\n```\s*$/;
  const m = s.match(fenced);
  return m ? m[1] : s;
}

/**
 * Run the renderer at session close. Returns the markdown document.
 */
export async function renderInterviewOutput(
  input: Omit<RendererInput, "bookLanguageLabel">,
  client: ClaudeCliClient = new ClaudeCliClient(),
): Promise<string> {
  const bookLanguageLabel = languageLabel(input.bookLanguage);
  const systemPrompt = buildRendererSystemPrompt({
    bookLanguage: input.bookLanguage,
    bookLanguageLabel,
    hasExistingTranscript: Boolean(input.existingTranscript),
  });
  const userPrompt = buildRendererUserPrompt({ ...input, bookLanguageLabel });
  const result = await client.complete({
    systemPrompt,
    userPrompt,
    model: MODELS.renderer,
  });
  const cleaned = stripMarkdownFences(result.text).trim();
  if (!cleaned) {
    throw new LLMError("renderer returned empty output");
  }
  return cleaned;
}

function stripMarkdownFences(s: string): string {
  // Sometimes the model wraps the whole document in ```markdown ... ```;
  // strip a single outer fence if present.
  const fenced = /^\s*```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/;
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
  // Drop context files that don't belong to the interviewer mode (e.g.
  // notas/inconsistencias.md is for the researcher, notas/permisos.md is for
  // the writer). The author's template stays untouched on disk. The filter
  // is moot when contextSummary is present (the summary already excludes
  // those), but cheap and defensive.
  const filteredContextFiles = input.contextFiles.filter((f) => !isContextDenied(f.path));
  const droppedCount = input.contextFiles.length - filteredContextFiles.length;

  const userPrompt = buildInterviewerUserPrompt({
    bookLanguage: input.bookLanguage,
    bookLanguageLabel: languageLabel(input.bookLanguage),
    bookClaudeMd: input.bookClaudeMd,
    templateSystemPrompt: input.templateSystemPrompt,
    contextFiles: filteredContextFiles,
    contextSummary: input.contextSummary,
    blocks: input.blocks,
    blockCoverage: input.blockCoverage,
    currentBlockId: input.currentBlockId,
    history: input.history,
  });

  const usingSummary = !!input.contextSummary;
  console.log(
    `[interviewer] turn: model=${MODELS.interviewer} lang=${input.bookLanguage} block=${input.currentBlockId} ` +
      `history=${input.history.length} ` +
      (usingSummary
        ? `mode=summary summaryBytes=${input.contextSummary!.length}`
        : `mode=raw ctxFiles=${filteredContextFiles.length}` +
          (droppedCount ? `(dropped ${droppedCount})` : "") +
          ` ctxBytes=${filteredContextFiles.reduce((n, f) => n + f.content.length, 0)}`) +
      ` promptBytes=${userPrompt.length}`,
  );
  const first = await client.complete({
    systemPrompt,
    userPrompt,
    model: MODELS.interviewer,
  });
  console.log(
    `[interviewer] model raw output (first ${Math.min(first.text.length, 600)} of ${first.text.length} chars):\n${first.text.slice(0, 600)}`,
  );
  try {
    const parsed = parseInterviewerReply(first.text);
    console.log(
      `[interviewer] parsed: currentBlockId=${parsed.currentBlockId} shouldClose=${parsed.shouldClose} coverage=${JSON.stringify(parsed.blockCoverage)}`,
    );
    return parsed;
  } catch (err) {
    // Single retry with a stricter nudge appended. The book's CLAUDE.md and
    // context files in the prompt sometimes pull the model into the author's
    // narrative voice; this reminds it that the addressee is the interviewee
    // and that the only valid output is JSON.
    console.warn(
      "[interview-engine] first reply was not parseable JSON; retrying with strict nudge",
    );
    const retryUserPrompt =
      userPrompt +
      "\n\n## STRICT REMINDER\n\nYour previous attempt was not valid JSON. " +
      "Reply with the JSON object only. The reply MUST begin with `{` and end with `}`. " +
      "Do not address the author. Do not summarize. Do not narrate. " +
      "Output exactly the four fields described in the system prompt.";
    const second = await client.complete({
      systemPrompt,
      userPrompt: retryUserPrompt,
      model: MODELS.interviewer,
    });
    return parseInterviewerReply(second.text);
  }
}
