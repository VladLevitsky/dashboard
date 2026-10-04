// Built-in writing templates for the FULL editors (no DOM, Node-testable). The HTML is canonical
// (Reference/writing/SPEC.md section 3): compact (no whitespace between tags, the note viewer is
// pre-wrap), <div> lines, h2/h3 headings, lists with empty <li><br></li> lines to fill in, callouts,
// tables with a header row and <br> in empty cells. Every template ends on an empty line so the
// caret can leave the last block. Variables: {{date}}, {{time}}, {{title}}.

// editors: where the template is offered ('projects' | 'meetings' | 'task' | 'subtask' | 'ideas').
// icon: a short generic icon name for the template menu.

const H2 = (text) => `<h2>${text}</h2>`;
const H3 = (text) => `<h3>${text}</h3>`;
const LINE = '<div><br></div>';
const BULLETS = '<ul><li><br></li></ul>';
const NUMBERED = '<ol><li><br></li></ol>';
const CHECKLIST = '<ul class="checklist"><li><br></li></ul>';
const callout = (kind) => `<div class="wr-callout" data-kind="${kind}">${LINE}</div>`;
const table = (headers, rows = 2) => {
  const head = `<tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr>`;
  const empty = `<tr>${headers.map(() => '<td><br></td>').join('')}</tr>`;
  return `<table class="wr-table"><tbody>${head}${empty.repeat(rows)}</tbody></table>`;
};

export const WRITING_TEMPLATES = [
  {
    id: 'meeting-notes',
    name: 'Meeting notes',
    description: 'Attendees, agenda, notes, decisions and action items',
    icon: 'meeting',
    editors: ['meetings', 'projects'],
    html: `<div>{{date}} · {{time}}</div>${H2('Attendees')}${LINE}${H2('Agenda')}${BULLETS}${H2('Notes')}${LINE}`
      + `${H2('Decisions')}${callout('decision')}${H2('Action items')}${CHECKLIST}${LINE}`,
  },
  {
    id: 'one-on-one',
    name: '1:1 check-in',
    description: 'Wins, blockers, topics and follow-ups',
    icon: 'people',
    editors: ['meetings'],
    html: `<div>{{date}}</div>${H2('Wins')}${BULLETS}${H2('Blockers')}${BULLETS}${H2('Topics')}${BULLETS}`
      + `${H2('Follow-ups')}${CHECKLIST}${LINE}`,
  },
  {
    id: 'project-brief',
    name: 'Project brief',
    description: 'Goal, context, scope, milestones, risks and next steps',
    icon: 'brief',
    editors: ['projects', 'ideas', 'task'],
    html: `<div>Created {{date}}</div>${H2('Goal')}${LINE}${H2('Context')}${LINE}`
      + `${H2('Scope')}${H3('In scope')}${BULLETS}${H3('Out of scope')}${BULLETS}`
      + `${H2('Milestones')}${table(['Milestone', 'Owner', 'Date'])}`
      + `${H2('Risks')}${callout('warning')}${H2('Next steps')}${CHECKLIST}${LINE}`,
  },
  {
    id: 'decision-record',
    name: 'Decision record',
    description: 'Context, options with pros and cons, the decision and its consequences',
    icon: 'decision',
    editors: ['projects', 'meetings', 'task', 'ideas'],
    html: `<div><b>Status:</b> Proposed · {{date}}</div>${H2('Context')}${LINE}`
      + `${H2('Options')}${table(['Option', 'Pros', 'Cons'])}`
      + `${H2('Decision')}${callout('decision')}${H2('Consequences')}${BULLETS}${LINE}`,
  },
  {
    id: 'weekly-review',
    name: 'Weekly review',
    description: 'Wins, challenges, lessons and next week priorities',
    icon: 'calendar',
    editors: ['projects', 'meetings', 'ideas'],
    html: `<div>Week of {{date}}</div>${H2('Wins')}${BULLETS}${H2('Challenges')}${BULLETS}${H2('Lessons')}${BULLETS}`
      + `${H2('Next week priorities')}${CHECKLIST}${LINE}`,
  },
  {
    id: 'retrospective',
    name: 'Retrospective',
    description: 'What went well, what to improve and action items',
    icon: 'retro',
    editors: ['meetings', 'projects'],
    html: `<div>{{date}}</div>${H2('Went well')}${BULLETS}${H2('To improve')}${BULLETS}`
      + `${H2('Action items')}${CHECKLIST}${LINE}`,
  },
  {
    id: 'task-brief',
    name: 'Task brief',
    description: 'Goal, steps, when it is done and notes',
    icon: 'target',
    editors: ['task', 'subtask', 'projects'],
    html: `${H2('Goal')}${LINE}${H2('Steps')}${CHECKLIST}${H2('Done when')}${BULLETS}${H2('Notes')}${LINE}`,
  },
  {
    id: 'standup',
    name: 'Daily standup',
    description: 'Yesterday, today and blockers',
    icon: 'standup',
    editors: ['meetings'],
    html: `<div>{{date}}</div>${H3('Yesterday')}${BULLETS}${H3('Today')}${BULLETS}${H3('Blockers')}${BULLETS}${LINE}`,
  },
  {
    id: 'content-brief',
    name: 'Content brief',
    description: 'Goal, audience, key message, channels, outline and call to action',
    icon: 'content',
    editors: ['projects', 'task', 'ideas'],
    html: `${H2('Goal')}${LINE}${H2('Audience')}${LINE}${H2('Key message')}${callout('note')}`
      + `${H2('Format and channels')}${BULLETS}${H2('Outline')}${NUMBERED}${H2('Call to action')}${LINE}`
      + `${H2('Details')}${table(['Owner', 'Due', 'Status'], 1)}${LINE}`,
  },
  {
    id: 'campaign-plan',
    name: 'Campaign plan',
    description: 'Objective, audience, channels, budget, KPIs and a launch checklist',
    icon: 'campaign',
    editors: ['projects'],
    html: `<div>Created {{date}}</div>${H2('Objective')}${LINE}${H2('Audience')}${LINE}`
      + `${H2('Channels')}${table(['Channel', 'Asset', 'Owner', 'Date'])}${H2('Budget')}${LINE}`
      + `${H2('KPIs')}${table(['Metric', 'Target', 'Actual'])}${H2('Launch checklist')}${CHECKLIST}${LINE}`,
  },
  {
    id: 'brainstorm',
    name: 'Brainstorm',
    description: 'The problem, every idea, the best bets and next steps',
    icon: 'idea',
    editors: ['ideas', 'projects', 'meetings'],
    html: `${H2('Problem')}${LINE}${H2('Ideas')}${BULLETS}${H2('Best bets')}${callout('tip')}`
      + `${H2('Next steps')}${CHECKLIST}${LINE}`,
  },
  {
    id: 'issue-report',
    name: 'Issue report',
    description: 'Summary, steps to reproduce, expected and actual result',
    icon: 'bug',
    editors: ['task', 'subtask'],
    html: `${H2('Summary')}${LINE}${H2('Steps to reproduce')}${NUMBERED}${H2('Expected')}${LINE}`
      + `${H2('Actual')}${LINE}${H2('Notes')}${LINE}`,
  },
];

const escapeHtml = (value) => String(value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Template (or template id) → HTML with every {{name}} replaced by the HTML-escaped vars[name].
// Unknown or missing variables become ''. Unknown template id → ''.
export function renderTemplate(template, vars = {}) {
  const t = typeof template === 'string' ? WRITING_TEMPLATES.find(x => x.id === template) : template;
  if (!t || typeof t.html !== 'string') return '';
  const values = vars || {};
  return t.html.replace(/\{\{\s*([A-Za-z][\w]*)\s*\}\}/g, (_, name) => {
    const v = Object.prototype.hasOwnProperty.call(values, name) ? values[name] : null;
    return v == null ? '' : escapeHtml(v);
  });
}

// The variables for a template inserted now: date "Sat, Oct 3, 2026", time "14:05" (local).
export function templateVars({ now = new Date(), title = '' } = {}) {
  const date = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return { date, time, title: title || '' };
}

// The templates offered in one editor ('projects', 'meetings', 'task', 'subtask', 'ideas').
export function templatesFor(editorId) {
  return WRITING_TEMPLATES.filter(t => t.editors.includes(editorId));
}
