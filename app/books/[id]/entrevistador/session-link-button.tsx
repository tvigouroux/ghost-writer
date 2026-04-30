"use client";

import { useState, useTransition } from "react";
import { regenerateSessionLinkAction } from "@/lib/actions/interviews";

export function SessionLinkButton({
  sessionId,
  disabled,
  disabledReason,
}: {
  sessionId: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (disabled) {
    return (
      <span className="text-[10px] uppercase tracking-wider text-stone-500">
        {disabledReason ?? "no disponible"}
      </span>
    );
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            try {
              const result = await regenerateSessionLinkAction(sessionId);
              setLink(result.link);
            } catch (err) {
              setError((err as Error).message);
            }
          });
        }}
        className="rounded border border-stone-300 px-2 py-1 text-[10px] uppercase tracking-wider hover:bg-stone-100 disabled:opacity-50 dark:border-stone-700 dark:hover:bg-stone-800"
      >
        {isPending ? "generando…" : link ? "regenerar link" : "obtener link"}
      </button>

      {link ? (
        <div className="mt-2 rounded bg-stone-100 p-2 text-[11px] dark:bg-stone-900">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-stone-500">
            Link nuevo (válido 72h, invalida el anterior)
          </div>
          <div className="flex items-center gap-2">
            <code className="break-all font-mono">{link}</code>
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(link);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="shrink-0 rounded border border-stone-400 px-2 py-0.5 text-[10px] uppercase tracking-wider hover:bg-stone-200 dark:border-stone-600 dark:hover:bg-stone-800"
            >
              {copied ? "copiado" : "copiar"}
            </button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p className="mt-1 text-[10px] text-red-700 dark:text-red-300">{error}</p>
      ) : null}
    </div>
  );
}
