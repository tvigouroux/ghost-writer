import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

export async function GET() {
  const checks: Record<string, "ok" | string> = {};

  // DB file presence
  const dbPath = resolve(process.env.DATABASE_URL ?? "data/ghost-writer.sqlite");
  checks.db = existsSync(dbPath) ? "ok" : `missing: ${dbPath}`;

  // Claude CLI reachable
  try {
    const r = spawnSync(process.env.CLAUDE_CLI_BIN || "claude", ["--version"], {
      encoding: "utf8",
      timeout: 5_000,
    });
    checks.claude = r.status === 0 ? "ok" : `exit=${r.status}: ${(r.stderr || r.stdout || "").trim()}`;
  } catch (e) {
    checks.claude = (e as Error).message;
  }

  return NextResponse.json(checks);
}
