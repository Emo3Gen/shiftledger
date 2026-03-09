const BASE = 'http://localhost:3000';
const CHAT = 'e2e_test_' + Date.now();
const TENANT = 'test_tenant';
const WEEK = '2026-02-23';

async function send(userId, text) {
  const res = await fetch(BASE + '/debug/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tenant_id: TENANT, chat_id: CHAT, user_id: userId, text, meta: { role: 'staff' } }),
  });
  const data = await res.json();
  if (!data.ok) console.error('SEND FAILED:', text, data.error);
  return data;
}

// Step 0: OPEN_WEEK
await send('admin1', 'OPEN_WEEK ' + WEEK);

// Иса (u1)
await send('u1', 'AVAIL ' + WEEK + ' mon 10-13');
await send('u1', 'AVAIL ' + WEEK + ' tue 10-13');
await send('u1', 'AVAIL ' + WEEK + ' thu 10-13');
await send('u1', 'AVAIL ' + WEEK + ' fri 10-13');
await send('u1', 'AVAIL ' + WEEK + ' sat 10-13');

// Дарина (u2)
await send('u2', 'AVAIL ' + WEEK + ' mon 18-21');
await send('u2', 'AVAIL ' + WEEK + ' tue 18-21');
await send('u2', 'AVAIL ' + WEEK + ' wed 10-13');
await send('u2', 'AVAIL ' + WEEK + ' thu 10-13');
await send('u2', 'AVAIL ' + WEEK + ' sat 10-13');
await send('u2', 'AVAIL ' + WEEK + ' sun 18-21');

// Ксюша (u3)
await send('u3', 'AVAIL ' + WEEK + ' wed 18-21');
await send('u3', 'AVAIL ' + WEEK + ' thu 18-21');
await send('u3', 'AVAIL ' + WEEK + ' fri 18-21');
await send('u3', 'AVAIL ' + WEEK + ' sun 10-13');

// Карина (u4)
await send('u4', 'AVAIL ' + WEEK + ' sat 18-21');
await send('u4', 'AVAIL ' + WEEK + ' fri 18-21');

// Build schedule
const buildRes = await fetch(BASE + '/debug/build-schedule', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ chat_id: CHAT, week_start: WEEK, user_id: 'admin1' }),
});
const buildData = await buildRes.json();
console.log('Schedule built:', buildData.schedule?.assignments?.length, 'assignments');

// Show hours per user before replacements
const hoursBefore = {};
for (const a of buildData.schedule?.assignments || []) {
  const [fh] = a.from.split(':').map(Number);
  const [th] = a.to.split(':').map(Number);
  hoursBefore[a.user_id] = (hoursBefore[a.user_id] || 0) + (th - fh);
}
console.log('Hours BEFORE replacements:', JSON.stringify(hoursBefore));

// Replacements
// Замена 1: Иса не может в чт утро → Ксюша
await send('u1', 'девочки, не могу в четверг утро, кто сможет?');
await send('u3', 'я смогу выйти в чт утро');

// Замена 2: Дарина не может в пн вечер → Карина
await send('u2', 'не смогу в понедельник вечер, подмените пожалуйста');
await send('u4', 'могу в пн вечер, подменю');

// Замена 3: Ксюша/Дарина не может в ср утро → Иса
await send('u3', 'в среду утро не получится, кто может?');
await send('u1', 'я выйду в ср утро');

// Замена 4: Карина не может в пт вечер → Дарина
await send('u4', 'пт вечер не смогу, кто свободен?');
await send('u2', 'я смогу в пт вечер');

// Check timesheet
const tsRes = await fetch(BASE + '/debug/timesheet?chat_id=' + encodeURIComponent(CHAT) + '&week_start=' + WEEK);
const tsData = await tsRes.json();
const ts = tsData.timesheet;

console.log('\n=== TIMESHEET ===');
for (const emp of ts.employees || []) {
  console.log('  ' + emp.name + ' (' + emp.user_id + '): shift=' + emp.shift_hours + 'h, eff=' + emp.effective_hours + 'h, pay=' + emp.total_pay + '₽');
}
console.log('Totals: hours=' + ts.totals?.total_hours + ', pay=' + ts.totals?.total_pay + '₽');

// Check replacements
const schedRes = await fetch(BASE + '/debug/schedule?chat_id=' + encodeURIComponent(CHAT) + '&week_start=' + WEEK);
const schedData = await schedRes.json();
const replacements = (schedData.slots || []).filter(s => s.replaced_user_id);
console.log('\nReplacements: ' + replacements.length);
for (const r of replacements) {
  console.log('  ' + r.dow + ' ' + r.slot_name + ': ' + r.user_id + ' за ' + r.replaced_user_id);
}
