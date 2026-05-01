# Interview flow

End-to-end, what happens from "the author connects a book" to "the
transcript is on GitHub".

## Sequence

```mermaid
sequenceDiagram
    actor A as Author
    participant W as Web (Next.js)
    participant S as Server actions
    participant DB as SQLite
    participant CLI as Claude CLI (subprocess)
    participant STT as Groq Whisper (planned)
    participant R as data/book-clones/{book_id}
    actor I as Interviewee

    A->>W: Connect book (URL or local path)
    S->>R: git clone → data/book-clones/{book_id}
    Note over R: If source is a local working copy,<br/>cloner walks through to its origin<br/>and rewrites ours to point at it.
    A->>W: Create / import an InterviewTemplate
    A->>W: Create Interviewee + Session
    S-->>A: unique link https://.../s/{token}

    A->>I: (offline) sends the link

    I->>W: Opens link
    S->>DB: validates JWT, marks status=live
    Note over S,CLI: First open only:
    S->>R: git pull && read curated context
    S->>CLI: summarize all curated context (model=sonnet)
    CLI-->>S: ContextSummary JSON
    S->>DB: persist sessions.context_summary
    S->>CLI: opening question (with summary, not raw context)
    CLI-->>S: { next_question, block_coverage, current_block_id, should_close }
    S-->>I: intro + question 1

    loop each turn
        I->>W: answer (text; audio is planned)
        opt audio (planned)
            S->>STT: transcribe → text
        end
        S->>DB: insert turn (interviewee)
        S->>CLI: claude -p (with summary, history, current state)
        CLI-->>S: next question + updated state
        S->>DB: update session, insert turn (interviewer)
        S-->>I: new question
    end

    Note over CLI,S: Close: agent (must_cover bloques satisfied)<br/>or interviewee ("Terminar entrevista")
    S->>CLI: closing prompt → markdown transcript (model=sonnet)
    CLI-->>S: markdown
    S->>DB: insert output, status=closed

    A->>W: Reviews transcript at /books/[id]/outputs/[id]
    alt deposit only
        A->>W: clicks "Depositar como _pendiente-"
        S->>R: write entrevistas/<scope>/_pendiente-<slug>.md
        Note over A,R: Author renames, commits, pushes from their workstation.
    else direct commit and push
        A->>W: clicks "Commit + push a main" (requires GITHUB_TOKEN)
        S->>R: git pull --ff-only origin main
        S->>R: write entrevistas/<scope>/<slug>.md
        S->>R: git -c user.name=... commit -m "..."
        S->>R: git -c http.extraheader=Authorization push origin main
        S-->>A: commit hash + GitHub URL
    end
```

## Canonical processed-`.md` format

The renderer mirrors the format of processed-response files in the
reference book repo (`entrevistas/<scope>/NN-<slug>-respuestas.md`):

```markdown
# Entrevista — Respuestas: <descriptive title>

**Entrevistado**: <Name> (<relation, if any>)
**Fecha de la sesión**: YYYY-MM-DD
**Cobertura**: bloques 1, 2, 3 (completos); bloque 4 (parcial)
**Estado**: cerrado por <agente|entrevistado>

## Bloque 1 — <title>
processed prose with verbatim quotes preserved

> "verbatim quote"

## Bloque 2 — ...

[PARCIAL: <what's still missing for this block>]

## Pendientes detectados
- ...

## Vetos del entrevistado
- Turno 14: <topic summary, no verbatim>

<!-- FUENTES: turns 1-37 de session {id} -->
```

No YAML frontmatter — aligned with the book repo's convention. Section
headings remain in Spanish even for non-Spanish books, because they
match files the rest of the book repo's tooling expects. The *content
language* of the prose is `books.default_language`.

## Where each piece of code lives

| Step | File |
|---|---|
| Connect book | `lib/actions/books.ts:connectBookAction` |
| Detect / fix non-pushable origin | `lib/actions/books.ts:getBookRemoteInfo` + `relinkBookOriginAction`, `lib/repo/cloner.ts` |
| Import a template from a `.md` | `lib/md/interview-template-parser.ts`, `lib/actions/import-template.ts` |
| Create session, generate JWT | `lib/actions/interviews.ts:createSessionAction`, `lib/auth/interviewee.ts` |
| Reset / regenerate / delete a session | `lib/actions/interviews.ts:{resetSessionAction, regenerateSessionLinkAction, deleteSessionAction}` |
| First-open summarize + persist | `lib/actions/turns.ts:ensureSessionContextSummary`, `lib/llm/modes/summarizer.ts`, `lib/interview-engine.ts:summarizeContext` |
| Each turn | `lib/actions/turns.ts:{startOrContinueAction, submitTextTurnAction}`, `lib/llm/modes/interviewer.ts`, `lib/interview-engine.ts:runInterviewerTurn` |
| Veto / close | `lib/actions/turns.ts:{vetoTurnAction, closeSessionAction}` |
| Render at close | `lib/llm/modes/renderer.ts`, `lib/interview-engine.ts:renderInterviewOutput`, called from `closeSessionAction` and (auto) when agent says `should_close` |
| Deposit `_pendiente-` | `lib/actions/outputs.ts:depositPendingAction`, `lib/repo/writer.ts` |
| Commit + push | `lib/actions/outputs.ts:commitAndPushOutputAction`, `lib/repo/committer.ts` |
| Author UI | `app/books/[id]/...` |
| Interviewee room | `app/s/[token]/page.tsx` + `room.tsx` |

## Performance signal

The dev server logs one line per turn:

```
[interviewer] turn: model=sonnet lang=es block=block-9 history=4
              mode=summary summaryBytes=9123 promptBytes=48234
```

- `mode=summary` ⇢ using the precomputed summary (cheap, fast).
- `mode=raw ctxFiles=N ctxBytes=NNN` ⇢ falling back to raw files (only
  before the summary is computed, or after a "+ recargar contexto" reset).

A ~90% drop in `promptBytes` from baseline-to-summary is the headline
optimization win and is testable from these logs alone.
