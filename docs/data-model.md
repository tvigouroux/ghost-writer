# Data model

Authoritative source: [`lib/db/schema.ts`](../lib/db/schema.ts) (Drizzle).

Multi-tenant + multi-book + multi-mode from day one. MVP only exercises a
subset, but the schema is built so new modes are additive.

## Tables

```
authors            (id, email, github_handle, display_name, created_at)
book_templates     (id, name, description, manifest_path, is_builtin, created_at)
books              (id, author_id, template_id?, title, repo_url?, repo_local_path,
                    enabled_modes, created_at)
interviewees       (id, book_id, display_name, relation?, notes?, created_at)
interview_templates(id, book_id, name, system_prompt, intro_md?, guide_blocks JSON,
                    context_files JSON, source_md_path?, created_at)
sessions           (id, template_id, interviewee_id, status, token_jti, token_expires_at,
                    current_block_id?, block_coverage JSON?, started_at?, closed_at?, created_at)
turns              (id, session_id, ordinal, role, block_id?, content_text?, audio_path?,
                    vetoed, created_at)
outputs            (id, session_id UNIQUE, processed_md, delivered_md_path?, delivered_at?,
                    approved_by_author, created_at)
revoked_tokens     (jti, revoked_at)
```

## Conventions

- IDs: ULIDs (`ulid` package), stored as `TEXT`.
- Timestamps: `INTEGER` unix milliseconds.
- JSON columns: `TEXT` validated with `zod` at the boundary.
- `sessions.status`: `'draft' | 'live' | 'paused' | 'closed' | 'delivered'`.
- `turns.role`: `'interviewer' | 'interviewee'`.
- `block_coverage` shape: `{ [block_id: string]: 'pending' | 'partial' | 'covered' }`.
- `guide_blocks` shape: `[{ id, title, objective, seed_questions[], must_cover }]`.

## Mapping to the reference book repo

| App concept | Book repo equivalent |
|---|---|
| `book_templates.memoir-cowork` | extracted from a reference memoir repo (`CLAUDE.md`, `outline.md`, etc.) |
| `interview_templates` | a file under `entrevistas/terceros/` (e.g. `NN-<role>.md`) — importable |
| `outputs.delivered_md_path` | `entrevistas/terceros/_pendiente-NN-<slug>.md` |
| `interview_templates.context_files` | repo-relative paths, e.g. `outline.md`, `acerca-de-mi.md`, `capitulos/<NN-slug>.md` |

## Reserved for future modes

`writer_drafts`, `architect_changes`, `researcher_findings` — schema TBD when
those modes ship.
