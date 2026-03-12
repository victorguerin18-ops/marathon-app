import axios from 'axios';

const CLIENT_ID = process.env.REACT_APP_STRAVA_CLIENT_ID;
const CLIENT_SECRET = process.env.REACT_APP_STRAVA_CLIENT_SECRET;
const REDIRECT_URI = window.location.origin + '/';

export function stravaLogin() {
  const url = `https://www.strava.com/oauth/authorize?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${REDIRECT_URI}&approval_prompt=force&scope=activity:read_all`;
  window.location.href = url;
}

export async function exchangeToken(code) {
  const res = await axios.post('https://www.strava.com/oauth/token', {
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    code,
    grant_type: 'authorization_code',
  });
  return res.data;
}

export async function fetchActivities(accessToken) {
  const res = await axios.get('https://www.strava.com/api/v3/athlete/activities', {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: { per_page: 100, page: 1 },
  });
  return res.data
    .filter(a => a.type === 'Run')
    .map(a => ({
      id: 'strava_' + a.id,
      date: a.start_date_local.slice(0, 10),
      type: guessType(a),
      dist: Math.round(a.distance / 100) / 10,
      dur: Math.round(a.moving_time / 60),
      hr: a.average_heartrate ? Math.round(a.average_heartrate) : null,
      rpe: estimateRPE(a),
      feeling: 3,
      notes: a.name || '',
      plannedId: null,
      fromStrava: true,
    }));
}

function guessType(a) {
  const dist = a.distance / 1000;
  const hr = a.average_heartrate;
  const wt = a.workout_type; // 0=normal, 1=race, 2=long run, 3=workout

  // Compétition
  if (wt === 1) return 'Course';

  // Long run tagué Strava
  if (wt === 2) return 'Sortie longue';

  // Workout intense tagué Strava
  if (wt === 3) return hr && hr >= 160 ? 'Fractionné / VMA' : 'Tempo / Seuil';

  // Longue distance → sortie longue
  if (dist >= 18) return 'Sortie longue';

  // Détection par FC si disponible
  if (hr) {
    if (hr < 140) return 'Footing';
    if (hr < 152) return 'Endurance fondamentale';
    if (hr < 163) return 'Tempo / Seuil';
    return 'Fractionné / VMA';
  }

  // Fallback distance seule
  if (dist < 5) return 'Footing';
  if (dist < 15) return 'Endurance fondamentale';
  return 'Sortie longue';
}

function estimateRPE(a) {
  if (!a.average_heartrate) return 5;
  const hr = a.average_heartrate;
  if (hr < 130) return 3;
  if (hr < 138) return 4;
  if (hr < 145) return 5;
  if (hr < 152) return 6;
  if (hr < 160) return 7;
  if (hr < 168) return 8;
  return 9;
}
