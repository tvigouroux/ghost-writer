"use client";

import { useState, useTransition } from "react";
import {
  closeSessionAction,
  startOrContinueAction,
  submitTextTurnAction,
  vetoTurnAction,
  type RoomState,
} from "@/lib/actions/turns";

export function Room({
  token,
  initial,
}: {
  token: string;
  initial: RoomState;
}) {
  const [state, setState] = useState<RoomState>(initial);
  const [draft, setDraft] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const closed = state.status === "closed" || state.status === "delivered";
  const hasInterviewerTurn = state.turns.some((t) => t.role === "interviewer");

  function withTransition(fn: () => Promise<RoomState>) {
    setError(null);
    startTransition(async () => {
      try {
        const next = await fn();
        setState(next);
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col px-4 py-8 sm:px-6">
      <header className="mb-6">
        <p className="text-xs uppercase tracking-wider text-stone-500">
          Entrevista para un libro en construcción
        </p>
        <h1 className="mt-1 text-2xl font-semibold">
          Hola, {state.intervieweeName}
        </h1>
      </header>

      {!hasInterviewerTurn ? (
        <section className="rounded border border-stone-200 p-4 dark:border-stone-800">
          {state.introMd ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {state.introMd}
            </p>
          ) : (
            <p className="text-sm text-stone-500">
              Cuando estés, empezamos.
            </p>
          )}
          <button
            type="button"
            disabled={isPending}
            onClick={() =>
              withTransition(() => startOrContinueAction(token))
            }
            className="mt-4 rounded bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
          >
            {isPending ? "Preparando…" : "Comenzar entrevista"}
          </button>
        </section>
      ) : (
        <ConversationView
          state={state}
          token={token}
          onVeto={(turnId, vetoed) =>
            withTransition(() => vetoTurnAction(token, turnId, vetoed))
          }
        />
      )}

      {hasInterviewerTurn && !closed ? (
        <form
          className="mt-6"
          onSubmit={(e) => {
            e.preventDefault();
            const text = draft.trim();
            if (!text) return;
            setDraft("");
            withTransition(() => submitTextTurnAction(token, text));
          }}
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Tu respuesta…"
            rows={5}
            disabled={isPending}
            className="w-full rounded border border-stone-300 bg-white px-3 py-2 text-sm dark:border-stone-700 dark:bg-stone-900"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={isPending || draft.trim().length === 0}
              className="rounded bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
            >
              {isPending ? "Pensando…" : "Enviar respuesta"}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() =>
                withTransition(() => closeSessionAction(token))
              }
              className="rounded border border-stone-300 px-3 py-2 text-xs text-stone-700 hover:bg-stone-100 disabled:opacity-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-900"
            >
              Terminar entrevista
            </button>
            <span className="text-xs text-stone-500">
              Bloque actual: {state.currentBlockId ?? "—"}
            </span>
          </div>
        </form>
      ) : null}

      {closed ? (
        <section className="mt-6 rounded border border-stone-200 bg-stone-50 p-4 text-sm dark:border-stone-800 dark:bg-stone-900">
          <p className="font-medium">Entrevista cerrada.</p>
          <p className="mt-1 text-stone-500">
            Gracias por tu tiempo. El autor recibirá la transcripción procesada
            para revisar antes de incorporarla al libro.
          </p>
        </section>
      ) : null}

      {error ? (
        <p className="mt-4 text-xs text-red-700 dark:text-red-300">{error}</p>
      ) : null}

      <footer className="mt-auto pt-12 text-center text-[10px] text-stone-400">
        Tus respuestas se procesan después de que termines. Puedes vetar
        cualquier respuesta tuya con el botón "marcar como off-the-record".
      </footer>
    </main>
  );
}

function ConversationView({
  state,
  onVeto,
}: {
  state: RoomState;
  token: string;
  onVeto: (turnId: string, vetoed: boolean) => void;
}) {
  return (
    <ol className="space-y-4">
      {state.turns.map((t) => (
        <li
          key={t.id}
          className={`rounded p-3 text-sm ${
            t.role === "interviewer"
              ? "bg-stone-100 dark:bg-stone-900"
              : "border border-stone-300 dark:border-stone-700"
          }`}
        >
          <div className="mb-1 text-[10px] uppercase tracking-wider text-stone-500">
            {t.role === "interviewer" ? "Pregunta" : "Tu respuesta"}
            {t.vetoed ? " · OFF THE RECORD" : ""}
          </div>
          <p
            className={`whitespace-pre-wrap leading-relaxed ${
              t.vetoed ? "line-through opacity-50" : ""
            }`}
          >
            {t.text}
          </p>
          {t.role === "interviewee" ? (
            <button
              type="button"
              onClick={() => onVeto(t.id, !t.vetoed)}
              className="mt-2 text-[10px] uppercase tracking-wider text-stone-500 hover:text-stone-900 dark:hover:text-stone-100"
            >
              {t.vetoed ? "deshacer veto" : "marcar como off-the-record"}
            </button>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
