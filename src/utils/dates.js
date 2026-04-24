import { TODAY_STR, TODAY } from '../constants';

export function parseDate(str) {
  const [y,m,d] = str.split('-'); return new Date(+y, +m-1, +d);
}
export function addDays(dateStr, n) {
  const dt = parseDate(dateStr); dt.setDate(dt.getDate()+n);
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
}
export function wkKey(dateStr) {
  const dt = parseDate(dateStr); const day = dt.getDay()||7;
  const mon = new Date(dt); mon.setDate(dt.getDate()-day+1);
  return `${mon.getFullYear()}-${String(mon.getMonth()+1).padStart(2,'0')}-${String(mon.getDate()).padStart(2,'0')}`;
}
export function fmtDate(d, opts={weekday:"short",day:"numeric",month:"short"}) {
  const [y,m,day]=d.split('-'); return new Date(+y,+m-1,+day).toLocaleDateString("fr-FR",opts);
}
export function isToday(d)  { return d === TODAY_STR; }
export function isFuture(d) { return parseDate(d) > TODAY; }
export function pace(dist,dur) {
  if(!dist||!dur) return "--'--\"";
  const s=(dur*60)/dist;
  return `${Math.floor(s/60)}'${String(Math.round(s%60)).padStart(2,"0")}"`;
}
