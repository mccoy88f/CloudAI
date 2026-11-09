const runnerUrl = process.env.RUNNER_URL ?? "http://runner:4000"

export async function archiveConversation(projectId: string, who: string, text: string): Promise<void> {
  if (!text.trim()) return
  const response = await fetch(`${runnerUrl}/projects/${projectId}/archive`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ who, text, at: new Date().toISOString() }),
  })
  if (!response.ok) throw new Error("archivio non scritto")
}

export async function readMemory(projectId: string): Promise<string | null> {
  const response = await fetch(`${runnerUrl}/projects/${projectId}/memory`)
  if (!response.ok) return null
  const body = (await response.json()) as { text?: unknown }
  return typeof body.text === "string" && body.text.trim() ? body.text : null
}
