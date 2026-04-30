import spawn from "cross-spawn";
import { existsSync } from "node:fs";
import { join } from "node:path";

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
    const explicit = bin ?? process.env.CLAUDE_CLI_BIN;
    if (explicit) {
      this.bin = explicit;
    } else {
      // Probe well-known npm-global locations before falling back to PATH.
      // Next.js's dev server may be launched from a shell whose PATH does not
      // include %APPDATA%\npm (Windows) or ~/.npm-global/bin (POSIX), even
      // though the user can run `claude` from their terminal.
      this.bin = probeClaudeBin() ?? "claude";
    }
  }

  async complete(opts: CompleteOptions): Promise<CompleteResult> {
    return this.completeOnce(opts).catch(async (err) => {
      // Single retry for transient errors. Non-transient (auth, JSON parse,
      // user abort) propagate immediately.
      if (isTransient(err)) {
        const backoffMs = 2000;
        console.warn(
          `[claude-cli] transient error: ${(err as Error).message}; retrying in ${backoffMs}ms`,
        );
        await new Promise((r) => setTimeout(r, backoffMs));
        return this.completeOnce(opts);
      }
      throw err;
    });
  }

  private async completeOnce(opts: CompleteOptions): Promise<CompleteResult> {
    const args = [
      "-p",
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      "--verbose",
      "--append-system-prompt",
      opts.systemPrompt + (opts.appendSystem ? "\n\n" + opts.appendSystem : ""),
    ];
    if (opts.model) {
      args.push("--model", opts.model);
    }

    const timeoutMs = Number(process.env.CLAUDE_CLI_TIMEOUT_MS) || 5 * 60 * 1000;
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

      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        // SIGKILL fallback if the process refuses to die.
        setTimeout(() => child.kill("SIGKILL"), 2000).unref();
      }, timeoutMs);
      timer.unref();

      let stdout = "";
      let stderr = "";

      stdoutStream.setEncoding("utf8");
      stderrStream.setEncoding("utf8");
      stdoutStream.on("data", (chunk: string) => (stdout += chunk));
      stderrStream.on("data", (chunk: string) => (stderr += chunk));

      child.on("error", (err) => {
        clearTimeout(timer);
        opts.signal?.removeEventListener("abort", onAbort);
        reject(new LLMError(`failed to spawn claude CLI: ${err.message}`, err));
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        opts.signal?.removeEventListener("abort", onAbort);
        if (timedOut) {
          reject(new LLMError(`claude CLI timed out after ${timeoutMs}ms`));
          return;
        }
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

      // Large prompts (>16 KB default highWaterMark) need explicit
      // backpressure handling — `write()` returns false and the underlying
      // pipe must be drained before further writes. Without this the CLI
      // child can sit forever waiting for the rest of the prompt while
      // Node's pipe buffer is full and we never call end().
      const ok = stdinStream.write(opts.userPrompt, "utf8", (err) => {
        if (err) {
          reject(new LLMError(`stdin write failed: ${err.message}`, err));
          return;
        }
        stdinStream.end();
      });
      if (!ok) {
        // The callback above will fire after the buffer drains. Drain might
        // happen before the callback in some Node versions, so we also add
        // a one-shot listener that no-ops if already ended.
        stdinStream.once("drain", () => {
          // If end() hasn't been called yet from the callback, this push is
          // safe; Node ignores double-end.
        });
      }
    });
  }
}

/**
 * Identify errors worth a single retry. Transient = network / rate-limit /
 * spawn race / parse glitch. Non-transient = auth, model output not JSON,
 * user abort.
 */
function isTransient(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  if (msg.includes("rate_limit") || msg.includes("rate limit")) return true;
  if (msg.includes("eai_again") || msg.includes("econnreset")) return true;
  if (msg.includes("etimedout") || msg.includes("timed out")) return true;
  if (msg.includes("503") || msg.includes("502") || msg.includes("504")) return true;
  return false;
}

/**
 * Best-effort probe for the Claude CLI binary in well-known install locations.
 * Returns an absolute path if found, otherwise null.
 */
function probeClaudeBin(): string | null {
  const candidates: string[] = [];
  if (process.platform === "win32") {
    const appdata = process.env.APPDATA;
    if (appdata) candidates.push(join(appdata, "npm", "claude.cmd"));
    const programFiles = process.env["ProgramFiles"];
    if (programFiles) candidates.push(join(programFiles, "nodejs", "claude.cmd"));
  } else {
    const home = process.env.HOME;
    if (home) {
      candidates.push(join(home, ".npm-global", "bin", "claude"));
      candidates.push(join(home, ".local", "bin", "claude"));
    }
    candidates.push("/usr/local/bin/claude");
    candidates.push("/opt/homebrew/bin/claude");
  }
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
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
