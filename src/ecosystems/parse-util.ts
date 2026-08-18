// Shared parsing helpers for the manifest/lock readers.

import type { Dep } from '@lib/libyear/engine'
export type { Dep }

// The leading dotted-numeric run of a range: "^1.38" -> "1.38". Used wherever a
// manifest states a range and we take its floor as the current version.
export const baseVersion = (range: string): string | null => range.match(/(\d+\.\d+(?:\.\d+)?)/)?.[1] ?? null
