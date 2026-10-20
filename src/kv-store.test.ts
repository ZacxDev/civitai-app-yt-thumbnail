// The private `kv` mapping is a contract with the cutover copy script
// (`copy-kv-to-appdata.sql`): collection `kv`, key = the legacy key verbatim,
// data = `{ value: <legacy value> }`. These cases pin all three with LITERALS,
// against the SDK's own fake store built from the COMMITTED manifest — so an
// undeclared or renamed collection fails here as `collection_not_declared`
// rather than passing against a phantom store.

import { describe, expect, it } from 'vitest';

import { createAppFakeStorage } from './fake-doc-storage.js';
import { CUSTOM_FORMATS_KEY, parseCustomFormats } from './formats.js';
import { HISTORY_PREFIX, historyKey } from './history.js';
import { KV_COLLECTION, KV_LIST_LIMIT_MAX, createKvStorage, type KvDocument } from './kv-store.js';

const kvOf = (fake: ReturnType<typeof createAppFakeStorage>) =>
  fake.storage.collection<KvDocument>('kv');

describe('the copy-script contract', () => {
  it('names the collection and the legacy keys literally', () => {
    expect(KV_COLLECTION).toBe('kv');
    // The legacy keys the production rows sit under; renaming any strands them.
    expect(CUSTOM_FORMATS_KEY).toBe('formats:custom:v1');
    expect(HISTORY_PREFIX).toBe('gen:v1:');
    expect(historyKey(Date.parse('2026-10-01T00:00:00.000Z'), 'b-1')).toBe('gen:v1:98209187199999:b-1');
    expect(KV_LIST_LIMIT_MAX).toBe(100);
  });

  it('every key the app builds is a legal document key (the copy refuses any other)', () => {
    const batchId = `${Date.now().toString(36)}-${'z'.repeat(6)}`;
    for (const key of [CUSTOM_FORMATS_KEY, historyKey(Date.now(), batchId), historyKey(0, batchId)]) {
      expect(key).toMatch(/^[A-Za-z0-9._:-]{1,128}$/);
    }
  });

  it('reads records exactly as the copy script lays them down', async () => {
    const fake = createAppFakeStorage();
    const formats = [{ id: 'custom:1', label: 'Noir', suffix: 'hard shadows' }];
    await kvOf(fake).put('formats:custom:v1', { value: formats });
    const kv = createKvStorage(() => fake.storage);
    expect(parseCustomFormats(await kv.get(CUSTOM_FORMATS_KEY))).toEqual(formats);
  });

  it('writes the wrapped shape under the legacy key, so a copy re-run and the app agree', async () => {
    const fake = createAppFakeStorage();
    const kv = createKvStorage(() => fake.storage);
    await kv.set('formats:custom:v1', [{ id: 'custom:2' }]);
    expect((await kvOf(fake).get('formats:custom:v1'))?.data).toEqual({ value: [{ id: 'custom:2' }] });
    const put = fake.calls.find((c) => c.method === 'PUT');
    expect(put?.path).toBe('blocks/storage/kv/formats%3Acustom%3Av1');
    expect(put?.body).toEqual({ data: { value: [{ id: 'custom:2' }] } });
  });

  it('lists whole documents under a prefix, NEWEST FIRST by the inverted-timestamp key, unwrapped', async () => {
    const fake = createAppFakeStorage();
    const kv = createKvStorage(() => fake.storage);
    const older = historyKey(Date.parse('2026-09-01T00:00:00.000Z'), 'a');
    const newer = historyKey(Date.parse('2026-10-01T00:00:00.000Z'), 'b');
    await kv.set(older, { batchId: 'a' });
    await kv.set(newer, { batchId: 'b' });
    await kv.set('formats:custom:v1', []);

    const page = await kv.list({ prefix: HISTORY_PREFIX, limit: 500 });
    expect(page.entries.map((e) => [e.key, e.value])).toEqual([
      [newer, { batchId: 'b' }],
      [older, { batchId: 'a' }],
    ]);
    // A requested limit above the server's max is clamped, not refused.
    const list = fake.calls.find((c) => c.method === 'GET' && c.query.keyPrefix === HISTORY_PREFIX);
    expect(list?.query).toMatchObject({ limit: '100', sort: 'key' });
  });

  it('deletes, and answers null for a key never written', async () => {
    const fake = createAppFakeStorage();
    const kv = createKvStorage(() => fake.storage);
    await kv.set('formats:custom:v1', []);
    expect(await kv.delete('formats:custom:v1')).toEqual({ ok: true, deleted: true });
    expect(await kv.get('formats:custom:v1')).toBeNull();
  });

  it('is private, and REJECTS an anonymous viewer rather than reporting "nothing stored"', async () => {
    const fake = createAppFakeStorage();
    await createKvStorage(() => fake.storage).set('formats:custom:v1', [{ id: 'custom:1' }]);
    const bob = createKvStorage(() => fake.as({ viewer: { username: 'bob' } }).storage);
    expect(await bob.get('formats:custom:v1')).toBeNull();
    const anon = createKvStorage(() => createAppFakeStorage({ viewer: null }).storage);
    await expect(anon.get('formats:custom:v1')).rejects.toMatchObject({ code: 'sign_in_required' });
  });
});
