// The AI assistant. Runs on the server so the Anthropic API key never reaches the browser.
const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const STATUSES = ['pending','started','ongoing','completed'];
const hits = new Map(); // best-effort per-instance rate limit

const allowedEmails = () => (process.env.ALLOWED_EMAIL || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

async function getUser(token) {
  const r = await fetch(process.env.SUPABASE_URL + '/auth/v1/user', {
    headers: { Authorization: 'Bearer ' + token, apikey: process.env.SUPABASE_ANON_KEY },
  });
  return r.ok ? r.json() : null;
}

// Reads the tasks with the user's own token, so the database's security rules apply.
async function getTasks(token) {
  const since = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
  const q = `/rest/v1/tasks?select=id,title,due_date,due_time,alarm,status&or=(status.neq.completed,due_date.gte.${since})&order=due_date.asc&limit=250`;
  const r = await fetch(process.env.SUPABASE_URL + q, {
    headers: { Authorization: 'Bearer ' + token, apikey: process.env.SUPABASE_ANON_KEY },
  });
  if (!r.ok) return [];
  return (await r.json()).map(t => ({ id: t.id, title: t.title, date: t.due_date, time: t.due_time || null, alarm: t.alarm, status: t.status }));
}

function rules(tasks, now, selected) {
  return `You are the assistant inside a personal planner app. The person talks to you casually, often by voice, so messages may be rambling or have filler words. Turn what they say into changes to their task list, or answer questions about it.

Right now: ${now.dow} ${now.date}, ${now.time} local time. The day they are looking at in the calendar: ${selected}.
Statuses, in order: pending, started, ongoing, completed. Each task is one card on their board.

Their current tasks (JSON):
${JSON.stringify(tasks)}

Reply with ONLY one JSON object in this shape:
{"reply":"one or two short, friendly sentences confirming what you did or answering the question","actions":[ ... ]}
Each action is one of:
{"op":"add","title":"short clear task title","date":"YYYY-MM-DD","time":"HH:MM" or null,"alarm":true|false,"status":"pending"}
{"op":"update","id":"existing id","title"?:...,"date"?:...,"time"?:"HH:MM" or null,"alarm"?:...,"status"?:...}
{"op":"delete","id":"existing id"}
Rules: split several things into several actions. Clean up titles (no filler words, no dates or times inside the title). If no day is mentioned for a new task use ${selected}. If a time is given, set alarm true unless they say no reminder. "Done/finished" means status completed; "working on it" means ongoing; "began/kicked off" means started. Match existing tasks by meaning when they refer to one. Never invent tasks they did not mention. If they are only asking a question, return an empty actions array. If something is unclear, make the most sensible choice and say so in the reply.`;
}

const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });
  for (const k of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'ANTHROPIC_API_KEY', 'ALLOWED_EMAIL'])
    if (!process.env[k]) return res.status(500).json({ error: 'Server is missing ' + k });

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Sign in first' });
  const user = await getUser(token).catch(() => null);
  if (!user) return res.status(401).json({ error: 'Your session expired. Sign in again.' });
  if (!allowedEmails().includes((user.email || '').toLowerCase())) return res.status(403).json({ error: 'This account is not allowed' });

  const now = Date.now(), recent = (hits.get(user.id) || []).filter(t => now - t < 60000);
  if (recent.length >= 20) return res.status(429).json({ error: 'Too many requests. Wait a minute.' });
  recent.push(now); hits.set(user.id, recent);

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); }
  catch { return res.status(400).json({ error: 'Bad request' }); }
  const message = String(body.message || '').slice(0, 2000).trim();
  if (!message) return res.status(400).json({ error: 'Empty message' });
  const selected = isDate(body.selected) ? body.selected : new Date().toISOString().slice(0, 10);
  const n = body.now || {};
  const nowInfo = { date: isDate(n.date) ? n.date : selected, time: /^\d{2}:\d{2}$/.test(n.time || '') ? n.time : '', dow: DOW.includes(n.dow) ? n.dow : '' };

  const turns = (Array.isArray(body.turns) ? body.turns : []).slice(-8)
    .filter(t => t && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string')
    .map(t => ({ role: t.role, content: t.content.slice(0, 4000) }));
  while (turns.length && turns[0].role !== 'user') turns.shift();
  if (turns.length && turns[turns.length - 1].role === 'user') turns.pop();
  const messages = [...turns, { role: 'user', content: message }];

  const tasks = await getTasks(token);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        system: rules(tasks, nowInfo, selected),
        messages,
      }),
    });
    if (!r.ok) {
      console.error('Anthropic error', r.status, await r.text());
      return res.status(502).json({ error: r.status === 429 ? 'The AI is busy. Try again in a moment.' : 'The AI request failed.' });
    }
    const data = await r.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    const actions = (Array.isArray(json.actions) ? json.actions : []).slice(0, 30).filter(a => a &&
      ((a.op === 'add' && typeof a.title === 'string') ||
       ((a.op === 'update' || a.op === 'delete') && typeof a.id === 'string')));
    const reply = String(json.reply || 'Done.').slice(0, 600);
    return res.status(200).json({ reply, actions, raw: JSON.stringify({ reply, actions }) });
  } catch (e) {
    console.error(e);
    return res.status(502).json({ error: 'I couldn’t work that out. Try saying it differently.' });
  }
}
