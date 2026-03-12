import { createClient } from '@supabase/supabase-js';
const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.REACT_APP_SUPABASE_KEY
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