# Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 15 (App Router) + TS | Server Actions, streaming, single deployable. |
| UI | Tailwind v3 + shadcn/ui | shadcn components added on demand from `components/ui/`. |
| DB | SQLite via `better-sqlite3` + Drizzle ORM | Synchronous driver, single file, migratable to Postgres. |
| Author auth | Magic link (Resend) in prod; `DEV_AUTHOR_EMAIL` bypass in dev | Single-tenant MVP. |
| Interviewee auth | JWT (`jose`) in URL, 72h expiry, revocable via `revoked_tokens` | Single session per token. |
| LLM | Claude CLI subprocess (Max session) | `lib/llm/claude-cli.ts`. Adapter interface in `lib/llm/client.ts`. |
| STT | Groq Whisper (`whisper-large-v3-turbo`) | Phase 7. Spanish + sport jargon hint via `prompt`. |
| Book repo | `simple-git` clone in `data/book-clones/{book_id}/` | `git pull` before reads, never push. |
| Deploy | Local + Cloudflare Tunnel for MVP; small VPS for 24/7 hosting | Max session is not portable to ephemeral containers. |

## Why these (vs the original prompt)

- **`better-sqlite3` instead of libSQL/Turso.** Synchronous, no daemon, easier
  to reason about for a single-process app. Drizzle abstracts both, swap is
  cheap.
- **Clone separate from any cloud-synced location.** Book repos may be kept in
  OneDrive/Dropbox/iCloud by their authors; writing to such a location from a
  process while sync runs can cause file lock conflicts. The app always works
  on a separate clone in `data/book-clones/{book_id}/`.
- **Cloudflare Tunnel over ngrok for the MVP**: free, no auth required for the
  visitor, stable while the tunnel is up.

## Risks tracked

1. Concurrency LLM tied to the Max plan rate limit → enforce serial per book.
2. Cloud-sync lock conflicts (OneDrive/Dropbox/iCloud) → never write to the
   author's primary working copy; always work on `data/book-clones/{book_id}/`.
3. Spanish-Chilean sport jargon in Whisper → pass `prompt` field with
   vocabulary (UTMB, trail, vertical, pace…).
4. CLI output parsing fragility → mock-based tests + `pnpm smoke:claude`
   healthcheck.
5. Scope creep → MVP locked to Interviewer mode for third parties.
