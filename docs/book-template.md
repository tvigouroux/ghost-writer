# Book template

A *book template* describes how a fresh book repository is initialized.

```
templates/{template_id}/
├── manifest.json
├── CLAUDE.md.tmpl
├── outline.md.tmpl
├── ...
```

## `manifest.json` (skeleton)

```json
{
  "id": "memoir-cowork",
  "name": "Memoir in Cowork",
  "description": "Structure for a memoir worked in Cowork-with-Claude mode",
  "placeholders": [
    {"key": "TITULO", "label": "Book title", "required": true},
    {"key": "TESIS", "label": "Central thesis or question", "required": true},
    {"key": "LECTOR_IDEAL", "label": "Ideal reader, in one sentence", "required": true},
    {"key": "TONO", "label": "Tone (e.g. intimate, ironic, sober)", "required": true},
    {"key": "AUTOR_NOMBRE", "label": "Author name"}
  ],
  "files": [
    {"src": "CLAUDE.md.tmpl", "dst": "CLAUDE.md"},
    {"src": "outline.md.tmpl", "dst": "outline.md"}
  ],
  "directories": ["capitulos", "entrevistas/tomas", "entrevistas/terceros", "investigacion", "notas"],
  "enabled_modes": ["interviewer", "architect", "writer", "researcher"]
}
```

## Generating the first template — `memoir-cowork`

Done by **reading** an existing memoir-in-progress book repo and abstracting
its patterns. The book draft is not modified. Only structure, conventions, and
templates are extracted into `templates/memoir-cowork/`.

The placeholder keys in `manifest.json` are kept in Spanish because the
template targets Spanish-language memoirs and the resulting book files are
written in Spanish. Renaming keys to English is a future task if/when other
language templates ship.

## Application (future)

`lib/repo/scaffolder.ts` takes `(template_id, placeholders, target_repo_path)`,
copies files substituting `{{PLACEHOLDER}}` tokens, creates directories, and
makes the first commit. The "create new book" UI lands in Phase 11+.

## In the MVP

The template exists as an artifact under `templates/memoir-cowork/` (extracted
in Phase 4) but **there is no "create new book" UI yet**. The author connects
an existing repo.
