import { api, el, renderNav, rupees } from '../services/api.js';
import { mountAssistant } from '../components/voiceAssistant.js';

renderNav();

mountAssistant(document.getElementById('assistant'), {
  mode: 'public',
  title: 'Admissions assistant',
  greeting: 'Hi! I can answer admission questions and help you apply. What would you like to know?',
  suggestions: ['Which courses do you offer?', 'What is the fee for CSE?', 'What documents do I need?', 'I want to apply'],
});

function courseCard(c) {
  const fact = (label, value) => [el('dt', {}, label), el('dd', {}, value)];
  return el(
    'article',
    { class: 'course' },
    el('span', { class: 'code' }, c.code),
    el('h3', {}, c.name),
    el('dl', { class: 'facts' }, ...fact('Min. 12th (PCM)', `${c.min_12th_percent}%`), ...fact('Seats', String(c.seats)), ...fact('Tuition / year', rupees(c.annual_fee)), ...fact('Hostel / year', rupees(c.hostel_fee))),
  );
}

(async () => {
  const grid = document.getElementById('courses');
  try {
    const { college, courses } = await api('/api/public/home');
    if (college?.name) document.getElementById('college-name').textContent = college.name;
    if (college?.description) document.getElementById('intro').textContent = college.description;
    const c = college?.contact;
    if (c) document.getElementById('contact').textContent = `Admissions office: ${c.phone} · ${c.email} · ${c.address}`;
    grid.replaceChildren(...(courses ?? []).map(courseCard));
  } catch (err) {
    grid.replaceChildren(el('p', { class: 'error' }, `Could not load programmes: ${err.message}`));
  }
})();
