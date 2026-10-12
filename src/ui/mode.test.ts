import { describe, expect, it } from 'vitest';
import { BUILD_HISTORY_STATE, MODES, buildShowsViewer, isBuildEntry, parseMode } from './mode';

describe('parseMode', () => {
  it('accepts the three modes', () => {
    for (const m of MODES) expect(parseMode(m)).toBe(m);
  });
  it('falls back to Simple for anything else', () => {
    expect(parseMode(null)).toBe('simple');
    expect(parseMode(undefined)).toBe('simple');
    expect(parseMode('')).toBe('simple');
    expect(parseMode('Build')).toBe('simple');
    expect(parseMode('builder')).toBe('simple');
    expect(parseMode('__proto__')).toBe('simple');
  });
});

describe('buildShowsViewer', () => {
  it('shows the viewer only for the assembly step-through', () => {
    expect(buildShowsViewer('assembly')).toBe(true);
    for (const s of ['verify', 'cutlist', 'nesting', 'bom', 'shaper', 'forms', 'finishing', 'downloads']) expect(buildShowsViewer(s)).toBe(false);
  });
});

describe('isBuildEntry', () => {
  it('recognizes the history state Build pushes', () => {
    expect(isBuildEntry(BUILD_HISTORY_STATE)).toBe(true);
    expect(isBuildEntry(null)).toBe(false);
    expect(isBuildEntry({})).toBe(false);
    expect(isBuildEntry('build')).toBe(false);
  });
});
