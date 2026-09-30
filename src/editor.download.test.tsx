import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { REVOKE_DELAY_MS, downloadBlob, thumbnailFileName } from './editor.js';

/**
 * `downloadBlob` — the DOM glue behind the editor's Download button.
 *
 * 🔴 WHY THIS FILE IS A `.tsx`. `editor.test.ts` runs in the `node` project with
 * no DOM at all (see vite.config.ts's two-project split), so nothing there can
 * see an anchor, a click, or an object URL. The `dom` project globs `*.test.tsx`
 * only — hence the extension, despite there being no JSX here.
 *
 * 🔴 WHAT THIS CANNOT PROVE, SAID FIRST. jsdom does not download anything, and
 * it does not implement iframe sandboxing at all. NOTHING in this file is
 * evidence that the live app produces a file. It does not, and cannot today: the
 * live iframe is sandboxed without `allow-downloads`, and this block is refused
 * that token at submit (see `manifest.test.ts`'s sandbox block). What this file
 * pins is the one defect in this module that IS observable here — the object URL
 * was revoked in the same task as the click — plus the anchor's shape.
 *
 * 🔴 RED/GREEN MATRIX. The revoke case fails at the base ref (5c10658) on a real
 * ASSERTION, not an import error: `downloadBlob` exists there and revokes
 * synchronously, so `revoked` is already `[url]` before any timer runs. The two
 * anchor cases are GREEN at base — label them INVARIANT GUARDS, not regression
 * coverage; they exist so a future rewrite of this function cannot drop the
 * `download` attribute (which turns the click into a navigation) without saying
 * so.
 */

/** jsdom implements neither of these, so the test owns both ends of the URL. */
function stubObjectUrls() {
  const created: Blob[] = [];
  const revoked: string[] = [];
  const url = 'blob:stub/6e1f-a-url-no-fixture-string-equals';
  const u = URL as unknown as Record<string, unknown>;
  const priorCreate = u.createObjectURL;
  const priorRevoke = u.revokeObjectURL;
  u.createObjectURL = (b: Blob) => {
    created.push(b);
    return url;
  };
  u.revokeObjectURL = (v: string) => {
    revoked.push(v);
  };
  return {
    url,
    created,
    revoked,
    restore() {
      u.createObjectURL = priorCreate;
      u.revokeObjectURL = priorRevoke;
    },
  };
}

describe('downloadBlob', () => {
  let urls: ReturnType<typeof stubObjectUrls>;

  beforeEach(() => {
    vi.useFakeTimers();
    urls = stubObjectUrls();
  });

  afterEach(() => {
    urls.restore();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('🔴 does NOT revoke the object URL in the same task as the click', () => {
    // The race this removes: the navigation a download click starts has not
    // necessarily read the blob URL by the time the next statement runs, and a
    // revoked URL resolves to nothing. NOT the cause of the button being inert
    // in production — a three-case headless-chromium control showed an
    // unsandboxed page downloading fine WITH the synchronous revoke — but a real
    // defect, and the one this module can be held to.
    const blob = new Blob(['0123456789'], { type: 'image/jpeg' });
    downloadBlob(blob, thumbnailFileName(3));

    expect(urls.created).toEqual([blob]);
    expect(urls.revoked).toEqual([]);

    // …and it IS revoked, eventually: an object URL pins its blob for the life
    // of the document, so deferring must not mean leaking.
    vi.advanceTimersByTime(REVOKE_DELAY_MS);
    expect(urls.revoked).toEqual([urls.url]);
  });

  it('gives the anchor the DOWNLOAD attribute and the requested file name', () => {
    // INVARIANT GUARD (green at base). Without `download` the same click is a
    // navigation, which in an iframe is a different permission entirely.
    let seen: { download: string; href: string } | null = null;
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function patched(this: HTMLAnchorElement) {
      seen = { download: this.download, href: this.href };
    };
    try {
      downloadBlob(new Blob(['abc']), 'yt-thumbnail-7.jpg');
    } finally {
      HTMLAnchorElement.prototype.click = realClick;
    }
    expect(seen).toEqual({ download: 'yt-thumbnail-7.jpg', href: urls.url });
  });

  it('leaves no anchor behind in the document', () => {
    // INVARIANT GUARD (green at base). Exporting repeatedly must not accumulate
    // hidden anchors in the block's body.
    downloadBlob(new Blob(['abc']), thumbnailFileName(1));
    downloadBlob(new Blob(['abcd']), thumbnailFileName(2));
    expect(document.querySelectorAll('a[download]')).toHaveLength(0);
  });
});
