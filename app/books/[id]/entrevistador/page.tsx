import Link from "next/link";
import { notFound } from "next/navigation";
import { getBookById } from "@/lib/actions/books";
import {
  createInterviewTemplateAction,
  createIntervieweeAction,
  listInterviewees,
  listInterviewTemplates,
  listSessions,
} from "@/lib/actions/interviews";
import { CreateSessionForm } from "./create-session-form";

const SAMPLE_BLOCKS = JSON.stringify(
  [
    {
      id: "block-1",
      title: "Cómo nos conocimos",
      objective:
        "Capturar el primer encuentro y qué impresión inicial causó el autor.",
      seedQuestions: [
        "¿Te acordás cómo nos conocimos?",
        "¿Qué pensaste de mí esa primera vez?",
      ],
      mustCover: true,
    },
    {
      id: "block-2",
      title: "Una escena memorable",
      objective: "Pedir un momento concreto, una imagen, no un resumen.",
      seedQuestions: ["¿Hay un momento entre nosotros que te quedó pegado?"],
      mustCover: true,
    },
  ],
  null,
  2,
);

export default async function InterviewerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: bookId } = await params;
  const book = await getBookById(bookId);
  if (!book) notFound();

  const [templates, interviewees, sessions] = await Promise.all([
    listInterviewTemplates(bookId),
    listInterviewees(bookId),
    listSessions(bookId),
  ]);

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <Link
        href={`/books/${bookId}`}
        className="text-xs text-stone-500 hover:text-stone-900 dark:hover:text-stone-100"
      >
        ← {book.title}
      </Link>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Entrevistador</h1>
      <p className="mt-1 text-sm text-stone-500">
        Templates, entrevistados y sesiones para este libro.
      </p>

      <section className="mt-10">
        <h2 className="text-xl font-medium">Templates</h2>
        {templates.length === 0 ? (
          <p className="mt-2 text-sm text-stone-500">
            No hay templates todavía. Crea uno abajo.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {templates.map((t) => (
              <li
                key={t.id}
                className="rounded border border-stone-200 p-3 text-sm dark:border-stone-800"
              >
                <div className="font-medium">{t.name}</div>
                <div className="text-xs text-stone-500">
                  {(JSON.parse(t.guideBlocks) as { id: string }[]).length}{" "}
                  bloques · contexto:{" "}
                  {(JSON.parse(t.contextFiles) as string[]).length} archivos
                </div>
              </li>
            ))}
          </ul>
        )}
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-medium">
            Crear template
          </summary>
          <form
            action={createInterviewTemplateAction}
            className="mt-3 space-y-3 rounded border border-stone-200 p-4 dark:border-stone-800"
          >
            <input type="hidden" name="bookId" value={bookId} />
            <FieldShort name="name" label="Nombre" required />
            <FieldLong
              name="systemPrompt"
              label="System prompt (reglas adicionales para el agente entrevistador)"
              required
              defaultValue="Sé cálido y atento. Profundizá si las respuestas son vagas. Una pregunta por turno."
            />
            <FieldLong
              name="introMd"
              label="Intro markdown (lo que ve el entrevistado al abrir el link)"
              defaultValue="Hola. Esto es una entrevista para un libro en construcción. Puedes responder por texto o audio. Cuando quieras, empezamos."
            />
            <FieldLong
              name="guideBlocksJson"
              label="Guide blocks (JSON)"
              required
              defaultValue={SAMPLE_BLOCKS}
              monospace
              rows={14}
            />
            <FieldLong
              name="contextFilesText"
              label="Archivos de contexto del repo (uno por línea, paths relativos)"
              placeholder={"outline.md\nacerca-de-mi.md\ncapitulos/01-slug.md"}
              monospace
            />
            <FieldShort
              name="sourceMdPath"
              label="Source markdown path (opcional, si el template viene de un .md del repo)"
            />
            <button
              type="submit"
              className="rounded bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-900"
            >
              Crear template
            </button>
          </form>
        </details>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-medium">Entrevistados</h2>
        {interviewees.length === 0 ? (
          <p className="mt-2 text-sm text-stone-500">
            No hay entrevistados todavía.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {interviewees.map((i) => (
              <li
                key={i.id}
                className="rounded border border-stone-200 p-3 text-sm dark:border-stone-800"
              >
                <div className="font-medium">{i.displayName}</div>
                {i.relation ? (
                  <div className="text-xs text-stone-500">{i.relation}</div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-medium">
            Agregar entrevistado
          </summary>
          <form
            action={createIntervieweeAction}
            className="mt-3 space-y-3 rounded border border-stone-200 p-4 dark:border-stone-800"
          >
            <input type="hidden" name="bookId" value={bookId} />
            <FieldShort name="displayName" label="Nombre" required />
            <FieldShort name="relation" label="Relación con el autor" />
            <FieldLong name="notes" label="Notas privadas del autor" />
            <button
              type="submit"
              className="rounded bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-900"
            >
              Agregar entrevistado
            </button>
          </form>
        </details>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-medium">Sesiones</h2>
        {sessions.length === 0 ? (
          <p className="mt-2 text-sm text-stone-500">
            Todavía no has creado ninguna sesión.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {sessions.map((s) => {
              const interviewee = interviewees.find(
                (i) => i.id === s.intervieweeId,
              );
              const template = templates.find((t) => t.id === s.templateId);
              return (
                <li
                  key={s.id}
                  className="rounded border border-stone-200 p-3 text-sm dark:border-stone-800"
                >
                  <div className="font-medium">
                    {interviewee?.displayName ?? "?"} · {template?.name ?? "?"}
                  </div>
                  <div className="text-xs text-stone-500">
                    estado: {s.status} · jti: {s.tokenJti}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <details className="mt-4" open={templates.length > 0 && interviewees.length > 0}>
          <summary className="cursor-pointer text-sm font-medium">
            Crear sesión y generar link
          </summary>
          {templates.length === 0 || interviewees.length === 0 ? (
            <p className="mt-3 text-sm text-stone-500">
              Necesitas al menos un template y un entrevistado primero.
            </p>
          ) : (
            <CreateSessionForm
              bookId={bookId}
              templates={templates.map((t) => ({ id: t.id, name: t.name }))}
              interviewees={interviewees.map((i) => ({
                id: i.id,
                displayName: i.displayName,
              }))}
            />
          )}
        </details>
      </section>
    </main>
  );
}

function FieldShort({
  name,
  label,
  required,
  defaultValue,
  placeholder,
}: {
  name: string;
  label: string;
  required?: boolean;
  defaultValue?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium">{label}</span>
      <input
        name={name}
        required={required}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="mt-1 w-full rounded border border-stone-300 bg-white px-3 py-2 text-sm dark:border-stone-700 dark:bg-stone-900"
      />
    </label>
  );
}

function FieldLong({
  name,
  label,
  required,
  defaultValue,
  placeholder,
  monospace,
  rows = 4,
}: {
  name: string;
  label: string;
  required?: boolean;
  defaultValue?: string;
  placeholder?: string;
  monospace?: boolean;
  rows?: number;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium">{label}</span>
      <textarea
        name={name}
        required={required}
        defaultValue={defaultValue}
        placeholder={placeholder}
        rows={rows}
        className={`mt-1 w-full rounded border border-stone-300 bg-white px-3 py-2 text-sm dark:border-stone-700 dark:bg-stone-900 ${
          monospace ? "font-mono text-xs" : ""
        }`}
      />
    </label>
  );
}
