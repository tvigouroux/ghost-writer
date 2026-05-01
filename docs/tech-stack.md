# Tech stack

Why each piece is here and what it would take to swap it.

| Layer | Choice | Notes |
|---|---|---|
| Framework | **Next.js 15** (App Router) + TypeScript | Server components + server actions are the natural shape for this app: most of the work is server-side I/O (DB, repo, subprocess) and the UI is mostly forms and a chat-like room. |
| UI | **Tailwind v3**, no component library | Surface kept small. Adding shadcn/ui is a one-time install if a component grows hairy. |
| DB | **SQLite via `@libsql/client`** + **Drizzle ORM** | Single-file local DB, prebuilt native bindings (Node 25 + Windows + better-sqlite3 was a swamp), and Drizzle migrates SQLite → Postgres without code changes. |
| Author auth | `DEV_AUTHOR_EMAIL` shortcut today | Magic-link via Resend is the planned production path. The `lib/auth/author.ts` interface won't change. |
| Interviewee auth | **`jose`** signed JWT in URL, 72h expiry, revocable via `revoked_tokens` | Single JTI per session. Reset rotates it. Author can regenerate from the UI. |
| LLM | **Claude Code CLI** as a subprocess | Lets the project run on a Pro/Max plan without API spend. Adapter pattern (`LLMClient`) makes a future SDK swap mechanical. Drawback: no native prompt caching in headless mode. |
| Per-task model | Sonnet for interviewer / renderer / summarizer, Haiku for health | `lib/llm/models.ts` holds the mapping with env-var overrides (`LLM_MODEL_INTERVIEWER`, etc.). Opus stays explicitly out of defaults. |
| Context optimization | Pre-computed per-session summary | Once-per-session summarizer call distills 300–500 KB of curated context into 5–15 KB JSON. Subsequent turns are 80–90% smaller and proportionally faster. |
| STT (planned) | **Groq Whisper** as the candidate | Cheap, fast, generous free tier. Will land behind an `STTClient` interface. |
| Book repo | **`simple-git`** against a local clone in `data/book-clones/{book_id}/` | Read with allow-list (path-traversal-guarded). Writes either land at `_pendiente-<slug>.md` (manual review) or commit-and-push to `main` (opt-in via `GITHUB_TOKEN`). Token never enters the remote URL or `.git/config`. |
| GitHub commit (opt-in) | One-shot `Authorization: Bearer` header via `git -c http.extraheader=...` | ff-only pull before commit so a divergent local clone fails loudly instead of merging. Token is redacted from any error bubbled up. |
| Subprocess wrapper | **`cross-spawn`** | Handles Windows `.cmd` shim resolution and arg quoting. Required because the Claude CLI ships as `claude.cmd` on Windows. |
| Logging | `console.*` to dev-server stdout | No structured logger yet. Lines are tagged (`[interviewer]`, `[summarizer]`) for grep. |
| Deploy | Local + Cloudflare Tunnel for dev; small VPS where `claude /login` happens once for production | Max session isn't portable to ephemeral containers. Can move to API-only when the SDK adapter ships. |

## Risks tracked

1. **Concurrency vs. Max plan rate limit** — one CLI subprocess at a time
   in practice. A queued second interview shows "wait" rather than
   competing for tokens.
2. **Cloud-sync conflicts** (`OneDrive`/`Dropbox`/`iCloud`) on
   `data/book-clones/` — never write there. The cloner copies into a
   path inside the app's working directory.
3. **Spanish-Chilean register drift** — the interviewer prompt now ships
   real bad/good examples to anchor style; the model otherwise tends
   toward neutral Spanish.
4. **Subprocess fragility** — timeouts (`CLAUDE_CLI_TIMEOUT_MS`, default
   5 min), single retry on transient errors (rate limit, EAI_AGAIN,
   ECONNRESET), proper backpressure on stdin (a 380 KB write without
   the callback hung the child until timeout — a real bug we shipped a
   fix for).
5. **Windows `cmd.exe` 8 KB command-line cap** — the system prompt is
   passed via `--append-system-prompt-file <tempfile>` instead of
   inline, because the prompt itself crossed that limit once we added
   bad/good examples.

## Why these and not the alternatives

- **`@libsql/client` instead of `better-sqlite3`.** No native build step
  on Node 25 + Windows. Drizzle treats them similarly.
- **Server actions over a tRPC / API route layer.** Fewer files. Next 15
  is built around it.
- **Tailwind without a UI library.** Lower maintenance surface for a
  one-author project. Easier to fork.
- **`simple-git` over `isomorphic-git`.** We need real `git pull`/`push`
  semantics (ff-only, push to remote, reading config), not a
  re-implementation. `simple-git` shells out to system git.
- **CLI subprocess over Anthropic SDK.** Pricing. The summary cache
  closes most of the perf gap. SDK adapter is on the roadmap as
  opt-in.
