/**
 * Top-level app modes (D-30): Simple | Advanced | Build. Pure, so the parsing and the layout rules run headless under vitest.
 * Only an explicit mode-button click persists the mode (see `setMode` in main.ts).
 */

export const MODES = ['simple', 'advanced', 'build'] as const;
export type Mode = (typeof MODES)[number];

export const MODE_KEY = 'klondike-view-mode';

/** A saved or typed value to a mode; anything unknown (null, garbage, an old value) opens in Simple. */
export function parseMode(raw: string | null | undefined): Mode {
  return (MODES as readonly string[]).includes(raw ?? '') ? (raw as Mode) : 'simple';
}

/**
 * Whether the 3D viewer is on screen in Build mode. Only the Assembly step-through needs it (it shows the sled as built up to the
 * current step). Every other section is tables and drawings, where a viewer would be a large empty or irrelevant pane, so it is hidden.
 */
export function buildShowsViewer(section: string): boolean {
  return section === 'assembly';
}

/** State kept on the browser history entry that Build mode pushes (so Back leaves Build instead of the app). */
export const BUILD_HISTORY_STATE = { klMode: 'build' } as const;

export function isBuildEntry(state: unknown): boolean {
  return typeof state === 'object' && state !== null && (state as { klMode?: unknown }).klMode === 'build';
}
