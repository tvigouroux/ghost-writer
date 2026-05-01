# Open decisions

Decisions that are intentionally unfinished. Issues and discussion welcome —
each item below is roughly the shape of one focused PR or issue.

## Per-block context allow-list (today the allow-list is per-template)

Today every block of an interview gets the same set of context files.
That's wasteful when block 1 only needs `outline.md` but block 7 needs
`capitulos/07-cerro.md`. A per-block allow-list would shave more off the
already-summarized prompt, especially as books grow.

**Status**: low priority while the precomputed summary keeps prompts
small. Worth revisiting once a book has 30+ chapters.

## Audio transcription provider

Groq Whisper is the candidate (cheap, fast, generous free tier). Other
plausible options: OpenAI Whisper API, self-hosted faster-whisper.
Whichever one ships first should land behind an `STTClient` interface
similar to `LLMClient` so swaps are configuration-only.

**Open question**: client-side Web Speech API as a fallback when no key
is set? Quality is uneven on Chilean Spanish but it's free and offline.

## Streaming the interviewer reply to the room

The room shows "Pensando…" while the agent generates. With streaming the
interviewee would see tokens arrive — much better perceived latency. The
CLI supports stream-json output already; the server just needs to
forward chunks to the client (Server-Sent Events or a streaming server
action).

**Trade-off**: more moving parts, more error paths. Probably worth it
once the audio loop ships, when the round trip gets longer.

## Magic-link auth for the author

Today: `DEV_AUTHOR_EMAIL` in `.env` auto-creates / reuses an author row.
Production-ready: magic-link via Resend (or any transactional email
provider). The auth seam in `lib/auth/author.ts` is ready for the swap;
the email side is the work.

**Open question**: do we keep the dev shortcut as `NODE_ENV=development`
fallback, or remove it entirely once magic-link is in?

## Anthropic SDK adapter with prompt caching

The Claude CLI doesn't expose `cache_control` in headless mode. An
Anthropic SDK adapter (opt-in via `ANTHROPIC_API_KEY`) would unlock
~90% additional token savings on cached system prompts and context.
Cost: leaving the user's Claude Pro/Max plan and paying API rates,
which the cache discount mostly offsets.

**Status**: explicit non-goal for the MVP. Reasonable next step once
someone hits Max plan rate limits in real use.

## "Create new book" UI

Today the author "connects" an existing repo. The book templates exist
(`templates/memoir-cowork/`) and the manifest format is settled. What's
missing is the UI: pick a template, fill placeholders, create or
target a fresh GitHub repo, scaffold, first commit.

**Open question**: does `lib/repo/scaffolder.ts` shell out to `git init`
or use a GitHub App to create the repo and push the scaffold in one go?
The PAT path is simpler; the GitHub App is more correct.

## Non-interviewer modes (Architect, Writer, Researcher)

Each is a prompt builder + a small UI:

- **Architect**: edits to `outline.md`, chapter list, arcs.
- **Writer**: chapter drafts from outline + processed interviews. Output
  goes to `capitulos/_pendiente-NN-*.md`.
- **Researcher**: cross-checks interviews against
  `notas/cronologia.md`, populates `notas/inconsistencias.md`.

**Status**: not started. Each is a clean, scoped piece of work — good
candidates for a contributor PR.

## Test suite

Currently: `pnpm typecheck` + `pnpm build` + smoke / inspect scripts.
No unit or integration tests. The boundaries that would benefit most
from tests:

- `lib/llm/modes/*` prompt builders (snapshot tests).
- `lib/llm/claude-cli.ts` (with a mocked subprocess).
- `lib/md/interview-template-parser.ts` (table-driven tests over real
  examples from book repos).
- `lib/repo/{reader,writer,committer}.ts` (path traversal, prefix
  policy, `_pendiente-` write-then-not-commit).

**Open question**: vitest or node:test? vitest is friendlier with TS;
node:test is zero-dep.

## CI

No GitHub Actions yet. A reasonable starter workflow:

- On PR: install, typecheck, build.
- On main: same plus dependency review.
- Optional: a smoke test that runs the parser against a fixture book
  repo (no Claude CLI calls — that needs auth).

**Open question**: where do the fixtures live? A separate repo? A
generated synthetic book repo?

## Internationalization

The interviewer agent already adapts to `books.default_language`
(BCP-47). What's missing:

- A consistent `lib/i18n/` for interviewee UI strings (today: hardcoded
  Chilean Spanish).
- Per-language model assignment (some models are stronger in some
  languages; currently one model per task across all languages).

**Status**: low priority while the only deployment is Spanish. Will
matter the day someone wants to write a book in Portuguese or Catalan.

## Multi-author / multi-book hosting

Schema is already multi-tenant; auth and routing are not. To host
multiple authors on one instance, three things need to happen:

1. Real author auth (see magic-link above).
2. Author-scoped routes (a `/me` redirect, no shared `/books/[id]`).
3. Quota / rate limit isolation per author (today everyone shares the
   one `claude` subprocess and its rate limit).

**Status**: explicit non-goal for the MVP.

## How to engage with these

Open an issue tagged with the section title. If you have a strong opinion
on the trade-offs, write the design note in the issue body before any
PR — feedback on direction is much cheaper than feedback on diff.
