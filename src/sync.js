import { addDays } from './utils/dates';
import { TODAY_STR } from './constants';

const OWNER = 'victorguerin18-ops';
const REPO  = 'marathon-app';
const PATH  = 'victor_coaching_data.json';
const API   = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}`;

function toBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

const TYPE_SHORT = {
  'Endurance fondamentale': 'EF',
  'Fractionné / VMA':       'Fractionné',
  'Tempo / Seuil':          'Tempo',
  'Sortie longue':          'SL',
  'Footing':                'Footing',
  'Évaluation VMA':         'Éval VMA',
  'Course':                 'Course',
};

const FEELING_LABELS = { 1: 'Épuisé', 2: 'Fatigué', 3: 'Correct', 4: 'Bien', 5: 'Excellent' };

function fmtAllure(dist, dur) {
  if (!dist || !dur) return '—';
  const sPerKm = (dur * 60) / dist;
  return `${Math.floor(sPerKm / 60)}:${String(Math.round(sPerKm % 60)).padStart(2, '0')}/km`;
}

// Retourne le lundi de la semaine ISO (format YYYY-MM-DD)
function weekMonday(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const dow = dt.getDay();
  dt.setDate(dt.getDate() + (dow === 0 ? -6 : 1 - dow));
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export async function syncToGitHub({ done, planned, checkIn, recentCheckins, planConfig }) {
  const RACE_DATE = new Date('2026-10-25');
  const now       = new Date();
  const cutoff6w  = addDays(TODAY_STR, -42);
  const last7d    = done.filter(r => r.date >= addDays(TODAY_STR, -7));
  const cads7d    = last7d.filter(r => r.cadence).map(r => r.cadence);

  const json = {
    meta: {
      last_sync: now.toISOString(),
      jours_avant_lille: Math.ceil((RACE_DATE - now) / 86400000),
      semaines_avant_lille: Math.ceil((RACE_DATE - now) / (86400000 * 7)),
    },
    profil: {
      vma: planConfig.vma,
      objectif_allure: '4:58',
      objectif_temps: '3:30:00',
    },
    checkin_aujourd_hui: {
      date: TODAY_STR,
      vfc: checkIn.hrv,
      recuperation_bevel: checkIn.bevelRecovery,
      fc_repos: checkIn.restingHR,
      sommeil_h: checkIn.sleepHours,
      sensation: checkIn.feelingScore,
      readiness_score: checkIn.readiness,
      morning_brief: checkIn.morningBrief,
    },
    historique_checkins: recentCheckins.map(c => ({
      date: c.date,
      vfc: c.hrv,
      recuperation_bevel: c.bevelRecovery,
      fc_repos: c.restingHR,
      sommeil_h: c.sleepHours,
      readiness: c.readiness,
    })),
    // Limité aux 6 semaines glissantes pour garder le fichier compact
    seances: [...done]
      .filter(s => s.date >= cutoff6w)
      .sort((a, b) => b.date.localeCompare(a.date))
      .map(s => ({
        date: s.date,
        type: s.type,
        source: s.fromStrava ? (s.notes ? 'both' : 'strava') : 'manual',
        distance_km: s.dist,
        duree_min: s.dur,
        allure_moy: s.dist > 0
          ? `${Math.floor(s.dur / s.dist)}:${String(Math.round((s.dur / s.dist % 1) * 60)).padStart(2, '0')}`
          : null,
        bpm_moy: s.hr,
        bpm_max: s.max_hr,
        cadence: s.cadence,
        denivele_m: s.elevation,
        suffer_score: s.suffer_score,
        rpe: s.rpe,
        feeling: s.feeling,
        notes_app: s.notes || null,
        description_strava: s.description_strava || null,
        planned_dist: s.plannedId ? planned.find(p => p.id === s.plannedId)?.targetDist : null,
      })),
    semaine_en_cours: {
      volume_km: last7d.reduce((s, r) => s + r.dist, 0).toFixed(1),
      nb_seances: last7d.length,
      cadence_moy: cads7d.length ? Math.round(cads7d.reduce((s, v) => s + v, 0) / cads7d.length) : null,
      repartition: (() => {
        const types = {};
        last7d.forEach(r => { types[r.type] = (types[r.type] || 0) + 1; });
        return types;
      })(),
    },
  };

  const TOKEN = process.env.REACT_APP_GITHUB_TOKEN;
  const headers = {
    Authorization: `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
    Accept: 'application/vnd.github+json',
  };

  let sha = null;
  const getRes = await fetch(API, { headers });
  if (getRes.ok) {
    sha = (await getRes.json()).sha;
  } else if (getRes.status !== 404) {
    const errGet = await getRes.json();
    throw new Error(`GET sha échoué (${getRes.status}) : ${errGet.message}`);
  }

  const body = { message: 'sync coaching data', content: toBase64(JSON.stringify(json, null, 2)) };
  if (sha) body.sha = sha;

  const res = await fetch(API, { method: 'PUT', headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`PUT échoué (${res.status}) : ${err.message}`);
  }
  return json;
}

// Génère un résumé texte compact à coller dans Claude.com
export function generateClaudePrompt({ done, planned, checkIn, recentCheckins, planConfig, protectionScore }) {
  const RACE_DATE = new Date('2026-10-25');
  const now       = new Date();
  const daysLeft  = Math.ceil((RACE_DATE - now) / 86400000);
  const weeksLeft = Math.ceil(daysLeft / 7);

  const rl  = s => s >= 85 ? 'EXCELLENT' : s >= 65 ? 'BON' : s >= 45 ? 'MODÉRÉ' : 'FAIBLE';
  const v   = (val, suf = '') => (val != null && val !== '' ? `${val}${suf}` : '—');
  const pad = (s, n) => String(s).padEnd(n);

  const cutoff = addDays(TODAY_STR, -42);
  const recent = [...done].filter(r => r.date >= cutoff).sort((a, b) => b.date.localeCompare(a.date));

  // Volume par semaine
  const weeks = {};
  recent.forEach(r => {
    const wk = weekMonday(r.date);
    if (!weeks[wk]) weeks[wk] = { dist: 0, runs: 0, rpe: [], cad: [] };
    weeks[wk].dist += r.dist;
    weeks[wk].runs++;
    if (r.rpe)     weeks[wk].rpe.push(r.rpe);
    if (r.cadence) weeks[wk].cad.push(r.cadence);
  });

  const upcoming = [...planned]
    .filter(p => p.date >= TODAY_STR && p.date <= addDays(TODAY_STR, 14))
    .sort((a, b) => a.date.localeCompare(b.date));

  const ps      = protectionScore;
  const acwrVal = ps?.signals?.find(s => s.key === 'ACWR')?.value || '—';
  const r       = checkIn.readiness || 0;

  const L = [];

  L.push(`🏃 MARATHON VICTOR — 25/10/2026 (${daysLeft}j · ${weeksLeft} sem.)`);
  L.push(`Objectif sub-3h30 · VMA: ${planConfig.vma} km/h · Allure cible: 4:58/km`);
  L.push('');

  L.push(`━━ CHECK-IN ${TODAY_STR} ━━`);
  L.push(`Bevel: ${v(checkIn.bevelRecovery, '%')} · VFC: ${v(checkIn.hrv, 'ms')} · FC repos: ${v(checkIn.restingHR, 'bpm')} · Sommeil: ${v(checkIn.sleepHours, 'h')} · Sensation: ${FEELING_LABELS[checkIn.feelingScore] || '—'}`);
  L.push(`Readiness: ${r ? `${r}/100 (${rl(r)})` : '—'}`);
  if (checkIn.morningBrief) L.push(`Brief: ${checkIn.morningBrief.replace(/\n+/g, ' · ')}`);
  L.push('');

  if (ps) {
    L.push('━━ PROTECTION BLESSURE ━━');
    L.push(`Score: ${ps.total}/100 (${ps.level?.label}) · ACWR: ${acwrVal}`);
    L.push('');
  }

  const hist = (recentCheckins || []).filter(c => c.date !== TODAY_STR).slice(0, 7);
  if (hist.length > 0) {
    L.push('━━ CHECK-INS RÉCENTS ━━');
    L.push('Date         Bevel   VFC    Sommeil  Readiness');
    hist.forEach(c => {
      L.push(`${c.date}  ${pad(v(c.bevelRecovery, '%'), 7)} ${pad(v(c.hrv, 'ms'), 6)} ${pad(v(c.sleepHours, 'h'), 8)} ${v(c.readiness)}`);
    });
    L.push('');
  }

  const wkEntries = Object.entries(weeks).sort(([a], [b]) => b.localeCompare(a));
  if (wkEntries.length > 0) {
    L.push('━━ VOLUME 6 SEMAINES ━━');
    L.push('Sem. (lundi)  Km     Séances  RPE moy  Cadence');
    wkEntries.forEach(([wk, d]) => {
      const rpeAvg = d.rpe.length ? (d.rpe.reduce((s, x) => s + x, 0) / d.rpe.length).toFixed(1) : '—';
      const cadAvg = d.cad.length ? Math.round(d.cad.reduce((s, x) => s + x, 0) / d.cad.length) : '—';
      L.push(`${wk}  ${pad(d.dist.toFixed(1), 6)} ${pad(d.runs, 8)} ${pad(rpeAvg, 8)} ${cadAvg}`);
    });
    L.push('');
  }

  if (recent.length > 0) {
    L.push('━━ SÉANCES (6 dernières semaines) ━━');
    L.push('Date         Type           Km    Dur  Allure      BPM  Cad  D+m  RPE  Feeling');
    recent.forEach(s => {
      L.push(
        `${s.date}  ${pad(TYPE_SHORT[s.type] || s.type, 14)} ${pad(s.dist, 5)} ${pad(s.dur, 4)} ${pad(fmtAllure(s.dist, s.dur), 11)} ${pad(s.hr || '—', 4)} ${pad(s.cadence || '—', 4)} ${pad(s.elevation != null ? Math.round(s.elevation) : '—', 5)} ${pad(s.rpe || '—', 4)} ${FEELING_LABELS[s.feeling] || '—'}`
      );
    });
    L.push('');
  }

  if (upcoming.length > 0) {
    L.push('━━ PLAN À VENIR (14 jours) ━━');
    L.push('Date         Type           Km    Dur');
    upcoming.forEach(p => {
      L.push(`${p.date}  ${pad(TYPE_SHORT[p.type] || p.type, 14)} ${pad(p.targetDist, 5)} ${p.targetDur}`);
    });
  }

  return L.join('\n');
}
