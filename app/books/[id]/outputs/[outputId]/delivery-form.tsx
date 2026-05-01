"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  commitAndPushOutputAction,
  depositPendingAction,
} from "@/lib/actions/outputs";

/**
 * Two delivery paths for an approved transcript:
 *   1. Deposit as `_pendiente-<slug>.md` in a directory of the local clone.
 *      The author renames + commits manually from their workstation.
 *   2. Commit and push directly to the book repo's remote (requires
 *      GITHUB_TOKEN). Author types the final relPath and commit message.
 */
export function DeliveryForm({
  outputId,
  defaultRelDir,
  defaultSlug,
  defaultRelPath,
  defaultCommitMessage,
  githubEnabled,
  alreadyDelivered,
}: {
  outputId: string;
  defaultRelDir: string;
  defaultSlug: string;
  defaultRelPath: string;
  defaultCommitMessage: string;
  githubEnabled: boolean;
  alreadyDelivered: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    kind: "deposit" | "commit";
    deliveredMdPath: string;
    commitUrl?: string | null;
  } | null>(null);

  // Deposit form state
  const [relDir, setRelDir] = useState(defaultRelDir);
  const [slug, setSlug] = useState(defaultSlug);

  // Commit form state
  const [relPath, setRelPath] = useState(defaultRelPath);
  const [commitMessage, setCommitMessage] = useState(defaultCommitMessage);
  const [overwriteRequested, setOverwriteRequested] = useState(false);

  function deposit() {
    setError(null);
    setSuccess(null);
    start(async () => {
      try {
        const r = await depositPendingAction({ outputId, relDir, slug });
        setSuccess({ kind: "deposit", deliveredMdPath: r.deliveredMdPath });
        router.refresh();
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  function commit(opts: { overwrite?: boolean } = {}) {
    if (
      !opts.overwrite &&
      !confirm(
        `Esto hace git commit + push directamente a main del repo del libro:\n\n${relPath}\n\nEs visible en GitHub al instante. ¿Seguir?`,
      )
    ) {
      return;
    }
    setError(null);
    setSuccess(null);
    setOverwriteRequested(false);
    start(async () => {
      try {
        const r = await commitAndPushOutputAction({
          outputId,
          relPath,
          commitMessage,
          overwrite: opts.overwrite,
        });
        setSuccess({
          kind: "commit",
          deliveredMdPath: r.deliveredMdPath,
          commitUrl: r.commitUrl,
        });
        router.refresh();
      } catch (err) {
        const msg = (err as Error).message;
        // Detect the OverwriteError signature so the UI can offer a deliberate
        // overwrite path instead of just printing "already exists".
        if (msg.includes("already exists") && msg.includes("Pick a unique path")) {
          setOverwriteRequested(true);
        }
        setError(msg);
      }
    });
  }

  function confirmOverwriteAndCommit() {
    if (
      !confirm(
        `OJO: ${relPath} ya existe en el repo con contenido distinto.\n\nSi confirmás, esta transcripción VA A REEMPLAZAR el archivo entero. El historial de git lo conserva, pero recuperarlo después es manual.\n\n¿Seguro que querés sobreescribir?`,
      )
    ) {
      return;
    }
    commit({ overwrite: true });
  }

  return (
    <section className="mt-10 space-y-6">
      <h2 className="text-sm font-medium uppercase tracking-wider text-stone-500">
        Entrega
      </h2>

      {alreadyDelivered ? (
        <p className="rounded border border-emerald-300 bg-emerald-50 p-3 text-xs text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          Ya depositada en{" "}
          <code className="font-mono">{alreadyDelivered}</code>. Puedes volver
          a entregar (sobrescribirá el archivo).
        </p>
      ) : null}

      {/* Deposit pending */}
      <div className="rounded border border-stone-200 p-4 dark:border-stone-800">
        <h3 className="text-sm font-medium">
          Solo depositar (revisión manual del autor)
        </h3>
        <p className="mt-1 text-xs text-stone-500">
          Escribe{" "}
          <code className="font-mono">
            {relDir}/_pendiente-{slug}.md
          </code>{" "}
          en el clone local. La app no commitea — vos lo movés y commiteás
          desde tu workstation.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="block text-xs font-medium">Carpeta</span>
            <input
              value={relDir}
              onChange={(e) => setRelDir(e.target.value)}
              className="mt-1 w-full rounded border border-stone-300 bg-white px-2 py-1 font-mono text-xs dark:border-stone-700 dark:bg-stone-900"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium">Slug</span>
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              className="mt-1 w-full rounded border border-stone-300 bg-white px-2 py-1 font-mono text-xs dark:border-stone-700 dark:bg-stone-900"
            />
          </label>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={deposit}
          className="mt-3 rounded border border-stone-400 bg-white px-3 py-1.5 text-xs hover:bg-stone-100 disabled:opacity-50 dark:border-stone-600 dark:bg-stone-900 dark:hover:bg-stone-800"
        >
          {pending ? "depositando…" : "Depositar como _pendiente-"}
        </button>
      </div>

      {/* Commit + push */}
      <div className="rounded border border-stone-300 p-4 dark:border-stone-700">
        <h3 className="text-sm font-medium">Commit y push directo a main</h3>
        {!githubEnabled ? (
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
            Para activar este botón, agrega un{" "}
            <code className="font-mono">GITHUB_TOKEN</code> a{" "}
            <code className="font-mono">.env</code> y reinicia el dev server.
          </p>
        ) : (
          <p className="mt-1 text-xs text-stone-500">
            La app hace <code className="font-mono">git pull --ff-only</code>,
            escribe el archivo en el path final, commitea con tu identidad de{" "}
            <code className="font-mono">.env</code> y pushea a{" "}
            <code className="font-mono">origin/main</code>. Visible en GitHub
            al instante.
          </p>
        )}
        <label className="mt-3 block">
          <span className="block text-xs font-medium">Path final en el repo</span>
          <input
            value={relPath}
            onChange={(e) => setRelPath(e.target.value)}
            disabled={!githubEnabled}
            className="mt-1 w-full rounded border border-stone-300 bg-white px-2 py-1 font-mono text-xs disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900"
          />
        </label>
        <label className="mt-2 block">
          <span className="block text-xs font-medium">Mensaje del commit</span>
          <textarea
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            disabled={!githubEnabled}
            rows={3}
            className="mt-1 w-full rounded border border-stone-300 bg-white px-2 py-1 text-xs disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900"
          />
        </label>
        <button
          type="button"
          disabled={pending || !githubEnabled}
          onClick={() => commit()}
          className="mt-3 rounded border border-emerald-500 bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {pending ? "haciendo push…" : "Commit + push a main"}
        </button>
      </div>

      {error ? (
        <p className="rounded border border-red-300 bg-red-50 p-3 text-xs text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      ) : null}

      {success ? (
        <div className="rounded border border-emerald-300 bg-emerald-50 p-3 text-xs text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          {success.kind === "deposit" ? (
            <>
              Depositado en{" "}
              <code className="font-mono">{success.deliveredMdPath}</code>. Ya
              podés inspeccionar / mover / commitear desde tu workstation.
            </>
          ) : (
            <>
              Pusheado a main: <code className="font-mono">{success.deliveredMdPath}</code>.
              {success.commitUrl ? (
                <>
                  {" "}
                  <a
                    href={success.commitUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="underline hover:no-underline"
                  >
                    Ver commit en GitHub →
                  </a>
                </>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
