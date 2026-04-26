import { addDays } from './utils/dates';
import { TODAY_STR } from './constants';

const OWNER = 'victorguerin18-ops';
const REPO  = 'marathon-app';
const PATH  = 'victor_coaching_data.json';
const API   = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}`;

function toBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

export async function syncToGitHub({ done, planned, checkIn, recentCheckins, planConfig }) {
  const RACE_DATE = new Date('2026-10-25');
  const now = new Date();

  const json = {
    meta: {
      last_sync: now.toISOString(),
      jours_avant_lille: Math.ceil((RACE_DATE - now) / 86400000),
      semaines_avant_lille: Math.ceil((RACE_DATE - now) / (86400000 * 7)),
    },
    profil: {
      vma: planConfig.vma,
      objectif_allure: "4:58",
      objectif_temps: "3:30:00",
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
    seances: [...done]
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
        splits: s.splits || [],
        planned_dist: s.plannedId ? planned.find(p => p.id === s.plannedId)?.targetDist : null,
      })),
    semaine_en_cours: {
      volume_km: done
        .filter(r => r.date >= addDays(TODAY_STR, -7))
        .reduce((s, r) => s + r.dist, 0)
        .toFixed(1),
      nb_seances: done.filter(r => r.date >= addDays(TODAY_STR, -7)).length,
      repartition: (() => {
        const types = {};
        done.filter(r => r.date >= addDays(TODAY_STR, -7)).forEach(r => {
          types[r.type] = (types[r.type] || 0) + 1;
        });
        return types;
      })(),
    },
  };

  const TOKEN = process.env.REACT_APP_GITHUB_TOKEN;
  console.log('[sync] token présent :', !!TOKEN, '— longueur :', TOKEN?.length);

  const headers = {
    Authorization: `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
    Accept: 'application/vnd.github+json',
  };

  // Récupère le SHA si le fichier existe déjà (404 = premier upload, sha reste null)
  let sha = null;
  const getRes = await fetch(API, { headers });
  if (getRes.ok) {
    const existing = await getRes.json();
    sha = existing.sha;
    console.log('[sync] fichier existant, sha :', sha?.slice(0, 8));
  } else if (getRes.status === 404) {
    console.log('[sync] fichier absent — premier upload');
  } else {
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
