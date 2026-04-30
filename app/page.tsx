export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Ghost Writer</h1>
      <p className="mt-4 text-stone-600 dark:text-stone-400">
        Plataforma de creación de libros asistida por Claude. MVP en construcción.
      </p>
      <p className="mt-2 text-sm text-stone-500">
        Estado: scaffold listo. Próximo: adapter del CLI de Claude y conexión al repo del libro.
      </p>
    </main>
  );
}
