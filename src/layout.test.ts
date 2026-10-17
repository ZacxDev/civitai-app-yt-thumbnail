import { describe, expect, it } from 'vitest';

import { resolveBlockTier, type BlockSizeTier } from '@civitai/blocks-react';

import { FORMATS_RAIL_WIDTH, ULTRAWIDE_MIN, layoutForTier, type BlockLayout } from './layout.js';

// The width→shape decision, at literal values.
//
// 🔴 EVERY NUMBER IN THE TABLE IS WRITTEN OUT BY HAND, not read back from
// `layoutForTier`. A table built by calling the function it tests asserts only
// that the function is deterministic — which is true of a function that returns
// the wrong answer. These came from the design decision, and a change to the
// ladder has to change this file too. That is the cost, and it is the point.

/**
 * One fixture width strictly INSIDE each tier.
 *
 * 🔴 THE WIDTHS ARE CHOSEN TO DISCRIMINATE. Each is distinct from every
 * breakpoint constant (480 / 768 / 1024 / 1184 / 1440), from the tier-top widths
 * the gutter case names (1023 / 1183), from the ultrawide threshold (1800), and
 * from every value `layoutForTier` can RETURN (640 / 1184 / 124 / 160 / 200 / 220 /
 * 340 / 400), and from `FORMATS_RAIL_WIDTH` (320) — a fixture that happens to equal a constant the assertion also names
 * cannot see a mutant that hardcodes that constant. None of them sits on a boundary
 * either: a width that lands exactly ON the comparison it is meant to exercise
 * passes whether the comparison is `>=` or `>`.
 *
 * ⚠️ AND THAT IS WHY `md`'s FIXTURE COULD NOT SEE THE GUTTER BUG. 1099 is strictly
 * inside `md` and distinct from every constant, and the two-column cap was 1100 —
 * so this fixture sat one pixel under the cap and the whole table stayed green while
 * every width from 1101 to 1183 was guttered. "Inside the tier" is not "inside the
 * range the cap governs"; the tier-top case below is what covers the difference.
 */
const INSIDE: Record<BlockSizeTier, number> = {
  base: 361,
  xs: 613,
  sm: 901,
  md: 1099,
  lg: 1301,
  xl: 1523,
};

/** A width that is BOTH `xl` and ultrawide — the only shape 4 columns is real at. */
const INSIDE_ULTRAWIDE = 1907;

/**
 * The narrowest block width the SDK resolves to `tier` — found by scanning rather than
 * written down, so a breakpoint move shows up as a changed expectation instead of a
 * stale literal this file quietly keeps asserting.
 */
function tierFloor(tier: BlockSizeTier): number {
  for (let w = 1; w <= 4000; w++) if (resolveBlockTier(w) === tier) return w;
  throw new Error(`no width in range resolves to ${tier}`);
}

interface Case {
  readonly name: string;
  readonly tier: BlockSizeTier;
  readonly ultrawide: boolean;
  readonly width: number;
  readonly expected: BlockLayout;
}

const CASES: readonly Case[] = [
  {
    name: 'base — a phone, or the model.sidebar_top slot',
    tier: 'base',
    ultrawide: false,
    width: INSIDE.base,
    expected: {
      tier: 'base',
      ultrawide: false,
      maxWidth: 640,
      formatMinCardPx: 124,
      rail: false,
      railWidth: 0,
      heroMinHeight: 104,
      editorSideBySide: false,
      modelRow: 'stacked',
    },
  },
  {
    name: 'xs',
    tier: 'xs',
    ultrawide: false,
    width: INSIDE.xs,
    expected: {
      tier: 'xs',
      ultrawide: false,
      maxWidth: 640,
      formatMinCardPx: 124,
      rail: false,
      railWidth: 0,
      heroMinHeight: 104,
      editorSideBySide: false,
      modelRow: 'stacked',
    },
  },
  {
    name: 'sm',
    tier: 'sm',
    ultrawide: false,
    width: INSIDE.sm,
    expected: {
      tier: 'sm',
      ultrawide: false,
      maxWidth: 1184,
      formatMinCardPx: 160,
      rail: false,
      railWidth: 0,
      heroMinHeight: 104,
      editorSideBySide: false,
      modelRow: 'row',
    },
  },
  {
    name: 'md',
    tier: 'md',
    ultrawide: false,
    width: INSIDE.md,
    expected: {
      tier: 'md',
      ultrawide: false,
      maxWidth: 1184,
      formatMinCardPx: 160,
      rail: false,
      railWidth: 0,
      heroMinHeight: 104,
      editorSideBySide: false,
      modelRow: 'row',
    },
  },
  {
    // 🔴 `lg` IS NOT A RAIL TIER AND THIS CASE IS WHERE THAT IS STATED AS A NUMBER.
    // It had the rail for one revision; at 1184–1439px of block the three fixed-plus-
    // flexible tracks leave ONE thumbnail per row where the tabbed layout renders three,
    // so crossing 1183 → 1184 made the app's primary object smaller. The operator moved
    // the rail to `xl`. Every field below is `md`'s except the tier itself, which is the
    // whole claim — `lg` is a wider `md`, not a narrower `xl`.
    name: 'lg — the rail does NOT appear here; it is a two-column tier',
    tier: 'lg',
    ultrawide: false,
    width: INSIDE.lg,
    expected: {
      tier: 'lg',
      ultrawide: false,
      maxWidth: 1184,
      formatMinCardPx: 160,
      rail: false,
      railWidth: 0,
      heroMinHeight: 104,
      editorSideBySide: false,
      modelRow: 'row',
    },
  },
  {
    name: 'xl, not ultrawide — the rail appears here: a windowed desktop browser, or a 1600/1680 monitor',
    tier: 'xl',
    ultrawide: false,
    width: INSIDE.xl,
    expected: {
      tier: 'xl',
      ultrawide: false,
      maxWidth: null,
      formatMinCardPx: 200,
      rail: true,
      railWidth: 340,
      heroMinHeight: 132,
      editorSideBySide: true,
      modelRow: 'row',
    },
  },
  {
    name: 'xl AND ultrawide — the fourth column',
    tier: 'xl',
    ultrawide: true,
    width: INSIDE_ULTRAWIDE,
    expected: {
      tier: 'xl',
      ultrawide: true,
      maxWidth: null,
      formatMinCardPx: 220,
      rail: true,
      railWidth: 400,
      heroMinHeight: 132,
      editorSideBySide: true,
      modelRow: 'row',
    },
  },
];

describe('layoutForTier', () => {
  it.each(CASES.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(layoutForTier(c.tier, c.ultrawide)).toEqual(c.expected);
  });

  // 🔴 THIS IS WHAT TIES THE TABLE TO REALITY. Without it the table above is a
  // claim about seven strings, and a fixture width could sit in a different tier
  // than the row it was written under while every assertion stayed green.
  it.each(CASES.map((c) => [c.width, c.tier] as const))(
    '%ipx really resolves to %s through the SDK ladder',
    (width, tier) => {
      expect(resolveBlockTier(width)).toBe(tier);
    },
  );

  it('the ultrawide fixture is above the threshold AND inside xl', () => {
    // Both halves have to hold or the 4-column row is unreachable in production:
    // `ultrawide` is clamped to `xl` on purpose (see below).
    expect(INSIDE_ULTRAWIDE).toBeGreaterThanOrEqual(ULTRAWIDE_MIN);
    expect(resolveBlockTier(INSIDE_ULTRAWIDE)).toBe('xl');
  });

  it('every fixture width is distinct from every breakpoint and every output value', () => {
    // The mutation-isolation control, mechanised: a fixture that equals a constant
    // the assertions name cannot observe a mutant that hardcodes that constant.
    const forbidden = new Set([
      480, 768, 1024, 1184, 1440, 1800, 1023, 1183, 640, 124, 160, 200, 220, 340, 400, 0,
      // The formats rail's width is a layout output too, and `responsive.test.tsx`
      // names it in a `gridTemplateColumns` literal — so a fixture equal to it could
      // not see a mutant that hardcoded it.
      FORMATS_RAIL_WIDTH,
    ]);
    for (const width of [...Object.values(INSIDE), INSIDE_ULTRAWIDE]) {
      expect(forbidden.has(width)).toBe(false);
    }
  });

  describe('the ultrawide flag is CLAMPED to the tier, never trusted', () => {
    // Two observers, two answers; during a resize frame they can disagree, and a
    // caller (or a test) can hand over a combination no real geometry produces.
    it.each(['base', 'xs', 'sm', 'md', 'lg'] as const)(
      'ultrawide=true at %s is ignored',
      (tier) => {
        const clamped = layoutForTier(tier, true);
        expect(clamped.ultrawide).toBe(false);
        // And it is ignored ALL THE WAY DOWN, not just in the echoed flag: the
        // 4-column/400px-rail branch must be unreachable from a sub-xl tier.
        expect(clamped).toEqual(layoutForTier(tier, false));
        // Two independent ultrawide-only numbers, so this is not one coincidence.
        // (`resultColumns` used to be the third; it is gone — the thumbnail grid is
        // intrinsically sized now and nothing lays out from a per-tier count.)
        expect(clamped.formatMinCardPx).not.toBe(220);
        expect(clamped.railWidth).not.toBe(400);
      },
    );

    it('ultrawide=true at xl is honoured', () => {
      expect(layoutForTier('xl', true).formatMinCardPx).toBe(220);
      expect(layoutForTier('xl', true).railWidth).toBe(400);
    });

    it('omitting the flag is the same as passing false', () => {
      for (const tier of ['base', 'xs', 'sm', 'md', 'lg', 'xl'] as const) {
        expect(layoutForTier(tier)).toEqual(layoutForTier(tier, false));
      }
    });
  });

  describe('invariants that hold across the whole ladder', () => {
    const all = [
      ...(['base', 'xs', 'sm', 'md', 'lg', 'xl'] as const).map((t) => layoutForTier(t, false)),
      layoutForTier('xl', true),
    ];

    it('railWidth is 0 exactly when there is no rail — in BOTH directions', () => {
      for (const l of all) {
        expect(l.railWidth === 0).toBe(l.rail === false);
        if (l.rail) expect(l.railWidth).toBeGreaterThan(0);
      }
    });

    it('the content column is uncapped exactly when the rail is on', () => {
      // The cap exists to keep a SINGLE readable measure; once the rail plus a
      // multi-column grid are spending the width there is nothing left to cap.
      for (const l of all) expect(l.maxWidth === null).toBe(l.rail);
    });

    it('the editor splits exactly when the rail is on', () => {
      for (const l of all) expect(l.editorSideBySide).toBe(l.rail);
    });

    it('the hero height floor keys off the rail, and the two values really differ', () => {
      // 🔴 THE POINT IS THAT IT AGREES WITH THE PADDING. `heroStyle` picks its
      // padding with `layout.rail ? … : …`; if this field were keyed off anything
      // else the hero could get the tall floor and the narrow padding at some
      // tier, which is the kind of disagreement a second open-coded ternary in
      // `App.tsx` would have produced silently.
      for (const l of all) expect(l.heroMinHeight).toBe(l.rail ? 132 : 104);
      // Not a flat ladder: a "keys off rail" check over one repeated value passes
      // vacuously, and the whole reason the field exists is that it VARIES.
      expect(new Set(all.map((l) => l.heroMinHeight)).size).toBe(2);
      // And the floor is a floor, not a cap on the two-line text stack it has to
      // clear (26px + 13px of type at 1.15, plus 36px of padding ≈ 81px).
      for (const l of all) expect(l.heroMinHeight).toBeGreaterThan(81);
    });

    it('card size never DECREASES as the block gets wider', () => {
      // 🔴 `resultColumns` WAS THE OTHER HALF OF THIS AND IS GONE WITH THE FIELD.
      // It ran 1/1/2/2/3/3/4 and the thumbnail grid laid out from it — which is what
      // multiplied with the history ROW grid and squeezed a thumbnail down to a
      // sixteenth of the main column. The thumbnail grid is now `auto-fill` with a
      // tier-INDEPENDENT floor (`IMAGE_MIN_PX`), so there is no per-tier count left
      // to grade a ladder on; `responsive.test.tsx` asserts the floor is identical at
      // four widths instead, which is the replacement claim.
      for (let i = 1; i < all.length; i += 1) {
        expect(all[i].formatMinCardPx).toBeGreaterThanOrEqual(all[i - 1].formatMinCardPx);
      }
      // And it is not a flat ladder — a monotonicity check over seven equal values
      // passes vacuously.
      expect(all[0].formatMinCardPx).toBe(124);
      expect(all[all.length - 1].formatMinCardPx).toBe(220);
      expect(new Set(all.map((l) => l.formatMinCardPx)).size).toBe(4);
    });

    it('the TABLET tiers cannot gutter — the cap is above every width `sm`/`md` admit', () => {
      // 🔴 THE ONE-COLUMN CAP DELIBERATELY DOES GUTTER AND THE TABLET TIERS MUST
      // NOT, so this is scoped rather than universal. 640 at `base`/`xs` gutters
      // from 641px up, which is the point of it: a single text column wants a
      // readable measure. Two columns are already spending the width, and "full
      // width on a tablet" is the requirement, so a cap narrower than the tier's
      // own top width is a defect — it was 1100 against a tier that runs to 1183.
      //
      // 🔴 SCOPED TO `sm`/`md` AND *NOT* TO EVERY TIER THAT SHARES THEIR CAP. `lg` joined
      // them when the rail moved to `xl`, and at `lg` the cap DOES bind, on purpose — the
      // case below is that claim, with its arithmetic. This title used to say "at ANY
      // width inside its own tiers" while the body enumerated two tiers; the two now
      // agree, because the honest scope is the device class, not the shape.
      //
      // Each pair is `[tier, the widest width that tier admits]`, one below the next
      // breakpoint on the SDK ladder; the loop below re-derives them through
      // `resolveBlockTier` so they cannot drift into fiction.
      const TABLET_TIERS = [
        ['sm', 1023],
        ['md', 1183],
      ] as const;

      for (const [tier, top] of TABLET_TIERS) {
        const cap = layoutForTier(tier).maxWidth;
        expect(cap, `${tier} is meant to be capped`).not.toBeNull();
        expect(
          cap as number,
          `${tier} caps the column at ${cap}px but the tier runs to ${top}px, so a block ` +
            `between ${(cap as number) + 1} and ${top}px wide is centred inside ` +
            `${(top - (cap as number)) / 2}px of gutter`,
        ).toBeGreaterThanOrEqual(top);
      }

      // The control: each `top` really IS the last width in that tier, and one more
      // pixel is the next tier. Without this the loop above could pass against two
      // invented numbers.
      for (const [tier, top] of TABLET_TIERS) {
        expect(resolveBlockTier(top)).toBe(tier);
        expect(resolveBlockTier(top + 1)).not.toBe(tier);
      }
    });

    it('🔴 the cap DOES bind inside `lg`, and that is what keeps the step into the rail one tile', () => {
      // 🔴 THE GUTTER THE CASE ABOVE DOES NOT COVER, ASSERTED RATHER THAN LEFT SILENT.
      // `lg` shares `sm`/`md`'s cap but runs to 1439px, so from a 1233px block up the
      // content column is centred inside gutters — up to 103px a side at 1439. That is
      // not an oversight and this is where a reader finds out: it is the reason the one
      // discontinuity this layout still has costs ONE thumbnail instead of two.
      //
      // Capped, every width in `lg` renders the same grid container, so the tile count is
      // flat across the tier and the step at 1440 is 3 -> 2. Uncapped, a 1439px block
      // would render 4 and the step would be 4 -> 2 — the same two-tile cliff that moving
      // the rail to `xl` exists to remove, relocated rather than fixed. The tile
      // arithmetic itself lives in `responsive.test.tsx`, against the emitted CSS; what
      // is assertable in this pure module is that the cap binds and where.
      const cap = layoutForTier('lg').maxWidth as number;
      expect(cap, '`lg` is meant to be capped').not.toBeNull();

      // It binds, and the sharp statement is WHERE: the cap IS the tier's own floor, so
      // the content column stops growing exactly where `lg` begins. That is why the tile
      // count is FLAT across 1184–1439 rather than merely bounded somewhere inside it.
      // Both numbers come out of `resolveBlockTier`, so neither is a literal here.
      const LG_FLOOR = tierFloor('lg');
      const LG_TOP = tierFloor('xl') - 1;
      expect(resolveBlockTier(LG_TOP)).toBe('lg');
      expect(
        cap,
        `the \`lg\` cap is ${cap}px but the tier floor is ${LG_FLOOR}px. If the cap is ` +
          `ABOVE the floor the column grows with the block again, and the step into the ` +
          `rail at ${LG_TOP + 1} goes back to TWO tiles — the defect moving the rail to ` +
          `\`xl\` exists to remove. Move the tile-count case in responsive.test.tsx first ` +
          `and change this one with it.`,
      ).toBe(LG_FLOOR);
      // ...and the tier really is wider than its floor, or "flat across the tier" would be
      // a claim about a one-pixel range.
      expect(LG_TOP).toBeGreaterThan(LG_FLOOR);

      // ...and it is the SAME cap the tablet tiers get, not a third number. A `lg`-only
      // cap would pass the bound above and be a per-tier ladder nobody asked for.
      expect(cap).toBe(layoutForTier('md').maxWidth);
      expect(cap).toBe(layoutForTier('sm').maxWidth);
      // The control: `xl` really is uncapped, so "capped" above is a distinction the
      // ladder can express.
      expect(layoutForTier('xl').maxWidth).toBeNull();
    });

    it('the 640px column this pass removed survives ONLY below sm', () => {
      // The regression this whole module exists for: a 1600px block must not get
      // a 640px content column.
      expect(layoutForTier('base').maxWidth).toBe(640);
      expect(layoutForTier('xs').maxWidth).toBe(640);
      for (const tier of ['sm', 'md', 'lg', 'xl'] as const) {
        expect(layoutForTier(tier).maxWidth).not.toBe(640);
      }
    });
  });

  // =========================================================================
  // THE FORMATS RAIL'S WIDTH — a FIXED length, and the numbers it may not be.
  //
  // 🔴 WHAT THIS FILE CAN AND CANNOT CLAIM ABOUT IT. This module is pure, so what is
  // assertable here is the VALUE: that it is a fixed length, inside the band the
  // operator set, and distinct from the two widths the OTHER rail can be. That it
  // reaches the DOM as a px track rather than a fraction of the main column — the
  // actual defect — is a claim about `railGridStyle`, and it lives in
  // `responsive.test.tsx` next to the emitted `gridTemplateColumns`.
  // =========================================================================
  describe('FORMATS_RAIL_WIDTH', () => {
    /** Every width `layoutForTier` can hand the INPUTS rail, over the whole ladder. */
    const railWidths = new Set(
      [
        ...(['base', 'xs', 'sm', 'md', 'lg', 'xl'] as const).map((t) => layoutForTier(t, false)),
        layoutForTier('xl', true),
      ].map((l) => l.railWidth),
    );

    it('is a fixed, positive, whole number of px', () => {
      // A fixed LENGTH is the whole design decision — see the constant's docblock for
      // the tile arithmetic. A string ('30%', '1fr') or a fraction would be the defect
      // wearing the constant's name, and `railGridStyle` interpolates it followed by
      // 'px', so a non-integer would emit a subpixel track.
      expect(typeof FORMATS_RAIL_WIDTH).toBe('number');
      expect(Number.isInteger(FORMATS_RAIL_WIDTH)).toBe(true);
      expect(FORMATS_RAIL_WIDTH).toBeGreaterThan(0);
    });

    it('sits inside the 320–360px band the operator set', () => {
      // Pinned in BOTH directions. Too narrow and the 200px format card at this tier
      // cannot fit beside 34px of rail chrome (16+16 padding, 1+1 border); too wide and
      // it is taking px from the thumbnail grid for a column it cannot use.
      expect(FORMATS_RAIL_WIDTH).toBeGreaterThanOrEqual(320);
      expect(FORMATS_RAIL_WIDTH).toBeLessThanOrEqual(360);
    });

    it('clears one format card at its floor, plus the rail’s own chrome', () => {
      // The lower bound as a DERIVATION rather than a second literal: the card floor at
      // the rail tiers comes off the layout, and `railStyle`'s padding + border is 34px.
      // Without this the band above is two numbers somebody chose.
      //
      // 🔴 THE UPPER HALF OF THIS CASE WAS DELETED, NOT MOVED. It asserted that the rail
      // does not clear a SECOND card column — `< floor * 2 + 8 + RAIL_CHROME`, i.e. < 482
      // — which cannot fail while the band case above caps the constant at 360. A bound
      // dominated by a tighter bound in the same file reads as a constraint and provides
      // none. The ARGUMENT it carried (extra width buys the picker nothing, so it belongs
      // to the thumbnail grid) is not lost: it is the whole of `FORMATS_RAIL_WIDTH`'s
      // docblock, and the tile-count cases in `responsive.test.tsx` are what measure it.
      //
      // The floor is read off `xl` — the narrowest RAIL tier. It used to read `lg` too,
      // which stopped being a rail tier when the operator moved the rail up.
      const RAIL_CHROME = 16 * 2 + 1 * 2;
      const floor = Math.max(
        layoutForTier('xl').formatMinCardPx,
        layoutForTier('xl', true).formatMinCardPx,
      );
      expect(FORMATS_RAIL_WIDTH).toBeGreaterThan(floor + RAIL_CHROME);
      // The control: `floor` really is the rail tiers' card floor and not, say, 0 — the
      // bound above would pass against anything small.
      expect(floor).toBeGreaterThan(layoutForTier('md').formatMinCardPx);
    });

    it('is DISTINCT from every width the inputs rail can be', () => {
      // 🔴 THE MUTANT THIS EXISTS FOR: the two rails' widths swapped in
      // `railGridStyle`. `responsive.test.tsx` asserts the whole track list as one
      // string, and pins `FORMATS_RAIL_WIDTH` as the SECOND track besides — but BOTH of
      // those are only visible while the two numbers differ; if they were ever made
      // equal, both would silently stop discriminating.
      //
      // 🔴 AND THE SWAP GOT CHEAPER TO WRITE WHEN THE COLUMNS WERE REORDERED. The two
      // fixed tracks are now ADJACENT (`railWidth`px `FORMATS_RAIL_WIDTH`px then the one
      // `fr`), so transposing them is a well-formed three-track list that no structural
      // check can see — only the inequality this case pins stands between that mutant and
      // a green suite.
      expect(railWidths.has(FORMATS_RAIL_WIDTH)).toBe(false);
      // The control: the set really is the inputs rail's widths and is not empty.
      expect(railWidths.has(0)).toBe(true);
      expect(railWidths.size).toBeGreaterThan(1);
    });

    // 🔴 `is NOT a per-tier field` WAS DELETED HERE. It asserted
    // `not.toHaveProperty('formatsRailWidth')` on three layouts — a guard on one SPELLING
    // of the hazard, which `formatsRail`, `formatsWidth` or `railWidthRight` all walk
    // while being the same change. The structural claim is already made where it can be
    // made properly: `expectedRailTracks` in `responsive.test.tsx` builds the expected
    // track list from `layoutForTier(...).railWidth` and the module-level constant, so a
    // per-tier formats width can only reach the DOM by disagreeing with that string.
  });

  // =========================================================================
  // THE ASSUMPTION THE CLAMP USED TO MAKE SILENTLY.
  // =========================================================================
  describe('the top of the SDK tier ladder is an ASSUMPTION, so it is pinned', () => {
    it('`xl` is the widest tier the SDK reports today', () => {
      // 🔴 THE ASSUMPTION `ultrawide && tier === 'xl'` USED TO BURY. The ladder is
      // `@civitai/theme`'s, not this app's, and the clamp read as a statement about
      // ultrawide while actually being a statement about the ladder's LAST element.
      // This is the announcement: if a wider tier is ever added, this case names it
      // instead of the fourth column vanishing quietly.
      //
      // Asserted through `resolveBlockTier`, a FIRST-PARTY export, rather than by
      // importing `BREAKPOINT_KEYS` from the transitive `@civitai/theme`. The claim
      // is the same one and this spelling cannot break on a dependency layout.
      for (const width of [1440, 1920, 2560, 3440, 5120, 7680]) {
        expect(resolveBlockTier(width), `${width}px no longer resolves to xl`).toBe('xl');
      }
    });

    it('the ladder `layout.ts` mirrors really IS the SDK ladder', () => {
      // 🔴 `layout.ts` WRITES OUT `BREAKPOINT_KEYS` PLUS `'base'` RATHER THAN
      // IMPORTING IT — six entries against the SDK's five, not a mirror — because
      // `@civitai/theme` is a TRANSITIVE dependency — pinned by
      // `@civitai/blocks-react`, absent from this app's `package.json` — so shipped
      // code importing it would take an undeclared dependency. A mirror needs a pin,
      // and this is it: each tier is reached through `resolveBlockTier` at a width
      // strictly inside it, in ascending order, so a key INSERTED anywhere in the
      // scale fails here rather than being absorbed by `admitsUltrawide`'s
      // "unrecognised means wider" branch.
      const ladder: readonly [BlockSizeTier, number][] = [
        ['base', 1],
        ['xs', 480],
        ['sm', 768],
        ['md', 1024],
        ['lg', 1184],
        ['xl', 1440],
      ];
      for (const [tier, width] of ladder) {
        expect(resolveBlockTier(width), `${width}px no longer resolves to ${tier}`).toBe(tier);
      }
      // And nothing sits BETWEEN two rungs: the pixel under each rung belongs to the
      // rung below it, so the ladder has no gap a new key could already be filling.
      for (let i = 1; i < ladder.length; i++) {
        expect(resolveBlockTier(ladder[i][1] - 1)).toBe(ladder[i - 1][0]);
      }
    });

    it('a tier ADDED above xl still gets the fourth column', () => {
      // 🔴 THE REGRESSION CASE. With the old `ultrawide && tier === 'xl'` this
      // returns 3 columns and a 340px rail — the defect: a 2560px block quietly
      // losing the fourth column and the wider rail while every other test stays
      // green. An unrecognised tier is treated as wider than `xl`, so the app is
      // correct the day the SDK appends one rather than the day someone notices.
      const future = layoutForTier('2xl' as BlockSizeTier, true);
      expect(future.rail).toBe(true);
      expect(future.formatMinCardPx).toBe(220);
      expect(future.railWidth).toBe(400);
      expect(future.ultrawide).toBe(true);

      // The assumption stated as a test rather than left in a comment: today the SDK
      // has no such tier, so this case is about the FUTURE and says so.
      expect(resolveBlockTier(2560)).toBe('xl');
    });

    it('but a tier no ultrawide block can REPORT is still clamped', () => {
      // The other direction: `lg` spans 1184–1439, so no block ≥ULTRAWIDE_MIN ever
      // reports it, and `('lg', true)` is two observers disagreeing rather than a real
      // geometry. The tier wins.
      //
      // 🔴 THIS CASE'S EXPECTED VALUES MOVED WHEN `lg` LEFT THE RAIL, AND THAT IS WHY IT
      // IS STILL HERE. It used to read as "the rail at lg is the NON-ultrawide rail";
      // `lg` has no rail now, so the clamp is visible in a different pair of numbers —
      // the ultrawide flag itself, and the two-column card floor rather than 220. The
      // claim is unchanged: `ultrawide` is clamped to the tier, not trusted.
      expect(resolveBlockTier(ULTRAWIDE_MIN)).not.toBe('lg');
      expect(layoutForTier('lg', true).ultrawide).toBe(false);
      expect(layoutForTier('lg', true)).toEqual(layoutForTier('lg', false));
      // ...and the clamp is a real distinction, not a tautology: at `xl` the same `true`
      // IS honoured, so the two calls differ there.
      expect(layoutForTier('xl', true)).not.toEqual(layoutForTier('xl', false));
    });
  });
});
