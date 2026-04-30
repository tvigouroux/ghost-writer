import spawn from "cross-spawn";

// This module is intrinsically server-only (subprocess), but we don't import
// "server-only" so the smoke-test script can require it directly. We use
// `cross-spawn` instead of `node:child_process` to handle Windows `.cmd` shim
// resolution and arg quoting safely.
import { LLMError, type CompleteOptions, type CompleteResult, type LLMClient } from "./client";

/**
 * Invokes the Claude Code CLI as a subprocess using the author's Max session.
 *
 * Uses `claude -p` (print mode) with `--output-format stream-json` so we can
 * parse structured output reliably. The system prompt is passed via
 * `--append-system-prompt` (the CLI's stable mechanism for additional system
 * context). The user prompt is sent via stdin to avoid shell-quoting hazards.
 *
 * Concurrency: callers must serialize invocations. The Max plan rate limit is
 * shared across the process; the higher layer enforces a single-flight queue
 * per book.
 */
export class ClaudeCliClient implements LLMClient {
  private readonly bin: string;

  constructor(bin?: string) {
    // cross-spawn handles `.cmd` resolution on Windows; pass the bare name.
    this.bin = bin ?? process.env.CLAUDE_CLI_BIN ?? "claude";
  }

  async complete(opts: CompleteOptions): Promise<CompleteResult> {
    const args = [
      "-p",
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      "--verbose",
      "--append-system-prompt",
      opts.systemPrompt + (opts.appendSystem ? "\n\n" + opts.appendSystem : ""),
    ];

    const start = Date.now();
    return new Promise<CompleteResult>((resolveResult, reject) => {
      const child = spawn(this.bin, args, {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });

      // With `stdio: ["pipe","pipe","pipe"]` these are guaranteed non-null,
      // but the type system doesn't know that.
      const stdoutStream = child.stdout!;
      const stderrStream = child.stderr!;
      const stdinStream = child.stdin!;

      const onAbort = () => child.kill("SIGTERM");
      opts.signal?.addEventListener("abort", onAbort, { once: true });

      let stdout = "";
      let stderr = "";

      stdoutStream.setEncoding("utf8");
      stderrStream.setEncoding("utf8");
      stdoutStream.on("data", (chunk: string) => (stdout += chunk));
      stderrStream.on("data", (chunk: string) => (stderr += chunk));

      child.on("error", (err) => {
        opts.signal?.removeEventListener("abort", onAbort);
        reject(new LLMError(`failed to spawn claude CLI: ${err.message}`, err));
      });

      child.on("close", (code) => {
        opts.signal?.removeEventListener("abort", onAbort);
        if (code !== 0) {
          reject(
            new LLMError(
              `claude CLI exited with code ${code}: ${stderr.slice(0, 500)}`,
            ),
          );
          return;
        }
        try {
          const parsed = parseStreamJson(stdout);
          resolveResult({
            text: parsed.text,
            meta: { ...parsed.meta, latencyMs: Date.now() - start },
          });
        } catch (err) {
          reject(new LLMError("failed to parse claude CLI output", err));
        }
      });

      stdinStream.write(opts.userPrompt);
      stdinStream.end();
    });
  }
}

/**
 * Parse the CLI's stream-json output. Each line is a JSON event. We accumulate
 * the assistant's text content and capture the final result event for meta.
 *
 * Reference: https://docs.claude.com/en/docs/claude-code/sdk/sdk-headless#stream-json-output
 */
function parseStreamJson(raw: string): { text: string; meta: Record<string, unknown> } {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  let text = "";
  let meta: Record<string, unknown> = {};
  let resultEvent: any = null;

  for (const line of lines) {
    let evt: any;
    try {
      evt = JSON.parse(line);
    } catch {
      continue;
    }

    // The CLI emits "assistant" events with `message.content` arrays similar to
    // the Anthropic API shape. We accumulate text blocks from those, but only
    // for non-error messages (the CLI emits a synthetic assistant message with
    // model="<synthetic>" when reporting auth/rate-limit/etc. errors).
    if (
      evt.type === "assistant" &&
      evt.message?.content &&
      evt.message.model !== "<synthetic>"
    ) {
      for (const block of evt.message.content) {
        if (block.type === "text" && typeof block.text === "string") {
          text += block.text;
        }
      }
    }
    if (evt.type === "result") {
      resultEvent = evt;
      meta = {
        sessionId: evt.session_id,
        durationMs: evt.duration_ms,
        durationApiMs: evt.duration_api_ms,
        numTurns: evt.num_turns,
        totalCostUsd: evt.total_cost_usd,
      };
      if (typeof evt.result === "string" && text.length === 0 && !evt.is_error) {
        text = evt.result;
      }
    }
  }

  if (resultEvent?.is_error) {
    const reason =
      typeof resultEvent.result === "string" ? resultEvent.result : "unknown error";
    throw new Error(`claude CLI returned an error: ${reason}`);
  }

  if (text.length === 0) {
    throw new Error("no text content in claude CLI stream");
  }
  return { text, meta };
}
