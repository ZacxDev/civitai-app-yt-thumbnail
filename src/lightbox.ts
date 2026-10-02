// The lightbox's POSITION RULE — all of it, as one pure function over
// `(anchor url, the row's urls, the row's labels)`, so the one decision in this
// feature that a reader will second-guess is assertable without rendering anything.
//
// 🔴 NO COLOUR MAY APPEAR IN THIS FILE. `theme-guard.test.tsx`'s Guard A derives
// its file set from this directory minus a named exemption list, so this module is
// scanned the moment it exists. There is nothing to paint here anyway — this file
// is one lookup and two strings.

/** Everything the dialog paints, derived once from the row's own arrays. */
export interface LightboxView {
  /**
   * Where the anchored picture currently sits in the row — DISPLAY ONLY. It feeds the
   * position indicator and the image's `alt`, and nothing navigates by it: that is the
   * whole point of anchoring on the url, so do not reintroduce a caller that steps it.
   */
  readonly index: number;
  readonly url: string;
  /** The format label for this image, or `null` where the record cannot name one. */
  readonly label: string | null;
  /** The position indicator, 1-based: "2 of 4". */
  readonly position: string;
  /**
   * The picture Prev moves to, or `null` AT THE FIRST ONE — see the fork recorded
   * on {@link lightboxView}. `null` is what makes the Prev button render disabled.
   */
  readonly prevUrl: string | null;
  /** The picture Next moves to, or `null` at the last one. */
  readonly nextUrl: string | null;
}

/**
 * Reduce (the url the viewer opened, the row's current images) to what the dialog
 * shows — or `null` for "there is nothing to show", which is "closed" AND "the
 * picture that was open is no longer in this row".
 *
 * 🔴 THE OPEN PICTURE IS ANCHORED BY ITS URL, NOT BY AN INDEX, AND THAT IS A FIX
 * FOR A MEASURED DEFECT RATHER THAN a preference. `imageUrls` is ordered by
 * `record.workflowIds` (see `joinHistory`), and this app submits ONE WORKFLOW PER
 * FORMAT, so a two-format batch whose SECOND format resolves first renders
 * `[B]` — the viewer clicks it and reads "1 of 1". When format one lands, the join
 * puts A at index 0 and the list becomes `[A, B]`. A bare index of 0 then resolves
 * to A: the picture CHANGES UNDER THE VIEWER and the dialog's heading renames
 * itself to the other format. An index cannot distinguish "the list grew in front
 * of me" from "I am still looking at the same thing"; a url can, and this is the
 * whole reason the state is a string.
 *
 * 🔴 A PICTURE THAT LEAVES THE ROW CLOSES THE DIALOG — it does NOT fall back to a
 * neighbour. `imageUrls` is rebuilt on every poll snapshot and every storage
 * reload, so a batch's images can go away under an open lightbox; a reload that
 * drops a workflow is the ordinary way. The earlier version CLAMPED to the last
 * surviving image, which is the same defect as the one above wearing different
 * clothes: it silently shows a DIFFERENT picture, under a heading naming a
 * DIFFERENT format, with no viewer input. Returning `null` makes the dialog's
 * caller close it, which is the only honest answer — the thing being looked at is
 * gone.
 *
 * 🔴 `urls` IS THE ROW'S OWN ARRAY AND THAT IS WHAT KEEPS ROWS APART. The anchor is
 * meaningless on its own; it is only ever looked up in the array it is handed. A
 * caller holding one row's state cannot reach another row's pictures, because it
 * never has them.
 *
 * 🔴 IT CLAMPS AT THE ENDS. IT DOES NOT WRAP. This was a real fork and the losing
 * option is recorded so it is not silently re-decided:
 *
 *  - WRAP would mean "4 of 4" → Next → "1 of 4". The position indicator is the
 *    thing that makes this surface legible, and it states a LINEAR position in a
 *    finite list; a control that teleports from the last item to the first
 *    contradicts the sentence printed next to it.
 *  - CLAMP lets the boundary be VISIBLE instead of surprising: at an end the
 *    neighbour is `null`, so the button renders DISABLED and the viewer can see
 *    they are at the end before they click. Wrap cannot express that at all.
 *
 * A batch is 1–8 pictures (`formats × quantity`), so there is no long list where
 * wrapping would save anyone a drag across the whole row.
 *
 * 🔴 THE NEIGHBOURS ARE COMPUTED HERE AND NOWHERE ELSE, which is what replaced an
 * earlier `stepIndex(index, count, delta)` helper that the buttons and the arrow
 * keys each called with their own arguments. That shape had an UNGUARDABLE claim
 * attached to it: a mutant replacing the key handler's `stepIndex(at, count, delta)`
 * with `at + delta` passed the ENTIRE suite, because the view re-clamped the index
 * at render and erased the difference. There is now no index arithmetic at either
 * call site to get wrong — both read `prevUrl`/`nextUrl` off this view — so "one
 * mover" is a property of the shape instead of a sentence asking to be trusted.
 *
 * A DUPLICATE URL WITHIN ONE ROW RESOLVES TO THE FIRST OF THEM, and that is
 * recorded rather than engineered around. Two images in one batch carrying the same
 * url means the same picture twice, so the dialog shows the right PICTURE; only the
 * "n of m" number would read low. Nothing in the orchestrator's output is known to
 * produce it, and a tie-break would cost the whole anchor its simplicity.
 */
export function lightboxView(
  anchor: string | null,
  urls: readonly string[],
  labels: readonly (string | null)[],
): LightboxView | null {
  if (anchor === null) return null;
  const at = urls.indexOf(anchor);
  // Not in this row's current list: closed, or the picture went away under an open
  // dialog. Both are "nothing to show" — see the block above for why this is not a
  // fallback to a neighbour.
  if (at < 0) return null;
  const count = urls.length;
  return {
    index: at,
    url: urls[at],
    label: labels[at] ?? null,
    position: `${at + 1} of ${count}`,
    prevUrl: at > 0 ? urls[at - 1] : null,
    nextUrl: at < count - 1 ? urls[at + 1] : null,
  };
}
