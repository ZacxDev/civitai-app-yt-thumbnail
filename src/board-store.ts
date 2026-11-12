/**
 * YT Thumbnail — the published-format board, over ONE shared collection of the
 * App Blocks document store.
 *
 * Until 0.2.0 the board was the legacy shared feed (`useSharedStorage`, scopes
 * `apps:storage:shared:read` + `:write`): `append({ title, body, data })`, a
 * host vote tally, and `report(key, reason)`. The document store replaces it
 * with one declared collection:
 *
 *   `formats` — `{ visibility: "shared", write: "own", marks: ["vote"] }`
 *     key    = server-minted (`create`), as the legacy `append` was;
 *     data   = `{ v: 1, label, suffix }` (see `boardDocForFormat` in
 *              `./formats.ts`) — no `title`/`body` split any more;
 *     votes  = the `vote` MARK: the tally is `marks.vote`, "did I vote" is the
 *              store's `viewer.marks`, on every read, for every device;
 *     report = the BUILT-IN `report` mark (undeclared, cannot be withdrawn, its
 *              count never exposed).
 *
 * - `write: "own"` is the narrowest policy that works: a viewer publishes their
 *   own format and nobody else can edit it. Creating needs the consent-gated
 *   `apps:storage:publish`; reading, voting and reporting need only
 *   `apps:storage`.
 * - No `showAuthor`: the board never renders who published a format, so turning
 *   it on would publish every author's username for no feature that reads it.
 *   "Is it mine" is `author.isViewer`.
 * - No index and no counter: the board is read newest-first by `createdAt` (the
 *   legacy feed's order), and the votes are marks.
 *
 * Production held ZERO legacy shared rows for this app at cutover, so no copy
 * script exists for `formats` and nothing outside this repo depends on its
 * shape. `./board-store.test.ts` pins it against `createFakeStorage` over the
 * committed manifest.
 */

import type { DocumentStorage, StorageCollection, StorageDocument } from '@civitai/sdk';

import { boardDocForFormat, type BoardDocument, type SharedItemLike } from './formats.js';

export const BOARD_COLLECTION = 'formats';
/** The consent-gated scope creating a board document needs. */
export const PUBLISH_SCOPE = 'apps:storage:publish';
export const VOTE_MARK = 'vote';
/** The platform's built-in report mark — not declared, never withdrawable. */
export const REPORT_MARK = 'report';
/** Newest first, as the legacy feed listed. */
export const BOARD_SORT = '-createdAt';
/** How many published formats the board loads (the legacy page size). */
export const BOARD_PAGE_SIZE = 25;

/** A store document → the item `./formats.ts` turns into a PublishedFormat. */
export function toSharedItem(doc: StorageDocument<BoardDocument>): SharedItemLike {
  return {
    key: doc.key,
    data: doc.data,
    votes: doc.marks[VOTE_MARK] ?? 0,
    viewerVoted: doc.viewer?.marks.includes(VOTE_MARK) ?? false,
    authoredByViewer: doc.author.kind === 'user' && doc.author.isViewer,
  };
}

/**
 * Assert a mark reply's `count`. A malformed reply is a FAILURE, not a tally of
 * zero — the app writes this number straight into the row's displayed count.
 */
function requireCount(reply: { count?: unknown }, op: string): number {
  if (typeof reply.count !== 'number' || !Number.isFinite(reply.count)) {
    throw new Error(`formats ${op}: reply carried no numeric \`count\``);
  }
  return reply.count;
}

/** The board operations the app performs. Every failure REJECTS with the store's error. */
export interface BoardStore {
  list(): Promise<SharedItemLike[]>;
  /** Create a published format under a SERVER-minted key. */
  publish(fmt: { label: string; suffix: string }): Promise<{ key: string }>;
  /** Set the viewer's `vote` mark; resolves the new tally. Idempotent. */
  vote(key: string): Promise<number>;
  /** Remove the viewer's `vote` mark; resolves the new tally. Idempotent. */
  unvote(key: string): Promise<number>;
  /** File a `report` mark. Idempotent, permanent, and it does NOT hide the row. */
  report(key: string): Promise<void>;
}

export function createBoardStore(
  docs: () => DocumentStorage | Promise<DocumentStorage>,
): BoardStore {
  const formats = async (): Promise<StorageCollection<BoardDocument>> =>
    (await docs()).collection<BoardDocument>(BOARD_COLLECTION);

  return {
    async list() {
      const page = await (await formats()).list({ sort: BOARD_SORT, limit: BOARD_PAGE_SIZE });
      return page.items.map(toSharedItem);
    },
    async publish(fmt) {
      const doc = await (await formats()).create(boardDocForFormat(fmt));
      return { key: doc.key };
    },
    async vote(key) {
      return requireCount(await (await formats()).mark(key, VOTE_MARK), 'vote');
    },
    async unvote(key) {
      return requireCount(await (await formats()).unmark(key, VOTE_MARK), 'unvote');
    },
    async report(key) {
      await (await formats()).mark(key, REPORT_MARK);
    },
  };
}
