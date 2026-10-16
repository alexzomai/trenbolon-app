"use client"

import * as React from "react"
import { cn } from "cn"
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui"

import { buttonVariants } from "@/components/ui/button"

/**
 * Single-choice toggle group. Radix renders `type="single"` as a `radiogroup`
 * of `radio`s with roving focus, so arrow keys move between the choices and
 * screen readers announce which one is selected.
 *
 * The items borrow `buttonVariants` instead of a separate `toggle` primitive,
 * which keeps them identical to the gray buttons used elsewhere in the tracker.
 */
function ToggleGroup({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      className={cn("flex items-center gap-2", className)}
      {...props}
    />
  )
}

function ToggleGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn(
        buttonVariants({ variant: "secondary" }),
        "h-auto min-w-0 font-normal whitespace-normal data-[state=on]:border-selected data-[state=on]:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export { ToggleGroup, ToggleGroupItem }
