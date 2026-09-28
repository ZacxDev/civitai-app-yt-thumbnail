import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TEXT_OVERLAY,
  EXPORT_QUALITIES,
  THUMB_FONT_STACK,
  YT_H,
  YT_MAX_BYTES,
  YT_W,
  clampOverlay,
  coverCrop,
  drawThumbnail,
  exportLadder,
  thumbnailFileName,
  wrapLines,
  type ThumbCtx,
} from './editor.js';

// The editor cores are tested against RECORDING fakes — no real canvas needed.
// Every assertion below pins BEHAVIOR (what was drawn, with which numbers), not
// implementation details.

/**
 * A 2D-context fake that records every call + property set. `measureText` is
 * deterministic: `measurePerChar` px per character. Property writes (font,
 * lineWidth, …) are captured through a Proxy so assertions can pin them.
 */
function recordingCtx(measurePerChar = 10) {
  const calls: Array<{ op: string; args: unknown[] }> = [];
  const state: Record<string, unknown> = {};
  const ctx = {
    drawImage(...args: unknown[]) {
      calls.push({ op: 'drawImage', args: [...args] });
    },
    save() {
      calls.push({ op: 'save', args: [] });
    },
    restore() {
      calls.push({ op: 'restore', args: [] });
    },
    measureText(text: string) {
      return { width: text.length * measurePerChar };
    },
    fillText(text: string, x: number, y: number) {
      calls.push({ op: 'fillText', args: [text, x, y] });
    },
    strokeText(text: string, x: number, y: number) {
      calls.push({ op: 'strokeText', args: [text, x, y] });
    },
  };
  const proxy = new Proxy(ctx as unknown as ThumbCtx, {
    set(target, prop, value) {
      state[prop as string] = value;
      calls.push({ op: `set:${String(prop)}`, args: [value] });
      (target as unknown as Record<string, unknown>)[prop as string] = value;
      return true;
    },
    get(target, prop) {
      if (prop in state) return state[prop as string];
      return (target as unknown as Record<string, unknown>)[prop as string];
    },
  });
  return { ctx: proxy, calls };
}

describe('coverCrop', () => {
  it('a same-aspect source fills the frame exactly (no crop)', () => {
    // 1280x720 source into a 1280x720 frame — identity.
    expect(coverCrop(1280, 720, 1280, 720)).toEqual({ sx: 0, sy: 0, sw: 1280, sh: 720 });
  });
  it('a 1:1 1024 source crops to the centered 16:9 band', () => {
    const r = coverCrop(1024, 1024, 1280, 720);
    // The crop must preserve aspect: sw/sh == 1280/720 (within float tolerance).
    expect(r.sw / r.sh).toBeCloseTo(1280 / 720, 6);
    // Full width, centered vertically.
    expect(r.sw).toBeCloseTo(1024, 6);
    expect(r.sx).toBeCloseTo(0, 6);
    expect(r.sy).toBeCloseTo((1024 - r.sh) / 2, 6);
    // And the crop is inside the source.
    expect(r.sy).toBeGreaterThanOrEqual(0);
    expect(r.sy + r.sh).toBeLessThanOrEqual(1024);
  });
  it('a portrait source keeps full width and takes a centered horizontal band', () => {
    // 720x1280 portrait into 16:9: the crop is full-width (720), height-banded.
    const r = coverCrop(720, 1280, 1280, 720);
    expect(r.sw).toBeCloseTo(720, 6);
    expect(r.sx).toBeCloseTo(0, 6);
    expect(r.sh).toBeCloseTo(405, 6);
    expect(r.sy).toBeCloseTo((1280 - 405) / 2, 6);
    expect(r.sw / r.sh).toBeCloseTo(1280 / 720, 6);
  });
  it('an extreme panoramic source crops to the centered middle', () => {
    const r = coverCrop(2048, 256, 1280, 720);
    expect(r.sh).toBeCloseTo(256, 6);
    expect(r.sx).toBeGreaterThanOrEqual(0);
    expect(r.sw / r.sh).toBeCloseTo(1280 / 720, 6);
  });
});

describe('wrapLines', () => {
  const m = (t: string) => t.length * 10; // 10px per char
  it('fits on one line when under the width', () => {
    expect(wrapLines(m, 'short title', 1000)).toEqual(['short title']);
  });
  it('wraps greedily at word boundaries', () => {
    // maxWidth 60 → 6 chars per line: "big" fits, "bold" doesn't join it.
    expect(wrapLines(m, 'big bold words here', 60)).toEqual(['big', 'bold', 'words', 'here']);
  });
  it('never returns an empty line list for non-empty input', () => {
    expect(wrapLines(m, 'x', 10)).toEqual(['x']);
    expect(wrapLines(m, '   ', 100)).toEqual([]);
  });
  it('hard-breaks a single word longer than the line', () => {
    const lines = wrapLines(m, 'supercalifragilistic', 100);
    // 10 chars per line at 10px/char.
    expect(lines).toEqual(['supercalif', 'ragilistic']);
    for (const line of lines) expect(m(line)).toBeLessThanOrEqual(100);
  });
  it('an empty string is no lines', () => {
    expect(wrapLines(m, '', 100)).toEqual([]);
  });
});

describe('clampOverlay', () => {
  it('keeps valid values and clamps out-of-range ones', () => {
    expect(clampOverlay(DEFAULT_TEXT_OVERLAY)).toEqual(DEFAULT_TEXT_OVERLAY);
    const c = clampOverlay({
      ...DEFAULT_TEXT_OVERLAY,
      sizePct: 999,
      xPct: -10,
      yPct: 150,
      strokePct: 80,
      color: '',
      strokeColor: '',
    });
    expect(c.sizePct).toBe(60);
    expect(c.xPct).toBe(0);
    expect(c.yPct).toBe(100);
    expect(c.strokePct).toBe(50);
    // Empty colors fall back to the defaults.
    expect(c.color).toBe(DEFAULT_TEXT_OVERLAY.color);
    expect(c.strokeColor).toBe(DEFAULT_TEXT_OVERLAY.strokeColor);
  });
  it('non-finite numbers fall back to the defaults, not NaN', () => {
    const c = clampOverlay({
      text: 'hi',
      sizePct: NaN,
      xPct: NaN,
      yPct: NaN,
      strokePct: NaN,
      color: '#fff',
      strokeColor: '#000',
    });
    expect(c.sizePct).toBe(DEFAULT_TEXT_OVERLAY.sizePct);
    expect(c.xPct).toBe(DEFAULT_TEXT_OVERLAY.xPct);
    expect(c.yPct).toBe(DEFAULT_TEXT_OVERLAY.yPct);
    expect(c.strokePct).toBe(DEFAULT_TEXT_OVERLAY.strokePct);
  });
});

describe('drawThumbnail (recording fake ctx)', () => {
  it('draws the image cover-fit and sets the heavy font at sizePct of height', () => {
    const { ctx, calls } = recordingCtx();
    drawThumbnail(
      ctx,
      { width: 1024, height: 1024 },
      { ...DEFAULT_TEXT_OVERLAY, text: 'WOW', sizePct: 20 },
    );
    const draw = calls.find((c) => c.op === 'drawImage');
    expect(draw).toBeDefined();
    // Cover crop of a 1024 square into 1280x720: full width, centered band.
    // args = [img, sx, sy, sw, sh, dx, dy, dw, dh].
    expect(draw?.args[0]).toEqual({ width: 1024, height: 1024 });
    expect(draw?.args[1]).toBeCloseTo(0, 6);
    expect(draw?.args[3]).toBeCloseTo(1024, 6);
    expect(draw?.args[6]).toBe(0);
    expect(draw?.args[7]).toBe(1280);
    expect(draw?.args[8]).toBe(720);
    // The font is 900-weight, 20% of 720 = 144px, in the thumbnail stack.
    const font = calls.find((c) => c.op === 'set:font');
    expect(font?.args[0]).toBe(`900 ${144}px ${THUMB_FONT_STACK}`);
    // drawImage is the FIRST call; restore is the LAST (save/restore bracket).
    expect(calls[0].op).toBe('drawImage');
    expect(calls.at(-1)?.op).toBe('restore');
  });

  it('single-line text: one strokeText then one fillText, centered at (xPct, yPct)', () => {
    const { ctx, calls } = recordingCtx();
    drawThumbnail(
      ctx,
      { width: 1280, height: 720 },
      { ...DEFAULT_TEXT_OVERLAY, text: 'HELLO', sizePct: 18, xPct: 50, yPct: 50, strokePct: 12 },
    );
    const stroke = calls.find((c) => c.op === 'strokeText');
    const fill = calls.find((c) => c.op === 'fillText');
    expect(stroke?.args).toEqual(['HELLO', 640, 360]);
    expect(fill?.args).toEqual(['HELLO', 640, 360]);
    // Stroke comes BEFORE fill (outline under fill).
    expect(calls.findIndex((c) => c.op === 'strokeText')).toBeLessThan(
      calls.findIndex((c) => c.op === 'fillText'),
    );
    // lineWidth = 12% of the 129.6px font.
    const lw = calls.find((c) => c.op === 'set:lineWidth');
    expect(lw?.args[0]).toBeCloseTo(0.12 * (18 / 100) * 720, 6);
  });

  it('multi-line text stacks evenly-spaced lines, all centered on xPct', () => {
    // 100px per char → ~11 chars per line, forcing a wrap into 3 lines.
    const { ctx, calls } = recordingCtx(100);
    drawThumbnail(
      ctx,
      { width: 1280, height: 720 },
      { ...DEFAULT_TEXT_OVERLAY, text: 'one two three four five six', sizePct: 18, yPct: 50 },
    );
    const fills = calls.filter((c) => c.op === 'fillText');
    expect(fills.length).toBe(3);
    // All lines share the same x (xPct 50 → 640).
    for (const f of fills) expect(f.args[1]).toBe(640);
    // Line centers are evenly spaced around the yPct anchor.
    const ys = fills.map((f) => f.args[2] as number);
    expect(ys[1] - ys[0]).toBeCloseTo(ys[2] - ys[1], 6);
    expect(ys[1] - ys[0]).toBeGreaterThan(0);
  });

  it('strokePct 0 → no strokeText calls, fill only', () => {
    const { ctx, calls } = recordingCtx();
    drawThumbnail(
      ctx,
      { width: 1280, height: 720 },
      { ...DEFAULT_TEXT_OVERLAY, text: 'CLEAN', strokePct: 0 },
    );
    expect(calls.some((c) => c.op === 'strokeText')).toBe(false);
    expect(calls.some((c) => c.op === 'fillText')).toBe(true);
  });

  it('an out-of-bounds yPct clamps so the block stays on the canvas', () => {
    const { ctx, calls } = recordingCtx();
    // yPct -100 would anchor the block far above the canvas; the clamp keeps
    // the first line fully on-canvas instead of drawing off-screen text.
    drawThumbnail(
      ctx,
      { width: 1280, height: 720 },
      { ...DEFAULT_TEXT_OVERLAY, text: 'TOP', yPct: -100, sizePct: 20 },
    );
    const fill = calls.find((c) => c.op === 'fillText');
    const y = fill?.args[2] as number;
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y).toBeLessThan((20 / 100) * 720); // within one line height of the top
  });
});

describe('exportLadder', () => {
  it('returns the FIRST quality whose blob fits maxBytes', async () => {
    const sizes: Record<number, number> = { 0.92: 3_000_000, 0.85: 500_000, 0.75: 100_000 };
    const res = await exportLadder(
      async (q) => new Blob([new Uint8Array(sizes[q] ?? 50)]),
      YT_MAX_BYTES,
    );
    expect(res.quality).toBe(0.85);
    expect(res.bytes).toBe(500_000);
    expect(res.oversized).toBe(false);
  });
  it('returns the smallest quality + oversized when nothing fits', async () => {
    const res = await exportLadder(async () => new Blob([new Uint8Array(3_000_000)]), YT_MAX_BYTES);
    expect(res.quality).toBe(EXPORT_QUALITIES.at(-1));
    expect(res.oversized).toBe(true);
    expect(res.bytes).toBe(3_000_000);
  });
  it('skips null blobs on the way down', async () => {
    const res = await exportLadder(
      async (q) => (q > 0.5 ? null : new Blob([new Uint8Array(10)])),
      YT_MAX_BYTES,
    );
    expect(res.quality).toBeLessThanOrEqual(0.5);
    expect(res.oversized).toBe(false);
  });
  it('throws when every encode returns null', async () => {
    await expect(exportLadder(async () => null, YT_MAX_BYTES)).rejects.toThrow(/no blob/i);
  });
  it('a first-try fit never touches the smaller qualities', async () => {
    let calls = 0;
    const res = await exportLadder(
      async (q) => {
        calls += 1;
        return new Blob([new Uint8Array(q === 0.92 ? 10 : 999_999)]);
      },
      YT_MAX_BYTES,
    );
    expect(res.quality).toBe(0.92);
    expect(calls).toBe(1);
  });
});

describe('thumbnailFileName', () => {
  it('is a numbered jpg', () => {
    expect(thumbnailFileName(1)).toBe('yt-thumbnail-1.jpg');
    expect(thumbnailFileName(3)).toBe('yt-thumbnail-3.jpg');
  });
  it('falls back to 1 for a non-positive / non-finite counter', () => {
    expect(thumbnailFileName(0)).toBe('yt-thumbnail-1.jpg');
    expect(thumbnailFileName(-5)).toBe('yt-thumbnail-1.jpg');
    expect(thumbnailFileName(NaN)).toBe('yt-thumbnail-1.jpg');
  });
  it('floors a fractional counter', () => {
    expect(thumbnailFileName(2.7)).toBe('yt-thumbnail-2.jpg');
  });
});

describe('YT canvas constants', () => {
  it('the composite surface is exactly 1280x720 (YouTube-recommended 16:9)', () => {
    expect(YT_W).toBe(1280);
    expect(YT_H).toBe(720);
  });
  it('the byte cap mirrors YouTube (2 MB)', () => {
    expect(YT_MAX_BYTES).toBe(2 * 1024 * 1024);
  });
});
