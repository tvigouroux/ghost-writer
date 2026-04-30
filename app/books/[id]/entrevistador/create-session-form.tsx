"use client";

import { useState, useTransition } from "react";
import { createSessionAction } from "@/lib/actions/interviews";

export function CreateSessionForm({
  bookId,
  templates,
  interviewees,
}: {
  bookId: string;
  templates: { id: string; name: string }[];
  interviewees: { id: string; displayName: string }[];
}) {
  const [isPending, startTransition] = useTransition();
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  return (
    <form
      action={(formData) => {
        setError(null);
        setLink(null);
        startTransition(async () => {
          try {
            const result = await createSessionAction(formData);
            setLink(result.link);
          } catch (err) {
            setError((err as Error).message);
          }
        });
      }}
      className="mt-3 space-y-3 rounded border border-stone-200 p-4 dark:border-stone-800"
    >
      <input type="hidden" name="bookId" value={bookId} />
      <label className="block">
        <span className="block text-sm font-medium">Template</span>
        <select
          name="templateId"
          required
          className="mt-1 w-full rounded border border-stone-300 bg-white px-3 py-2 text-sm dark:border-stone-700 dark:bg-stone-900"
        >
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="block text-sm font-medium">Entrevistado</span>
        <select
          name="intervieweeId"
          required
          className="mt-1 w-full rounded border border-stone-300 bg-white px-3 py-2 text-sm dark:border-stone-700 dark:bg-stone-900"
        >
          {interviewees.map((i) => (
            <option key={i.id} value={i.id}>
              {i.displayName}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        disabled={isPending}
        className="rounded bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
      >
        {isPending ? "Generando…" : "Crear sesión + link"}
      </button>

      {error ? (
        <p className="text-xs text-red-700 dark:text-red-300">{error}</p>
      ) : null}
      {link ? (
        <div className="rounded bg-stone-100 p-3 text-xs dark:bg-stone-900">
          <div className="mb-1 font-medium">Link generado (válido 72h):</div>
          <div className="flex items-center gap-2">
            <code className="break-all font-mono">{link}</code>
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(link);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="shrink-0 rounded border border-stone-400 px-2 py-1 text-[10px] uppercase tracking-wider hover:bg-stone-200 dark:border-stone-600 dark:hover:bg-stone-800"
            >
              {copied ? "copiado" : "copiar"}
            </button>
          </div>
        </div>
      ) : null}
    </form>
  );
}
