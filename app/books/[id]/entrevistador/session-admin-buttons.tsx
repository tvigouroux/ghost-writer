"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deleteSessionAction,
  resetSessionAction,
} from "@/lib/actions/interviews";

/**
 * "Reiniciar" wipes turns + output, status → draft, JTI rotates (old link
 * invalidated). "Borrar" hard-deletes the session row and everything tied to
 * it; the interviewee row stays so a new session can be created for them.
 */
export function SessionAdminButtons({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    if (!confirm("Esto borra los turnos y la transcripción de esta sesión. ¿Continuar?")) {
      return;
    }
    setError(null);
    start(async () => {
      try {
        await resetSessionAction(sessionId);
        router.refresh();
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  function del() {
    setError(null);
    start(async () => {
      try {
        await deleteSessionAction(sessionId);
        router.refresh();
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={reset}
        className="rounded border border-stone-300 px-2 py-1 text-[10px] uppercase tracking-wider hover:bg-stone-100 disabled:opacity-50 dark:border-stone-700 dark:hover:bg-stone-800"
      >
        {pending ? "..." : "reiniciar"}
      </button>

      {confirmDelete ? (
        <>
          <span className="text-[10px] text-stone-500">¿borrar definitivo?</span>
          <button
            type="button"
            disabled={pending}
            onClick={del}
            className="rounded border border-red-400 bg-red-50 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-red-700 hover:bg-red-100 disabled:opacity-50 dark:border-red-700 dark:bg-red-950 dark:text-red-200 dark:hover:bg-red-900"
          >
            confirmar
          </button>
          <button
            type="button"
            onClick={() => setConfirmDelete(false)}
            className="text-[10px] text-stone-500 hover:text-stone-900 dark:hover:text-stone-100"
          >
            cancelar
          </button>
        </>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={() => setConfirmDelete(true)}
          className="rounded border border-stone-300 px-2 py-1 text-[10px] uppercase tracking-wider text-stone-500 hover:border-red-400 hover:bg-red-50 hover:text-red-700 disabled:opacity-50 dark:border-stone-700 dark:hover:border-red-700 dark:hover:bg-red-950 dark:hover:text-red-200"
        >
          borrar
        </button>
      )}

      {error ? (
        <span className="text-[10px] text-red-700 dark:text-red-300">{error}</span>
      ) : null}
    </div>
  );
}
