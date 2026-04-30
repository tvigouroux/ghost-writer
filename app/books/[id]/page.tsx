import Link from "next/link";
import { notFound } from "next/navigation";
import { getBookById } from "@/lib/actions/books";

export default async function BookOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const book = await getBookById(id);
  if (!book) notFound();

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link
        href="/"
        className="text-xs text-stone-500 hover:text-stone-900 dark:hover:text-stone-100"
      >
        ← libros
      </Link>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">
        {book.title}
      </h1>
      <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-stone-500">Idioma</dt>
        <dd>{book.defaultLanguage}</dd>
        <dt className="text-stone-500">Clone local</dt>
        <dd className="break-all font-mono text-xs">{book.repoLocalPath}</dd>
        {book.repoUrl ? (
          <>
            <dt className="text-stone-500">Repo</dt>
            <dd>
              <a
                href={book.repoUrl}
                target="_blank"
                rel="noreferrer"
                className="text-stone-900 underline hover:no-underline dark:text-stone-100"
              >
                {book.repoUrl}
              </a>
            </dd>
          </>
        ) : null}
        <dt className="text-stone-500">Modos</dt>
        <dd>{(JSON.parse(book.enabledModes) as string[]).join(", ")}</dd>
      </dl>

      <section className="mt-12">
        <h2 className="text-xl font-medium">Modos</h2>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          <ModeCard
            href={`/books/${book.id}/entrevistador`}
            title="Entrevistador"
            available
            description="Conducí entrevistas a terceros con un link único. Las transcripciones procesadas se depositan en el repo del libro como _pendiente-*.md."
          />
          <ModeCard
            title="Arquitecto"
            description="Edición del outline y planificación de capítulos."
            available={false}
          />
          <ModeCard
            title="Escritor"
            description="Borrador de capítulos a partir de entrevistas + outline."
            available={false}
          />
          <ModeCard
            title="Investigador"
            description="Detección de inconsistencias y chequeo factual."
            available={false}
          />
        </ul>
      </section>
    </main>
  );
}

function ModeCard({
  href,
  title,
  description,
  available,
}: {
  href?: string;
  title: string;
  description: string;
  available: boolean;
}) {
  const inner = (
    <div
      className={`rounded border p-4 ${
        available
          ? "border-stone-300 hover:border-stone-900 dark:border-stone-700 dark:hover:border-stone-100"
          : "border-dashed border-stone-300 opacity-50 dark:border-stone-700"
      }`}
    >
      <div className="flex items-baseline justify-between">
        <span className="font-medium">{title}</span>
        {!available ? (
          <span className="text-[10px] uppercase tracking-wider text-stone-500">
            próximamente
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-stone-500">{description}</p>
    </div>
  );
  return available && href ? <Link href={href}>{inner}</Link> : <li>{inner}</li>;
}
