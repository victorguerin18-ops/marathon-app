import axios from 'axios';

const CLIENT_ID = process.env.REACT_APP_STRAVA_CLIENT_ID;
const CLIENT_SECRET = process.env.REACT_APP_STRAVA_CLIENT_SECRET;
const REDIRECT_URI = window.location.origin + '/';

// Redirige vers la page d'auth Strava
export function stravaLogin() {
  const url = `https://www.strava.com/oauth/authorize?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${REDIRECT_URI}&approval_prompt=force&scope=activity:read_all`;
  window.location.href = url;
}

// Échange le code contre un token
export async function exchangeToken(code) {
  const res = await axios.post('https://www.strava.com/oauth/token', {
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    code,
    grant_type: 'authorization_code',
  });
  return res.data;
}

// Récupère toutes les activités running
export async function fetchActivities(accessToken) {
  const res = await axios.get('https://www.strava.com/api/v3/athlete/activities', {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: { per_page: 100, page: 1 },
  });
  return res.data
    .filter(a => a.type === 'Run')
    .map(a => ({
      id: 'strava_' + a.id,
      date: a.start_date_local.slice(0, 10).replace(/-/g, '/'),

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
  const name = (a.name || '').toLowerCase();
  const dist = a.distance / 1000;
  if (name.includes('fractionné') || name.includes('interval') || name.includes('vma')) return 'Fractionné';
  if (name.includes('tempo') || name.includes('seuil')) return 'Tempo';
  if (name.includes('récup') || name.includes('recovery') || dist < 6) return 'Récupération';
  if (dist >= 16) return 'Sortie longue';
  return 'Endurance';
}

function estimateRPE(a) {
  if (!a.average_heartrate) return 6;
  const hr = a.average_heartrate;
  if (hr < 130) return 3;
  if (hr < 140) return 4;
  if (hr < 150) return 5;
  if (hr < 158) return 6;
  if (hr < 165) return 7;
  if (hr < 172) return 8;
  return 9;
}