import spawn from "cross-spawn";
import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { MODELS } from "@/lib/llm/models";

export async function GET() {
  const checks: Record<string, "ok" | string> = {};

  const dbPath = resolve(process.env.DATABASE_URL ?? "data/ghost-writer.sqlite");
  checks.db = existsSync(dbPath) ? "ok" : `missing: ${dbPath}`;

  // The CLI `--version` is a binary-presence ping; it doesn't actually invoke
  // a model. The health-tier model assignment (Haiku) only matters once we
  // upgrade this probe to a real round-trip in the future.
  checks.healthModel = MODELS.health;

  checks.claude = await new Promise<"ok" | string>((resolveResult) => {
    const child = spawn(process.env.CLAUDE_CLI_BIN || "claude", ["--version"], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout?.on("data", (c) => (out += String(c)));
    child.stderr?.on("data", (c) => (err += String(c)));
    const t = setTimeout(() => {
      child.kill();
      resolveResult("timeout");
    }, 5_000);
    child.on("close", (code) => {
      clearTimeout(t);
      resolveResult(code === 0 ? "ok" : `exit=${code}: ${(err || out).trim()}`);
    });
    child.on("error", (e) => {
      clearTimeout(t);
      resolveResult(`spawn: ${e.message}`);
    });
  });

  return NextResponse.json(checks);
}
