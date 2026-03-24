import axios from 'axios';
const CLIENT_ID     = process.env.REACT_APP_STRAVA_CLIENT_ID;
const CLIENT_SECRET = process.env.REACT_APP_STRAVA_CLIENT_SECRET;
const REDIRECT_URI  = window.location.origin + '/';

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
  // Stocker tout : access_token, refresh_token, expires_at
  const { access_token, refresh_token, expires_at } = res.data;
  localStorage.setItem('strava_access_token',  access_token);
  localStorage.setItem('strava_refresh_token', refresh_token);
  localStorage.setItem('strava_expires_at',    String(expires_at));
  return res.data;
}

// Retourne un access_token valide (rafraîchit si expiré)
export async function getValidToken() {
  const accessToken  = localStorage.getItem('strava_access_token');
  const refreshToken = localStorage.getItem('strava_refresh_token');
  const expiresAt    = parseInt(localStorage.getItem('strava_expires_at') || '0', 10);

  if (!accessToken || !refreshToken) return null;

  // Si le token expire dans moins de 5 minutes, on rafraîchit
  const nowSec = Math.floor(Date.now() / 1000);
  if (expiresAt - nowSec > 300) {
    return accessToken; // encore valide
  }

  // Rafraîchissement
  try {
    const res = await axios.post('https://www.strava.com/oauth/token', {
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type:    'refresh_token',
    });
    const { access_token, refresh_token: new_refresh, expires_at } = res.data;
    localStorage.setItem('strava_access_token',  access_token);
    localStorage.setItem('strava_refresh_token', new_refresh);
    localStorage.setItem('strava_expires_at',    String(expires_at));
    return access_token;
  } catch (e) {
    console.error('Strava refresh failed', e);
    // Token invalide — on force une reconnexion
    localStorage.removeItem('strava_access_token');
    localStorage.removeItem('strava_refresh_token');
    localStorage.removeItem('strava_expires_at');
    return null;
  }
}

export async function fetchActivities() {
  const token = await getValidToken();
  if (!token) throw new Error('Non connecté à Strava');

  const res = await axios.get('https://www.strava.com/api/v3/athlete/activities', {
    headers: { Authorization: `Bearer ${token}` },
    params:  { per_page: 100, page: 1 },
  });
  return res.data
    .filter(a => a.type === 'Run')
    .map(a => ({
      id:        'strava_' + a.id,
      date:      a.start_date_local.slice(0, 10),
      type:      guessType(a),
      dist:      Math.round(a.distance / 100) / 10,
      dur:       Math.round(a.moving_time / 60),
      hr:        a.average_heartrate ? Math.round(a.average_heartrate) : null,
      rpe:       estimateRPE(a),
      feeling:   3,
      notes:     a.name || '',
      plannedId: null,
      fromStrava:true,
    }));
}

function guessType(a) {
  const dist = a.distance / 1000;
  const hr   = a.average_heartrate;
  const wt   = a.workout_type;
  if (wt === 1) return 'Course';
  if (wt === 2) return 'Sortie longue';
  if (wt === 3) return hr && hr >= 160 ? 'Fractionné / VMA' : 'Tempo / Seuil';
  if (dist >= 18) return 'Sortie longue';
  if (hr) {
    if (hr < 140) return 'Footing';
    if (hr < 152) return 'Endurance fondamentale';
    if (hr < 163) return 'Tempo / Seuil';
    return 'Fractionné / VMA';
  }
  if (dist < 5)  return 'Footing';
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