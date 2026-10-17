/**
 * Leaf module: the one place that touches `window.localStorage`. Kept free of
 * imports so both the session store and the saved-workout catalog can use it
 * without depending on each other.
 */

/**
 * Returns the Storage object, or null when it cannot be touched at all.
 * Accessing `window.localStorage` itself can throw when site data is blocked,
 * hence the try/catch around the property read.
 */
export function getStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null
    return window.localStorage ?? null
  } catch {
    return null
  }
}
