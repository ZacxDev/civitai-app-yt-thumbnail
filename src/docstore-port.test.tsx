// 0.2.0 — the viewer's formats and history moved from the legacy per-viewer KV
// (`useAppStorage`) to the document store's private `kv` collection, and the
// published-format board from the legacy shared feed (`useSharedStorage`) to
// the shared `formats` collection. These drive the REAL <App/> (no hook mocks)
// against the mock host for the bridge and the SDK's `createFakeStorage` for
// the document store (installed per test by ./test-setup.ts), and pin:
//   1. a viewer's formats exactly as the cutover copy laid them down load;
//   2. saving a format writes `kv` under the legacy key, wrapped in { value };
//   3. publishing creates a `formats` document; the board lists other viewers'
//      documents with their `vote` tally, and a vote is the viewer's mark;
//   4. an anonymous viewer never reaches the private store;
//   5. in production wiring (no override) the requests go to the HOST origin's
//      `/api/v1/blocks/storage/…`, with the block token.
// test-setup's tripwire additionally fails ANY test that speaks a legacy store.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App.js';
import { configureDocumentStorage } from './doc-storage.js';
import { seedKv } from './fake-doc-storage.js';
import { KV_COLLECTION, type KvDocument } from './kv-store.js';
import { installMockMoneyHost } from './mock-buzz.js';
import { testDocStore } from './test-doc-store.js';

const VIEWER = { id: 2, username: 'dev', status: 'active' } as const;
/** The shared board collection, as a LITERAL (`board-store.test.ts` pins the constant to it). */
const BOARD_COLLECTION = 'formats';

describe('YT Thumbnail on the document store (0.2.0)', () => {
  let uninstall: (() => void) | undefined;
  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
    vi.unstubAllGlobals();
  });

  it('loads custom formats exactly as the copy script wrote them (kv, `formats:custom:v1`, { value })', async () => {
    await seedKv(testDocStore(), {
      'formats:custom:v1': [{ id: 'custom:7', label: 'Copied Noir', suffix: 'hard shadows' }],
    });
    uninstall = installMockMoneyHost({ viewer: { ...VIEWER } });
    render(<App />);
    expect(await screen.findByTestId('yt-format-custom:7')).toHaveTextContent('Copied Noir');
    const get = testDocStore().calls.find((c) => c.method === 'GET' && c.path.startsWith(`blocks/storage/${KV_COLLECTION}/`));
    expect(get?.path).toBe('blocks/storage/kv/formats%3Acustom%3Av1');
  });

  it('saving a format writes the list under the legacy key, wrapped in { value }', async () => {
    uninstall = installMockMoneyHost({ viewer: { ...VIEWER } });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByTestId('yt-format-new'));
    await user.type(screen.getByTestId('yt-format-label'), 'Mine');
    await user.type(screen.getByTestId('yt-format-suffix'), 'my look');
    await user.click(screen.getByTestId('yt-format-save'));

    const kv = testDocStore().storage.collection<KvDocument>(KV_COLLECTION);
    await waitFor(async () => {
      const doc = await kv.get('formats:custom:v1');
      expect(doc?.data.value).toEqual([expect.objectContaining({ label: 'Mine', suffix: 'my look' })]);
    });
  });

  it('publish creates a `formats` document; the board shows other viewers’ formats and votes with a mark', async () => {
    const fake = testDocStore();
    await seedKv(fake, { 'formats:custom:v1': [{ id: 'custom:1', label: 'Retro VHS', suffix: 'vhs grain' }] });
    // Another viewer's published format, with one vote from a third viewer.
    const theirs = await fake
      .as({ viewer: { username: 'zed' } })
      .storage.collection(BOARD_COLLECTION)
      .create({ v: 1, label: 'Neon Noir', suffix: 'wet streets' });
    await fake.as({ viewer: { username: 'amy' } }).storage.collection(BOARD_COLLECTION).mark(theirs.key, 'vote');

    uninstall = installMockMoneyHost({ viewer: { ...VIEWER } });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByTestId('yt-format-publish-custom:1'));
    expect(await screen.findByTestId('yt-storage-note')).toHaveTextContent('Published “Retro VHS” to the board.');
    const mine = await fake.storage.collection(BOARD_COLLECTION).list({ author: 'me' });
    expect(mine.items.map((d) => d.data)).toEqual([{ v: 1, label: 'Retro VHS', suffix: 'vhs grain' }]);

    await user.click(screen.getByTestId('yt-board-toggle'));
    const vote = await screen.findByTestId(`yt-published-vote-${theirs.key}`);
    await waitFor(() =>
      expect(screen.getAllByTestId('yt-published-row').some((r) => /Neon Noir/.test(r.textContent ?? ''))).toBe(true),
    );
    await user.click(vote);
    await waitFor(async () => {
      const doc = await fake.storage.collection(BOARD_COLLECTION).get(theirs.key);
      expect(doc?.marks.vote).toBe(2);
      expect(doc?.viewer?.marks).toEqual(['vote']);
    });
  });

  it('an anonymous viewer never reaches the private store', async () => {
    uninstall = installMockMoneyHost({ viewer: null });
    render(<App />);
    await screen.findByTestId('yt-storage-anon');
    await new Promise((r) => setTimeout(r, 50));
    expect(testDocStore().calls.filter((c) => c.path.startsWith(`blocks/storage/${KV_COLLECTION}`))).toEqual([]);
  });

  it('production wiring: the HOST origin’s /api/v1/blocks/storage routes, with the block token', async () => {
    configureDocumentStorage(null);
    const seen: { url: string; auth: string | null }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        seen.push({ url, auth: new Headers(init?.headers).get('authorization') });
        const isDoc = /\/blocks\/storage\/kv\//.test(url);
        return new Response(
          JSON.stringify(isDoc ? { code: 'not_found', message: 'not found' } : { items: [], nextCursor: null }),
          { status: isDoc ? 404 : 200, headers: { 'content-type': 'application/json' } },
        );
      }),
    );
    uninstall = installMockMoneyHost({ viewer: { ...VIEWER } });
    render(<App />);
    await waitFor(() =>
      expect(seen.some((s) => s.url.includes('/blocks/storage/kv/formats%3Acustom%3Av1'))).toBe(true),
    );
    const storageCalls = seen.filter((s) => s.url.includes('/blocks/storage'));
    for (const call of storageCalls) {
      expect(call.url.startsWith(`${window.location.origin}/api/v1/blocks/storage/`)).toBe(true);
      expect(call.auth).toMatch(/^Bearer \S+/);
    }
  });
});
