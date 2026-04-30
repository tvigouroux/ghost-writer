"use client";

import { useMemo, useState } from "react";
import type { RepoMdFile } from "@/lib/actions/import-template";

/**
 * For an interview template, these patterns map to files that typically *do*
 * help the interviewer agent. They're suggestions, not requirements — the
 * "Sugerir selección" button pre-fills the checkboxes with whatever matches.
 */
const RECOMMENDED_PATTERNS: { needle: string; reason: string }[] = [
  { needle: "outline", reason: "outline" },
  { needle: "acerca-de-mi", reason: "bio del autor" },
  { needle: "claude.md", reason: "reglas del libro" },
  { needle: "respuestas", reason: "respuestas previas (evita pedir recap)" },
  { needle: "capitulos/", reason: "capítulos que alimentan el bloque" },
];

/**
 * Files that the interviewer mode auto-filters out at prompt time (see
 * INTERVIEWER_CONTEXT_DENYLIST). We grey them out in the picker so the author
 * knows their selection won't reach the model — but we don't hide them, in
 * case the author wants to keep the marking for other modes later.
 */
const DENIED_PATTERNS = ["notas/inconsistencias", "notas/permisos", "notas/cronologia"];

function classify(path: string): "recommended" | "denied" | "neutral" {
  const lower = path.toLowerCase();
  if (DENIED_PATTERNS.some((p) => lower.includes(p))) return "denied";
  if (RECOMMENDED_PATTERNS.some((p) => lower.includes(p.needle))) return "recommended";
  return "neutral";
}

/**
 * Searchable, grouped-by-directory checkbox picker. Authoritative state lives
 * in the parent (a Set<string> of selected paths) so the form can read it on
 * submit.
 */
export function ContextFilesPicker({
  files,
  selected,
  onChange,
}: {
  files: RepoMdFile[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [filter, setFilter] = useState("");

  function suggestSelection() {
    const next = new Set<string>();
    for (const f of files) {
      if (classify(f.path) === "recommended") next.add(f.path);
    }
    onChange(next);
  }

  const grouped = useMemo(() => {
    const filtered = filter
      ? files.filter((f) => f.path.toLowerCase().includes(filter.toLowerCase()))
      : files;
    const map = new Map<string, RepoMdFile[]>();
    for (const f of filtered) {
      const key = f.dir || "(raíz)";
      const arr = map.get(key) ?? [];
      arr.push(f);
      map.set(key, arr);
    }
    // Sort directories so root comes first, then alphabetical.
    return [...map.entries()].sort(([a], [b]) => {
      if (a === "(raíz)") return -1;
      if (b === "(raíz)") return 1;
      return a.localeCompare(b);
    });
  }, [files, filter]);

  function toggle(path: string) {
    const next = new Set(selected);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    onChange(next);
  }

  function toggleGroup(group: RepoMdFile[]) {
    const allSelected = group.every((f) => selected.has(f.path));
    const next = new Set(selected);
    for (const f of group) {
      if (allSelected) next.delete(f.path);
      else next.add(f.path);
    }
    onChange(next);
  }

  return (
    <div className="rounded border border-stone-300 bg-white dark:border-stone-700 dark:bg-stone-900">
      <div className="border-b border-stone-200 bg-stone-50 px-3 py-2 text-[11px] leading-relaxed text-stone-600 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-400">
        <strong>Recomendado para entrevistador:</strong>{" "}
        <code className="font-mono">outline.md</code>,{" "}
        <code className="font-mono">acerca-de-mi.md</code>,{" "}
        <code className="font-mono">CLAUDE.md</code> del libro, y archivos{" "}
        <code className="font-mono">*-respuestas.md</code> de entrevistas previas
        (para evitar pedir recap). Suma los <code className="font-mono">capitulos/</code>{" "}
        que se relacionen con los bloques de esta entrevista.{" "}
        <strong className="text-stone-700 dark:text-stone-300">
          Se filtran automáticamente
        </strong>{" "}
        (no llegan al modelo aunque los marques):{" "}
        <code className="font-mono">notas/inconsistencias.md</code>,{" "}
        <code className="font-mono">notas/permisos.md</code>,{" "}
        <code className="font-mono">notas/cronologia*.md</code> — esos pertenecen
        a otros modos.
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-stone-200 px-3 py-2 dark:border-stone-800">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filtrar archivos…"
          className="flex-1 rounded border border-stone-300 bg-white px-2 py-1 text-xs dark:border-stone-700 dark:bg-stone-950"
        />
        <span className="text-xs text-stone-500">
          {selected.size} de {files.length} seleccionados
        </span>
        <button
          type="button"
          onClick={suggestSelection}
          className="rounded border border-stone-400 px-2 py-1 text-[10px] uppercase tracking-wider hover:bg-stone-200 dark:border-stone-600 dark:hover:bg-stone-800"
        >
          sugerir
        </button>
        {selected.size > 0 ? (
          <button
            type="button"
            onClick={() => onChange(new Set())}
            className="text-[10px] uppercase tracking-wider text-stone-500 hover:text-stone-900 dark:hover:text-stone-100"
          >
            limpiar
          </button>
        ) : null}
      </div>

      <div className="max-h-72 overflow-y-auto">
        {grouped.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-stone-500">
            {filter
              ? "Ningún archivo coincide con el filtro."
              : "No se encontraron archivos .md en el repo."}
          </p>
        ) : (
          grouped.map(([dirName, group]) => {
            const allSelected = group.every((f) => selected.has(f.path));
            const someSelected =
              !allSelected && group.some((f) => selected.has(f.path));
            return (
              <fieldset
                key={dirName}
                className="border-b border-stone-100 px-3 py-2 last:border-b-0 dark:border-stone-800"
              >
                <legend className="mb-1 flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected;
                    }}
                    onChange={() => toggleGroup(group)}
                  />
                  <span className="font-medium text-stone-700 dark:text-stone-300">
                    {dirName}
                  </span>
                  <span className="text-stone-400">({group.length})</span>
                </legend>
                <ul className="pl-5">
                  {group.map((f) => {
                    const cls = classify(f.path);
                    return (
                      <li key={f.path}>
                        <label
                          className={`flex items-center gap-2 py-0.5 text-xs hover:bg-stone-100 dark:hover:bg-stone-800 ${
                            cls === "denied" ? "opacity-50" : ""
                          }`}
                          title={
                            cls === "denied"
                              ? "Filtrado automáticamente para el modo entrevistador"
                              : cls === "recommended"
                              ? "Recomendado para el modo entrevistador"
                              : ""
                          }
                        >
                          <input
                            type="checkbox"
                            checked={selected.has(f.path)}
                            onChange={() => toggle(f.path)}
                          />
                          <span className="font-mono">{f.fileName}</span>
                          {cls === "recommended" ? (
                            <span className="text-[9px] uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                              recomendado
                            </span>
                          ) : null}
                          {cls === "denied" ? (
                            <span className="text-[9px] uppercase tracking-wider text-stone-400">
                              filtrado
                            </span>
                          ) : null}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
            );
          })
        )}
      </div>
    </div>
  );
}
