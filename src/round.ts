// The two decimals every surface reports.
//
// Drift is shown, gated and stored at two decimals, and the copies of this
// have to agree: the ratchet compares a stored total against a freshly computed
// one (gates.ts), and 3.10 → 3.52 is a growth of 0.42000000000000004 at full
// float precision. A ratchet set to 0 must not fail a manifest that did not
// change, so the rounding is one function rather than one per caller.

/**
 * Rounds to two decimal places.
 *
 * @param n Any finite number.
 * @returns `n` rounded to two decimals.
 */
export const round2 = (n: number): number => Math.round(n * 100) / 100
