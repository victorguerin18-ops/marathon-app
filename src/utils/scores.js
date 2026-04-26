import { TODAY_STR, INTENSE_TYPES, EASY_TYPES } from '../constants';
import { addDays, fmtDate } from './dates';

export function scoreSession(planned, done) {
  if(!planned||!done) return null;
  const d=Math.max(0,100-Math.abs(done.dist-planned.targetDist)/planned.targetDist*100);
  const t=Math.max(0,100-Math.abs(done.dur-planned.targetDur)/planned.targetDur*100);
  const h=planned.targetHR&&done.hr?Math.max(0,100-Math.abs(done.hr-planned.targetHR)/planned.targetHR*100):100;
  return Math.round(d*0.4+t*0.3+h*0.3);
}

export function computeVMA(doneList) {
  const evalTests = [...doneList]
    .filter(r => r.type === "Évaluation VMA" && r.dist > 0 && r.dur > 0)
    .sort((a, b) => b.date.localeCompare(a.date));

  if (evalTests.length > 0) {
    const latest = evalTests[0];
    const calcVMA = (t) => {
      const d6 = t.vma6minDist || null;
      if (d6 && d6 > 0) {
        return Math.round((d6 / 6 * 60 * 1.05) * 100) / 100;
      }
      const efDistEst = Math.min(3.0, t.dist * 0.25);
      const workDist = Math.max(t.dist - efDistEst, t.dist * 0.6);
      const workDur  = Math.max(t.dur - 20, 6);
      return Math.round((workDist / workDur * 60 * 1.05) * 100) / 100;
    };
    const vmaFromTest = calcVMA(latest);
    const testHistory = evalTests.slice(0, 5).map(t => ({
      date: t.date, dist: t.dist, dur: t.dur,
      vma6minDist: t.vma6minDist || null,
      vma: calcVMA(t),
      hasPreciseData: !!t.vma6minDist,
    }));
    return { source: "test", finalVMA: vmaFromTest, latestTest: latest, testHistory, breakdown: null };
  }

  const cutoff = addDays(TODAY_STR, -56);
  const seuilSessions = doneList.filter(r =>
    r.type === "Tempo / Seuil" && r.dist >= 6 && r.dur > 0 && r.date >= cutoff
  );
  if (seuilSessions.length >= 2) {
    const paces = seuilSessions.map(r => {
      const efSpeedKmh = 10;
      const warmupDistKm = (10 / 60) * efSpeedKmh * 2;
      const workDist = Math.max(r.dist - warmupDistKm, r.dist * 0.6);
      const workDur  = Math.max(r.dur - 20, r.dur * 0.6);
      return { pace: (workDur * 60) / workDist, date: r.date, workDist };
    }).sort((a, b) => a.pace - b.pace).slice(0, 3);
    const bestPace = paces[0].pace;
    const vmaEstimate = Math.round((3600 / bestPace / 0.87) * 100) / 100;
    return {
      source: "seuil", finalVMA: vmaEstimate, latestTest: null, testHistory: [],
      breakdown: { seuilPace: bestPace, seuilSessions: seuilSessions.length },
    };
  }
  return null;
}

export function computeProtectionScore({ done, readiness, weeklyVol }) {
  const signals = [];
  const HARD = ["Fractionné / VMA", "Tempo / Seuil", "Évaluation VMA"];

  const acuteLoad = done
    .filter(r => r.date >= addDays(TODAY_STR, -7))
    .reduce((s, r) => s + r.dist * (r.rpe || 5), 0);
  const weeks4 = [0,1,2,3].map(i =>
    done.filter(r => r.date >= addDays(TODAY_STR, -(i+1)*7) && r.date < addDays(TODAY_STR, -i*7))
        .reduce((s, r) => s + r.dist * (r.rpe || 5), 0)
  );
  const chronicLoad = weeks4.reduce((s, v) => s + v, 0) / 4;
  const acwr = chronicLoad > 0 ? acuteLoad / chronicLoad : 1;
  let acwrScore = 100;
  if (acwr < 0.8)       acwrScore = Math.round((acwr / 0.8) * 80);
  else if (acwr <= 1.3) acwrScore = 100;
  else if (acwr <= 1.5) acwrScore = Math.round(100 - ((acwr - 1.3) / 0.2) * 60);
  else                  acwrScore = Math.max(0, Math.round(40 - (acwr - 1.5) * 80));
  signals.push({ key:"ACWR", label:"Charge aiguë/chronique", score:acwrScore, weight:0.35, value:acwr.toFixed(2), optimal:"0.8–1.3" });

  const curKm  = weeklyVol[0]?.dist || 0;
  const prevKm = weeklyVol[1]?.dist || 0;
  const volPct = prevKm > 0 ? ((curKm - prevKm) / prevKm * 100) : 0;
  let volScore = 100;
  if (volPct > 20)      volScore = Math.max(0, Math.round(100 - (volPct - 20) * 3));
  else if (volPct > 10) volScore = Math.round(100 - (volPct - 10) * 2);
  signals.push({ key:"VOL", label:"Progression volume", score:volScore, weight:0.10, value:`${volPct > 0 ? "+" : ""}${Math.round(volPct)}%`, optimal:"≤+10%/sem" });

  const last14 = done.filter(r => r.date >= addDays(TODAY_STR, -14));
  let monoScore = 100, monoLabel = "variée", monoDetail = "";
  if (last14.length >= 3) {
    const nHard = last14.filter(r => HARD.includes(r.type)).length;
    const nEasy = last14.length - nHard;
    const dominantPct = Math.max(nHard, nEasy) / last14.length;
    const hardPct = Math.round((nHard / last14.length) * 100);
    const easyTypes = new Set(last14.filter(r => !HARD.includes(r.type)).map(r => r.type));
    if (dominantPct >= 0.85)      { monoScore = 30; monoLabel = "élevée"; }
    else if (dominantPct >= 0.70) { monoScore = 60; monoLabel = "modérée"; }
    else {
      const varietyBonus = easyTypes.size >= 2 ? 10 : 0;
      monoScore = Math.min(100, 80 + varietyBonus); monoLabel = "variée";
    }
    monoDetail = `${hardPct}% intensif · ${100-hardPct}% facile sur 14j`;
  }
  signals.push({ key:"MONO", label:"Monotonie", score:monoScore, weight:0.10, value:monoLabel, detail:monoDetail, optimal:"variée (30-40% intensif)" });

  const readinessScore = readiness ?? 65;
  signals.push({ key:"READY", label:"Readiness (VFC + récup)", score:readinessScore, weight:0.45, value:readiness ? `${readiness}/100` : "—", optimal:"≥75" });

  const total = Math.round(signals.reduce((s, sig) => s + sig.score * sig.weight, 0));
  const level = total >= 75 ? { label:"BIEN PROTÉGÉ", color:"#4ECDC4", bg:"#0d2b28", icon:"🛡️" }
              : total >= 50 ? { label:"VIGILANCE",     color:"#FF9F43", bg:"#2b1a00", icon:"⚠️" }
              :               { label:"RISQUE ÉLEVÉ",  color:"#FF6B6B", bg:"#2b0d0d", icon:"🚨" };
  return { total, signals, level, acwr };
}

export function calcReadiness(bevelRecovery, hrv, restingHR, sleepHours, feelingScore) {
  const sBevel = bevelRecovery > 0 ? Math.min(bevelRecovery, 100) : 50;
  const sHRV = hrv <= 0 ? 50
    : hrv >= 90 ? 100
    : hrv >= 63 ? 70 + (hrv - 63) / 35 * 30
    : Math.max(10, 70 - (63 - hrv) * 2);
  const sHR = restingHR <= 0 ? 50
    : restingHR <= 45 ? 100
    : restingHR <= 52 ? 90
    : restingHR <= 60 ? 75
    : restingHR <= 65 ? 55
    : Math.max(10, 55 - (restingHR - 65) * 3);
  const sSleep = sleepHours <= 0 ? 50
    : sleepHours >= 8 ? 100
    : sleepHours >= 7 ? 80 + (sleepHours - 7) * 20
    : sleepHours >= 6 ? 50 + (sleepHours - 6) * 30
    : Math.max(5, sleepHours / 6 * 50);
  const sFeel = ({1:10, 2:35, 3:65, 4:85, 5:100})[feelingScore] || 65;
  return Math.round(Math.min(100, Math.max(0, sBevel*0.60 + sHRV*0.15 + sHR*0.10 + sSleep*0.10 + sFeel*0.05)));
}

export function buildSmartInsight({
  readiness, checkIn, recentCheckins,
  todaySession, done, planned,
  protectionScore, acwr,
  planConfig,
}) {
  const bevel    = parseFloat(checkIn?.bevelRecovery) || 0;
  const vfc      = parseFloat(checkIn?.hrv) || 0;
  const sType    = todaySession?.type || null;
  const sDist    = todaySession?.targetDist || 0;
  const isIntense = sType ? INTENSE_TYPES.includes(sType) : false;
  const r        = readiness ?? 50;

  // ── 1. ALERTES PRIORITAIRES ──
  if (acwr > 1.3 && isIntense) {
    return `ACWR à ${acwr.toFixed(2)} — surcharge détectée. ${sType} de ${sDist}km prévu mais ton corps absorbe mal. EF légère ou repos pour protéger la suite.`;
  }
  if (r < 45) {
    if (isIntense) {
      return `Récup Bevel à ${bevel}% et VFC à ${vfc}ms — fatigue profonde. Pas de séance intense aujourd'hui, ton système nerveux n'a pas récupéré.`;
    }
    if (sType) {
      return `Readiness bas (${r}/100) mais ${sType} prévu est dans tes cordes. Reste en zone 2, n'accélère pas.`;
    }
  }

  // ── 2. CONTEXTE SEMAINE ──
  const kmFaitsSemaine = done
    .filter(d => d.date >= addDays(TODAY_STR, -6))
    .reduce((s, d) => s + d.dist, 0);
  const kmCibleSemaine = planConfig?.targetWeeklyKm || 42;
  const pctSemaine = kmCibleSemaine > 0 ? Math.round(kmFaitsSemaine / kmCibleSemaine * 100) : 0;
  const seancesRestantes = planned.filter(p =>
    p.date >= TODAY_STR &&
    p.date <= addDays(TODAY_STR, 6) &&
    !done.find(d => d.plannedId === p.id)
  );
  const kmRestants = seancesRestantes.reduce((s, p) => s + (p.targetDist || 0), 0);
  const [yr, mo, dy] = TODAY_STR.split('-').map(Number);
  const dayOfWeek = new Date(yr, mo - 1, dy).getDay();
  const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;

  // ── 3. DELTA VFC vs MOYENNE ──
  const history = (recentCheckins || []).filter(c => c.date !== TODAY_STR);
  function avg(vals) {
    const valid = vals.filter(v => v !== null && !isNaN(v) && v > 0);
    return valid.length >= 2 ? valid.reduce((s, v) => s + v, 0) / valid.length : null;
  }
  const avgVFC   = avg(history.map(c => parseFloat(c.hrv) || 0));
  const avgBevel = avg(history.map(c => parseFloat(c.bevelRecovery) || 0));
  const deltaVFC   = avgVFC   !== null ? Math.round(vfc   - avgVFC)   : null;
  const deltaRecup = avgBevel !== null ? Math.round(bevel - avgBevel) : null;

  // ── 4. DERNIÈRE SÉANCE ──
  const lastSession = [...done].sort((a, b) => b.date.localeCompare(a.date))[0] || null;
  const joursDepuis = lastSession
    ? Math.round((new Date(TODAY_STR + 'T12:00:00') - new Date(lastSession.date + 'T12:00:00')) / 86400000)
    : null;

  // ── 5. PATTERNS ──

  // A — Bonne récup + séance intense + VFC en hausse
  if (r >= 75 && deltaVFC !== null && deltaVFC > 3 && isIntense) {
    const afterStr = lastSession && joursDepuis !== null
      ? ` après ${joursDepuis === 1 ? 'hier' : `${joursDepuis}j`}`
      : '';
    return `VFC en hausse (+${deltaVFC}ms) — système nerveux bien récupéré${afterStr}. ${sType} de ${sDist}km : timing parfait.`;
  }

  // B — Bonne récup + séance facile
  if (r >= 75 && sType && !isIntense) {
    return `Forme excellente aujourd'hui (${r}/100). ${sType} de ${sDist}km prévu — profites-en pour rester en zone 2 et accumuler les km proprement.`;
  }

  // C — Récup correcte + séance intense
  if (r >= 55 && r < 75 && isIntense) {
    return `Récup correcte (${bevel}%) mais pas au top. ${sType} de ${sDist}km : faisable, commence prudemment et décide à l'échauffement.`;
  }

  // D — Récup correcte + volume semaine serré
  if (r >= 55 && r < 75 && pctSemaine < 60 && daysUntilSunday <= 3 && seancesRestantes.length > 0) {
    return `Readiness à ${r}/100. Il te reste ${kmRestants.toFixed(0)}km sur ${seancesRestantes.length} séance(s) cette semaine — rythme serré mais atteignable si tu y vas aujourd'hui.`;
  }

  // E — Récup en baisse vs moyenne
  if (deltaRecup !== null && deltaVFC !== null && deltaRecup < -15 && deltaVFC < -5) {
    const sessionStr = sType
      ? `${sType} de ${sDist}km : réduis l'intensité de 20%.`
      : 'Journée légère recommandée.';
    return `VFC en baisse (${deltaVFC}ms vs moyenne) et récup Bevel à ${bevel}% — tendance de fatigue. ${sessionStr}`;
  }

  // G — Semaine bien avancée (avant F pour couvrir "repos + bonne semaine")
  if (pctSemaine >= 80) {
    const sessionStr = sType
      ? `${sType} aujourd'hui et tu boucles la semaine proprement.`
      : 'Reste à gérer la récup.';
    return `Bonne semaine en cours — ${kmFaitsSemaine.toFixed(0)}km/${kmCibleSemaine}km (${pctSemaine}%). ${sessionStr}`;
  }

  // F — Aucune séance prévue
  if (!sType) {
    if (r >= 75) {
      return `Jour de repos prévu — et tu es en forme (${r}/100). Profite pour récupérer activement, la prochaine séance sera meilleure.`;
    }
    return `Pas de séance aujourd'hui — ton corps en a besoin (${r}/100). ${seancesRestantes.length} séance(s) encore cette semaine.`;
  }

  // ── 6. FALLBACK ──
  return `Readiness ${r}/100 — ${r >= 65 ? "forme correcte pour t'entraîner." : "écoute ton corps aujourd'hui."}`;
}

export function getReadinessReco(score, hrv, plannedType, bevelRecovery = 0) {
  const h = parseFloat(hrv) || 0;
  const b = parseFloat(bevelRecovery) || 0;
  const sessionLabel = plannedType || "ta séance";
  if (score >= 85) return `${b > 0 ? `Bevel ${b}% · ` : ''}Tu es en pleine forme. ${sessionLabel} — c'est le bon moment pour t'exprimer 💪`;
  if (score >= 65) {
    if (h >= 78) return `VFC à ${h}ms — bonne récup. ${sessionLabel} possible, reste à l'écoute à l'échauffement.`;
    return `Forme correcte — ${sessionLabel} possible, surveille tes sensations en début de séance.`;
  }
  if (score >= 45) return `${b > 0 ? `Bevel ${b}% — ` : ''}corps encore en récupération. EF légère ou repos recommandé.`;
  return `${b > 0 ? `Bevel ${b}% — ` : ''}fatigue détectée. Repos ou marche active recommandé aujourd'hui.`;
}

export function getReadinessAdvice(readiness, todaySession, weekPlanned, doneSessions) {
  if (!readiness || !todaySession) return null;
  if (doneSessions.find(d => d.plannedId === todaySession.id)) return null;

  const isIntense = INTENSE_TYPES.includes(todaySession.type);
  const isSL      = todaySession.type === "Sortie longue";
  const futureWeek = weekPlanned
    .filter(p => p.date > TODAY_STR && !doneSessions.find(d => d.plannedId === p.id))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (readiness >= 65 && !isIntense && !isSL) return null;
  if (readiness >= 85) return null;

  if (readiness < 45) {
    return {
      level:"danger", color:"#FF6B6B", icon:"🔴", title:"Repos recommandé",
      message:`Readiness à ${readiness}/100 — ton corps est en déficit de récupération. Reporter la séance est la meilleure décision aujourd'hui.`,
      actions:[
        { id:"postpone", label:"REPORTER À DEMAIN", icon:"→" },
        { id:"ignore",   label:"IGNORER",           icon:"✕", ghost:true },
      ],
      swapTarget:null,
    };
  }

  if (readiness < 65 && isIntense) {
    const swapTarget = futureWeek.find(p => EASY_TYPES.includes(p.type));
    const reduceTarget = { ...todaySession, targetDist:Math.round(todaySession.targetDist*0.75*10)/10, targetDur:Math.round(todaySession.targetDur*0.75), notes:"Volume réduit de 25% — readiness bas" };
    const actions = [];
    if (swapTarget) actions.push({ id:"swap", label:`ÉCHANGER AVEC EF DU ${fmtDate(swapTarget.date,{weekday:"short",day:"numeric"})}`, icon:"⇄", swapWith:swapTarget });
    actions.push({ id:"reduce", label:"RÉDUIRE LE VOLUME (-25%)", icon:"↓", reduced:reduceTarget });
    actions.push({ id:"ignore", label:"IGNORER", icon:"✕", ghost:true });
    return {
      level:"warning", color:"#FF9F43", icon:"🟡", title:`${todaySession.type} risquée`,
      message:`Readiness à ${readiness}/100 — une séance intense aujourd'hui risque d'aggraver la fatigue et d'augmenter le risque de blessure.${swapTarget ? ` Tu peux échanger avec ton EF du ${fmtDate(swapTarget.date,{weekday:"long",day:"numeric"})}.` : ""}`,
      actions, swapTarget,
    };
  }

  if (readiness < 65 && isSL) {
    const reduced = { ...todaySession, targetDist:Math.round(todaySession.targetDist*0.75*10)/10, targetDur:Math.round(todaySession.targetDur*0.75), notes:"SL réduite de 25% — readiness bas" };
    return {
      level:"warning", color:"#FF9F43", icon:"🟡", title:"Sortie longue à adapter",
      message:`Readiness à ${readiness}/100 — une SL complète aujourd'hui est risquée. Réduis à ${reduced.targetDist}km et reste en zone 2 stricte.`,
      actions:[
        { id:"reduce",   label:`RÉDUIRE À ${reduced.targetDist}KM`, icon:"↓", reduced },
        { id:"postpone", label:"REPORTER",                          icon:"→" },
        { id:"ignore",   label:"IGNORER",                           icon:"✕", ghost:true },
      ],
      swapTarget:null,
    };
  }

  if (readiness < 85 && isIntense) {
    return {
      level:"caution", color:"#FFE66D", icon:"⚠️", title:"Séance validée avec vigilance",
      message:`Readiness à ${readiness}/100 — séance faisable mais surveille tes sensations. Si tu te sens mal à l'échauffement, n'hésite pas à transformer en EF.`,
      actions:[
        { id:"ignore", label:"COMPRIS, ON Y VA",        icon:"💪", primary:true },
        { id:"reduce", label:"RÉDUIRE LE VOLUME (-20%)", icon:"↓", reduced:{ ...todaySession, targetDist:Math.round(todaySession.targetDist*0.80*10)/10, targetDur:Math.round(todaySession.targetDur*0.80) } },
      ],
      swapTarget:null,
    };
  }

  return null;
}
