"use client";

import { useState, useTransition } from "react";
import { createInterviewTemplateAction } from "@/lib/actions/interviews";
import {
  parseInterviewMdAction,
  type ImportableMd,
  type RepoMdFile,
} from "@/lib/actions/import-template";
import { ContextFilesPicker } from "./context-files-picker";

const DEFAULT_BLOCKS = JSON.stringify(
  [
    {
      id: "block-1",
      title: "Cómo nos conocimos",
      objective:
        "Capturar el primer encuentro y qué impresión inicial causó el autor.",
      seedQuestions: [
        "¿Te acuerdas cómo nos conocimos?",
        "¿Qué pensaste de mí esa primera vez?",
      ],
      mustCover: true,
    },
    {
      id: "block-2",
      title: "Una escena memorable",
      objective: "Pedir un momento concreto, una imagen, no un resumen.",
      seedQuestions: ["¿Hay un momento entre nosotros que se te quedó pegado?"],
      mustCover: true,
    },
  ],
  null,
  2,
);

export function CreateTemplateForm({
  bookId,
  importable,
  repoFiles,
}: {
  bookId: string;
  importable: ImportableMd[];
  repoFiles: RepoMdFile[];
}) {
  const [name, setName] = useState("");
  const [systemPrompt, setSystemPrompt] = useState(
    "Sé cálido y atento. Profundiza si las respuestas son vagas. Una pregunta por turno.",
  );
  const [introMd, setIntroMd] = useState(
    "Hola. Esto es una entrevista para un libro en construcción. Puedes responder por texto o audio. Cuando quieras, empezamos.",
  );
  const [guideBlocksJson, setGuideBlocksJson] = useState(DEFAULT_BLOCKS);
  const [selectedContext, setSelectedContext] = useState<Set<string>>(new Set());
  const [sourceMdPath, setSourceMdPath] = useState("");
  const [respuestasMdPath, setRespuestasMdPath] = useState("");
  const [importPath, setImportPath] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [submitting, startTransition] = useTransition();
  const [importing, startImport] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function handleImport() {
    if (!importPath) return;
    setError(null);
    setSuccess(false);
    startImport(async () => {
      try {
        const result = await parseInterviewMdAction({ bookId, relPath: importPath });
        setName(result.parsed.name);
        if (result.parsed.introMd) setIntroMd(result.parsed.introMd);
        setGuideBlocksJson(result.guideBlocksJson);
        setSourceMdPath(result.sourceMdPath);
        setWarnings(result.parsed.warnings);
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  return (
    <div className="mt-3 space-y-3 rounded border border-stone-200 p-4 dark:border-stone-800">
      {importable.length > 0 ? (
        <div className="rounded bg-stone-100 p-3 text-xs dark:bg-stone-900">
          <div className="mb-2 font-medium">
            Importar desde el repo del libro
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={importPath}
              onChange={(e) => setImportPath(e.target.value)}
              className="min-w-[18rem] rounded border border-stone-300 bg-white px-2 py-1 text-xs dark:border-stone-700 dark:bg-stone-950"
            >
              <option value="">— elegir un .md del repo —</option>
              {importable.map((m) => (
                <option key={m.path} value={m.path}>
                  {m.path}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!importPath || importing}
              onClick={handleImport}
              className="rounded border border-stone-400 px-2 py-1 text-[10px] uppercase tracking-wider hover:bg-stone-200 disabled:opacity-50 dark:border-stone-600 dark:hover:bg-stone-800"
            >
              {importing ? "leyendo…" : "importar"}
            </button>
          </div>
          {warnings.length > 0 ? (
            <ul className="mt-2 space-y-1 text-[10px] text-amber-700 dark:text-amber-400">
              {warnings.map((w, i) => (
                <li key={i}>· {w}</li>
              ))}
            </ul>
          ) : null}
          <p className="mt-2 text-[10px] text-stone-500">
            Best-effort: revisa los bloques antes de guardar. La parseada
            siempre te deja editar todo.
          </p>
        </div>
      ) : (
        <p className="text-xs text-stone-500">
          No se detectaron archivos importables en{" "}
          <code className="font-mono">entrevistas/</code> del repo del libro.
        </p>
      )}

      <form
        action={(formData) => {
          setError(null);
          setSuccess(false);
          // Inject the controlled values into formData since they're not
          // bound to inputs as defaultValue (we manage them with state).
          formData.set("name", name);
          formData.set("systemPrompt", systemPrompt);
          formData.set("introMd", introMd);
          formData.set("guideBlocksJson", guideBlocksJson);
          formData.set(
            "contextFilesText",
            [...selectedContext].sort().join("\n"),
          );
          formData.set("sourceMdPath", sourceMdPath);
          formData.set("respuestasMdPath", respuestasMdPath);
          startTransition(async () => {
            try {
              await createInterviewTemplateAction(formData);
              setSuccess(true);
              setName("");
              setSourceMdPath("");
              setSelectedContext(new Set());
              setWarnings([]);
            } catch (err) {
              setError((err as Error).message);
            }
          });
        }}
        className="space-y-3"
      >
        <input type="hidden" name="bookId" value={bookId} />
        <Field
          label="Nombre"
          required
          value={name}
          onChange={setName}
          placeholder="Entrevista 03 — Daniela"
        />
        <FieldLong
          label="System prompt (reglas adicionales para el agente entrevistador)"
          required
          value={systemPrompt}
          onChange={setSystemPrompt}
        />
        <FieldLong
          label="Intro markdown (lo que ve el entrevistado al abrir el link)"
          value={introMd}
          onChange={setIntroMd}
        />
        <FieldLong
          label="Guide blocks (JSON)"
          required
          value={guideBlocksJson}
          onChange={setGuideBlocksJson}
          monospace
          rows={14}
        />
        <div>
          <span className="block text-sm font-medium">
            Archivos de contexto del repo
          </span>
          <p className="mt-1 text-xs text-stone-500">
            Lo que marques se pasa al agente como contexto curado por turno.
            Default cerrado: si no marcas nada, el entrevistador trabaja solo
            con el guion y el CLAUDE.md del libro.
          </p>
          <div className="mt-2">
            <ContextFilesPicker
              files={repoFiles}
              selected={selectedContext}
              onChange={setSelectedContext}
            />
          </div>
        </div>
        <Field
          label="Source markdown path (si vino de un .md del repo)"
          value={sourceMdPath}
          onChange={setSourceMdPath}
          placeholder="entrevistas/terceros/03-daniela.md"
        />

        <div>
          <span className="block text-sm font-medium">
            Archivo de respuestas acumulado
          </span>
          <p className="mt-1 text-xs text-stone-500">
            Si ya existe un{" "}
            <code className="font-mono">*-respuestas.md</code> con sesiones
            previas, elegilo acá. Cada cierre de sesión va a{" "}
            <strong>enriquecer</strong> ese archivo en lugar de crear uno
            nuevo. Si lo dejás vacío, se infiere desde el source path
            agregando{" "}
            <code className="font-mono">-respuestas.md</code>.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select
              value={
                repoFiles.some((f) => f.path === respuestasMdPath)
                  ? respuestasMdPath
                  : ""
              }
              onChange={(e) => setRespuestasMdPath(e.target.value)}
              className="min-w-[24rem] flex-1 rounded border border-stone-300 bg-white px-2 py-1 font-mono text-xs dark:border-stone-700 dark:bg-stone-900"
            >
              <option value="">— sin acumulador (se infiere) —</option>
              {repoFiles
                .filter((f) => /-respuestas\.md$/i.test(f.path))
                .map((f) => (
                  <option key={f.path} value={f.path}>
                    {f.path}
                  </option>
                ))}
            </select>
            <input
              value={respuestasMdPath}
              onChange={(e) => setRespuestasMdPath(e.target.value)}
              placeholder="o escribilo a mano"
              className="min-w-[14rem] flex-1 rounded border border-stone-300 bg-white px-2 py-1 font-mono text-xs dark:border-stone-700 dark:bg-stone-900"
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
        >
          {submitting ? "Guardando…" : "Crear template"}
        </button>
        {error ? (
          <p className="text-xs text-red-700 dark:text-red-300">{error}</p>
        ) : null}
        {success ? (
          <p className="text-xs text-emerald-700 dark:text-emerald-400">
            Template creado.
          </p>
        ) : null}
      </form>
    </div>
  );
}

function Field({
  label,
  required,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  required?: boolean;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium">{label}</span>
      <input
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded border border-stone-300 bg-white px-3 py-2 text-sm dark:border-stone-700 dark:bg-stone-900"
      />
    </label>
  );
}

function FieldLong({
  label,
  required,
  value,
  onChange,
  placeholder,
  monospace,
  rows = 4,
}: {
  label: string;
  required?: boolean;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  monospace?: boolean;
  rows?: number;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium">{label}</span>
      <textarea
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className={`mt-1 w-full rounded border border-stone-300 bg-white px-3 py-2 text-sm dark:border-stone-700 dark:bg-stone-900 ${
          monospace ? "font-mono text-xs" : ""
        }`}
      />
    </label>
  );
}
