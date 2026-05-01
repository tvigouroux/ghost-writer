# Ghost Writer

> A self-hosted writing studio where Claude conducts interviews and helps you
> shape a book — while your GitHub repo stays the source of truth and you
> stay the only one who commits the manuscript.

<p>
  <img alt="Status" src="https://img.shields.io/badge/status-early%20MVP-orange?style=flat-square">
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square">
  <img alt="PRs welcome" src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square">
  <img alt="Privacy by design" src="https://img.shields.io/badge/privacy-by%20design-8B5CF6?style=flat-square">
</p>

<p>
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-15-black?style=flat-square&logo=next.js">
  <img alt="React" src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white">
  <img alt="Tailwind CSS" src="https://img.shields.io/badge/Tailwind_CSS-3-06B6D4?style=flat-square&logo=tailwind-css&logoColor=white">
  <img alt="SQLite via libsql" src="https://img.shields.io/badge/SQLite-libsql-003B57?style=flat-square&logo=sqlite&logoColor=white">
  <img alt="Drizzle ORM" src="https://img.shields.io/badge/Drizzle-ORM-C5F74F?style=flat-square&logo=drizzle&logoColor=black">
  <img alt="Claude" src="https://img.shields.io/badge/Powered_by-Claude-D97706?style=flat-square&logo=anthropic&logoColor=white">
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-20%2B-339933?style=flat-square&logo=node.js&logoColor=white">
  <img alt="pnpm" src="https://img.shields.io/badge/pnpm-package_manager-F69220?style=flat-square&logo=pnpm&logoColor=white">
</p>

**Status: early MVP.** Built in the open, used by its author to write a
running memoir. The interviewer flow is end-to-end; other modes are
incremental from here. PRs and ideas welcome — see
[`CONTRIBUTING.md`](CONTRIBUTING.md).

---

## What this is

If you've ever tried to write a book that draws on interviews — yours,
family's, a coach's, a colleague's — you know the loop:

1. You write a questionnaire.
2. You send it.
3. They answer something.
4. The next question depends on what they answered. But you're not there.
5. You either flatten the conversation into something shallow, or you
   schedule another call, or you give up.

Ghost Writer is the Claude-assisted version of *being there*. The author
configures an interview as a list of thematic blocks with objectives and
seed questions. The app generates a private link. The interviewee opens it
on their phone, answers by text or audio, and Claude conducts the
conversation: drilling down when an answer is vague, advancing when a
block is covered, never asking them to recap material that already lives
in the book repo.

When the session closes, Claude renders a polished markdown transcript in
the format the book repo already uses, drops it in the local clone for
review, and (optionally) pushes it directly to GitHub with a commit
message. The author edits, the author commits, the author owns the book.

## What this is not

- **Not a chatbot.** The interviewer agent is bounded by a guide the
  author wrote. It doesn't free-associate.
- **Not a content scraper.** The interviewee sees only their own
  conversation. They never see the book draft, other interviews, or the
  author's notes.
- **Not a hosted SaaS.** You run it locally (or on your own VPS). Your
  drafts and your interviews stay on disk.
- **Not a replacement for the writer.** Claude collects, structures, and
  proposes. The author keeps the pen.

## Why it might be interesting to you

- You're writing memoir, biography, oral history, journalism — anything
  where interviews are the raw material and structure is the work.
- You already use Claude Code in "Cowork" mode against a book repo and
  want to extend that to live conversations with people who aren't you.
- You're building something similar and want a privacy-first reference
  implementation: per-interview context allow-list, JWT-bounded room
  links, no third-party transcript service in the loop, no Claude commits
  unless you opt in.
- You want to study the prompt engineering side: how to keep a long-context
  agent on rails through a 10-turn interview without it drifting into
  free-form analysis. The prompts are in
  [`lib/llm/modes/`](lib/llm/modes/) and
  [`lib/llm/modes/interviewer.ts`](lib/llm/modes/interviewer.ts) is the
  most battle-tested.

## How a session looks

The author flow:

1. Connect a book → app clones the repo into `data/book-clones/{book_id}/`.
2. Create an InterviewTemplate. Either author the JSON of guide blocks
   directly, or click *"Importar desde el repo"* to pre-fill from an
   existing `entrevistas/.../guion.md` file.
3. Pick which files of the repo become per-interview context (a checkbox
   picker with "recomendado" / "filtrado" badges).
4. Add the interviewee, create the session, share the generated link.

The interviewee flow:

1. Opens the link on their phone. Sees a friendly intro.
2. Hits *"Comenzar entrevista"*. The first question arrives.
3. Answers by text or audio. The agent drills down or advances per block.
4. At any point: *"marcar como off-the-record"* on a turn, or
   *"Terminar entrevista"*.
5. On close: a thank-you panel.

Back to the author:

1. Reviews the rendered `.md` transcript at `/books/<id>/outputs/<id>`.
2. Either:
   - Deposits it as `entrevistas/<scope>/_pendiente-<slug>.md` for manual
     review and a commit from their workstation, **or**
   - Commits and pushes directly to `main` of the book repo via
     `GITHUB_TOKEN` in `.env` (with a confirm dialog).

## Privacy by design

Privacy here is non-negotiable, not a checkbox.

- **The book draft is never exposed to the interviewee.** Curated
  per-interview context is allow-list only, default closed.
- **Per-interviewee isolation.** What X said is never injected into Y's
  room. There's no shared agent memory across interviews.
- **No third-party transcript service in scope yet.** Audio (when it
  ships) goes to a single configured Whisper provider you choose; no
  intermediate brokers.
- **Single-use links.** JWT-signed, expiring, jti-tracked, revocable. The
  author can rotate any link from the UI in one click.
- **Claude doesn't commit by default.** The deposit path stages files
  under a `_pendiente-` prefix. Direct commit is opt-in via a token in
  your `.env`.
- **Veto trail preserved.** Vetoed turns are excluded from the prose body
  and listed under "Vetos del entrevistado" by ordinal — auditable but not
  quotable.

## Quick start

Prerequisites:

- Node.js 20+ and pnpm.
- Claude Code CLI logged in to the account you want to power the agent
  (`claude /login`). Ghost Writer runs the CLI as a subprocess; whatever
  rate limit and model your CLI session has applies to the app.
- A book repo on GitHub (or any URL `git clone` accepts) and, if you want
  direct push, a GitHub Personal Access Token with `repo` scope.

```bash
git clone https://github.com/tvigouroux/ghost-writer.git
cd ghost-writer
cp .env.example .env
# minimum: set DEV_AUTHOR_EMAIL and JWT_SECRET in .env
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm smoke:claude          # confirm the CLI subprocess works
pnpm dev
```

Open http://localhost:3000, connect your book, build a template, generate
a link.

To let an interviewee on a different network reach your dev server, run
a tunnel:

```bash
cloudflared tunnel --url http://localhost:3000
```

Set the `cloudflared` URL as `PUBLIC_BASE_URL` in `.env` so generated
interview links use it.

## Stack at a glance

<p>
  <a href="https://skillicons.dev">
    <img src="https://skillicons.dev/icons?i=nextjs,react,typescript,tailwind,sqlite,nodejs,pnpm,git,github,vscode" alt="stack icons">
  </a>
</p>


- **Next.js 15** (App Router) + TypeScript.
- **SQLite** via `@libsql/client` + **Drizzle ORM**. Single-file local DB,
  migratable to Postgres without a code rewrite.
- **Claude Code CLI** as a subprocess (`claude -p --output-format
  stream-json`). Pluggable: any client implementing
  [`LLMClient`](lib/llm/client.ts) drops in.
- **Per-task model assignment.** Sonnet for the heavy lifting, Haiku for
  health checks, all overridable via env vars. See
  [`lib/llm/models.ts`](lib/llm/models.ts).
- **Pre-computed context summaries.** First turn pays a one-shot summary
  cost; every following turn is ~85% smaller and faster. See the
  [`Summarizer` prompt](lib/llm/modes/summarizer.ts).
- **Tailwind v3** with no UI framework — minimal surface, easy to fork.
- **simple-git** for repo I/O. Path-traversal-guarded reader, prefix-only
  writer, optional commit-and-push with token never logged.

Every dependency was picked to be replaceable. The boundaries that matter
(LLM, repo, STT, auth) are interfaces, not implementations.

## Documentation

- [Architecture overview](docs/architecture.md) — start here if you want
  the mental model.
- [Tech stack rationale](docs/tech-stack.md)
- [Data model](docs/data-model.md)
- [Interview flow end-to-end](docs/interview-flow.md)
- [The four modes](docs/modes.md) (Architect, Interviewer, Writer,
  Researcher) — only Interviewer is implemented.
- [Book templates](docs/book-template.md)
- [Open decisions](docs/open-decisions.md) — what's intentionally
  unfinished and where the author would value input.

## Roadmap

Done:

- Scaffold, schema, Claude CLI adapter.
- Repo cloner with allow-list reader and `_pendiente-` prefix writer.
- Memoir-cowork book template extracted from a real working memoir repo.
- Author UI: connect book, import / build templates, manage interviewees,
  generate single-use links, regenerate links, reset / delete sessions.
- Interviewee room (text-only) with per-turn veto, off-the-record
  marking, and "Terminar entrevista".
- Renderer mode that produces a transcript matching the book repo's
  canonical format on session close.
- Delivery: deposit as `_pendiente-` or commit-and-push directly to
  `main`.
- Optimizations: model-per-task, context filtering by mode, prompt
  compaction, pre-computed per-session context summary, retries on
  transient errors, configurable timeouts, draft preservation on UI
  errors.

Next up:

- Audio responses (Whisper, candidate provider: Groq for cost / latency).
- Architect / Writer / Researcher modes.
- "Create new book" UI applying the `memoir-cowork` template to a fresh
  GitHub repo.
- Magic-link auth for the author (today: `DEV_AUTHOR_EMAIL` bypass).
- A real test suite. (Today: typecheck + manual + smoke scripts.)
- Streaming output to the room (perceived-latency win).

## Contributing

PRs welcome. If you're new to opensource, this is a good place to learn:
the repo is small enough to read in an afternoon, the boundaries are
clear, and the maintainer (the author) is figuring it out too.

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the workflow, what kind of
issues are easy first wins, and a tour of the codebase. Be kind:
[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

To report a security issue privately, see [`SECURITY.md`](SECURITY.md).

## Working language

The interviewee UI is in **Spanish** (Chilean register, configurable per
book). Code, comments, internal docs, and this README are in **English**.
User-facing strings live in `lib/llm/modes/` (the agent's natural-language
output is shaped by the prompt's `bookLanguage` parameter).

## License

[MIT](LICENSE) — do whatever you want, attribution appreciated.

---

Built with [Claude Code](https://claude.com/claude-code).
