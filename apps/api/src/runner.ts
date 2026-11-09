const runnerUrl = process.env.RUNNER_URL ?? "http://runner:4000"

export async function callRunner<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${runnerUrl}${path}`, {
      ...init,
      headers: init?.body ? { "content-type": "application/json" } : undefined,
    })
  } catch {
    throw new Error("Il runner non risponde")
  }
  const body = (await response.json().catch(() => ({}))) as { error?: unknown }
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Operazione non riuscita")
  return body as T
}
