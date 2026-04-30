/**
 * Adapter interface for the LLM. The MVP implementation is a Claude CLI
 * subprocess wrapper (`claude-cli.ts`). A future API-based implementation can
 * drop in without callers changing.
 */
export interface LLMClient {
  /**
   * One-shot completion. Returns the assistant's text reply.
   * Used for the interviewer turn loop and for the final transcript render.
   */
  complete(opts: CompleteOptions): Promise<CompleteResult>;
}

export interface CompleteOptions {
  systemPrompt: string;
  userPrompt: string;
  /** Optional: extra system context appended after systemPrompt. */
  appendSystem?: string;
  /** Soft cap for the model, in tokens. */
  maxOutputTokens?: number;
  /** Abort handle. */
  signal?: AbortSignal;
}

export interface CompleteResult {
  text: string;
  /** Provider-specific metadata (cost, model, latency, etc.). */
  meta: Record<string, unknown>;
}

export class LLMError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "LLMError";
  }
}
