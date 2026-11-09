import type { ReactNode } from "react"

export function AuthCard({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <div className="flex min-h-dvh items-start justify-center bg-background px-4 py-8 md:items-center">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6">
        <h1 className="text-lg font-medium tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        <div className="mt-6">{children}</div>
      </div>
    </div>
  )
}

export function FormError({ children }: { children: string | null }) {
  if (!children) return null
  return <p className="text-sm text-red-400">{children}</p>
}
