# Modes

Each mode defines a **prompt** and a **set of capabilities** over the book
repo. Modes share infrastructure (LLM adapter, repo reader/writer, DB, the
book's `CLAUDE.md` as system context).

| Mode | MVP | Context fed to Claude | Output |
|---|---|---|---|
| Architect | No | `outline.md`, `CLAUDE.md`, `notas/`, chapter list | suggested edits to `outline.md` |
| **Interviewer** | **Yes** | `CLAUDE.md`, `interview_template`, curated `context_files` | next turn; on close, processed `.md` at `entrevistas/terceros/_pendiente-*.md` |
| Writer | No | `outline.md`, target chapter, related interviews | draft at `capitulos/_pendiente-NN-*.md` |
| Researcher | No | `notas/cronologia-deportiva.md`, `notas/inconsistencias.md`, interviews | findings at `notas/_pendiente-inconsistencias-*.md` |

## Shared rule

Claude never writes directly to the book repo. The app deposits to a marked
location (always with the `_pendiente-` prefix), and the author moves,
renames, and commits from their workstation.

## Implementation

- `lib/llm/modes/interviewer.ts` — system prompt + user-prompt builder.
- `lib/llm/modes/{architect,writer,researcher}.ts` — placeholders for future
  phases.

## Why the prefix is `_pendiente-`

The reference book repo already uses underscore-prefixed filenames as a
convention for non-content artifacts (e.g. `_plantilla-introduccion.md`).
Reusing the underscore-prefix convention means the deposited files sort
predictably and visually mark themselves as "not yet part of the manuscript".
