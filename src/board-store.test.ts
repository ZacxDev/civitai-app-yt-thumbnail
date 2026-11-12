// The published-format board is ONE shared collection (see ./board-store.ts).
// Pinned with LITERALS against the SDK's contract fake over the COMMITTED
// manifest, so a declaration that drifts from the code fails here.

import { describe, expect, it } from 'vitest';

import { FAKE_STORAGE_MODERATION } from '@civitai/sdk/testing';

import {
  BOARD_COLLECTION,
  BOARD_PAGE_SIZE,
  BOARD_SORT,
  PUBLISH_SCOPE,
  createBoardStore,
} from './board-store.js';
import { createAppFakeStorage } from './fake-doc-storage.js';
import { classifyStorageError, publishRefusalMessage } from './storage-errors.js';

describe('the `formats` board', () => {
  it('names the collection, marks, scope and read order literally', () => {
    expect(BOARD_COLLECTION).toBe('formats');
    expect(PUBLISH_SCOPE).toBe('apps:storage:publish');
    expect(BOARD_SORT).toBe('-createdAt');
    expect(BOARD_PAGE_SIZE).toBe(25);
  });

  it('publishes `{ v, label, suffix }` under a server-minted key', async () => {
    const fake = createAppFakeStorage();
    const board = createBoardStore(() => fake.storage);
    const { key } = await board.publish({ label: ' Retro ', suffix: ' vhs grain ' });
    const post = fake.calls.find((c) => c.method === 'POST');
    expect(post?.path).toBe('blocks/storage/formats');
    expect(post?.body).toEqual({ data: { v: 1, label: 'Retro', suffix: 'vhs grain' } });
    expect((await fake.storage.collection(BOARD_COLLECTION).get(key))?.author).toMatchObject({ isViewer: true });
  });

  it('🔴 the store moderates the SUFFIX: a blocked term in it is refused, with viewer copy', async () => {
    // The guarantee the legacy `body` field existed for. A refusal must come from
    // the suffix alone (the label is clean), so this is about the field that is
    // injected into other viewers' paid generations.
    const board = createBoardStore(() => createAppFakeStorage().storage);
    const err = await board
      .publish({ label: 'Clean name', suffix: `glow ${FAKE_STORAGE_MODERATION.blockedText}` })
      .then(() => null, (e: unknown) => e);
    expect(err).toMatchObject({ code: 'content_rejected' });
    expect(publishRefusalMessage(err)).toMatch(/content check rejected/);
    // Control: the same label with a clean suffix publishes.
    await expect(board.publish({ label: 'Clean name', suffix: 'glow' })).resolves.toMatchObject({
      key: expect.any(String),
    });
  });

  it('lists newest first with the vote tally, the viewer’s own vote, and authorship', async () => {
    const fake = createAppFakeStorage();
    const zed = createBoardStore(() => fake.as({ viewer: { username: 'zed' } }).storage);
    const first = await zed.publish({ label: 'First', suffix: 'one' });
    const second = await zed.publish({ label: 'Second', suffix: 'two' });
    const me = createBoardStore(() => fake.storage);
    const mine = await me.publish({ label: 'Mine', suffix: 'three' });
    expect(await me.vote(first.key)).toBe(1);
    expect(await createBoardStore(() => fake.as({ viewer: { username: 'amy' } }).storage).vote(first.key)).toBe(2);

    const items = await me.list();
    expect(items.map((i) => [i.key, i.votes, i.viewerVoted, i.authoredByViewer])).toEqual([
      [mine.key, 0, false, true],
      [second.key, 0, false, false],
      [first.key, 2, true, false],
    ]);
    const get = fake.calls.filter((c) => c.method === 'GET' && c.path === 'blocks/storage/formats').at(-1);
    expect(get?.query).toMatchObject({ sort: '-createdAt', limit: '25' });
  });

  it('unvote removes the viewer’s mark; report is the built-in mark and is permanent', async () => {
    const fake = createAppFakeStorage();
    const me = createBoardStore(() => fake.storage);
    const { key } = await createBoardStore(() => fake.as({ viewer: { username: 'zed' } }).storage).publish({
      label: 'X',
      suffix: 'y',
    });
    expect(await me.vote(key)).toBe(1);
    expect(await me.unvote(key)).toBe(0);
    await me.report(key);
    const marks = fake.calls.filter((c) => c.method === 'PUT' && c.path.includes('/marks/'));
    expect(marks.map((c) => c.path.split('/').at(-1))).toEqual(['vote', 'report']);
    await expect(fake.storage.collection(BOARD_COLLECTION).unmark(key, 'report')).rejects.toMatchObject({
      code: 'invalid_request',
    });
  });

  it('a publish without the consent-gated scope is refused consent_required; a vote is not', async () => {
    const fake = createAppFakeStorage();
    const { key } = await createBoardStore(() => fake.as({ viewer: { username: 'zed' } }).storage).publish({
      label: 'X',
      suffix: 'y',
    });
    const unconsented = createBoardStore(() => fake.as({ scopes: ['apps:storage'] }).storage);
    const err = await unconsented.publish({ label: 'A', suffix: 'b' }).then(() => null, (e: unknown) => e);
    expect(err).toMatchObject({ code: 'consent_required' });
    expect(publishRefusalMessage(err)).toMatch(/permission first/);
    expect(await unconsented.vote(key)).toBe(1);
  });

  it('an anonymous viewer reads the board; their write is classified "sign in"', async () => {
    const fake = createAppFakeStorage();
    await createBoardStore(() => fake.storage).publish({ label: 'X', suffix: 'y' });
    const anon = createBoardStore(() => fake.as({ viewer: null }).storage);
    expect((await anon.list()).map((i) => [i.viewerVoted, i.authoredByViewer])).toEqual([[false, false]]);
    const err = await anon.publish({ label: 'A', suffix: 'b' }).then(() => null, (e: unknown) => e);
    expect(classifyStorageError(err)).toBe('anon');
  });
});
