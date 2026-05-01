# Contributing to Ghost Writer

Thanks for stopping by. Ghost Writer is a small, opinionated codebase
maintained primarily by its author (who is using it to write a book). PRs,
issues, and ideas are very welcome — including from people who are new to
opensource.

## Code of conduct

By participating you agree to abide by [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
Be kind, assume good faith, expect the same in return.

## Before writing code

- **Open an issue first** for anything beyond a typo or a one-line bug
  fix. The maintainer is one person and might already be partway through
  the same change.
- **Look at [`docs/open-decisions.md`](docs/open-decisions.md).** It
  enumerates what's intentionally unfinished and where input would be
  most valuable.
- **Skim [`docs/architecture.md`](docs/architecture.md)** so the change
  fits the seams the codebase already exposes.

If you're new to opensource and want a low-stakes first PR, look for
issues labeled `good-first-issue`. Things that are usually safe and
appreciated even without an issue:

- Typo / phrasing fixes anywhere in `docs/`.
- Adding type annotations to a function that's missing them.
- Improving a single error message to be more informative (the
  maintainer regrets every cryptic `Error: invalid input`).
- Adding tests where there are none.

## Setup

Prereqs:

- Node.js 20+ and pnpm.
- Claude Code CLI authenticated (`claude /login`).
- Windows, macOS, or Linux all work. The author runs Windows; CI is
  not set up yet.

```bash
git clone https://github.com/tvigouroux/ghost-writer.git
cd ghost-writer
cp .env.example .env
# minimum: set DEV_AUTHOR_EMAIL and JWT_SECRET in .env
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm dev
```

If `pnpm` isn't on your PATH after `npm install -g pnpm`, open a fresh
terminal so PATH refreshes.

## Useful commands

```bash
pnpm dev                    # local dev server (Next.js)
pnpm build                  # production build (also typechecks aggressively)
pnpm typecheck              # tsc --noEmit, ~5–30s, run after every nontrivial change
pnpm smoke:claude           # round-trip the Claude CLI adapter
pnpm db:inspect             # dump current authors / books / templates / sessions
pnpm db:reset-session <id>  # wipe a session's turns + transcript (preserves cached summary)
pnpm db:make-token <id>     # mint a fresh interviewee link for an existing session
pnpm test:repo <src>        # exercise the repo cloner + reader + path-traversal guard
pnpm validate:templates     # check the book templates manifest is consistent
```

## Codebase tour

```
app/                    Next.js routes (App Router)
  (author)/             # author-facing pages: book list, modes, output review
  s/[token]/            # public interviewee room
  api/health/           # /api/health endpoint
lib/
  actions/              # Next.js server actions, the boundary between UI and core
  auth/                 # JWT for interviewee links, dev-only author auth
  db/                   # Drizzle schema, libsql client, migrations
  interview-engine.ts   # orchestrates summarizer / interviewer / renderer turns
  llm/                  # adapter interface + CLI subprocess implementation
    modes/              # one prompt-builder file per mode (interviewer, summarizer, renderer)
    models.ts           # which model each task uses (Sonnet / Haiku / etc)
  md/                   # parsers (e.g. import an existing .md as a template)
  repo/                 # cloner, allow-listed reader, _pendiente writer, GH committer
  i18n/                 # (placeholder) interviewee-facing strings
templates/
  memoir-cowork/        # the seed book template
docs/                   # rationale + reference (read here, not in chat)
scripts/                # one-shot CLIs callable via pnpm
data/                   # gitignored — local DB, audio, book clones
```

## Conventions

- Filenames: kebab-case.
- Types use `interface` for object shapes, `type` for unions.
- Errors at trust boundaries (interviewee input, repo paths, env vars):
  validate with `zod` and **fail closed**.
- Don't add YAML frontmatter to files that get written into a book repo.
  The reference repo uses headers + bold metadata; we honor that.
- Don't `console.log` secrets. The committer redacts the GitHub token in
  any error path; copy that pattern if you add another credential.
- Code comments in English. UI strings shown to interviewees in the
  book's `default_language` (Chilean Spanish by default).

## Pull request checklist

Before opening a PR:

- [ ] `pnpm typecheck` passes.
- [ ] `pnpm build` passes.
- [ ] If you changed the schema, you ran `pnpm db:generate` and committed
      the new migration file alongside your change.
- [ ] If you added a server action that touches a session / book / output,
      it loads the row through the existing helper (`getCurrentAuthor`,
      `getBookById`, etc.) so ownership is enforced.
- [ ] If you changed the interviewer prompt, you reset a session
      (`pnpm db:reset-session <id>`) and verified the new behavior on a
      real turn — the prompt is the product, treat changes seriously.
- [ ] Commits are small enough to read. Long commit bodies are fine and
      encouraged when they capture *why*.

## Working with the maintainers

- Default branch: `main`. PRs merge into `main`.
- The project is maintained as a side project; reviews happen when they
  happen. Pinging in a comment after a few days is fine.
- If your PR is more than a small change, expect a short conversation in
  the issue first about scope and approach.
- Force-push during review is fine on your branch. Don't squash before
  the review — the per-commit story is useful.

## Architecture changes

Anything that touches one of these seams deserves its own issue with a
short design note:

- `lib/llm/client.ts` (the LLM interface).
- `lib/db/schema.ts` (the data model).
- `lib/repo/{reader,writer,committer}.ts` (the repo boundary).
- The `_pendiente-` / direct-commit policy in delivery.

These are the decisions that make the rest replaceable; changes here
ripple far.

## Releasing / publishing

There is no published artifact yet. The opensource value today is the
source you can fork and the patterns documented in `docs/`. If/when an
NPM or container release happens, this section will say how.

## Saying thanks

You don't have to. But if Ghost Writer helps you write a book, drop a
line in [Discussions](https://github.com/tvigouroux/ghost-writer/discussions)
when it's out — that's payment enough for everyone involved.
