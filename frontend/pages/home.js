import { api, el, currentUser, rupees } from '../services/api.js';
import { mountPublic } from '../services/layout.js';
import { mountAssistant } from '../components/voiceAssistant.js';
import { icon } from '../components/icons.js';

const DEPT_ICON = { CSE: 'cpu', ECE: 'radio', MECH: 'gear' };

const user = await currentUser();
const main = mountPublic(user, 'home');

// Landing: hero (text + campus art fading in) and a bottom strip with courses and "Talk to KIT".
const tagline = el('p', { class: 'tagline' }, 'Excellence in Engineering and Applied Technology');
const intro = el('p', { class: 'lead' }, 'An autonomous engineering institution in Coimbatore, Tamil Nadu.');
const courseRow = el('div', { class: 'course-row' }, el('p', { class: 'muted' }, 'Loading programmes…'));
const talkCard = el(
  'button',
  { type: 'button', class: 'talk-card', 'data-talk': '' },
  el('span', { class: 'talk-icon' }, icon('mic', 28)),
  el('span', { class: 'talk-text' }, el('strong', {}, 'Talk to KIT'), el('span', {}, 'Ask about admissions, courses and more!')),
  el('span', { class: 'talk-go' }, icon('arrow', 18)),
);

main.classList.add('home');
main.append(
  el(
    'section',
    { class: 'landing' },
    el(
      'div',
      { class: 'landing-hero' },
      el(
        'div',
        { class: 'landing-text' },
        el('h1', {}, 'Welcome to ', el('br'), 'Knotopian Institute', el('br'), 'of Technology'),
        tagline,
        intro,
        el('a', { class: 'btn btn-lg', href: '#courses' }, 'Explore courses', icon('arrow', 18)),
      ),
      el('div', { class: 'landing-art', 'aria-hidden': 'true' }, el('img', { src: '/images/campus.svg', alt: '' })),
    ),
    el('div', { class: 'landing-strip' }, el('div', { class: 'courses-box', id: 'courses' }, el('h2', {}, 'Our courses'), courseRow), talkCard),
  ),
);

// Assistant lives in a slide-in panel so the first screen stays clean.
const panelBody = el('div', { class: 'drawer-body' });
const closeBtn = el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close assistant' }, icon('close', 18));
const drawer = el(
  'aside',
  { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'drawer-title', hidden: '' },
  el('div', { class: 'drawer-head' }, el('div', {}, el('h2', { id: 'drawer-title' }, 'Talk to KIT'), el('p', { class: 'muted' }, 'Admissions assistant · speak or type, no login needed')), closeBtn),
  panelBody,
);
const backdrop = el('div', { class: 'drawer-backdrop', hidden: '' });
document.body.append(backdrop, drawer);

let assistant = null;
let opener = null;
function openDrawer(trigger) {
  opener = trigger ?? document.activeElement;
  if (!assistant) {
    assistant = mountAssistant(panelBody, {
      mode: 'public',
      greeting: 'Hi! I can answer admission questions and help you apply. What would you like to know?',
      suggestions: ['Which courses do you offer?', 'What is the fee for CSE?', 'What documents do I need?', 'I want to apply'],
    });
  }
  drawer.hidden = backdrop.hidden = false;
  requestAnimationFrame(() => document.body.classList.add('drawer-open'));
  if (location.hash !== '#talk') history.replaceState(null, '', '#talk');
  closeBtn.focus();
}
function closeDrawer() {
  document.body.classList.remove('drawer-open');
  window.speechSynthesis?.cancel();
  setTimeout(() => (drawer.hidden = backdrop.hidden = true), 250);
  if (location.hash === '#talk') history.replaceState(null, '', location.pathname);
  opener?.focus?.();
}

document.addEventListener('click', (e) => {
  const trigger = e.target.closest('[data-talk], a[href="/#talk"], a[href="#talk"]');
  if (trigger) {
    e.preventDefault();
    openDrawer(trigger);
  }
});
closeBtn.addEventListener('click', closeDrawer);
backdrop.addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => e.key === 'Escape' && !drawer.hidden && closeDrawer());
if (location.hash === '#talk') openDrawer();
window.addEventListener('hashchange', () => location.hash === '#talk' && drawer.hidden && openDrawer());

try {
  const { college, courses } = await api('/api/public/home');
  if (college?.tagline) tagline.textContent = college.tagline;
  if (college?.description) intro.textContent = college.description;
  courseRow.replaceChildren(
    ...(courses ?? []).map((k) =>
      el(
        'div',
        { class: 'course-item', title: `${k.name} · min. 12th ${k.min_12th_percent}% · ${rupees(k.annual_fee)}/yr · ${k.seats} seats` },
        el('span', { class: 'course-ico' }, icon(DEPT_ICON[k.department] ?? 'school', 26)),
        el('strong', {}, k.name.replace(/^B\.Tech\s+/, '')),
        el('small', {}, `Min. ${k.min_12th_percent}% · ${rupees(k.annual_fee)}/yr`),
      ),
    ),
  );
} catch (err) {
  courseRow.replaceChildren(el('p', { class: 'error' }, `Could not load programmes: ${err.message}`));
}
