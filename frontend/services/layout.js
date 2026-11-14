// Page chrome: public header for visitors, sidebar app shell for logged-in students and teachers.
import { api, el, initials } from './api.js';
import { icon } from '../components/icons.js';

function logo() {
  return el('a', { class: 'brand', href: '/' }, el('span', { class: 'logo' }, 'KIT'), el('span', { class: 'brand-text' }, el('strong', {}, 'Knotopian Institute'), el('span', {}, 'of Technology')));
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
  const tagline = el('p', { class: 'foot-tagline' }, 'Excellence in Engineering and Applied Technology');
  const link = (href, text) => el('li', {}, el('a', { href }, text));
  const footer = el(
    'footer',
    { class: 'site-footer', id: 'about' },
    el(
      'div',
      { class: 'foot-grid' },
      el('div', { class: 'foot-brand' }, logo(), tagline),
      el('div', {}, el('h3', {}, 'Admissions office'), contact),
      el('div', {}, el('h3', {}, 'Quick links'), el('ul', { class: 'foot-list' }, link('/#courses', 'Programmes'), link('/#talk', 'Talk to KIT'), link(user ? '/assistant' : '/login', user ? 'My portal' : 'Student / teacher login'), link('/history', 'Conversation history'))),
    ),
    el('div', { class: 'foot-bottom' }, el('span', {}, `© ${new Date().getFullYear()} Knotopian Institute of Technology`), el('span', {}, 'Office hours: Monday to Saturday, 9:00 AM – 5:00 PM')),
  );

  api('/api/public/home')
    .then(({ college }) => {
      if (college?.tagline) tagline.textContent = college.tagline;
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

/** Logged-in layout: sidebar + top bar. `actions` are sidebar shortcuts that ask the assistant. Returns the content element. */
export function mountShell(user, { active = 'home', badge = 0 } = {}) {
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
        ]
      : [
          item('home', 'Home', 'home', '/assistant'),
          item('history', 'History', 'history', '/history'),
          item('leave', 'Leave request', 'leave', ask('I want to apply for leave')),
          item('od', 'On-duty request', 'flag', ask('I want to apply for on-duty')),
          item('placements', 'Placements', 'briefcase', ask('Which placement drives can I join?')),
          item('timetable', 'Timetable', 'clock', ask("What is today's timetable?")),
        ];

  const out = el('button', { type: 'button', class: 'side-link' }, icon('logout', 18), el('span', {}, 'Logout'));
  out.addEventListener('click', logout);

  const sidebar = el('aside', { class: 'sidebar' }, el('a', { class: 'side-brand', href: '/assistant' }, el('span', { class: 'logo' }, 'KIT'), el('span', {}, 'Knotopian')), el('nav', { class: 'side-nav', 'aria-label': 'Portal' }, ...links), el('div', { class: 'side-foot' }, out));

  const who =
    user.role === 'teacher' ? `Faculty · ${user.department ?? ''}` : `Student · ${[user.department, user.class_code].filter(Boolean).join(' · ')}`;
  const topbar = el(
    'header',
    { class: 'topbar' },
    el('a', { class: 'brand mobile-only', href: '/assistant' }, el('span', { class: 'logo' }, 'KIT')),
    el('div', { class: 'topbar-right' }, themeToggle(), el('div', { class: 'user-chip' }, el('span', { class: 'avatar' }, initials(user.full_name)), el('span', {}, el('strong', {}, user.full_name), el('small', {}, who)))),
  );
  const content = el('main', { class: 'content' });
  document.getElementById('app').replaceChildren(el('div', { class: 'app' }, sidebar, el('div', { class: 'app-main' }, topbar, content)));
  return content;
}
