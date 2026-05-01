import Link from "next/link";
import { notFound } from "next/navigation";
import { getOutputForAuthor } from "@/lib/actions/outputs";
import { DeliveryForm } from "./delivery-form";
import { RegenerateOutputButton } from "./regenerate-button";

export const dynamic = "force-dynamic";

export default async function OutputPage({
  params,
}: {
  params: Promise<{ id: string; outputId: string }>;
}) {
  const { id: bookId, outputId } = await params;
  const data = await getOutputForAuthor(outputId);
  if (!data) notFound();

  const { output, session, template, book, interviewee } = data;

  // Suggested defaults for the delivery form. The author can override.
  // Default to the aggregator path: explicit respuestasMdPath on the
  // template, or inferred sibling of sourceMdPath. Cumulative across
  // sessions — the renderer enriches this file every time.
  const sourceMdPath = template.sourceMdPath ?? "";
  const sourceDir = sourceMdPath.includes("/")
    ? sourceMdPath.slice(0, sourceMdPath.lastIndexOf("/"))
    : "entrevistas/terceros";
  const sourceBase = sourceMdPath
    ? sourceMdPath.slice(sourceMdPath.lastIndexOf("/") + 1).replace(/\.md$/, "")
    : "entrevista";
  const inferredAggregator = sourceMdPath
    ? /-respuestas\.md$/i.test(sourceMdPath)
      ? sourceMdPath
      : `${sourceDir}/${sourceBase}-respuestas.md`
    : `${sourceDir}/entrevista-respuestas.md`;
  const suggestedRelPath = template.respuestasMdPath || inferredAggregator;
  const suggestedSlug = suggestedRelPath
    .slice(suggestedRelPath.lastIndexOf("/") + 1)
    .replace(/\.md$/, "");
  const closedAt = session.closedAt
    ? new Date(session.closedAt).toISOString().slice(0, 10)
    : "session-incomplete";
  const suggestedCommitMessage = `Add ${suggestedRelPath}\n\nProcessed transcript from session ${session.id} closed ${closedAt}.\nInterviewee: ${interviewee?.displayName ?? "—"}.`;
  const githubEnabled = Boolean(process.env.GITHUB_TOKEN);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link
        href={`/books/${bookId}/entrevistador`}
        className="text-xs text-stone-500 hover:text-stone-900 dark:hover:text-stone-100"
      >
        ← entrevistador
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        Transcripción procesada
      </h1>
      <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
        <dt className="text-stone-500">Libro</dt>
        <dd>{book.title}</dd>
        <dt className="text-stone-500">Template</dt>
        <dd>{template.name}</dd>
        <dt className="text-stone-500">Entrevistado</dt>
        <dd>
          {interviewee?.displayName ?? "?"}
          {interviewee?.relation ? ` (${interviewee.relation})` : ""}
        </dd>
        <dt className="text-stone-500">Sesión</dt>
        <dd>
          {session.status} ·{" "}
          {session.closedAt
            ? new Date(session.closedAt).toISOString().slice(0, 16)
            : "—"}
        </dd>
        <dt className="text-stone-500">Aprobada</dt>
        <dd>{output.approvedByAuthor ? "sí" : "no"}</dd>
        {output.deliveredMdPath ? (
          <>
            <dt className="text-stone-500">Depositada en</dt>
            <dd className="break-all font-mono">{output.deliveredMdPath}</dd>
          </>
        ) : null}
      </dl>

      <div className="mt-4 flex flex-wrap gap-2">
        <RegenerateOutputButton sessionId={session.id} />
      </div>

      <section className="mt-8">
        <h2 className="text-sm font-medium uppercase tracking-wider text-stone-500">
          Markdown
        </h2>
        <pre className="mt-2 max-h-[70vh] overflow-auto rounded border border-stone-200 bg-stone-50 p-4 text-xs leading-relaxed dark:border-stone-800 dark:bg-stone-900">
          {output.processedMd}
        </pre>
      </section>

      <DeliveryForm
        outputId={output.id}
        defaultRelDir={sourceDir}
        defaultSlug={suggestedSlug}
        defaultRelPath={suggestedRelPath}
        defaultCommitMessage={suggestedCommitMessage}
        githubEnabled={githubEnabled}
        alreadyDelivered={output.deliveredMdPath}
      />
    </main>
  );
}
