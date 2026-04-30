"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { relinkBookOriginAction } from "@/lib/actions/books";

export function RemotePanel({
  bookId,
  originUrl,
  isPushable,
  reason,
  detectedGithubUrl,
}: {
  bookId: string;
  originUrl: string | null;
  isPushable: boolean;
  reason: string | null;
  detectedGithubUrl: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [newUrl, setNewUrl] = useState(detectedGithubUrl ?? "");
  const [error, setError] = useState<string | null>(null);

  function relink(url: string) {
    if (!url) return;
    setError(null);
    start(async () => {
      try {
        await relinkBookOriginAction({ bookId, newOriginUrl: url });
        router.refresh();
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  return (
    <section className="mt-8 rounded border border-stone-200 p-4 text-sm dark:border-stone-800">
      <h2 className="font-medium">Remote del clone</h2>
      <p className="mt-1 break-all text-xs text-stone-500">
        <code className="font-mono">{originUrl ?? "(sin origin)"}</code>
      </p>

      {isPushable ? (
        <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">
          Pusheable. La opción "commit y push directo" en cada output funciona
          contra este remoto.
        </p>
      ) : (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {reason ?? "Origin no apto para push."}
          </p>
          {detectedGithubUrl ? (
            <p className="text-xs text-stone-500">
              Detecté un upstream real:{" "}
              <code className="break-all font-mono">{detectedGithubUrl}</code>.{" "}
              <button
                type="button"
                disabled={pending}
                onClick={() => relink(detectedGithubUrl)}
                className="ml-1 rounded border border-stone-400 px-2 py-0.5 text-[10px] uppercase tracking-wider hover:bg-stone-100 disabled:opacity-50 dark:border-stone-600 dark:hover:bg-stone-800"
              >
                {pending ? "..." : "usar este"}
              </button>
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="https://github.com/usuario/libro.git"
              className="min-w-[20rem] flex-1 rounded border border-stone-300 bg-white px-2 py-1 font-mono text-xs dark:border-stone-700 dark:bg-stone-900"
            />
            <button
              type="button"
              disabled={pending || !newUrl}
              onClick={() => relink(newUrl)}
              className="rounded border border-stone-400 px-2 py-1 text-[10px] uppercase tracking-wider hover:bg-stone-100 disabled:opacity-50 dark:border-stone-600 dark:hover:bg-stone-800"
            >
              {pending ? "guardando…" : "Cambiar origin"}
            </button>
          </div>
        </div>
      )}

      {error ? (
        <p className="mt-2 text-xs text-red-700 dark:text-red-300">{error}</p>
      ) : null}
    </section>
  );
}
