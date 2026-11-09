import type { FileDocument, IndentWith, ProjectSummary } from "@cloudai/shared"
import { css } from "@codemirror/lang-css"
import { html } from "@codemirror/lang-html"
import { javascript } from "@codemirror/lang-javascript"
import { json } from "@codemirror/lang-json"
import { markdown } from "@codemirror/lang-markdown"
import { python } from "@codemirror/lang-python"
import { HighlightStyle, indentUnit, syntaxHighlighting } from "@codemirror/language"
import { EditorState } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { tags } from "@lezer/highlight"
import CodeMirror from "@uiw/react-codemirror"
import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { ApiError, api } from "@/lib/api"

const highlight = HighlightStyle.define([
  { tag: tags.keyword, color: "#c4b5fd" },
  { tag: tags.string, color: "#86efac" },
  { tag: tags.number, color: "#fdba74" },
  { tag: tags.comment, color: "#71717a", fontStyle: "italic" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "#93c5fd" },
  { tag: [tags.className, tags.typeName], color: "#fcd34d" },
  { tag: [tags.propertyName, tags.attributeName], color: "#67e8f9" },
  { tag: [tags.bool, tags.null, tags.atom], color: "#fdba74" },
  { tag: [tags.operator, tags.punctuation, tags.bracket], color: "#d4d4d8" },
  { tag: [tags.heading, tags.tagName], color: "#f9a8d4" },
  { tag: tags.regexp, color: "#86efac" },
])

const chrome = EditorView.theme(
  {
    "&": { height: "100%", backgroundColor: "#0c0c0e", color: "#fafafa" },
    ".cm-scroller": { fontFamily: '"IBM Plex Mono", ui-monospace, monospace', lineHeight: "1.55" },
    ".cm-content": { caretColor: "#fafafa" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#fafafa" },
    "&.cm-focused": { outline: "none" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: "#3f3f46",
    },
    ".cm-gutters": { backgroundColor: "#09090b", color: "#a1a1aa", border: "none" },
    ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "#18181b" },
  },
  { dark: true },
)

export function FileEditor({
  project,
  path,
  fullscreen,
  onClose,
  onSaved,
  onProject,
}: {
  project: ProjectSummary
  path: string
  fullscreen: boolean
  onClose: () => void
  onSaved: () => void
  onProject: (project: ProjectSummary) => void
}) {
  const [document, setDocument] = useState<FileDocument | null>(null)
  const [draft, setDraft] = useState("")
  const [saved, setSaved] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const extensions = useMemo(() => {
    const unit = project.indentWith === "tab" ? "\t" : " ".repeat(project.indentSize)
    return [
      chrome,
      syntaxHighlighting(highlight),
      languageOf(path),
      indentUnit.of(unit),
      EditorState.tabSize.of(project.indentSize),
      EditorView.lineWrapping,
    ]
  }, [path, project.indentSize, project.indentWith])

  useEffect(() => {
    let cancel = false
    setDocument(null)
    setDraft("")
    setSaved("")
    setError(null)
    setNotice(null)
    api<FileDocument>(`/api/projects/${project.id}/file?path=${encodeURIComponent(path)}`)
      .then((body) => {
        if (cancel) return
        setDocument(body)
        setDraft(body.text ?? "")
        setSaved(body.text ?? "")
      })
      .catch((caught: unknown) => {
        if (!cancel) setError(caught instanceof ApiError ? caught.message : "File non letto")
      })
    return () => {
      cancel = true
    }
  }, [project.id, path])

  async function save() {
    if (!project.canWrite || !document || document.binary || document.tooLarge || draft === saved) return
    setPending(true)
    setError(null)
    try {
      await api(`/api/projects/${project.id}/file`, {
        method: "PUT",
        body: JSON.stringify({ path, text: draft }),
      })
      setSaved(draft)
      setNotice("Salvato")
      onSaved()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "File non salvato")
    } finally {
      setPending(false)
    }
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === "s") {
        event.preventDefault()
        void save()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  const blocked = document?.binary || document?.tooLarge
  const download = `/api/projects/${project.id}/raw?path=${encodeURIComponent(path)}`

  return (
    <section className={`flex min-h-0 flex-col bg-background ${fullscreen ? "fixed inset-0 z-50" : "h-full"}`}>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          Chiudi
        </Button>
        <h2 className="min-w-0 flex-1 truncate font-mono text-xs">{path}</h2>
        <label className="text-xs text-muted-foreground" htmlFor={`indent-${path}`}>
          Indentazione
        </label>
        <select
          id={`indent-${path}`}
          disabled={!project.canWrite}
          value={project.indentWith}
          onChange={(event) => void changeIndent(event.target.value === "tab" ? "tab" : "space", project.indentSize)}
          className="h-8 rounded-md border border-border bg-background px-2 text-xs disabled:text-muted-foreground"
        >
          <option value="space">Spazi</option>
          <option value="tab">Tab</option>
        </select>
        <select
          aria-label="Larghezza indentazione"
          disabled={!project.canWrite || project.indentWith === "tab"}
          value={project.indentSize}
          onChange={(event) => void changeIndent(project.indentWith, Number(event.target.value))}
          className="h-8 rounded-md border border-border bg-background px-2 text-xs disabled:text-muted-foreground"
        >
          {[2, 4, 8].map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
        {project.canWrite && !blocked ? (
          <Button type="button" size="sm" disabled={pending || draft === saved} onClick={() => void save()}>
            Salva
          </Button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1">
        {error ? <p className="p-4 text-sm text-red-300">{error}</p> : null}
        {!document && !error ? <p className="p-4 text-sm text-muted-foreground">Apro il file…</p> : null}
        {blocked ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-sm text-muted-foreground">
            <p>{document?.binary ? "File binario." : "File troppo grande per l’editor."}</p>
            <a className="text-foreground underline" href={download}>
              Scarica
            </a>
          </div>
        ) : null}
        {document && !blocked ? (
          <CodeMirror
            key={path}
            className="h-full overflow-hidden"
            value={draft}
            height="100%"
            theme="none"
            editable={project.canWrite}
            basicSetup
            indentWithTab
            extensions={extensions}
            onChange={(value) => {
              setDraft(value)
              setNotice(null)
            }}
          />
        ) : null}
      </div>
      <p className="border-t border-border px-3 py-1 text-xs text-muted-foreground">
        {project.canWrite ? (notice ?? (draft === saved ? "" : "Modifiche non salvate")) : "Sola lettura"}
      </p>
    </section>
  )

  async function changeIndent(indentWith: IndentWith, indentSize: number) {
    try {
      const next = await api<ProjectSummary>(`/api/projects/${project.id}`, {
        method: "PATCH",
        body: JSON.stringify({ indentSize, indentWith }),
      })
      onProject(next)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Indentazione non aggiornata")
    }
  }
}

function languageOf(path: string) {
  const ext = path.split(".").pop()?.toLowerCase() ?? ""
  if (ext === "ts" || ext === "tsx" || ext === "js" || ext === "jsx" || ext === "mjs" || ext === "cjs") {
    return javascript({ typescript: ext === "ts" || ext === "tsx", jsx: ext === "tsx" || ext === "jsx" })
  }
  if (ext === "py") return python()
  if (ext === "json") return json()
  if (ext === "md" || ext === "mdx") return markdown()
  if (ext === "html" || ext === "htm") return html()
  if (ext === "css") return css()
  return []
}
