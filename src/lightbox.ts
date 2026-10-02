// The lightbox's POSITION RULE — all of it, as pure functions over
// `(index, count)`, so the one decision in this feature that a reader will
// second-guess is assertable without rendering anything.
//
// 🔴 NO COLOUR MAY APPEAR IN THIS FILE. `theme-guard.test.tsx`'s Guard A derives
// its file set from this directory minus a named exemption list, so this module is
// scanned the moment it exists. There is nothing to paint here anyway — this file
// is arithmetic and one string.

/**
 * 🔴 IT CLAMPS AT THE ENDS. IT DOES NOT WRAP. This was a real fork and the losing
 * option is recorded so it is not silently re-decided:
 *
 *  - WRAP would mean "4 of 4" → Next → "1 of 4". The position indicator is the
 *    thing that makes this surface legible, and it states a LINEAR position in a
 *    finite list; a control that teleports from the last item to the first
 *    contradicts the sentence printed next to it.
 *  - CLAMP lets the boundary be VISIBLE instead of surprising: {@link stepIndex}
 *    returns the same index at an end, and {@link lightboxView} reports
 *    `hasPrev`/`hasNext` so the buttons render DISABLED there. The viewer can see
 *    they are at the end before they click, which wrap cannot express at all.
 *
 * A batch is 1–8 pictures (`formats × quantity`), so there is no long list where
 * wrapping would save anyone a drag across the whole row.
 *
 * `count <= 0` is NOT a defensive branch with no caller. `imageUrls` is rebuilt on
 * every poll snapshot and every storage reload, so a batch's images can go away
 * UNDER AN OPEN LIGHTBOX — a reload that drops a workflow is the ordinary way. That
 * case reaches {@link lightboxView}, which is where it turns into "show nothing".
 */
export function clampIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  if (index < 0) return 0;
  const last = count - 1;
  return index > last ? last : index;
}

/**
 * Move `delta` places and stay inside the list. The ONLY mover — the on-screen
 * buttons and the arrow keys both go through this, so they cannot disagree about
 * the boundary.
 */
export function stepIndex(index: number, count: number, delta: number): number {
  return clampIndex(clampIndex(index, count) + delta, count);
}

/** Everything the dialog paints, derived once from the row's own arrays. */
export interface LightboxView {
  /** The index actually shown — clamped, so it can never point past the list. */
  readonly index: number;
  readonly url: string;
  /** The format label for this image, or `null` where the record cannot name one. */
  readonly label: string | null;
  /** The position indicator, 1-based: "2 of 4". */
  readonly position: string;
  readonly hasPrev: boolean;
  readonly hasNext: boolean;
}

/**
 * Reduce (requested index, the row's images) to what the dialog shows — or `null`
 * for "there is nothing to show", which is both "closed" and "the pictures went
 * away while it was open".
 *
 * 🔴 `urls` IS THE ROW'S OWN ARRAY AND THAT IS WHAT KEEPS ROWS APART. The index is
 * meaningless on its own; it only ever indexes the array it is handed. A caller
 * holding one row's state cannot reach another row's pictures, because it never has
 * them.
 *
 * 🔴 THE INDEX IS CLAMPED HERE RATHER THAN TRUSTED. The caller's index is React
 * state captured when a tile was clicked; `urls` is recomputed on every poll. A
 * batch that was showing image 4 of 4 when a reload dropped a workflow would
 * otherwise index past the end and render `src={undefined}` — a broken image icon
 * where a picture the viewer paid for used to be.
 */
export function lightboxView(
  index: number | null,
  urls: readonly string[],
  labels: readonly (string | null)[],
): LightboxView | null {
  if (index === null) return null;
  const count = urls.length;
  if (count === 0) return null;
  const at = clampIndex(index, count);
  return {
    index: at,
    url: urls[at]!,
    label: labels[at] ?? null,
    position: `${at + 1} of ${count}`,
    hasPrev: at > 0,
    hasNext: at < count - 1,
  };
}
