import { describe, expect, it } from 'vitest';

import { resolveBlockTier, type BlockSizeTier } from '@civitai/blocks-react';

import { ULTRAWIDE_MIN, layoutForTier, type BlockLayout } from './layout.js';

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
 * breakpoint constant (480 / 768 / 1024 / 1184 / 1440), from the ultrawide
 * threshold (1800), and from every value `layoutForTier` can RETURN (640 / 1100 /
 * 124 / 160 / 200 / 220 / 340 / 400) — a fixture that happens to equal a constant
 * the assertion also names cannot see a mutant that hardcodes that constant. None
 * of them sits on a boundary either: a width that lands exactly ON the comparison
 * it is meant to exercise passes whether the comparison is `>=` or `>`.
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
      resultColumns: 1,
      rail: false,
      railWidth: 0,
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
      resultColumns: 1,
      rail: false,
      railWidth: 0,
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
      maxWidth: 1100,
      formatMinCardPx: 160,
      resultColumns: 2,
      rail: false,
      railWidth: 0,
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
      maxWidth: 1100,
      formatMinCardPx: 160,
      resultColumns: 2,
      rail: false,
      railWidth: 0,
      editorSideBySide: false,
      modelRow: 'row',
    },
  },
  {
    name: 'lg — the rail appears here',
    tier: 'lg',
    ultrawide: false,
    width: INSIDE.lg,
    expected: {
      tier: 'lg',
      ultrawide: false,
      maxWidth: null,
      formatMinCardPx: 200,
      resultColumns: 3,
      rail: true,
      railWidth: 340,
      editorSideBySide: true,
      modelRow: 'row',
    },
  },
  {
    name: 'xl, not ultrawide — the live ~1600px desktop block',
    tier: 'xl',
    ultrawide: false,
    width: INSIDE.xl,
    expected: {
      tier: 'xl',
      ultrawide: false,
      maxWidth: null,
      formatMinCardPx: 200,
      resultColumns: 3,
      rail: true,
      railWidth: 340,
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
      resultColumns: 4,
      rail: true,
      railWidth: 400,
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
    const forbidden = new Set([480, 768, 1024, 1184, 1440, 1800, 640, 1100, 124, 160, 200, 220, 340, 400, 0]);
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
        expect(clamped.resultColumns).not.toBe(4);
        expect(clamped.railWidth).not.toBe(400);
      },
    );

    it('ultrawide=true at xl is honoured', () => {
      expect(layoutForTier('xl', true).resultColumns).toBe(4);
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

    it('columns and card size never DECREASE as the block gets wider', () => {
      for (let i = 1; i < all.length; i += 1) {
        expect(all[i].resultColumns).toBeGreaterThanOrEqual(all[i - 1].resultColumns);
        expect(all[i].formatMinCardPx).toBeGreaterThanOrEqual(all[i - 1].formatMinCardPx);
      }
      // And it is not a flat ladder — a monotonicity check over seven equal values
      // passes vacuously.
      expect(all[0].resultColumns).toBe(1);
      expect(all[all.length - 1].resultColumns).toBe(4);
      expect(new Set(all.map((l) => l.resultColumns)).size).toBe(4);
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
});
