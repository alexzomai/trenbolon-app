"use client"

import { WorkoutSession } from "@/components/workout-session"
import { useIsHydrated } from "@/lib/use-is-hydrated"

/**
 * Hydration boundary for the tracker.
 *
 * The page is statically prerendered, so the first client render has to match
 * the server's markup exactly — it cannot look at localStorage. Instead of
 * rendering defaults and then patching the saved state in from an effect
 * (a cascading render, and a visible flash of an empty workout), the session is
 * re-keyed the moment the client takes over. The client instance mounts fresh
 * and reads storage in its own reducer initializer.
 */
export function WorkoutTracker() {
  const hydrated = useIsHydrated()

  return <WorkoutSession key={hydrated ? "client" : "server"} hydrated={hydrated} />
}
