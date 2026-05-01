"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setBookCommitBranchAction } from "@/lib/actions/books";

/**
 * Per-book editor for "the branch the app commits to". Default is
 * `ghost-writer-staging` so app commits don't pollute the author's manual
 * work on `main`. Author can change it (e.g. back to `main` if they want
 * direct integration, or to a per-book staging branch with their own
 * naming).
 */
export function CommitBranchPanel({
  bookId,
  current,
}: {
  bookId: string;
  current: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [value, setValue] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function save() {
    setError(null);
    setSaved(false);
    start(async () => {
      try {
        await setBookCommitBranchAction({ bookId, branch: value.trim() });
        setSaved(true);
        router.refresh();
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  const dirty = value.trim() !== current;
  const usingMain = value.trim() === "main";

  return (
    <section className="mt-4 rounded border border-stone-200 p-4 text-sm dark:border-stone-800">
      <h2 className="font-medium">Rama de commits de la app</h2>
      <p className="mt-1 text-xs text-stone-500">
        Cuando aprobás una transcripción y la app hace{" "}
        <code className="font-mono">git push</code>, va a esta rama del repo
        del libro. Por defecto es{" "}
        <code className="font-mono">ghost-writer-staging</code> para no
        interferir con tu trabajo manual en{" "}
        <code className="font-mono">main</code> (Cowork, ediciones a mano).
        Cuando quieras llevar lo aprobado a <code className="font-mono">main</code>{" "}
        abrí un PR desde GitHub.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="min-w-[18rem] flex-1 rounded border border-stone-300 bg-white px-2 py-1 font-mono text-xs dark:border-stone-700 dark:bg-stone-900"
          placeholder="ghost-writer-staging"
        />
        <button
          type="button"
          disabled={pending || !dirty || !value.trim()}
          onClick={save}
          className="rounded border border-stone-400 px-2 py-1 text-[10px] uppercase tracking-wider hover:bg-stone-100 disabled:opacity-50 dark:border-stone-600 dark:hover:bg-stone-800"
        >
          {pending ? "guardando…" : "guardar"}
        </button>
      </div>
      {usingMain && dirty ? (
        <p className="mt-2 text-[10px] text-amber-700 dark:text-amber-400">
          Vas a apuntar la app a <code className="font-mono">main</code>. Los
          commits de la app van a interleavearse con tu trabajo manual.
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 text-[10px] text-red-700 dark:text-red-300">{error}</p>
      ) : null}
      {saved && !dirty ? (
        <p className="mt-2 text-[10px] text-emerald-700 dark:text-emerald-400">
          guardado.
        </p>
      ) : null}
    </section>
  );
}
