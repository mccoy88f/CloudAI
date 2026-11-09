import * as Dialog from "@radix-ui/react-dialog"
import type * as React from "react"
import { cn } from "@/lib/utils"

export function Sheet({ ...props }: React.ComponentProps<typeof Dialog.Root>) {
  return <Dialog.Root {...props} />
}

export function SheetTrigger({ ...props }: React.ComponentProps<typeof Dialog.Trigger>) {
  return <Dialog.Trigger {...props} />
}

export function SheetContent({
  side,
  className,
  children,
  title,
  ...props
}: React.ComponentProps<typeof Dialog.Content> & {
  side: "left" | "right"
  title: string
}) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
      <Dialog.Content
        className={cn(
          "fixed z-50 flex h-dvh w-[min(100%,20rem)] flex-col bg-background outline-none",
          side === "left" ? "sheet-left inset-y-0 left-0 border-r" : "sheet-right inset-y-0 right-0 border-l",
          "border-border",
          className,
        )}
        {...props}
      >
        <Dialog.Title className="sr-only">{title}</Dialog.Title>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  )
}
