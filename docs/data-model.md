# Data model

Authoritative source: [`lib/db/schema.ts`](../lib/db/schema.ts) (Drizzle).

The schema is multi-tenant + multi-book + multi-mode from day one. The MVP
exercises a subset; new modes add columns or tables without redesign.

## Tables

```
authors             (id, email, github_handle?, display_name?, created_at)

book_templates      (id, name, description?, manifest_path, is_builtin,
                     created_at)

books               (id, author_id, template_id?, title, repo_url?,
                     repo_local_path, default_language, enabled_modes,
                     created_at)

interviewees        (id, book_id, display_name, relation?, notes?,
                     created_at)

interview_templates (id, book_id, name, system_prompt, intro_md?,
                     guide_blocks JSON, context_files JSON,
                     source_md_path?, created_at)

sessions            (id, template_id, interviewee_id, status, token_jti,
                     token_expires_at, current_block_id?,
                     block_coverage JSON?, started_at?, closed_at?,
                     context_summary JSON?, context_summary_at?,
                     created_at)

turns               (id, session_id, ordinal, role, block_id?,
                     content_text?, audio_path?, vetoed, created_at)

outputs             (id, session_id UNIQUE, processed_md,
                     delivered_md_path?, delivered_at?,
                     approved_by_author, created_at)

revoked_tokens      (jti, revoked_at)
```

## Conventions

- IDs: ULIDs (`ulid` package), stored as `TEXT`.
- Timestamps: `INTEGER` Unix milliseconds.
- JSON columns: `TEXT`, validated with `zod` at the boundary.
- `sessions.status`: `'draft' | 'live' | 'paused' | 'closed' | 'delivered'`.
- `turns.role`: `'interviewer' | 'interviewee'`.
- `block_coverage` shape: `{ [block_id: string]: 'pending' | 'partial' | 'covered' }`.
- `guide_blocks` shape: `[{ id, title, objective, seed_questions[], must_cover }]`.
- `context_summary` shape (when present): the JSON returned by the
  summarizer mode. See [`lib/llm/modes/summarizer.ts`](../lib/llm/modes/summarizer.ts).

## Why context_summary lives on `sessions`

It belongs at the session level, not at the template level, because it
depends on:

1. The template's blocks (stable per template).
2. The repo files at the moment the session opened (mutable across
   templates and time).
3. The interviewee's name / relation (per session).

Recomputing it is cheap to ask for ("Recalcular resumen" on the
session) but the default is to preserve it across resets so iterating
on the interviewer prompt doesn't pay the 3–5 minute summarize cost
each time.

## Mapping to the reference book repo

| App concept | Book repo equivalent |
|---|---|
| `book_templates.memoir-cowork` | extracted from a real memoir-in-progress repo (`CLAUDE.md`, `outline.md`, `notas/`, …) |
| `interview_templates` | a `.md` under `entrevistas/<scope>/` — importable through "Importar desde el repo" |
| `outputs.delivered_md_path` | either `<scope>/_pendiente-<slug>.md` (manual review) or the final `<scope>/<slug>.md` after a direct commit |
| `interview_templates.context_files` | repo-relative paths (e.g. `outline.md`, `acerca-de-mi.md`, `capitulos/<NN-slug>.md`) |

## Reserved for future modes

`writer_drafts`, `architect_changes`, `researcher_findings` — schema TBD
when those modes ship. The current schema reserves no columns for them;
they're new tables.

## Migrations

Drizzle migrations live in `lib/db/migrations/`. The current set:

- `0000_*` — initial schema.
- `0001_*` — add `sessions.context_summary` and `context_summary_at`.

Generate a new migration after schema edits with `pnpm db:generate`.
Apply with `pnpm db:migrate`.
