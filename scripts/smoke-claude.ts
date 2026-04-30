/**
 * Smoke test for the Claude CLI adapter.
 *
 * Spawns `claude -p` with a trivial prompt and prints the parsed result.
 * Run: `pnpm smoke:claude`
 */
import { ClaudeCliClient } from "../lib/llm/claude-cli";

async function main() {
  const client = new ClaudeCliClient();
  const start = Date.now();
  const result = await client.complete({
    systemPrompt: "Responde solo la palabra OK, nada más.",
    userPrompt: "ping",
  });
  console.log("text:", JSON.stringify(result.text));
  console.log("meta:", result.meta);
  console.log("wall:", Date.now() - start, "ms");
}

main().catch((err) => {
  console.error("smoke failed:", err);
  process.exit(1);
});
