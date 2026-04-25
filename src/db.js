import { createClient } from '@supabase/supabase-js';
const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.REACT_APP_SUPABASE_ANON_KEY
);
export default supabase;
/* ─── PLANNED ─── */
export async function loadPlanned() {
  const { data, error } = await supabase.from('planned').select('*').order('date');
  if (error) { console.error(error); return []; }
  return data.map(r => ({
    id: r.id, date: r.date, type: r.type,
    targetDist: r.target_dist, targetDur: r.target_dur,
    targetHR: r.target_hr, notes: r.notes,
    generated: r.generated || false,
  }));
}
export async function savePlanned(p) {
  const { error } = await supabase.from('planned').upsert({
    id: p.id, date: p.date, type: p.type,
    target_dist: p.targetDist, target_dur: p.targetDur,
    target_hr: p.targetHR, notes: p.notes,
    generated: p.generated || false,
  });
  if (error) console.error(error);
}
export async function deletePlanned(id) {
  const { error } = await supabase.from('planned').delete().eq('id', id);
  if (error) console.error(error);
}
/* ─── DONE ─── */
export async function loadDone() {
  const { data, error } = await supabase.from('done').select('*').order('date', { ascending: false });
  if (error) { console.error(error); return []; }
  return data.map(r => ({
    id: r.id, plannedId: r.planned_id, date: r.date, type: r.type,
    dist: r.dist, dur: r.dur, hr: r.hr, rpe: r.rpe,
    feeling: r.feeling, notes: r.notes, fromStrava: r.from_strava,
  }));
}
export async function saveDone(r) {
  const { error } = await supabase.from('done').upsert({
    id: r.id, planned_id: r.plannedId || null, date: r.date, type: r.type,
    dist: r.dist, dur: r.dur, hr: r.hr || null, rpe: r.rpe,
    feeling: r.feeling || 3, notes: r.notes || '', from_strava: r.fromStrava || false,
  });
  if (error) console.error(error);
}
export async function saveManyDone(runs) {
  const rows = runs.map(r => ({
    id: r.id, planned_id: r.plannedId || null, date: r.date, type: r.type,
    dist: r.dist, dur: r.dur, hr: r.hr || null, rpe: r.rpe,
    feeling: r.feeling || 3, notes: r.notes || '', from_strava: r.fromStrava || false,
  }));
  const { error } = await supabase.from('done').upsert(rows, { onConflict: 'id' });
  if (error) console.error(error);
}
export async function deleteDone(id) {
  const { error } = await supabase.from('done').delete().eq('id', id);
  if (error) console.error(error);
}
/* ─── CHECKINS ─── */
export async function loadCheckin(date) {
  const { data, error } = await supabase.from('checkins').select('*').eq('date', date).maybeSingle();
  if (error) { console.error(error); return null; }
  if (!data) return null;
  return {
    hrv: String(data.hrv || ''),
    bevelRecovery: String(data.bevel_recovery || ''),
    restingHR: String(data.resting_hr || ''),
    sleepHours: String(data.sleep_hours || ''),
    feelingScore: data.feeling_score ?? 3,
    readiness: data.readiness,
    morningBrief: data.morning_brief || null,
    briefDate: data.brief_date || null,
  };
}
export async function saveCheckin(date, data) {
  const { error } = await supabase.from('checkins').upsert({
    id: `checkin-${date}`, date,
    hrv: data.hrv ? parseFloat(data.hrv) : null,
    bevel_recovery: data.bevelRecovery ? parseInt(data.bevelRecovery) : null,
    resting_hr: data.restingHR ? parseFloat(data.restingHR) : null,
    sleep_hours: data.sleepHours ? parseFloat(data.sleepHours) : null,
    feeling_score: data.feelingScore ?? null,
    readiness: data.readiness,
    morning_brief: data.morningBrief || null,
    brief_date: data.briefDate || null,
  }, { onConflict: 'id' });
  if (error) console.error(error);
}
export async function loadRecentCheckins(days = 7) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().split('T')[0];
  const { data, error } = await supabase.from('checkins').select('*')
    .gte('date', cutoffStr).order('date', { ascending: false });
  if (error) { console.error(error); return []; }
  return data.map(r => ({
    date: r.date,
    hrv: r.hrv ?? null,
    bevelRecovery: r.bevel_recovery ?? null,
    restingHR: r.resting_hr ?? null,
    sleepHours: r.sleep_hours ?? null,
    feelingScore: r.feeling_score ?? null,
    readiness: r.readiness ?? null,
    morningBrief: r.morning_brief || null,
    briefDate: r.brief_date || null,
  }));
}
export async function saveMorningBrief(date, brief) {
  const { error } = await supabase.from('checkins')
    .update({ morning_brief: brief, brief_date: date }).eq('date', date);
  if (error) console.error(error);
}
