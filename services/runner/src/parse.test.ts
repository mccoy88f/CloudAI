import assert from "node:assert/strict"
import test from "node:test"
import { createClaudeParser, createCursorParser, diffFromTool, modelPrompt } from "./parse.js"

test("claude stream-json becomes text, tools and a permission", () => {
  const parse = createClaudeParser()
  const native = parse('{"type":"system","subtype":"init","session_id":"sess-1"}')
  assert.deepEqual(native, [{ type: "native", sessionId: "sess-1" }])

  const delta = parse(
    '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"ciao"}}}',
  )
  assert.deepEqual(delta, [{ type: "delta", text: "ciao" }])

  const tool = parse(
    '{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Write","input":{"file_path":"a.ts","content":"let n = 1\\n"}}]}}',
  )
  assert.equal(tool[0]?.type, "tool")
  assert.equal(tool[1]?.type, "diff")
  if (tool[1]?.type === "diff") assert.equal(tool[1].path, "a.ts")

  const permission = parse(
    '{"type":"control_request","request_id":"req-1","request":{"subtype":"can_use_tool","tool_name":"Bash","input":{"command":"ls"}}}',
  )
  assert.deepEqual(permission, [
    { type: "permission", requestId: "req-1", tool: "Bash", input: '{\n  "command": "ls"\n}' },
  ])

  assert.deepEqual(parse('{"type":"result","is_error":false}'), [{ type: "idle" }])
})

test("cursor result replaces the streamed text", () => {
  const parse = createCursorParser()
  parse('{"type":"assistant","message":{"content":[{"type":"text","text":"par"}]}}')
  const result = parse('{"type":"result","result":"parziale completo"}')
  assert.deepEqual(result, [{ type: "assistant", text: "parziale completo" }, { type: "idle" }])
})

test("edit tools become a unified diff", () => {
  const diff = diffFromTool("StrReplace", { path: "src/a.ts", old_string: "a", new_string: "b" })
  assert.deepEqual(diff, { path: "src/a.ts", patch: "--- src/a.ts\n+++ src/a.ts\n-a\n+b" })
})

test("context is prepended only when present", () => {
  assert.equal(modelPrompt("fai", null), "fai")
  assert.match(modelPrompt("fai", "Utente: prima"), /Utente: prima[\s\S]*Richiesta:\nfai/)
})
