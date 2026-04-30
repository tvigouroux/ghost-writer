"use client";

import { useMemo, useState } from "react";
import type { RepoMdFile } from "@/lib/actions/import-template";

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
                  {group.map((f) => (
                    <li key={f.path}>
                      <label className="flex items-center gap-2 py-0.5 text-xs hover:bg-stone-100 dark:hover:bg-stone-800">
                        <input
                          type="checkbox"
                          checked={selected.has(f.path)}
                          onChange={() => toggle(f.path)}
                        />
                        <span className="font-mono">{f.fileName}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </fieldset>
            );
          })
        )}
      </div>
    </div>
  );
}
