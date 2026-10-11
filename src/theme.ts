/**
 * Light / dark theme. html[data-theme] is always 'light' or 'dark'; the preference ('auto' | 'light' | 'dark') is
 * remembered per viewer in localStorage, and 'auto' follows the OS setting live. index.html applies it before
 * first paint; this module owns the top-bar toggle.
 */
type Pref = 'auto' | 'light' | 'dark';
const KEY = 'klondike-theme';
const ORDER: Pref[] = ['auto', 'light', 'dark'];
const ICON: Record<Pref, string> = { auto: '◐', light: '☀', dark: '☾' };
const NAME: Record<Pref, string> = { auto: 'Auto', light: 'Light', dark: 'Dark' };
const WHAT: Record<Pref, string> = { auto: 'follows your device setting', light: 'light colors', dark: 'dark colors' };

const media = window.matchMedia('(prefers-color-scheme: dark)');

function readPref(): Pref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

function apply(pref: Pref): void {
  const dark = pref === 'dark' || (pref === 'auto' && media.matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
}

export function mountThemeToggle(btn: HTMLButtonElement): void {
  let pref = readPref();
  const show = () => {
    const next = ORDER[(ORDER.indexOf(pref) + 1) % ORDER.length];
    // The icon plus a word, so the state is readable; the label says what the next press does.
    btn.textContent = `${ICON[pref]} ${NAME[pref]}`;
    btn.title = `Theme: ${NAME[pref]} (${WHAT[pref]}). Press to switch to ${NAME[next]}.`;
    btn.setAttribute('aria-label', `Theme: ${NAME[pref]}. Switch to ${NAME[next]}.`);
  };
  apply(pref);
  show();
  btn.addEventListener('click', () => {
    pref = ORDER[(ORDER.indexOf(pref) + 1) % ORDER.length];
    try {
      localStorage.setItem(KEY, pref);
    } catch {
      /* private mode: the choice just isn't remembered */
    }
    apply(pref);
    show();
  });
  media.addEventListener('change', () => {
    if (pref === 'auto') apply(pref);
  });
}
