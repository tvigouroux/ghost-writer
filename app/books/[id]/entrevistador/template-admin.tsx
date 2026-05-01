"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteInterviewTemplateAction } from "@/lib/actions/interviews";

/**
 * Per-template "borrar" affordance with a two-step confirmation. Hard-delete
 * cascades to sessions / turns / outputs of this template. Files already
 * pushed to the book repo are not touched.
 */
export function TemplateAdminButtons({
  templateId,
  templateName,
  sessionCount,
}: {
  templateId: string;
  templateName: string;
  sessionCount: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function del() {
    setError(null);
    start(async () => {
      try {
        await deleteInterviewTemplateAction(templateId);
        router.refresh();
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px]">
      {confirming ? (
        <>
          <span className="text-stone-500">
            ¿borrar <strong>{templateName}</strong>
            {sessionCount > 0
              ? ` y sus ${sessionCount} sesión${sessionCount === 1 ? "" : "es"}?`
              : "?"}
          </span>
          <button
            type="button"
            disabled={pending}
            onClick={del}
            className="rounded border border-red-400 bg-red-50 px-2 py-1 font-medium uppercase tracking-wider text-red-700 hover:bg-red-100 disabled:opacity-50 dark:border-red-700 dark:bg-red-950 dark:text-red-200 dark:hover:bg-red-900"
          >
            confirmar
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="text-stone-500 hover:text-stone-900 dark:hover:text-stone-100"
          >
            cancelar
          </button>
        </>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={() => setConfirming(true)}
          className="rounded border border-stone-300 px-2 py-1 uppercase tracking-wider text-stone-500 hover:border-red-400 hover:bg-red-50 hover:text-red-700 disabled:opacity-50 dark:border-stone-700 dark:hover:border-red-700 dark:hover:bg-red-950 dark:hover:text-red-200"
        >
          borrar
        </button>
      )}
      {error ? (
        <span className="text-red-700 dark:text-red-300">{error}</span>
      ) : null}
    </div>
  );
}
