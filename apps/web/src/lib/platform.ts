import type { HealthReport } from "@cloudai/shared"
import { useEffect, useState } from "react"

export type LinkState = "connecting" | "up" | "down"

export function usePlatformStatus() {
  const [health, setHealth] = useState<HealthReport | null>(null)
  const [socket, setSocket] = useState<LinkState>("connecting")

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const response = await fetch("/api/health")
        const body = (await response.json()) as HealthReport
        if (!cancelled) setHealth(body)
      } catch {
        if (!cancelled) setHealth(null)
      }
    }

    void load()
    const timer = setInterval(() => void load(), 15_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    let socketRef: WebSocket | null = null
    let reconnect: ReturnType<typeof setTimeout> | undefined
    let closed = false

    function connect() {
      const protocol = window.location.protocol === "https:" ? "wss" : "ws"
      const next = new WebSocket(`${protocol}://${window.location.host}/api/ws`)
      socketRef = next
      setSocket("connecting")
      next.onopen = () => setSocket("up")
      next.onclose = () => {
        setSocket("down")
        if (!closed) reconnect = setTimeout(connect, 2000)
      }
      next.onerror = () => next.close()
    }

    connect()
    return () => {
      closed = true
      if (reconnect) clearTimeout(reconnect)
      socketRef?.close()
    }
  }, [])

  return { health, socket }
}
