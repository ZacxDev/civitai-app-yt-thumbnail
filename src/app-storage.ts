/**
 * YT Thumbnail — the two storage handles `<App/>` uses, as hooks.
 *
 * `useKvStorage()` replaces the legacy `useAppStorage()` (the private `kv`
 * collection, `./kv-store.ts`) and `useBoardStore()` replaces `useSharedStorage()`
 * (the shared `formats` collection, `./board-store.ts`). Both run on the
 * document store client from `./doc-storage.ts`.
 *
 * 🔴 BOTH HANDLES ARE STABLE FOR THE LIFE OF THE COMPONENT, and they read the
 * current client at CALL time. The client appears only once the host origin and
 * the block token are known; an operation called before that rejects (the App
 * gates every storage call on `ready` + a viewer, which the host sends in the
 * same BLOCK_INIT, so in practice it never does). A stable handle is also what
 * the App's `storageRef` comment requires: nothing may depend on its identity.
 *
 * Tests that mock `@civitai/blocks-react` wholesale replace THIS module with
 * their own fakes (`vi.mock('./app-storage.js', …)`); the mapping underneath is
 * pinned on its own (`./kv-store.test.ts`, `./board-store.test.ts`) and through
 * the real <App/> (`./docstore-port.test.tsx`).
 */

import { useMemo, useRef } from 'react';

import type { DocumentStorage } from '@civitai/sdk';

import { createBoardStore, type BoardStore } from './board-store.js';
import { useDocumentStorage, type DocumentStorageSource } from './doc-storage.js';
import { createKvStorage, type KvStorage } from './kv-store.js';

/** A `docs` thunk over whatever source is current at call time. */
function useCurrentDocs(): () => Promise<DocumentStorage> {
  const source = useDocumentStorage();
  const ref = useRef<DocumentStorageSource | null>(source);
  ref.current = source;
  return useMemo(
    () => async () => {
      const current = ref.current;
      if (current === null) throw new Error('storage is not available yet');
      return current();
    },
    [],
  );
}

export function useKvStorage(): KvStorage {
  const docs = useCurrentDocs();
  return useMemo(() => createKvStorage(docs), [docs]);
}

export function useBoardStore(): BoardStore {
  const docs = useCurrentDocs();
  return useMemo(() => createBoardStore(docs), [docs]);
}
