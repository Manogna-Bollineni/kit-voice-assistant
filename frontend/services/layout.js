// Page chrome: public header for visitors, sidebar app shell for logged-in students and teachers.
import { api, el, initials } from './api.js';
import { icon } from '../components/icons.js';

export const TAGLINE = 'Innovate. Learn. Excel.';

/** KIT brand: leaf mark + wordmark + full name. `light` uses the white mark for dark backgrounds. */
export function logo({ light = false, href = '/' } = {}) {
  return el(
    'a',
    { class: `brand${light ? ' brand-light' : ''}`, href },
    el('img', { class: 'mark', src: '/images/logo-mark.svg', alt: '' }),
    el('span', { class: 'wordmark' }, 'KIT'),
    el('span', { class: 'brand-text' }, el('strong', {}, 'Knotopian Institute'), el('span', {}, 'of Technology')),
  );
}

export function themeToggle() {
  const button = el('button', { type: 'button', class: 'icon-btn' });
  const render = () => {
    const dark = window.kitTheme?.current() === 'dark';
    button.replaceChildren(icon(dark ? 'sun' : 'moon', 18));
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

async function logout() {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  location.href = '/';
}

/** Visitor layout: top header + content container. Returns the <main> element. */
export function mountPublic(user, active = '') {
  const nav = el(
    'nav',
    { class: 'top-nav', 'aria-label': 'Main' },
    el('a', { href: '/#courses' }, 'Courses'),
    el('a', { href: '/#talk' }, 'Admissions'),
    el('a', { href: '#about' }, 'About'),
    user ? el('a', { href: '/assistant' }, 'My portal') : el('a', { href: '/login', 'aria-current': active === 'login' ? 'page' : null }, 'Login'),
    themeToggle(),
    el('a', { class: 'btn btn-sm', href: '/#talk', 'data-talk': '' }, 'Talk to KIT'),
  );
  const main = el('main', { class: 'page' });
  document.getElementById('app').replaceChildren(el('header', { class: 'site-header' }, el('div', { class: 'bar' }, logo(), nav)), main, siteFooter(user));
  return main;
}

/** Footer with live admissions contact details from the college system. */
function siteFooter(user) {
  const contact = el('ul', { class: 'foot-list' }, el('li', { class: 'muted' }, 'Loading contact details…'));
  const tagline = el('p', { class: 'foot-tagline' }, TAGLINE);
  const link = (href, text) => el('li', {}, el('a', { href }, text));
  const footer = el(
    'footer',
    { class: 'site-footer', id: 'about' },
    el(
      'div',
      { class: 'foot-grid' },
      el('div', { class: 'foot-brand' }, logo({ light: true }), tagline),
      el('div', {}, el('h3', {}, 'Admissions office'), contact),
      el('div', {}, el('h3', {}, 'Quick links'), el('ul', { class: 'foot-list' }, link('/#courses', 'Programmes'), link('/#talk', 'Talk to KIT'), link(user ? '/assistant' : '/login', user ? 'My portal' : 'Student / teacher login'), link('/history', 'Conversation history'))),
    ),
    el('div', { class: 'foot-bottom' }, el('span', {}, `© ${new Date().getFullYear()} Knotopian Institute of Technology`), el('span', {}, 'Office hours: Monday to Saturday, 9:00 AM – 5:00 PM')),
  );

  api('/api/public/home')
    .then(({ college }) => {
      const c = college?.contact;
      if (!c) throw new Error('no contact');
      const item = (iconName, child) => el('li', { class: 'foot-contact' }, icon(iconName, 16), child);
      contact.replaceChildren(
        item('phone', el('a', { href: `tel:${c.phone.replace(/\s+/g, '')}` }, c.phone)),
        item('mail', el('a', { href: `mailto:${c.email}` }, c.email)),
        item('mapPin', el('span', {}, c.address)),
        item('globe', el('span', {}, c.website.replace(/^https?:\/\//, ''))),
      );
    })
    .catch(() => contact.replaceChildren(el('li', { class: 'muted' }, 'Contact details are unavailable right now.')));
  return footer;
}

/** Bell with a small popover. `notices` is a list of { icon, title, detail, href }. */
function notificationsBell(notices = []) {
  const button = el('button', { type: 'button', class: 'icon-btn bell', 'aria-label': `Notifications (${notices.length})`, 'aria-expanded': 'false', 'aria-haspopup': 'true' }, icon('bell', 18), notices.length ? el('span', { class: 'bell-dot' }) : null);
  const list = el(
    'div',
    { class: 'popover', hidden: '' },
    el('strong', { class: 'popover-title' }, 'Notifications'),
    ...(notices.length
      ? notices.map((n) => el('a', { class: 'notice', href: n.href ?? '#' }, el('span', { class: 'notice-icon' }, icon(n.icon, 16)), el('span', {}, el('strong', {}, n.title), el('small', {}, n.detail))))
      : [el('p', { class: 'muted' }, 'You are all caught up.')]),
  );
  const wrap = el('div', { class: 'bell-wrap' }, button, list);
  const close = () => {
    list.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  };
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    list.hidden = !list.hidden;
    button.setAttribute('aria-expanded', String(!list.hidden));
  });
  document.addEventListener('click', (e) => !wrap.contains(e.target) && close());
  document.addEventListener('keydown', (e) => e.key === 'Escape' && close());
  return wrap;
}

/** Logged-in layout: sidebar + top bar. `actions` are sidebar shortcuts that ask the assistant. Returns the content element. */
export function mountShell(user, { active = 'home', badge = 0, notices = [] } = {}) {
  const item = (key, label, iconName, href, count) =>
    el('a', { class: 'side-link', href, 'aria-current': active === key ? 'page' : null }, icon(iconName, 18), el('span', {}, label), count ? el('span', { class: 'count' }, String(count)) : null);
  const ask = (text) => `/assistant?ask=${encodeURIComponent(text)}`;

  const links =
    user.role === 'teacher'
      ? [
          item('home', 'Home', 'home', '/assistant'),
          item('approvals', 'Pending approvals', 'users', '/assistant#approvals', badge),
          item('classes', 'Class attendance', 'chart', ask('Show attendance for my class')),
          item('history', 'History', 'history', '/history'),
          item('profile', 'Profile', 'user', ask('Show my profile details')),
        ]
      : [
          item('home', 'Home', 'home', '/assistant'),
          item('history', 'History', 'history', '/history'),
          item('leave', 'Leave request', 'leave', ask('I want to apply for leave')),
          item('od', 'On-duty request', 'flag', ask('I want to apply for on-duty')),
          item('placements', 'Placements', 'briefcase', ask('Which placement drives can I join?')),
          item('timetable', 'Timetable', 'clock', ask("What is today's timetable?")),
          item('profile', 'Profile', 'user', ask('Show my profile details')),
        ];

  const out = el('button', { type: 'button', class: 'side-link' }, icon('logout', 18), el('span', {}, 'Logout'));
  out.addEventListener('click', logout);

  const sidebar = el('aside', { class: 'sidebar' }, el('a', { class: 'side-brand', href: '/assistant' }, el('img', { class: 'mark', src: '/images/logo-mark.svg', alt: '' }), el('span', { class: 'wordmark' }, 'KIT')), el('nav', { class: 'side-nav', 'aria-label': 'Portal' }, ...links), el('div', { class: 'side-foot' }, out));

  const who =
    user.role === 'teacher' ? `Faculty · ${user.department ?? ''}` : `Student · ${[user.department, user.class_code].filter(Boolean).join(' · ')}`;
  const topbar = el(
    'header',
    { class: 'topbar' },
    el('a', { class: 'brand mobile-only', href: '/assistant' }, el('img', { class: 'mark', src: '/images/logo-mark.svg', alt: 'KIT' })),
    el('div', { class: 'topbar-right' }, themeToggle(), notificationsBell(notices), el('div', { class: 'user-chip' }, el('span', { class: 'avatar' }, initials(user.full_name)), el('span', {}, el('strong', {}, user.full_name), el('small', {}, who)))),
  );
  const content = el('main', { class: 'content' });
  document.getElementById('app').replaceChildren(el('div', { class: 'app' }, sidebar, el('div', { class: 'app-main' }, topbar, content)));
  return content;
}
