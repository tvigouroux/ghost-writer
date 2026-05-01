# Modes

Each mode is a prompt builder and a small protocol with the LLM, sharing
the rest of the infrastructure (LLM adapter, repo reader/writer, DB, the
book's `CLAUDE.md` as system context).

## Status today

| Mode | Implemented | Default model | Where it lives |
|---|---|---|---|
| **Summarizer** (per-session prep) | Yes | sonnet | `lib/llm/modes/summarizer.ts` |
| **Interviewer** | Yes | sonnet | `lib/llm/modes/interviewer.ts` |
| **Renderer** (transcript on close) | Yes | sonnet | `lib/llm/modes/renderer.ts` |
| Architect (outline / chapter planning) | No | — | not started |
| Writer (chapter drafts) | No | — | not started |
| Researcher (factual cross-check) | No | — | not started |

Defaults are overridable per-task via env vars
(`LLM_MODEL_INTERVIEWER`, `LLM_MODEL_RENDERER`, `LLM_MODEL_SUMMARIZER`,
`LLM_MODEL_HEALTH`); see [`lib/llm/models.ts`](../lib/llm/models.ts).

## Implemented modes

### Summarizer

Runs once per session, on first room-open. Reads the curated context
files (after the interviewer denylist filter) plus the book's
`CLAUDE.md`, and produces a structured JSON summary keyed by block id.
Persisted on `sessions.context_summary`. The interviewer turn loop reads
this summary instead of raw files on every subsequent turn.

Output shape:

```json
{
  "block_summaries": {
    "<block_id>": {
      "coverage_in_context": "covered" | "partial" | "absent",
      "key_facts": ["..."],
      "open_threads": ["..."]
    }
  },
  "general_notes": ["..."],
  "interviewee_specific_notes": ["..."]
}
```

Why this exists: without a summary, every turn re-sent ~400 KB of
context. With it, the first turn pays a ~3-minute one-shot cost; every
turn after is roughly 85% smaller.

### Interviewer

Receives the summary, the block list, the conversation history, and the
current block id. Returns one `next_question` plus updated state:

```json
{
  "next_question": "<one question, in book language>",
  "block_coverage": { "<block_id>": "pending|partial|covered" },
  "current_block_id": "<id>",
  "should_close": false
}
```

Hard rules baked into the prompt:

- One question per turn. Never two.
- Concrete: ask for a moment, scene, image, sensation, person.
- No disjunctive A-or-B-or-C framings.
- No multi-paragraph recap as setup. Short anchor sentence at most.
- Open threads from the summary are *pointers*, never scripts to repeat
  verbatim.
- Total length cap: 60 words.

Mode-specific allow-list / denylist:

- Reads `CLAUDE.md` of the book.
- Skips `notas/inconsistencias`, `notas/permisos`, `notas/cronologia*`
  even if the author's template lists them — those belong to the
  Researcher and Writer modes. The author's template stays untouched on
  disk; the filter applies at prompt-build time.

### Renderer

Runs at session close, either when the agent emits `should_close=true`
on its last turn, or when the interviewee clicks "Terminar entrevista".
Produces a single markdown document in the canonical book-repo format
(see [`docs/interview-flow.md`](interview-flow.md)).

Hard rules:

- Vetoed turns never appear in prose. They go in a "Vetos del
  entrevistado" list by ordinal with topic summary only.
- Verbatim quotes are preserved as blockquotes. Everything else is
  paraphrase.
- `[PARCIAL]` / `[PENDIENTE]` markers when blocks aren't fully covered.
- No YAML frontmatter (book repo's convention).

## Shared rule

Claude never writes directly to the author's working tree of the book.
The deposit path is staging — file goes to
`<scope>/_pendiente-<slug>.md` for review. Direct commit-and-push
exists but is opt-in via `GITHUB_TOKEN` in `.env`, with a confirm
dialog at the UI layer.

## Why the underscore prefix

The reference book repo already uses underscore-prefixed filenames as a
convention for non-content artifacts (e.g.
`_plantilla-introduccion.md`). Reusing the prefix means deposited
files sort predictably and visually mark themselves as "not yet part
of the manuscript".
