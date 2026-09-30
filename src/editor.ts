// Pure logic for the thumbnail EDITOR: overlay spec, cover-fit crop, text
// layout, and the export quality ladder. The DOM glue (a real canvas element,
// image loading, the download anchor) is thin App glue over these tested cores.
// Everything here is unit-tested in node with fake contexts (see editor.test.ts).

import { THUMB_HEIGHT, THUMB_WIDTH } from './generation.js';

/** YouTube's upload cap for thumbnails (bytes). */
export const YT_MAX_BYTES = 2 * 1024 * 1024;

/** The canvas size a thumbnail is composited + exported at. */
export const YT_W = THUMB_WIDTH;
export const YT_H = THUMB_HEIGHT;

/** Font stack for overlay text — heavy display faces, best-effort. */
export const THUMB_FONT_STACK = 'Impact, "Arial Black", "Helvetica Neue", Arial, sans-serif';

// ---------------------------------------------------------------------------
// Overlay spec — the user-editable text state. Positions are PERCENT of the
// canvas (0–100) so the spec is resolution-independent; size is percent of the
// canvas HEIGHT; stroke width is percent of the font size.
// ---------------------------------------------------------------------------

export interface TextOverlay {
  text: string;
  /** Font size as % of canvas height (e.g. 18 → 129.6px at 720). */
  sizePct: number;
  /** Center X of the text block, % of canvas width (0–100). */
  xPct: number;
  /** Center Y of the text block, % of canvas height (0–100). */
  yPct: number;
  /** Fill color — any CSS color string. */
  color: string;
  /** Outline (stroke) color. */
  strokeColor: string;
  /** Stroke width as % of font size (0–50). */
  strokePct: number;
}

export const DEFAULT_TEXT_OVERLAY: TextOverlay = {
  text: 'YOUR TITLE HERE',
  sizePct: 18,
  xPct: 50,
  yPct: 82,
  color: '#ffffff',
  strokeColor: '#000000',
  strokePct: 12,
};

/** Clamp an overlay into valid ranges; non-finite numbers → the default. */
export function clampOverlay(o: TextOverlay): TextOverlay {
  const num = (v: number, d: number) => (Number.isFinite(v) ? v : d);
  return {
    text: o.text ?? DEFAULT_TEXT_OVERLAY.text,
    sizePct: Math.max(2, Math.min(60, num(o.sizePct, DEFAULT_TEXT_OVERLAY.sizePct))),
    xPct: Math.max(0, Math.min(100, num(o.xPct, DEFAULT_TEXT_OVERLAY.xPct))),
    yPct: Math.max(0, Math.min(100, num(o.yPct, DEFAULT_TEXT_OVERLAY.yPct))),
    color: o.color || DEFAULT_TEXT_OVERLAY.color,
    strokeColor: o.strokeColor || DEFAULT_TEXT_OVERLAY.strokeColor,
    strokePct: Math.max(0, Math.min(50, num(o.strokePct, DEFAULT_TEXT_OVERLAY.strokePct))),
  };
}

// ---------------------------------------------------------------------------
// Geometry — cover-fit crop. The generated image's aspect ratio is usually
// 16:9 already, but an img2img source can be anything; cover-crop keeps the
// 1280×720 frame full with no letterboxing.
// ---------------------------------------------------------------------------

/**
 * The source rectangle that covers a dw×dh frame from a sw×sh image with the
 * largest centered crop of the same aspect. Returns the 4-arg source rect for
 * `ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh)`.
 */
export function coverCrop(
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): { sx: number; sy: number; sw: number; sh: number } {
  const scale = Math.max(dw / sw, dh / sh);
  const cw = dw / scale;
  const ch = dh / scale;
  return { sx: (sw - cw) / 2, sy: (sh - ch) / 2, sw: cw, sh: ch };
}

// ---------------------------------------------------------------------------
// Text layout — greedy word wrap against a measure function, hard-breaking a
// word longer than the line. Returns at least one line for any non-empty input.
// ---------------------------------------------------------------------------

/** Greedy-wrap `text` so each line measures ≤ maxWidthPx per `measure`. */
export function wrapLines(
  measure: (text: string) => number,
  text: string,
  maxWidthPx: number,
): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (measure(candidate) <= maxWidthPx || !current) {
      // A single word longer than the line is hard-broken further below; here
      // it is accepted as the line's seed (never dropped, never an empty line).
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
  }
  if (current) lines.push(current);

  // Hard-break any line still over-wide (a single long word): slice by chars.
  const out: string[] = [];
  for (const line of lines) {
    if (measure(line) <= maxWidthPx) {
      out.push(line);
      continue;
    }
    let rest = line;
    while (measure(rest) > maxWidthPx && rest.length > 1) {
      let cut = rest.length;
      while (cut > 1 && measure(rest.slice(0, cut)) > maxWidthPx) cut -= 1;
      out.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    if (rest) out.push(rest);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Drawing — one pass over a 2D context. Takes the narrowest structural types it
// actually needs so a recording fake can stand in for a real context in tests;
// App passes a real CanvasRenderingContext2D + HTMLImageElement.
// ---------------------------------------------------------------------------

/** The slice of a 2D context drawThumbnail uses. */
export interface ThumbCtx {
  drawImage(
    img: unknown,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
  save(): void;
  restore(): void;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineJoin: string;
  miterLimit: number;
  measureText(text: string): { width: number };
  fillText(text: string, x: number, y: number): void;
  strokeText(text: string, x: number, y: number): void;
}

/** An image source with the intrinsic size drawThumbnail needs. */
export interface ThumbImage {
  width: number;
  height: number;
}

/** Compute the cover-crop rect for `img` and hand it to `ctx.drawImage`. */
export function drawCover(ctx: ThumbCtx, img: ThumbImage): void {
  const { sx, sy, sw, sh } = coverCrop(img.width, img.height, YT_W, YT_H);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, YT_W, YT_H);
}

/**
 * Draw the composed thumbnail: image cover-fit to YT_W×YT_H, then the overlay
 * text (multi-line, centered on xPct, vertically centered as a block on yPct)
 * with the outline UNDER the fill (stroke-then-fill per line, like every
 * thumbnail maker).
 */
export function drawThumbnail(ctx: ThumbCtx, img: ThumbImage, raw: TextOverlay): void {
  const overlay = clampOverlay(raw);
  drawCover(ctx, img);

  const fontSize = (overlay.sizePct / 100) * YT_H;
  const font = `900 ${fontSize}px ${THUMB_FONT_STACK}`;
  ctx.save();
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const maxWidth = YT_W * 0.92;
  const lines = wrapLines((t) => ctx.measureText(t).width, overlay.text, maxWidth);
  const lineHeight = fontSize * 1.15;
  const blockH = lines.length * lineHeight;
  const cx = (overlay.xPct / 100) * YT_W;
  let firstCenter = (overlay.yPct / 100) * YT_H - blockH / 2 + lineHeight / 2;

  // Keep the whole block on the canvas: clamp the first line's center so the
  // block fits, honoring the user's yPct as closely as the clamp allows.
  const halfBlock = blockH / 2;
  const top = (overlay.yPct / 100) * YT_H - halfBlock;
  if (top < 0) firstCenter = lineHeight / 2;
  else if (top + blockH > YT_H) firstCenter = YT_H - halfBlock + lineHeight / 2;

  ctx.strokeStyle = overlay.strokeColor;
  ctx.lineWidth = (overlay.strokePct / 100) * fontSize;
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  for (const line of lines) {
    if (ctx.lineWidth > 0) ctx.strokeText(line, cx, firstCenter);
    ctx.fillStyle = overlay.color;
    ctx.fillText(line, cx, firstCenter);
    firstCenter += lineHeight;
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Export — a JPEG quality ladder until the blob is ≤ YT_MAX_BYTES.
// ---------------------------------------------------------------------------

export interface ExportResult {
  blob: Blob;
  quality: number;
  bytes: number;
  /** True when even the smallest quality exceeded maxBytes (caller warns). */
  oversized: boolean;
}

/** The qualities the ladder walks, high → low. */
export const EXPORT_QUALITIES: readonly number[] = [0.92, 0.85, 0.75, 0.6, 0.45, 0.3];

/**
 * Walk the quality ladder: the FIRST quality whose blob fits maxBytes wins.
 * If none fits, return the SMALLEST quality's blob with `oversized: true` (a
 * 1280×720 photo JPEG essentially never exceeds 2MB, but the caller must not
 * silently ship an over-cap file).
 */
export async function exportLadder(
  toBlob: (quality: number) => Promise<Blob | null>,
  maxBytes: number = YT_MAX_BYTES,
  qualities: readonly number[] = EXPORT_QUALITIES,
): Promise<ExportResult> {
  let last: { blob: Blob; quality: number } | null = null;
  for (const quality of qualities) {
    const blob = await toBlob(quality);
    if (!blob) continue;
    last = { blob, quality };
    if (blob.size <= maxBytes) {
      return { blob, quality, bytes: blob.size, oversized: false };
    }
  }
  if (!last) throw new Error('export produced no blob');
  return { blob: last.blob, quality: last.quality, bytes: last.blob.size, oversized: true };
}

/** A deterministic, YouTube-safe file name for an exported thumbnail. */
export function thumbnailFileName(n: number): string {
  const safe = Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
  return `yt-thumbnail-${safe}.jpg`;
}

// ---------------------------------------------------------------------------
// DOM glue — thin, untested here (exercised in the harness).
// ---------------------------------------------------------------------------

/**
 * Load an image URL for canvas compositing. `crossOrigin='anonymous'` is what
 * keeps the canvas un-tainted so `toBlob()` can export it; if the image host
 * does not answer CORS the load FAILS and the caller must degrade (the editor
 * cannot run on a tainted canvas).
 */
export function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${url} (CORS or network)`));
    img.src = url;
  });
}

/**
 * Ask the browser to download `blob` as `filename`.
 *
 * 🔴 THIS FUNCTION CANNOT OBSERVE WHETHER A FILE ARRIVED, and callers must not
 * claim it did. An `<a download>` click is fire-and-forget: it returns normally
 * whether the browser wrote a file, showed a picker, or ignored the click
 * entirely. In particular a sandboxed iframe WITHOUT `allow-downloads` drops the
 * download silently — no throw, no event — which is exactly how 0.1.0–0.1.5
 * shipped a Download button that printed "Saved" and produced nothing.
 *
 * 🔴 AND THIS APP CANNOT ASK FOR THAT TOKEN. `civitai app validate` REFUSES
 * `allow-downloads` for an unverified block, and a submitted block is always
 * unverified — `manifest.test.ts`'s sandbox block carries the exact wording and
 * the conditions under which that changes. So this call is expected to be inert
 * on civitai.com today. It is kept rather than deleted because it costs nothing
 * and does work everywhere else this bundle runs (`npm run dev`, the harness, a
 * verified tier later), and because deleting it would leave no path at all. The
 * honest wording beside the button is the other half.
 *
 * 🔴 THE DEFERRED REVOKE IS NOT A FIX FOR THAT EITHER. Revoking the object URL on the line
 * after `a.click()` is a real race — the navigation the click starts may not
 * have read the URL yet — but a three-case controlled experiment in headless
 * chromium showed it is NOT what broke the button: an unsandboxed page running
 * this exact code, synchronous revoke included, downloaded the file. It is
 * removed here because it is wrong, not because it was the cause. The revoke
 * still happens (an object URL pins its blob for the life of the document);
 * `setTimeout` just moves it past the click's own task.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

/**
 * How long the exported blob's object URL is kept alive after the click. Long
 * enough that the download's own fetch has certainly started, short enough that
 * a viewer exporting repeatedly does not accumulate pinned blobs.
 */
export const REVOKE_DELAY_MS = 60_000;
