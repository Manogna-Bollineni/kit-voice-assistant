import { renderNav } from '../services/api.js';
import { mountAssistant } from '../components/voiceAssistant.js';

const SUGGESTIONS = {
  student: ['What is my attendance?', 'Can I take leave tomorrow?', 'Apply on-duty for a hackathon', 'Which placement drives can I join?', 'Explain normalization in DBMS'],
  teacher: ['Any pending requests?', 'Show my classes', 'Who is below 75% attendance?'],
};

const user = await renderNav();
if (!user) {
  window.location.href = '/login';
} else {
  document.getElementById('welcome').textContent = `Hello, ${user.full_name}`;
  document.getElementById('role').textContent = user.role === 'teacher' ? 'Teacher' : 'Student';
  document.getElementById('who').textContent =
    user.role === 'student'
      ? `${user.department ?? ''} · Class ${user.class_code ?? ''} · Year ${user.year_of_study ?? ''}`
      : `${user.department ?? ''} department`;
  const root = document.getElementById('assistant');
  root.replaceChildren();
  mountAssistant(root, {
    mode: 'member',
    title: 'KIT Assistant',
    greeting:
      user.role === 'teacher'
        ? 'Hello! I can review and decide leave and on-duty requests, and check class attendance. What do you need?'
        : 'Hi! Ask me about your attendance, timetable, leave or on-duty, placements, college rules or a subject doubt.',
    suggestions: SUGGESTIONS[user.role] ?? [],
  });
}
