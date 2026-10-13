/**
 * Part chips for Build mode (Eric 2026-10-12: every mentioned part should be clickable "so that it can bring up just that piece in the model on the right").
 *
 * - `chip(id)`: an inline button with the part's name. Click, tap, Enter or Space opens its popover.
 * - The popover (one at a time, appended to `body` so a scrolling table cannot clip it): name and quantity, the finished T × W × L, the rough cuts, board and grain,
 *   the first few features, then "View drawing" and "Show in 3D". Wide screens anchor it under the chip; under 600 px it is a bottom sheet with a backdrop.
 *   Escape closes it and puts the focus back on the chip; Tab stays inside while it is open; a click outside closes it.
 * - `openDrawing(...)`: the part drawing large in a modal `<dialog>` (Download SVG, Show in 3D).
 * - `instrList(...)`: instruction items as a numbered list with nested bullets, tokens as chips, the parts an item names in plain words as small trailing chips.
 *
 * The data comes from the panel through `PartUiHost`, so this file knows nothing of `BuildData` and every slow lookup (`partDims`, the drawings) happens on demand.
 */
import type { Instr } from '../build/assembly';
import { h } from './dom';
import { instrSegments, type PartFacts } from './build-helpers';

/** What a drawing modal shows. */
export interface DrawingView {
  title: string;
  /** One muted line under the title (the make note, the scale). */
  sub?: string;
  /** Markup ready to inline (`previewSvg`). */
  markup: string;
  fileName: string;
  /** The original SVG for Download. */
  svg: string;
  /** A part to offer "Show in 3D" for. */
  partId?: string;
}

export interface PartUiHost {
  /** The label a part goes by in running text (`partLabel`), or undefined for an id the model does not have. */
  label(id: string): string | undefined;
  /** Whether the id is a part of this model (cheap: chips are made by the hundred). An unknown id gets a plain, disabled chip. */
  has(id: string): boolean;
  /** The card for a part (may compute `partDims`, so it runs when a popover opens, not when a chip is made). */
  facts(id: string): PartFacts | undefined;
  /** True when "View drawing" has something to open for the part (checked without drawing anything). */
  hasDrawing(id: string): boolean;
  /** The drawing for a part. May take seconds the first time, so the modal shows a note and calls this on the next tick. */
  drawing(id: string): DrawingView | undefined;
  show3d(id: string): void;
  download(name: string, svg: string): void;
}

export interface PartUi {
  /** A chip for part `id`; `text` overrides the label (a cut-list row's name). */
  chip(id: string, text?: string, cls?: string): HTMLButtonElement;
  /** Text with its `{{part-id}}` tokens as chips. */
  text(text: string): (string | Node)[];
  /** Items as a list: `ol` with nested `ul` (numbered at the top level only). */
  instrList(items: Instr[], cls?: string): HTMLElement;
  /** Part chips for ids, separated by spaces; more than `max` fold behind a "+N more" button. */
  chips(ids: string[], max?: number): HTMLElement;
  openDrawing(view: DrawingView | (() => DrawingView | undefined), opener: HTMLElement): void;
  /** Close the popover and the modal (the section or the design changed). */
  closeAll(): void;
}

const MAX_TRAILING = 5;
const PHONE = '(max-width: 599px)';

let uid = 0;

export function createPartUi(host: PartUiHost): PartUi {
  let pop: { el: HTMLElement; anchor: HTMLElement; backdrop?: HTMLElement; off: () => void } | null = null;
  let modal: HTMLDialogElement | null = null;

  function closePopover(restoreFocus = true): void {
    if (!pop) return;
    const { el, anchor, backdrop, off } = pop;
    pop = null;
    off();
    el.remove();
    backdrop?.remove();
    anchor.setAttribute('aria-expanded', 'false');
    anchor.removeAttribute('aria-controls');
    if (restoreFocus && anchor.isConnected) anchor.focus({ preventScroll: true });
  }

  function place(): void {
    if (!pop) return;
    const { el, anchor } = pop;
    if (!anchor.isConnected) { closePopover(false); return; }
    if (window.matchMedia(PHONE).matches) { el.style.left = el.style.top = el.style.maxHeight = ''; return; } // the CSS bottom sheet
    const r = anchor.getBoundingClientRect();
    const vw = document.documentElement.clientWidth, vh = window.innerHeight;
    const w = Math.min(340, vw - 16);
    el.style.width = `${w}px`;
    const left = Math.max(8, Math.min(r.left, vw - w - 8));
    const room = { below: vh - r.bottom - 14, above: r.top - 14 };
    const hgt = Math.min(el.scrollHeight, vh - 16);
    const below = room.below >= hgt || room.below >= room.above;
    const top = below ? r.bottom + 6 : Math.max(8, r.top - 6 - hgt);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.maxHeight = `${Math.max(160, below ? room.below : room.above)}px`;
  }

  function openPopover(id: string, anchor: HTMLElement): void {
    if (pop && pop.anchor === anchor) { closePopover(); return; }
    closePopover(false);
    const f = host.facts(id);
    if (!f) return;
    const titleId = `bp-pop-t-${++uid}`;
    const el = h('div', { class: 'bp-pop', role: 'dialog', 'aria-labelledby': titleId, tabindex: '-1', id: `bp-pop-${uid}` });
    const close = h('button', { type: 'button', class: 'bp-pop-x', 'aria-label': 'Close' }, '×');
    close.addEventListener('click', () => closePopover());
    el.append(h('div', { class: 'bp-pop-head' },
      h('div', {}, h('h3', { id: titleId }, f.name), h('div', { class: 'muted small' }, f.make)),
      close));
    const rows: (string | Node)[][] = [];
    if (f.size) rows.push(['Final size', h('span', {}, f.size, h('span', { class: 'muted' }, ' (T × W × L, in)'))]);
    if (f.cuts.length) rows.push(['Rough cut', h('ul', { class: 'bp-pop-list' }, ...f.cuts.map((c) => h('li', {}, c)))]);
    if (f.board) rows.push(['Board', f.board]);
    if (f.grain) rows.push(['Grain', f.grain]);
    if (rows.length) el.append(h('dl', { class: 'bp-facts bp-pop-facts' }, ...rows.flatMap(([k, v]) => [h('dt', {}, k as string), h('dd', {}, v)])));
    else el.append(h('p', { class: 'muted small' }, 'No cut-list entry: a bought part or a fitting.'));
    if (f.features.length) {
      el.append(h('div', { class: 'bp-pop-feat' }, h('strong', { class: 'small' }, 'Key features'),
        h('ul', { class: 'bp-pop-list small' }, ...f.features.map((x) => h('li', {}, x)),
          ...(f.moreFeatures ? [h('li', { class: 'muted' }, `+${f.moreFeatures} more on the drawing`)] : []))));
    }
    const actions = h('div', { class: 'bp-pop-actions' });
    if (host.hasDrawing(id)) {
      const b = h('button', { type: 'button' }, 'View drawing');
      b.addEventListener('click', () => { closePopover(false); openDrawing(() => host.drawing(id), anchor); });
      actions.append(b);
    }
    const s3 = h('button', { type: 'button', class: 'bp-primary' }, 'Show in 3D');
    s3.addEventListener('click', () => { closePopover(false); host.show3d(id); });
    actions.append(s3);
    el.append(actions);

    const phone = window.matchMedia(PHONE).matches;
    const backdrop = phone ? h('div', { class: 'bp-pop-backdrop' }) : undefined;
    if (backdrop) { backdrop.addEventListener('click', () => closePopover()); document.body.append(backdrop); }
    document.body.append(el);
    anchor.setAttribute('aria-expanded', 'true');
    anchor.setAttribute('aria-controls', el.id);

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePopover(); return; }
      if (e.key !== 'Tab') return;
      const items = [...el.querySelectorAll<HTMLElement>('button')];
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      const at = document.activeElement;
      if (e.shiftKey && (at === first || at === el)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
      else if (!el.contains(at)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
    };
    const onDown = (e: Event): void => {
      const t = e.target as Element | null;
      if (!t || el.contains(t) || t.closest('.bp-pchip')) return; // a chip's own click decides (same chip: toggle; another: replace)
      closePopover(false);
    };
    const onMove = (): void => place();
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    pop = { el, anchor, backdrop, off: () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    } };
    place();
    el.focus({ preventScroll: true });
  }

  function chip(id: string, text?: string, cls = ''): HTMLButtonElement {
    const known = host.has(id);
    const label = text ?? host.label(id) ?? id;
    const b = h('button', {
      type: 'button', class: `bp-pchip${cls ? ` ${cls}` : ''}`, 'data-part': id,
      title: known ? 'Size, cuts and a view in 3D' : '',
      ...(known ? { 'aria-haspopup': 'dialog', 'aria-expanded': 'false' } : {}),
    }, label);
    if (!known) { b.classList.add('is-plain'); b.disabled = true; return b; }
    b.addEventListener('click', () => openPopover(id, b));
    return b;
  }

  function text(t: string): (string | Node)[] {
    return instrSegments(t, host.label).map((s) => (typeof s === 'string' ? s : chip(s.part, s.label)));
  }

  function chips(ids: string[], max = MAX_TRAILING): HTMLElement {
    const wrap = h('span', { class: 'bp-pchips' });
    const fill = (all: boolean): void => {
      wrap.replaceChildren();
      const list = all ? ids : ids.slice(0, max);
      list.forEach((id, i) => { if (i) wrap.append(' '); wrap.append(chip(id)); });
      if (!all && ids.length > max) {
        const more = h('button', { type: 'button', class: 'bp-pchip bp-pchip-more', 'aria-label': `Show ${ids.length - max} more parts` }, `+${ids.length - max} more`);
        more.addEventListener('click', () => { fill(true); wrap.querySelector<HTMLElement>('.bp-pchip')?.focus(); });
        wrap.append(' ', more);
      }
    };
    fill(false);
    return wrap;
  }

  function instrItem(it: Instr, depth: number): HTMLElement {
    const inText = new Set((it.text.match(/\{\{([^{}\s]+)\}\}/g) ?? []).map((m) => m.slice(2, -2)));
    const extra = (it.parts ?? []).filter((id) => !inText.has(id));
    const li = h('li', {}, ...text(it.text));
    if (extra.length) li.append(' ', h('span', { class: 'bp-pchip-extra' }, chips(extra)));
    if (it.sub?.length) li.append(h('ul', { class: 'bp-sublist' }, ...it.sub.map((x) => instrItem(x, depth + 1))));
    return li;
  }

  function instrList(items: Instr[], cls = 'bp-instr'): HTMLElement {
    return h('ol', { class: cls }, ...items.map((it) => instrItem(it, 0)));
  }

  function closeModal(): void {
    if (!modal) return;
    const m = modal;
    modal = null;
    if (m.open) m.close();
    m.remove();
  }

  function openDrawing(view: DrawingView | (() => DrawingView | undefined), opener: HTMLElement): void {
    closePopover(false);
    closeModal();
    const dlg = h('dialog', { class: 'bp-modal', 'aria-labelledby': `bp-modal-t-${++uid}` });
    const title = h('h3', { id: `bp-modal-t-${uid}` });
    const sub = h('p', { class: 'muted small bp-modal-sub' });
    const body = h('div', { class: 'bp-modal-body' });
    const actions = h('div', { class: 'bp-modal-actions' });
    const x = h('button', { type: 'button', class: 'bp-pop-x', 'aria-label': 'Close' }, '×');
    x.addEventListener('click', () => dlg.close());
    dlg.append(h('div', { class: 'bp-modal-head' }, h('div', {}, title, sub), x), actions, body);
    const fill = (v: DrawingView | undefined): void => {
      if (!v) { title.textContent = 'No drawing'; body.replaceChildren(h('p', { class: 'muted' }, 'This part has no drawing.')); return; }
      title.textContent = v.title;
      sub.textContent = v.sub ?? '';
      const box = h('div', { class: 'bp-modal-svg' });
      box.innerHTML = v.markup;
      body.replaceChildren(box);
      const dl = h('button', { type: 'button', class: 'bp-primary' }, 'Download SVG');
      dl.addEventListener('click', () => host.download(v.fileName, v.svg));
      actions.replaceChildren(dl);
      if (v.partId && host.has(v.partId)) {
        const s3 = h('button', { type: 'button' }, 'Show in 3D');
        const id = v.partId;
        s3.addEventListener('click', () => { dlg.close(); host.show3d(id); });
        actions.append(s3);
      }
    };
    dlg.addEventListener('close', () => {
      if (modal === dlg) modal = null;
      dlg.remove();
      if (opener.isConnected) opener.focus({ preventScroll: true });
    });
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // the backdrop
    document.body.append(dlg);
    modal = dlg;
    if (typeof view === 'function') {
      title.textContent = 'Drawing the part…';
      body.replaceChildren(h('p', { class: 'muted', role: 'status' }, 'The first drawing takes a few seconds; the rest are ready after it.'));
      dlg.showModal();
      setTimeout(() => {
        if (modal !== dlg) return;
        try { fill(view()); } catch (err) {
          console.error(err);
          title.textContent = 'No drawing';
          body.replaceChildren(h('p', { class: 'fail', role: 'alert' }, `This could not be drawn: ${err instanceof Error ? err.message : String(err)}`));
        }
      }, 30);
    } else {
      fill(view);
      dlg.showModal();
    }
  }

  return { chip, text, instrList, chips, openDrawing, closeAll: () => { closePopover(false); closeModal(); } };
}
