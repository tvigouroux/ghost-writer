/**
 * Model selection per task.
 *
 * Not every task needs the most capable model. The interviewer turn loop has
 * to keep block coverage state and emit strict JSON over hundreds of KB of
 * context — that one stays on Sonnet. The renderer composes a structured
 * markdown document and is also Sonnet for now. The summarizer is borderline
 * and a candidate for Haiku once we measure quality. The health check is
 * trivial and goes to Haiku unconditionally.
 *
 * All four are overridable via env vars without code changes:
 *   LLM_MODEL_INTERVIEWER, LLM_MODEL_RENDERER, LLM_MODEL_SUMMARIZER,
 *   LLM_MODEL_HEALTH
 *
 * Values are passed to `claude --model <value>`. The Claude Code CLI accepts
 * either short aliases ("sonnet", "haiku", "opus") or full ids
 * ("claude-sonnet-4-6", etc.).
 */

export const MODELS = {
  interviewer: process.env.LLM_MODEL_INTERVIEWER ?? "sonnet",
  renderer: process.env.LLM_MODEL_RENDERER ?? "sonnet",
  summarizer: process.env.LLM_MODEL_SUMMARIZER ?? "sonnet",
  health: process.env.LLM_MODEL_HEALTH ?? "haiku",
} as const;

export type ModelKey = keyof typeof MODELS;
