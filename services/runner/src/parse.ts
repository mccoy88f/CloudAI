import type { EngineKind, RunnerEvent } from "@cloudai/shared"

export type Parser = (line: string) => RunnerEvent[]

export function createClaudeParser(): Parser {
  return (line) => {
    const message = parseJson(line)
    if (!message) return []
    const events: RunnerEvent[] = []
    if (message.type === "system" && message.subtype === "init" && typeof message.session_id === "string") {
      events.push({ type: "native", sessionId: message.session_id })
    }
    if (message.type === "stream_event") {
      const text = textDelta(message.event)
      if (text) events.push({ type: "delta", text })
    }
    if (message.type === "assistant") {
      const blocks = contentBlocks(message.message)
      let text = ""
      for (const block of blocks) {
        if (block.type === "text" && typeof block.text === "string") text += block.text
        if (block.type === "tool_use") {
          const input = block.input ?? {}
          events.push({ type: "tool", name: String(block.name ?? "tool"), input: stringify(input) })
          const diff = diffFromTool(String(block.name ?? ""), input)
          if (diff) events.push({ type: "diff", path: diff.path, patch: diff.patch })
        }
      }
      if (text) events.push({ type: "assistant", text })
    }
    if (message.type === "control_request") {
      const request = asRecord(message.request)
      const subtype = String(request.subtype ?? "")
      if (subtype === "can_use_tool" || subtype === "canUseTool") {
        events.push({
          type: "permission",
          requestId: String(message.request_id ?? ""),
          tool: String(request.tool_name ?? request.toolName ?? "tool"),
          input: stringify(request.input ?? {}),
        })
      }
    }
    if (message.type === "result") {
      if (message.is_error) events.push({ type: "error", text: String(message.result ?? "Errore del motore") })
      events.push({ type: "idle" })
    }
    return events
  }
}

export function createCursorParser(): Parser {
  let streamed = ""
  return (line) => {
    const message = parseJson(line)
    if (!message) return []
    const events: RunnerEvent[] = []
    if (typeof message.session_id === "string") events.push({ type: "native", sessionId: message.session_id })
    if (message.type === "assistant") {
      const text = assistantText(message)
      if (text) {
        streamed += text
        events.push({ type: "delta", text })
      }
      for (const block of contentBlocks(message.message)) {
        if (block.type === "tool_use" || block.type === "tool_call") {
          const input = block.input ?? block.arguments ?? {}
          events.push({ type: "tool", name: String(block.name ?? "tool"), input: stringify(input) })
          const diff = diffFromTool(String(block.name ?? ""), input)
          if (diff) events.push({ type: "diff", path: diff.path, patch: diff.patch })
        }
      }
    }
    if (message.type === "tool_call") {
      const input = message.arguments ?? message.input ?? {}
      events.push({ type: "tool", name: String(message.name ?? "tool"), input: stringify(input) })
      const diff = diffFromTool(String(message.name ?? ""), input)
      if (diff) events.push({ type: "diff", path: diff.path, patch: diff.patch })
    }
    if (message.type === "result") {
      const text = typeof message.result === "string" && message.result ? message.result : streamed
      if (message.is_error) events.push({ type: "error", text: text || "Errore del motore" })
      else if (text) events.push({ type: "assistant", text })
      streamed = ""
      events.push({ type: "idle" })
    }
    return events
  }
}

export function createGeminiParser(): Parser {
  let streamed = ""
  return (line) => {
    const message = parseJson(line)
    if (!message) return []
    const events: RunnerEvent[] = []
    if (typeof message.session_id === "string") events.push({ type: "native", sessionId: message.session_id })
    if (message.type === "message") {
      const text = typeof message.content === "string" ? message.content : typeof message.delta === "string" ? message.delta : ""
      if (text) {
        streamed += text
        events.push({ type: "delta", text })
      }
    }
    if (message.type === "tool_use") {
      const input = message.parameters ?? message.input ?? {}
      const name = String(message.tool_name ?? message.name ?? "tool")
      events.push({ type: "tool", name, input: stringify(input) })
      const diff = diffFromTool(name, input)
      if (diff) events.push({ type: "diff", path: diff.path, patch: diff.patch })
    }
    if (message.type === "error") {
      events.push({ type: "error", text: String(message.message ?? message.error ?? "Errore del motore") })
    }
    if (message.type === "result") {
      const text = typeof message.response === "string" && message.response ? message.response : streamed
      if (text) events.push({ type: "assistant", text })
      streamed = ""
      events.push({ type: "idle" })
    }
    return events
  }
}

export function diffFromTool(name: string, input: unknown): { path: string; patch: string } | null {
  const record = asRecord(input)
  const file = stringField(record, ["file_path", "path", "target_file", "filePath"])
  if (!file) return null
  if (name === "Write" || name === "write_file" || name === "WriteFile") {
    const content = stringField(record, ["content", "new_string", "contents"])
    return { path: file, patch: content }
  }
  if (name === "Edit" || name === "StrReplace" || name === "edit_file" || name === "EditFile") {
    const oldText = stringField(record, ["old_string", "oldString"])
    const newText = stringField(record, ["new_string", "newString", "content"])
    return { path: file, patch: `--- ${file}\n+++ ${file}\n-${oldText}\n+${newText}` }
  }
  return null
}

export function modelPrompt(prompt: string, context: string | null): string {
  if (!context) return prompt
  return `Contesto del lavoro già svolto su questo progetto:\n${context}\n\nRichiesta:\n${prompt}`
}

function parseJson(line: string): Record<string, unknown> | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith("{")) return null
  try {
    const value = JSON.parse(trimmed) as unknown
    return asRecord(value)
  } catch {
    return null
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

function contentBlocks(message: unknown): Record<string, unknown>[] {
  const content = asRecord(message).content
  return Array.isArray(content) ? content.map((block) => asRecord(block)) : []
}

function assistantText(message: Record<string, unknown>): string {
  return contentBlocks(message.message)
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => String(block.text))
    .join("")
}

function textDelta(event: unknown): string {
  const record = asRecord(event)
  const delta = asRecord(record.delta)
  return typeof delta.text === "string" ? delta.text : ""
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return ""
  }
}

function stringField(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    if (typeof record[key] === "string" && record[key]) return String(record[key])
  }
  return ""
}

export function commandFor(kind: EngineKind): string {
  if (kind === "claude") return "claude"
  if (kind === "cursor") return "agent"
  if (kind === "gemini") return "gemini"
  return ""
}
