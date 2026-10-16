"use client"

import { useSyncExternalStore } from "react"

/**
 * `false` while the server renders and during the hydration render, `true`
 * once the client owns the tree.
 *
 * `useSyncExternalStore` is the supported way to let server and client
 * disagree: React uses the server snapshot to produce markup that hydrates
 * cleanly, then re-renders with the client snapshot. That lets a component
 * read browser-only state (localStorage, Web Audio support) in a render-time
 * initializer rather than patching it in from an effect.
 *
 * The store never changes, so `subscribe` has nothing to listen to.
 */

const subscribe = () => () => {}
const getSnapshot = () => true
const getServerSnapshot = () => false

export function useIsHydrated(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
