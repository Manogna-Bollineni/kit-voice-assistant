// Shared DOM and API helpers. All user text is set with textContent (never innerHTML).

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) node.setAttribute(k, v);
  for (const c of children) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return node;
}

export async function api(path, options = {}) {
  const res = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) } });
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* empty or non-JSON body */
  }
  if (!res.ok) throw Object.assign(new Error(data.error ?? `Request failed (${res.status})`), { status: res.status });
  return data;
}

export async function currentUser() {
  try {
    return (await api('/api/me')).user;
  } catch {
    return null;
  }
}

/** Renders the header (logo + nav) into [data-header] and returns the logged-in user, if any. */
export async function renderNav() {
  const user = await currentUser();
  const bar = document.querySelector('[data-header]');
  if (!bar) return user;
  const brand = el('a', { class: 'brand', href: '/' }, el('span', { class: 'logo' }, 'KIT'), el('span', {}, el('strong', {}, 'Knotopian Institute'), el('span', {}, 'of Technology')));
  const links = [el('a', { href: '/' }, 'Home')];
  if (user) {
    links.push(el('a', { href: '/assistant' }, 'Assistant'), el('a', { href: '/history' }, 'History'));
    const out = el('button', { type: 'button' }, 'Log out');
    out.addEventListener('click', async () => {
      await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
      window.location.href = '/';
    });
    links.push(out);
  } else {
    links.push(el('a', { href: '/history' }, 'History'), el('a', { href: '/login' }, 'Login'));
  }
  const here = window.location.pathname.replace(/\/$/, '') || '/';
  for (const a of links) if (a.getAttribute('href') === here) a.setAttribute('aria-current', 'page');
  bar.replaceChildren(brand, el('nav', { 'aria-label': 'Main' }, ...links, themeToggle()));
  return user;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const SUN = ['M12 4V2', 'M12 22v-2', 'M4.93 4.93 6.34 6.34', 'M17.66 17.66l1.41 1.41', 'M2 12h2', 'M20 12h2', 'M4.93 19.07l1.41-1.41', 'M17.66 6.34l1.41-1.41', 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z'];
const MOON = ['M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z'];

function icon(paths) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
  for (const d of paths) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}

/** Light/dark switch; window.kitTheme comes from services/theme.js (loaded in <head>). */
function themeToggle() {
  const button = el('button', { type: 'button', class: 'theme-toggle' });
  const render = () => {
    const dark = window.kitTheme?.current() === 'dark';
    button.replaceChildren(icon(dark ? SUN : MOON));
    button.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
    button.title = dark ? 'Light theme' : 'Dark theme';
  };
  button.addEventListener('click', () => {
    window.kitTheme?.toggle();
    render();
  });
  render();
  return button;
}

export function rupees(n) {
  return typeof n === 'number' ? `₹${n.toLocaleString('en-IN')}` : '—';
}
