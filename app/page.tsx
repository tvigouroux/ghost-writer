import Link from "next/link";
import { connectBookAction, listBooksForCurrentAuthor } from "@/lib/actions/books";

export default async function Home() {
  let books: Awaited<ReturnType<typeof listBooksForCurrentAuthor>> = [];
  let authError: string | null = null;
  try {
    books = await listBooksForCurrentAuthor();
  } catch (err) {
    authError = (err as Error).message;
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-10">
        <h1 className="text-3xl font-semibold tracking-tight">Ghost Writer</h1>
        <p className="mt-2 text-sm text-stone-500">
          Plataforma de creación de libros asistida por Claude.
        </p>
      </header>

      {authError ? (
        <div className="rounded border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          <strong>Auth no configurada.</strong> Setea{" "}
          <code className="font-mono">DEV_AUTHOR_EMAIL</code> en{" "}
          <code className="font-mono">.env</code> y reinicia el dev server.
          <div className="mt-2 text-xs opacity-80">{authError}</div>
        </div>
      ) : (
        <>
          <section className="mb-12">
            <h2 className="mb-3 text-xl font-medium">Tus libros</h2>
            {books.length === 0 ? (
              <p className="text-sm text-stone-500">
                Todavía no has conectado ningún libro.
              </p>
            ) : (
              <ul className="space-y-2">
                {books.map((b) => (
                  <li
                    key={b.id}
                    className="rounded border border-stone-200 p-4 dark:border-stone-800"
                  >
                    <Link
                      href={`/books/${b.id}`}
                      className="font-medium hover:underline"
                    >
                      {b.title}
                    </Link>
                    <div className="mt-1 text-xs text-stone-500">
                      <code className="font-mono">{b.repoLocalPath}</code>
                      {" · "}
                      idioma: {b.defaultLanguage}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-xl font-medium">Conectar un libro</h2>
            <p className="mb-4 text-sm text-stone-500">
              Pásame la URL de un repo de GitHub (https) o un path local
              (preferentemente un repo git ya inicializado). La app lo va a
              clonar a{" "}
              <code className="font-mono">data/book-clones/&#123;book_id&#125;/</code>{" "}
              y trabajar contra esa copia.
            </p>
            <form action={connectBookAction} className="space-y-3">
              <Field name="title" label="Título de trabajo" required />
              <Field
                name="source"
                label="Source (URL o path local)"
                required
                placeholder="https://github.com/usuario/libro.git  o  C:/ruta/al/repo"
              />
              <Field
                name="repoUrl"
                label="URL del repo (opcional, para mostrar)"
                placeholder="https://github.com/usuario/libro"
              />
              <Field
                name="defaultLanguage"
                label="Idioma del libro (BCP-47)"
                placeholder="es"
                defaultValue="es"
              />
              <button
                type="submit"
                className="rounded bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
              >
                Conectar libro
              </button>
            </form>
          </section>
        </>
      )}
    </main>
  );
}

function Field({
  name,
  label,
  required,
  placeholder,
  defaultValue,
}: {
  name: string;
  label: string;
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium">{label}</span>
      <input
        name={name}
        required={required}
        placeholder={placeholder}
        defaultValue={defaultValue}
        className="mt-1 w-full rounded border border-stone-300 bg-white px-3 py-2 text-sm dark:border-stone-700 dark:bg-stone-900"
      />
    </label>
  );
}
