# Interview flow (MVP)

```mermaid
sequenceDiagram
    actor A as Author
    participant W as Web
    participant S as Server (Next.js)
    participant DB as SQLite
    participant CLI as Claude CLI (Max session)
    participant STT as Groq Whisper
    participant R as book-clone (data/book-clones/{book_id})
    actor I as Interviewee

    A->>W: Connect existing book (repo URL)
    S->>R: git clone → data/book-clones/{book_id}
    A->>W: Create InterviewTemplate (import a .md from entrevistas/terceros/, or build it)
    A->>W: Create Interviewee + Session
    S-->>A: unique link https://.../s/{token}

    A->>I: (offline) sends the link

    I->>W: Opens link
    S->>DB: validate JWT, mark status=live
    S->>R: git pull && read context_files (allow-list)
    S->>CLI: initial prompt (mode=interviewer + book CLAUDE.md + context + blocks)
    CLI-->>S: first question
    S-->>I: intro + question 1

    loop each turn
        I->>W: answers (text or audio)
        alt audio
            S->>STT: transcribe → text
        end
        S->>DB: insert turn (interviewee)
        S->>CLI: claude -p (system + context + history + block state)
        CLI-->>S: next question + meta {block_coverage, should_close}
        S->>DB: update session, insert turn (interviewer)
        S-->>I: new question
    end

    Note over CLI,S: Close: agent when must-cover blocks are covered, or interviewee via "End" button
    S->>CLI: closing prompt → generate processed .md
    CLI-->>S: markdown
    S->>DB: insert output, status=closed

    A->>W: Reviews and approves
    S->>R: write entrevistas/terceros/_pendiente-NN-slug.md
    Note over A,R: Author renames and commits from their workstation (the app NEVER commits)
```

## Canonical processed-`.md` format

Mirrors the format of processed-response files in the reference book repo
(`entrevistas/<author>/NN-<slug>-respuestas.md`):

```markdown
# Entrevista NN — Respuestas: [Title]

**Entrevistado**: [Name] ([relation])
**Fecha de la sesión**: YYYY-MM-DD
**Cobertura**: bloques 1, 2, 3 (completos); bloque 4 (parcial)
**Estado**: cerrado por agente

## Bloque 1 — [title]
processed prose with verbatim quotes preserved

> "verbatim quote"

## Bloque 2 — ...

## Pendientes detectados
- ...

## Vetos del entrevistado
- Turno 14: "no usar"

<!-- FUENTES: turns 1-37 de session {id} -->
```

No YAML frontmatter — aligned with the book repo's convention. Section headings
remain in Spanish because the file is consumed by the (Spanish-language) book
repo and matches its existing files; the *file content language* is independent
of this codebase's working language.
