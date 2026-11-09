import * as TabsPrimitive from "@radix-ui/react-tabs"
import type * as React from "react"
import { cn } from "@/lib/utils"

export function Tabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root className={cn("flex min-h-0 flex-col", className)} {...props} />
}

export function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn("grid grid-cols-3 border-b border-border", className)}
      {...props}
    />
  )
}

export function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "h-10 text-xs font-medium text-muted-foreground data-[state=active]:text-foreground data-[state=active]:shadow-[inset_0_-1px_0_0_var(--foreground)]",
        className,
      )}
      {...props}
    />
  )
}

export function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content className={cn("min-h-0 flex-1 outline-none", className)} {...props} />
  )
}
