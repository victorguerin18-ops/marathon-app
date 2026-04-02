import { useState, useMemo, useEffect } from "react";
import { stravaLogin, exchangeToken, fetchActivities, getValidToken } from './strava';
import { loadPlanned, loadDone, savePlanned, saveDone, saveManyDone, deletePlanned, deleteDone, loadCheckin, saveCheckin } from './db';
import { PlanWizard, PlanSettings, generatePlanFromConfig, defaultConfig, fmtPace } from './PlanWizard';

// ─── CONSTANTS ───────────────────────────────────────────────────────
const MARATHON_DATE = "2026-10-25";
const MARATHON      = new Date(MARATHON_DATE);
const TODAY         = new Date();
const TODAY_STR     = `${TODAY.getFullYear()}-${String(TODAY.getMonth()+1).padStart(2,'0')}-${String(TODAY.getDate()).padStart(2,'0')}`;
const DAYS_LEFT     = Math.ceil((MARATHON - TODAY) / 86400000);
const WEEKS_LEFT    = Math.floor(DAYS_LEFT / 7);

const VMA_DEFAULT = 15.24;

const TYPE_META = {
  "Footing":               { color:"#A8DADC", dark:"#0d1f20", icon:"〜",   desc:"Run libre, pas structuré" },
  "Endurance fondamentale":{ color:"#6BF178", dark:"#0d2b0f", icon:"◈",   desc:"Zone 2 · allure EF" },
  "Tempo / Seuil":         { color:"#FF9F43", dark:"#2b1a00", icon:"◇",   desc:"Seuil lactique" },
  "Fractionné / VMA":      { color:"#FF6B6B", dark:"#2b0d0d", icon:"▲▲",  desc:"Intervalles intenses" },
  "Sortie longue":         { color:"#C77DFF", dark:"#1e0d2b", icon:"◈◈◈", desc:"Endurance longue distance" },
  "Course":                { color:"#FFD700", dark:"#2b2200", icon:"🏅",  desc:"Compétition chronométrée" },
  "Évaluation VMA":        { color:"#00D2FF", dark:"#001f2b", icon:"⚡",  desc:"Test 6 min · Recalibrage VMA" },
};

const FEELINGS = ["😣","😕","😐","🙂","😄"];

const STORE = {
  get: (k, def) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } },
  set: (k, v)   => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// ─── DATE HELPERS ────────────────────────────────────────────────────
function parseDate(str) {
  const [y,m,d] = str.split('-'); return new Date(+y, +m-1, +d);
}
function addDays(dateStr, n) {
  const dt = parseDate(dateStr); dt.setDate(dt.getDate()+n);
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
}
function wkKey(dateStr) {
  const dt = parseDate(dateStr); const day = dt.getDay()||7;
  const mon = new Date(dt); mon.setDate(dt.getDate()-day+1);
  return `${mon.getFullYear()}-${String(mon.getMonth()+1).padStart(2,'0')}-${String(mon.getDate()).padStart(2,'0')}`;
}
function fmtDate(d, opts={weekday:"short",day:"numeric",month:"short"}) {
  const [y,m,day]=d.split('-'); return new Date(+y,+m-1,+day).toLocaleDateString("fr-FR",opts);
}
function isToday(d)  { return d === TODAY_STR; }
function isFuture(d) { return parseDate(d) > TODAY; }
function pace(dist,dur) {
  if(!dist||!dur) return "--'--\"";
  const s=(dur*60)/dist;
  return `${Math.floor(s/60)}'${String(Math.round(s%60)).padStart(2,"0")}"`;
}
function scoreSession(planned,done) {
  if(!planned||!done) return null;
  const d=Math.max(0,100-Math.abs(done.dist-planned.targetDist)/planned.targetDist*100);
  const t=Math.max(0,100-Math.abs(done.dur-planned.targetDur)/planned.targetDur*100);
  const h=planned.targetHR&&done.hr?Math.max(0,100-Math.abs(done.hr-planned.targetHR)/planned.targetHR*100):100;
  return Math.round(d*0.4+t*0.3+h*0.3);
}

// ─── VMA CALCULATOR ──────────────────────────────────────────────────
// Ratios physiologiques : allure observée → VMA estimée
// VMA (km/h) = distance / durée → pace_s = 3600/vma_kmh
// Si pace_ef = X sec/km, alors VMA = 3600 / (X / ratio_ef)
// ─── VMA CALCULATOR ──────────────────────────────────────────────────
// Basé en priorité sur les tests Évaluation VMA (test 6 min)
// Formule test 6 min : VMA (km/h) = distance_m / 100 × 0.5
// (distance couverte en 6 min = ~50% de la distance que tu parcourirais à VMA pure)
// Fallback : estimation depuis Seuil uniquement (type le moins sensible aux conditions)

function computeVMA(doneList) {
  // ── Priorité 1 : Tests Évaluation VMA (test 6 min) ──────────────────
  // La séance "Évaluation VMA" est enregistrée avec dist = distance couverte en 6 min
  const evalTests = [...doneList]
    .filter(r => r.type === "Évaluation VMA" && r.dist > 0 && r.dur > 0)
    .sort((a, b) => b.date.localeCompare(a.date)); // plus récent en premier

  if (evalTests.length > 0) {
    const latest = evalTests[0];
    // Utiliser vma6minDist si disponible (distance des 6min pures, sans échauff)
    // Sinon fallback sur dist totale (moins précis)
    const calcVMA = (t) => {
      const d6 = t.vma6minDist || null;
      if (d6 && d6 > 0) {
        // Distance couverte en 6 min exactement → VMA = d6 / 6 * 60 × 1.05
        return Math.round((d6 / 6 * 60 * 1.05) * 100) / 100;
      }
      // Fallback : soustraire échauff/cooldown estimés (~3km à allure EF)
      const efDistEst = Math.min(3.0, t.dist * 0.25); // max 25% dist = échauff+cooldown
      const workDist = Math.max(t.dist - efDistEst, t.dist * 0.6);
      const workDur  = Math.max(t.dur - 20, 6); // au moins 6 min
      return Math.round((workDist / workDur * 60 * 1.05) * 100) / 100;
    };
    const vmaFromTest = calcVMA(latest);

    // Historique des tests
    const testHistory = evalTests.slice(0, 5).map(t => ({
      date: t.date,
      dist: t.dist,
      dur: t.dur,
      vma6minDist: t.vma6minDist || null,
      vma: calcVMA(t),
      hasPreciseData: !!t.vma6minDist,
    }));

    return {
      source: "test",
      finalVMA: vmaFromTest,
      latestTest: latest,
      testHistory,
      breakdown: null, // pas de breakdown par type pour les tests
    };
  }

  // ── Priorité 2 : Estimation depuis Seuil uniquement ──────────────────
  // Le Seuil est le type le moins sensible aux conditions externes
  // (contrairement à l'EF qui varie énormément avec la chaleur, fatigue, terrain)
  const cutoff = addDays(TODAY_STR, -56); // 8 semaines (plus de données = plus fiable)
  const seuilSessions = doneList.filter(r =>
    r.type === "Tempo / Seuil" && r.dist >= 6 && r.dur > 0 && r.date >= cutoff
  );

  if (seuilSessions.length >= 2) {
    // Soustraire l'échauff + cooldown (2×10min en EF) pour avoir l'allure réelle au seuil
    // EF ≈ 70% VMA → on ne connaît pas encore la VMA, on utilise une EF estimée à 6'00"/km = 10km/h
    // Durée travail pur ≈ durée totale - 20min ; distance travail pur ≈ dist - 2×(10/60×10) = dist - 3.3km
    const paces = seuilSessions.map(r => {
      const efSpeedKmh = 10; // estimation conservative EF ~6'00"/km
      const warmupDistKm = (10 / 60) * efSpeedKmh * 2; // 2 × 10min à allure EF
      const workDist = Math.max(r.dist - warmupDistKm, r.dist * 0.6); // au moins 60% de la dist totale
      const workDur  = Math.max(r.dur - 20, r.dur * 0.6);             // au moins 60% de la durée
      return { pace: (workDur * 60) / workDist, date: r.date, workDist };
    }).sort((a, b) => a.pace - b.pace).slice(0, 3);

    const bestPace = paces[0].pace;
    // Seuil ≈ 87% VMA → VMA = vitesse_seuil / 0.87
    const vmaEstimate = Math.round((3600 / bestPace / 0.87) * 100) / 100;

    return {
      source: "seuil",
      finalVMA: vmaEstimate,
      latestTest: null,
      testHistory: [],
      breakdown: { seuilPace: bestPace, seuilSessions: seuilSessions.length },
    };
  }

  // ── Pas assez de données ─────────────────────────────────────────────
  return null;
}

// ─── PROTECTION SCORE ────────────────────────────────────────────────
// Score composite /100 — plus c'est haut, plus tu es protégé
function computeProtectionScore({ done, readiness, weeklyVol }) {
  const signals = [];

  // ── ACWR 4 semaines glissantes (35%) ──────────────────────────────
  // Charge = dist × RPE moyen, aiguë = 7j, chronique = moyenne 4×7j
  const acuteLoad = done
    .filter(r => r.date >= addDays(TODAY_STR, -7))
    .reduce((s, r) => s + r.dist * (r.rpe || 5), 0);
  const weeks4 = [0,1,2,3].map(i =>
    done.filter(r => r.date >= addDays(TODAY_STR, -(i+1)*7) && r.date < addDays(TODAY_STR, -i*7))
        .reduce((s, r) => s + r.dist * (r.rpe || 5), 0)
  );
  const chronicLoad = weeks4.reduce((s, v) => s + v, 0) / 4;
  const acwr = chronicLoad > 0 ? acuteLoad / chronicLoad : 1;
  // Zone optimale 0.8–1.3 → score 100, <0.8 ou >1.5 → score 0
  let acwrScore = 100;
  if (acwr < 0.8)       acwrScore = Math.round((acwr / 0.8) * 80);
  else if (acwr <= 1.3) acwrScore = 100;
  else if (acwr <= 1.5) acwrScore = Math.round(100 - ((acwr - 1.3) / 0.2) * 60);
  else                  acwrScore = Math.max(0, Math.round(40 - (acwr - 1.5) * 80));
  signals.push({ key: "ACWR", label: "Charge aiguë/chronique", score: acwrScore, weight: 0.35, value: acwr.toFixed(2), optimal: "0.8–1.3" });

  // ── Progression volume semaine/semaine (10%) ──────────────────────
  const curKm  = weeklyVol[0]?.dist || 0;
  const prevKm = weeklyVol[1]?.dist || 0;
  const volPct  = prevKm > 0 ? ((curKm - prevKm) / prevKm * 100) : 0;
  // Règle des 10% : +10% max optimal, >20% risqué
  let volScore = 100;
  if (volPct > 20)      volScore = Math.max(0, Math.round(100 - (volPct - 20) * 3));
  else if (volPct > 10) volScore = Math.round(100 - (volPct - 10) * 2);
  signals.push({ key: "VOL", label: "Progression volume", score: volScore, weight: 0.10, value: `${volPct > 0 ? "+" : ""}${Math.round(volPct)}%`, optimal: "≤+10%/sem" });

  // ── Monotonie entraînement (10%) ─────────────────────────────────
  // Logique lisible : % de séances dans la même catégorie d'intensité sur 14j
  // Catégories : EASY (EF, Footing, SL), HARD (VMA, Seuil, Éval)
  // Si 80%+ des séances sont dans la même catégorie → monotonie élevée
  const last14 = done.filter(r => r.date >= addDays(TODAY_STR, -14));
  let monoScore = 100;
  let monoLabel = "variée";
  let monoDetail = "";
  if (last14.length >= 3) {
    const HARD = ["Fractionné / VMA", "Tempo / Seuil", "Évaluation VMA"];
    const nHard = last14.filter(r => HARD.includes(r.type)).length;
    const nEasy = last14.length - nHard;
    const dominantPct = Math.max(nHard, nEasy) / last14.length; // % du type dominant
    const hardPct = Math.round((nHard / last14.length) * 100);

    // Aussi vérifier la variété dans EASY (EF vs SL vs Footing)
    const easyTypes = new Set(last14.filter(r => !HARD.includes(r.type)).map(r => r.type));

    if (dominantPct >= 0.85) {
      // Quasi-totalité dans une seule catégorie
      monoScore = 30;
      monoLabel = "élevée";
    } else if (dominantPct >= 0.70) {
      monoScore = 60;
      monoLabel = "modérée";
    } else {
      // Bon mix Easy/Hard + variété dans les types easy
      const varietyBonus = easyTypes.size >= 2 ? 10 : 0;
      monoScore = Math.min(100, 80 + varietyBonus);
      monoLabel = "variée";
    }
    monoDetail = `${hardPct}% intensif · ${100-hardPct}% facile sur 14j`;
  }
  signals.push({ key: "MONO", label: "Monotonie", score: monoScore, weight: 0.10, value: monoLabel, detail: monoDetail, optimal: "variée (30-40% intensif)" });

  // ── Readiness VFC + récup (45%) ───────────────────────────────────
  const readinessScore = readiness ?? 65; // 65 par défaut si pas de check-in
  signals.push({ key: "READY", label: "Readiness (VFC + récup)", score: readinessScore, weight: 0.45, value: readiness ? `${readiness}/100` : "—", optimal: "≥75" });

  // ── Score final ───────────────────────────────────────────────────
  const total = Math.round(signals.reduce((s, sig) => s + sig.score * sig.weight, 0));

  const level = total >= 75 ? { label: "BIEN PROTÉGÉ",  color: "#4ECDC4", bg: "#0d2b28", icon: "🛡️" }
              : total >= 50 ? { label: "VIGILANCE",      color: "#FF9F43", bg: "#2b1a00", icon: "⚠️" }
              :               { label: "RISQUE ÉLEVÉ",   color: "#FF6B6B", bg: "#2b0d0d", icon: "🚨" };

  return { total, signals, level, acwr };
}

// ─── VMA MODAL ───────────────────────────────────────────────────────
function VMAModal({ done, currentVMA, onClose }) {
  const result = useMemo(() => computeVMA(done), [done]);
  const finalVMA = result?.finalVMA ?? currentVMA;
  const diff = (finalVMA - currentVMA).toFixed(2);
  const diffPositive = finalVMA > currentVMA;
  const isFromTest = result?.source === "test";
  const isFromSeuil = result?.source === "seuil";

  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.92)",zIndex:400,display:"flex",alignItems:"flex-end",justifyContent:"center",backdropFilter:"blur(10px)"}}>
      <div onClick={e=>e.stopPropagation()} style={{width:"100%",maxWidth:480,background:"#0F1117",border:"1px solid #1C1F27",borderRadius:"22px 22px 0 0",padding:"28px 24px",paddingBottom:"calc(28px + env(safe-area-inset-bottom,12px))",maxHeight:"88vh",overflowY:"auto",animation:"popUp .28s cubic-bezier(.22,1,.36,1) forwards"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20}}>
          <div>
            <div style={{fontSize:10,color:"#00D2FF",letterSpacing:3,fontFamily:"'JetBrains Mono',monospace",marginBottom:6}}>⚡ VMA</div>
            <div style={{display:"flex",alignItems:"baseline",gap:8}}>
              <span style={{fontSize:44,fontWeight:800,letterSpacing:-2,color:"#E8E4DC"}}>{finalVMA.toFixed(2)}</span>
              <span style={{fontSize:16,color:"#555",fontFamily:"'JetBrains Mono',monospace"}}>km/h</span>
            </div>
            {result && (
              <div style={{fontSize:11,fontFamily:"'JetBrains Mono',monospace",marginTop:4}}>
                <span style={{color:diffPositive?"#6BF178":"#FF9F43"}}>{diffPositive?"▲":"▼"} {Math.abs(+diff)} km/h</span>
                <span style={{color:"#444",marginLeft:6}}>vs config ({currentVMA} km/h)</span>
              </div>
            )}
            {!result && <div style={{fontSize:11,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginTop:4}}>Pas de données · affiche ta config</div>}
          </div>
          <button onClick={onClose} style={{background:"#1C1F27",border:"none",color:"#888",fontSize:18,cursor:"pointer",borderRadius:10,width:36,height:36,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
        </div>

        <div style={{marginBottom:20,padding:"12px 14px",background:"#080A0E",borderRadius:10,border:`1px solid ${isFromTest?"#00D2FF33":isFromSeuil?"#FF9F4333":"#1C1F27"}`}}>
          {isFromTest && (
            <div style={{fontSize:11,color:"#00D2FF",fontFamily:"'JetBrains Mono',monospace",lineHeight:1.7}}>
              <span style={{fontWeight:700}}>⚡ Basé sur ton dernier test Évaluation VMA</span><br/>
              <span style={{color:"#555"}}>Test du {result.latestTest?.date} · {result.latestTest?.dist}km en {result.latestTest?.dur}min · méthode la plus fiable</span>
            </div>
          )}
          {isFromSeuil && (
            <div style={{fontSize:11,color:"#FF9F43",fontFamily:"'JetBrains Mono',monospace",lineHeight:1.7}}>
              <span style={{fontWeight:700}}>△ Estimé depuis tes séances Seuil</span><br/>
              <span style={{color:"#555"}}>Pas de test Évaluation VMA · estimation depuis ta meilleure allure Seuil ({result.breakdown?.seuilSessions} séances sur 8 semaines)</span>
            </div>
          )}
          {!result && (
            <div style={{fontSize:11,color:"#555",fontFamily:"'JetBrains Mono',monospace",lineHeight:1.7}}>
              Aucune donnée. Fais un test Évaluation VMA ou ajoute des séances Seuil pour une estimation.
            </div>
          )}
        </div>

        {isFromTest && result.testHistory?.length > 0 && (
          <div style={{marginBottom:20}}>
            <div style={{fontSize:10,color:"#555",letterSpacing:2,fontFamily:"'JetBrains Mono',monospace",marginBottom:10}}>HISTORIQUE DES TESTS</div>
            {result.testHistory.map((t,i)=>(
              <div key={t.date} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 14px",background:"#080A0E",borderRadius:10,border:`1px solid ${i===0?"#00D2FF33":"#1C1F27"}`,marginBottom:6}}>
                <div>
                  <div style={{fontSize:11,color:i===0?"#00D2FF":"#888",fontFamily:"'JetBrains Mono',monospace"}}>{t.date}{i===0?" · DERNIER":""}</div>
                  <div style={{fontSize:10,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginTop:2}}>{t.dist}km en {t.dur}min</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:18,fontWeight:800,color:i===0?"#E8E4DC":"#666"}}>{t.vma.toFixed(2)}</div>
                  <div style={{fontSize:9,color:"#555",fontFamily:"'JetBrains Mono',monospace"}}>km/h</div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{padding:"14px 16px",background:"#080A0E",borderRadius:12,border:"1px solid #1C1F27",marginBottom:16}}>
          <div style={{fontSize:9,color:"#555",letterSpacing:3,fontFamily:"'JetBrains Mono',monospace",marginBottom:8}}>COMMENT CALCULER TA VMA</div>
          <div style={{fontSize:11,color:"#888",fontFamily:"'JetBrains Mono',monospace",lineHeight:1.8}}>
            <span style={{color:"#00D2FF",fontWeight:700}}>✓ Test 6 min (recommandé)</span><br/>
            Sur piste ou GPS précis, cours à fond 6 minutes, note la distance. Ajoute une séance <span style={{color:"#00D2FF"}}>Évaluation VMA</span> dans le journal avec la distance couverte → calcul automatique.<br/><br/>
            <span style={{color:"#FF9F43"}}>Fallback : Seuil</span><br/>
            Sans test, l'app utilise ta meilleure allure Seuil (÷0.87). Moins précis, sensible aux conditions.
          </div>
        </div>

        {result && Math.abs(+diff) >= 0.2 && (
          <div style={{padding:"14px 16px",background:diffPositive?"#6BF17811":"#FF9F4311",border:`1px solid ${diffPositive?"#6BF17833":"#FF9F4333"}`,borderRadius:12,fontSize:11,color:diffPositive?"#6BF178":"#FF9F43",fontFamily:"'JetBrains Mono',monospace",lineHeight:1.7}}>
            {diffPositive
              ? `✓ VMA calculée (${finalVMA} km/h) > config (${currentVMA} km/h). Recalibre dans les réglages !`
              : `△ VMA calculée (${finalVMA} km/h) < config (${currentVMA} km/h). Allures cibles peut-être trop ambitieuses.`
            }
          </div>
        )}
      </div>
    </div>
  );
}

// ─── CHARTS ──────────────────────────────────────────────────────────
function Chart({ data, color, formatY, smooth }) {
  if(!data||data.length<2) return (
    <div style={{fontSize:11,color:"#555",fontFamily:"'JetBrains Mono',monospace",padding:"24px 0",textAlign:"center"}}>
      Pas assez de données
    </div>
  );
  const W=440,H=150,padL=46,padB=28,padT=16,padR=10;
  const iW=W-padL-padR, iH=H-padT-padB;
  const maxVal=Math.max(...data.map(d=>d.value),1);
  const pts=data.map((d,i)=>({x:padL+(i/(data.length-1))*iW, y:padT+(1-d.value/maxVal)*iH,...d}));
  function crPath(){
    let p=`M ${pts[0].x} ${pts[0].y}`;
    for(let i=0;i<pts.length-1;i++){
      const p0=pts[Math.max(i-1,0)],p1=pts[i],p2=pts[i+1],p3=pts[Math.min(i+2,pts.length-1)];
      p+=` C ${p1.x+(p2.x-p0.x)/6} ${p1.y+(p2.y-p0.y)/6}, ${p2.x-(p3.x-p1.x)/6} ${p2.y-(p3.y-p1.y)/6}, ${p2.x} ${p2.y}`;
    }
    return p;
  }
  function polyPath(){return pts.map((p,i)=>`${i===0?'M':'L'} ${p.x} ${p.y}`).join(' ');}
  const linePath=smooth?crPath():polyPath();
  const base=padT+iH;
  const area=linePath+` L ${pts[pts.length-1].x} ${base} L ${pts[0].x} ${base} Z`;
  const ticks=[0,.25,.5,.75,1].map(t=>({y:padT+(1-t)*iH,val:Math.round(t*maxVal)}));
  const step=Math.max(1,Math.floor(data.length/5));
  const xLbls=data.map((d,i)=>({...d,i})).filter(({i})=>i%step===0||i===data.length-1);
  const last=pts[pts.length-1];
  const cid=color.replace('#','');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:H}}>
      <defs>
        <linearGradient id={`aG${cid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.4"/>
          <stop offset="100%" stopColor={color} stopOpacity="0.03"/>
        </linearGradient>
        <linearGradient id={`lG${cid}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={color} stopOpacity="0.4"/>
          <stop offset="100%" stopColor={color} stopOpacity="1"/>
        </linearGradient>
      </defs>
      {ticks.map((t,i)=>(
        <g key={i}>
          <line x1={padL} y1={t.y} x2={W-padR} y2={t.y} stroke="#1C1F27" strokeWidth={1} strokeDasharray={i===0?"none":"3,5"}/>
          <text x={padL-5} y={t.y+4} textAnchor="end" fill="#444" fontSize={9} fontFamily="JetBrains Mono">{formatY?formatY(t.val):t.val}</text>
        </g>
      ))}
      <path d={area} fill={`url(#aG${cid})`}/>
      <path d={linePath} fill="none" stroke={`url(#lG${cid})`} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"/>
      {pts.map((p,i)=>(
        <circle key={i} cx={p.x} cy={p.y} r={i===pts.length-1?5:3}
          fill={i===pts.length-1?color:"#080A0E"} stroke={color} strokeWidth={1.5} opacity={i===pts.length-1?1:0.55}/>
      ))}
      {xLbls.map(({label,i})=>(
        <text key={i} x={padL+(i/(data.length-1))*iW} y={H-6} textAnchor="middle" fill="#444" fontSize={9} fontFamily="JetBrains Mono">{label}</text>
      ))}
      <rect x={last.x-24} y={last.y-22} width={48} height={16} rx={4} fill={color} opacity={0.18}/>
      <text x={last.x} y={last.y-10} textAnchor="middle" fill={color} fontSize={10} fontWeight="700" fontFamily="JetBrains Mono">
        {formatY?formatY(last.value):last.value}
      </text>
    </svg>
  );
}

const PERIODS=[
  {key:"1m",label:"1 mois",days:30},{key:"2m",label:"2 mois",days:61},
  {key:"4m",label:"4 mois",days:122},{key:"1y",label:"1 an",days:365},{key:"all",label:"Tout",days:null},
];
const VARIETY_PERIODS=[
  {key:"4w",label:"4 sem.",days:28},{key:"2m",label:"2 mois",days:61},
  {key:"6m",label:"6 mois",days:183},{key:"all",label:"Tout",days:null},
];
const METRICS=[
  {key:"km",label:"KM",desc:"Kilomètres / semaine"},
  {key:"time",label:"TEMPS",desc:"Minutes de course / semaine"},
  {key:"load",label:"CHARGE",desc:"Charge = km × RPE moyen"},
];

// ─── MAIN APP ─────────────────────────────────────────────────────────
export default function App() {
  const [planned,   setPlanned]   = useState([]);
  const [done,      setDone]      = useState([]);
  const [view,      setView]      = useState("today");
  const [modal,     setModal]     = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [stravaConnected, setStravaConnected] = useState(()=>!!localStorage.getItem('strava_access_token'));
  const [stravaLoading,   setStravaLoading]   = useState(false);
  const [syncStatus, setSyncStatus] = useState("");
  const [editForm,  setEditForm]  = useState(null);
  const [showVMA,   setShowVMA]   = useState(false);

  // Plan config (wizard)
  const [planConfig, setPlanConfig] = useState(()=>STORE.get("plan_config",null)||defaultConfig(VMA_DEFAULT));
  const [showWizard, setShowWizard] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [paceEdit, setPaceEdit] = useState(null); // key de l'allure en cours d'édition
  const [planGenLoading, setPlanGenLoading] = useState(false);

  // Check-in matin
  const [checkIn, setCheckIn] = useState({ hrv: "", recovery: "", feeling: null });
  const [checkInSaved, setCheckInSaved] = useState(false);
  const [checkInEditing, setCheckInEditing] = useState(false);

  // Modal déplacement séance
  const [moveModal, setMoveModal] = useState(null);
  const [editPlannedForm, setEditPlannedForm] = useState(null); // {session, mode:'swap'|'move'}
  const [moveTargetId, setMoveTargetId] = useState(null);
  const [moveDate, setMoveDate] = useState("");

  const [showProtectionDetail, setShowProtectionDetail] = useState(false);
  const [weekAdjustModal, setWeekAdjustModal] = useState(null); // {session, newDist, reason, isAlert}
  const [weekAdjustDismissed, setWeekAdjustDismissed] = useState(()=>STORE.get('week_adjust_'+wkKey(new Date().toISOString().split('T')[0]), false));
  const [showACWRDetail, setShowACWRDetail] = useState(false);
  const [showMonoDetail, setShowMonoDetail] = useState(false);

  // Modal débrief post-Strava
  const [stravaDebriefModal, setStravaDebriefModal] = useState(null); // {stravaSession, plannedSession}
  const [debriefForm, setDebriefForm] = useState({rpe:"6", feeling:"3", notes:""});

  // Readiness advisor
  const [readinessAction, setReadinessAction] = useState(()=>STORE.get('readiness_action_'+TODAY_STR, null));

  // Chart state
  const [volPeriod,  setVolPeriod]  = useState("4m");
  const [volMetric,  setVolMetric]  = useState("km");
  const volSmooth = false;
  const [pacePeriod, setPacePeriod] = useState("all");
  const paceSmooth = false;
  const [varPeriod,  setVarPeriod]  = useState("4w");

  // Coach state
  const [coachMsg,   setCoachMsg]   = useState(()=>STORE.get("coach_msg",null));
  const [coachDate,  setCoachDate]  = useState(()=>STORE.get("coach_date",null));
  const [coachLoading,setCoachLoading]=useState(false);
  const [chatHistory, setChatHistory]=useState(()=>STORE.get("coach_chat",[]));
  const [chatInput,  setChatInput]  = useState("");

  useEffect(()=>{
    async function init(){
      setLoading(true);
      const [p,d,ci]=await Promise.all([loadPlanned(),loadDone(),loadCheckin(TODAY_STR)]);
      setPlanned(p); setDone(d);
      if(ci){ setCheckIn(ci); setCheckInSaved(true); }
      setLoading(false);
      // Auto-sync Strava silencieux au chargement si connecté
      const token = await getValidToken();
      if(token) {
        try {
          const activities = await fetchActivities();
          const existingMap = new Map(d.map(r=>[r.id,r]));
          const toSave = activities.map(a=>mergeStravaActivity(a, existingMap.get(a.id)));
          const newOnes = toSave.filter(a=>!existingMap.has(a.id));
          if(newOnes.length>0){
            await saveManyDone(toSave);
            setDone(prev=>{
              const m=new Map(prev.map(r=>[r.id,r]));
              toSave.forEach(a=>m.set(a.id,a));
              const updated=Array.from(m.values());
              checkForTodayStravaDebrief(updated, p);
              return updated;
            });
          }
        } catch(e){ /* silencieux */ }
      }
    }
    init();
  },[]);// eslint-disable-line react-hooks/exhaustive-deps

  useEffect(()=>{
    const params=new URLSearchParams(window.location.search);
    const code=params.get('code'); if(!code) return;
    setStravaLoading(true); setSyncStatus("Connexion Strava...");
    exchangeToken(code).then(data=>{
      setStravaConnected(true);
      setSyncStatus("Import des séances...");
      fetchActivities().then(async activities=>{
        const existingMap=new Map(done.map(r=>[r.id,r]));
        const toSave=activities.map(a=>mergeStravaActivity(a, existingMap.get(a.id)));
        const newCount=toSave.filter(a=>!existingMap.has(a.id)).length;
        if(toSave.length>0){await saveManyDone(toSave); setDone(prev=>{const m=new Map(prev.map(r=>[r.id,r])); toSave.forEach(a=>m.set(a.id,a)); return Array.from(m.values());});}
        setSyncStatus(`✓ ${newCount} nouvelles · ${toSave.length-newCount} mises à jour`);
        setTimeout(()=>setSyncStatus(""),4000); setStravaLoading(false);
      });
      window.history.replaceState({},'','/');
    }).catch(()=>{setStravaLoading(false);setSyncStatus("");});
  },[done]);// eslint-disable-line react-hooks/exhaustive-deps

  // Merge Strava activity avec données locales existantes
  // On garde rpe, type, feeling, notes si déjà modifiés manuellement
  function mergeStravaActivity(incoming, existing) {
    // Auto-lier à la séance planifiée du même jour si pas encore liée
    const autoPlannedId = (() => {
      if (existing?.plannedId) return existing.plannedId; // déjà lié
      // Chercher une séance planifiée du même jour non encore réalisée
      const match = planned.find(p =>
        p.date === incoming.date &&
        !done.find(d => d.plannedId === p.id && d.id !== incoming.id)
      );
      return match?.id || null;
    })();

    if (!existing) return { ...incoming, plannedId: autoPlannedId };
    return {
      ...incoming,                               // dist, dur, hr, date depuis Strava
      type:      existing.type,                  // type modifié manuellement conservé
      rpe:       existing.rpe,                   // RPE manuel conservé
      feeling:   existing.feeling,               // ressenti conservé
      notes:     existing.notes ?? incoming.notes,
      plannedId: existing.plannedId || autoPlannedId, // lien conservé ou auto-détecté
    };
  }

  async function syncStrava(){
    setStravaLoading(true); setSyncStatus("Synchronisation...");
    const token = await getValidToken();
    if(!token){
      setStravaConnected(false);
      setSyncStatus("Session expirée — reconnecte Strava");
      setTimeout(()=>setSyncStatus(""),4000);
      setStravaLoading(false); return;
    }
    const activities=await fetchActivities();
    const existingMap=new Map(done.map(r=>[r.id,r]));
    const toSave=activities.map(a=>mergeStravaActivity(a, existingMap.get(a.id)));
    const newCount=toSave.filter(a=>!existingMap.has(a.id)).length;
    if(toSave.length>0){await saveManyDone(toSave); setDone(prev=>{const m=new Map(prev.map(r=>[r.id,r])); toSave.forEach(a=>m.set(a.id,a)); const updated=Array.from(m.values()); checkForTodayStravaDebrief(updated, planned); return updated;});}
    setSyncStatus(`✓ ${newCount} nouvelles · ${toSave.length-newCount} mises à jour`);
    setTimeout(()=>setSyncStatus(""),3000); setStravaLoading(false);
  }

  // Ouvre le modal débrief si une séance Strava du jour vient d'arriver sans débrief
  function checkForTodayStravaDebrief(doneList, plannedList) {
    const todayStrava = doneList.find(d => d.date === TODAY_STR && d.fromStrava);
    if (!todayStrava) return;
    // Déjà débriefé si rpe a été modifié manuellement (> valeur auto estimateRPE)
    // On détecte via un flag ou si feeling !== 3 (valeur par défaut Strava)
    if (todayStrava.feeling !== 3 || STORE.get("debriefed_"+todayStrava.id, false)) return;
    // Trouver la séance planifiée du jour
    const planned = plannedList.find(p => p.date === TODAY_STR) || null;
    setStravaDebriefModal({ stravaSession: todayStrava, plannedSession: planned });
    setDebriefForm({ rpe: String(todayStrava.rpe || 6), feeling: "3", notes: todayStrava.notes || "" });
  }

  async function generateAndSavePlan(cfg){
    setPlanGenLoading(true);
    const config = cfg || planConfig;
    const toDelete = planned.filter(p=>p.generated && parseDate(p.date) > parseDate(TODAY_STR));
    for(const p of toDelete){ await deletePlanned(p.id); }
    const oldFormat = planned.filter(p=>p.id && p.id.startsWith('plan-') && parseDate(p.date) > parseDate(TODAY_STR));
    for(const p of oldFormat){ await deletePlanned(p.id); }
    const sessions = generatePlanFromConfig(config, planned.filter(p=>!p.generated));
    for(const s of sessions){ await savePlanned(s); }
    setPlanned(prev=>{
      const kept = prev.filter(p=>
        (!p.generated && !(p.id||'').startsWith('plan-')) ||
        parseDate(p.date) <= parseDate(TODAY_STR)
      );
      const ids = new Set(kept.map(p=>p.id));
      return [...kept, ...sessions.filter(s=>!ids.has(s.id))];
    });
    setPlanGenLoading(false);
    setShowWizard(false);
    setShowSettings(false);
  }

  function handleWizardComplete(cfg){
    const updated = {...planConfig, ...cfg};
    setPlanConfig(updated);
    STORE.set("plan_config", updated);
    generateAndSavePlan(updated);
  }

  function handleSettingsUpdate(patch){
    const updated = {...planConfig, ...patch};
    setPlanConfig(updated);
    STORE.set("plan_config", updated);
  }

  async function deleteSession(id){
    await deletePlanned(id);
    setPlanned(prev=>prev.filter(p=>p.id!==id));
  }

  async function deleteJournalEntry(entry){
    if(!window.confirm("Supprimer cette séance du journal ? Si elle était planifiée, elle repassera en 'à faire'.")) return;
    await deleteDone(entry.id);
    setDone(prev=>prev.filter(r=>r.id!==entry.id));
    // Si liée à une séance planifiée, on ne touche à rien — elle redevient automatiquement "à faire"
  }

  function buildCoachContext(){
    const recentDone=[...done].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,15);
    const weeks={};
    done.forEach(r=>{
      const wk=wkKey(r.date);
      if(!weeks[wk]) weeks[wk]={dist:0,runs:0,rpe:[]};
      weeks[wk].dist+=r.dist; weeks[wk].runs++; weeks[wk].rpe.push(r.rpe||5);
    });
    const wkList=Object.entries(weeks).sort(([a],[b])=>b.localeCompare(a)).slice(0,4);
    const planUpcoming=[...planned].filter(p=>parseDate(p.date)>=parseDate(TODAY_STR)).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,6);
    const totalKm=done.reduce((s,r)=>s+r.dist,0);
    const efRuns=done.filter(r=>r.type==="Endurance fondamentale"&&r.dist>5).sort((a,b)=>a.date.localeCompare(b.date));
    const lastPace=efRuns.length?(efRuns[efRuns.length-1].dur*60)/efRuns[efRuns.length-1].dist:null;
    const todayDone=done.find(d=>d.date===TODAY_STR);
    const todayPlannedSession=planned.find(p=>p.date===TODAY_STR);
    const readiness=checkInSaved?(checkIn.readiness??calcReadiness(checkIn.hrv,checkIn.recovery,checkIn.feeling)):null;
    const ps=protectionScore;

    return `Tu es le coach marathon de Victor. Sois CONCIS (max 5 phrases sauf si question précise). Pose une question si tu as besoin d'une info manquante. Pas d'intro générique, va droit au but.

PROFIL : Victor, Marathon de Lille 25/10/2026 (${DAYS_LEFT}j/${WEEKS_LEFT}sem), sub-3h30, VMA ${planConfig.vma}km/h, allures : EF ${fmtPace(planConfig.paces.ef)}/km · Seuil ${fmtPace(planConfig.paces.tempo)}/km · VMA ${fmtPace(planConfig.paces.vma)}/km · Marathon ~4'58"/km

ÉTAT DU JOUR :
- Readiness : ${readiness!==null?`${readiness}/100 (VFC ${checkIn.hrv||'?'}ms, récup ${checkIn.recovery||'?'}%, sensation ${checkIn.feeling===0?'🟢 frais':checkIn.feeling===1?'🟡 correct':checkIn.feeling===2?'🔴 fatigué':'non renseigné'})`:'check-in non fait'}
- Protection blessure : ${ps.total}/100 (${ps.level.label}) — ACWR ${ps.signals.find(s=>s.key==='ACWR')?.value||'?'}, monotonie ${ps.signals.find(s=>s.key==='MONO')?.value||'?'}
- Séance du jour prévue : ${todayPlannedSession?`${todayPlannedSession.type} ${todayPlannedSession.targetDist}km`:'aucune'}
- Séance du jour réalisée : ${todayDone?`${todayDone.type} ${todayDone.dist}km en ${todayDone.dur}min, FC ${todayDone.hr||'?'}bpm, RPE ${todayDone.rpe||'?'}, ressenti ${["😣","😕","😐","🙂","😄"][(todayDone.feeling||3)-1]}`:'pas encore'}

SEMAINES RÉCENTES :
${wkList.map(([wk,d])=>`${wk}: ${d.dist.toFixed(0)}km, ${d.runs} séances, RPE moy ${(d.rpe.reduce((s,v)=>s+v,0)/d.rpe.length).toFixed(1)}`).join('\n')}
Total cumulé : ${totalKm.toFixed(0)}km · Dernière allure EF : ${lastPace?`${fmtPace(lastPace)}/km`:'?'}

DERNIÈRES SÉANCES :
${recentDone.slice(0,8).map(r=>`${r.date} ${r.type.split(' ')[0]} ${r.dist}km ${r.dur}min FC${r.hr||'?'} RPE${r.rpe||'?'} ${["😣","😕","😐","🙂","😄"][(r.feeling||3)-1]}`).join('\n')}

PLAN À VENIR :
${planUpcoming.map(p=>`${p.date}: ${p.type} ${p.targetDist}km`).join('\n')}`;
  }

  function calcReadiness(hrv, recovery, feeling) {
    // Score /100 basé sur VFC + récup + sensation
    const h = parseFloat(hrv) || 0;
    const r = parseFloat(recovery) || 0;
    const f = feeling; // 0=frais, 1=correct, 2=fatigué

    // VFC : <60=mauvais, 60-75=moyen, 75-85=bien, >85=excellent
    const hrvScore = h <= 0 ? 50 : h >= 85 ? 100 : h >= 75 ? 80 + (h-75)/10*20 : h >= 60 ? 50 + (h-60)/15*30 : Math.max(0, h/60*50);
    // Récup Bevel : linéaire 0→100
    const recScore = r <= 0 ? 50 : Math.min(r, 100);
    // Sensation : frais=100, correct=65, fatigué=30
    const feelScore = f === null ? 65 : f === 0 ? 100 : f === 1 ? 65 : 30;

    const score = Math.round(hrvScore * 0.45 + recScore * 0.35 + feelScore * 0.20);
    return Math.min(100, Math.max(0, score));
  }

  function getReadinessReco(score, hrv, plannedType) {
    const h = parseFloat(hrv) || 0;
    const sessionLabel = plannedType || "ta séance";
    if (score >= 85) {
      if (h >= 78) return `VFC à ${h}ms — tu es frais et ton système nerveux est prêt. ${sessionLabel} validée 💪`;
      return `Score excellent — tout vert pour ${sessionLabel} aujourd'hui 💪`;
    }
    if (score >= 65) {
      if (h >= 70 && h < 78) return `VFC à ${h}ms — bonne forme. EF ou séance modérée, évite l'intensité maximale.`;
      return `Forme correcte — ${sessionLabel} possible, reste à l'écoute de ton corps.`;
    }
    if (score >= 45) {
      return `VFC à ${h > 0 ? h+"ms — " : ""}ton corps récupère encore. EF légère ou repos recommandé.`;
    }
    return `VFC à ${h > 0 ? h+"ms — " : ""}fatigue détectée. Repos ou marche active aujourd'hui.`;
  }

  async function saveCheckIn(data) {
    const readiness = calcReadiness(data.hrv, data.recovery, data.feeling);
    await saveCheckin(TODAY_STR, data.hrv, data.recovery, data.feeling, readiness);
    setCheckIn({...data, readiness});
    setCheckInSaved(true);
    setCheckInEditing(false);
  }

  // ── READINESS ADVISOR ────────────────────────────────────────────────

  // Séances intensives qui nécessitent un bon readiness
  const INTENSE_TYPES = ["Fractionné / VMA", "Tempo / Seuil", "Évaluation VMA"];
  const EASY_TYPES    = ["Endurance fondamentale", "Footing"];

  // Calcule la suggestion d'adaptation selon readiness + séance du jour
  function getReadinessAdvice(readiness, todaySession, weekPlanned, doneSessions) {
    if (!readiness || !todaySession) return null;
    if (doneSessions.find(d => d.plannedId === todaySession.id)) return null; // déjà fait

    const isIntense = INTENSE_TYPES.includes(todaySession.type);
    const isSL      = todaySession.type === "Sortie longue";

    // Séances futures de la semaine non encore faites
    const futureWeek = weekPlanned
      .filter(p => p.date > TODAY_STR && !doneSessions.find(d => d.plannedId === p.id))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Score ≥ 65 et séance EF/Footing → tout va bien
    if (readiness >= 65 && !isIntense && !isSL) return null;
    // Score ≥ 85 → tout va bien
    if (readiness >= 85) return null;

    // SCORE < 45 → repos total
    if (readiness < 45) {
      return {
        level: "danger",
        color: "#FF6B6B",
        icon: "🔴",
        title: "Repos recommandé",
        message: `Readiness à ${readiness}/100 — ton corps est en déficit de récupération. Reporter la séance est la meilleure décision aujourd'hui.`,
        actions: [
          { id: "postpone", label: "REPORTER À DEMAIN", icon: "→" },
          { id: "ignore",   label: "IGNORER",           icon: "✕", ghost: true },
        ],
        swapTarget: null,
      };
    }

    // SCORE 45–64 avec séance intense → proposer échange avec EF de la semaine
    if (readiness < 65 && isIntense) {
      const swapTarget = futureWeek.find(p => EASY_TYPES.includes(p.type));
      const reduceTarget = { ...todaySession, targetDist: Math.round(todaySession.targetDist * 0.75 * 10) / 10, targetDur: Math.round(todaySession.targetDur * 0.75), notes: "Volume réduit de 25% — readiness bas" };
      const actions = [];
      if (swapTarget) {
        actions.push({ id: "swap", label: `ÉCHANGER AVEC EF DU ${fmtDate(swapTarget.date, {weekday:"short", day:"numeric"})}`, icon: "⇄", swapWith: swapTarget });
      }
      actions.push({ id: "reduce", label: "RÉDUIRE LE VOLUME (-25%)", icon: "↓", reduced: reduceTarget });
      actions.push({ id: "ignore", label: "IGNORER", icon: "✕", ghost: true });
      return {
        level: "warning",
        color: "#FF9F43",
        icon: "🟡",
        title: `${todaySession.type} risquée`,
        message: `Readiness à ${readiness}/100 — une séance intense aujourd'hui risque d'aggraver la fatigue et d'augmenter le risque de blessure.${swapTarget ? ` Tu peux échanger avec ton EF du ${fmtDate(swapTarget.date, {weekday:"long", day:"numeric"})}.` : ""}`,
        actions,
        swapTarget,
      };
    }

    // SCORE 45–64 avec SL → réduire la distance
    if (readiness < 65 && isSL) {
      const reduced = { ...todaySession, targetDist: Math.round(todaySession.targetDist * 0.75 * 10) / 10, targetDur: Math.round(todaySession.targetDur * 0.75), notes: "SL réduite de 25% — readiness bas" };
      return {
        level: "warning",
        color: "#FF9F43",
        icon: "🟡",
        title: "Sortie longue à adapter",
        message: `Readiness à ${readiness}/100 — une SL complète aujourd'hui est risquée. Réduis à ${reduced.targetDist}km et reste en zone 2 stricte.`,
        actions: [
          { id: "reduce", label: `RÉDUIRE À ${reduced.targetDist}KM`, icon: "↓", reduced },
          { id: "postpone", label: "REPORTER", icon: "→" },
          { id: "ignore", label: "IGNORER", icon: "✕", ghost: true },
        ],
        swapTarget: null,
      };
    }

    // SCORE 65–84 avec séance intense → avertissement doux
    if (readiness < 85 && isIntense) {
      return {
        level: "caution",
        color: "#FFE66D",
        icon: "⚠️",
        title: "Séance validée avec vigilance",
        message: `Readiness à ${readiness}/100 — séance faisable mais surveille tes sensations. Si tu te sens mal à l'échauffement, n'hésite pas à transformer en EF.`,
        actions: [
          { id: "ignore", label: "COMPRIS, ON Y VA", icon: "💪", primary: true },
          { id: "reduce", label: "RÉDUIRE LE VOLUME (-20%)", icon: "↓", reduced: { ...todaySession, targetDist: Math.round(todaySession.targetDist * 0.80 * 10) / 10, targetDur: Math.round(todaySession.targetDur * 0.80) } },
        ],
        swapTarget: null,
      };
    }

    return null;
  }

  // Exécute l'action choisie
  async function applyReadinessAction(action, todaySession) {
    if (action.id === "ignore") {
      const updated = { done: true, result: null };
      STORE.set('readiness_action_'+TODAY_STR, updated);
      setReadinessAction(updated);
      return;
    }

    if (action.id === "swap" && action.swapWith) {
      // Échanger les dates des deux séances
      const sessionA = { ...todaySession,    date: action.swapWith.date };
      const sessionB = { ...action.swapWith, date: todaySession.date };
      await savePlanned(sessionA);
      await savePlanned(sessionB);
      setPlanned(prev => prev.map(p => {
        if (p.id === sessionA.id) return sessionA;
        if (p.id === sessionB.id) return sessionB;
        return p;
      }));
      const swapResult = { done: true, result: `✓ Séances échangées — ${sessionB.type} déplacé au ${fmtDate(sessionB.date, {weekday:"long", day:"numeric"})}` };
      STORE.set('readiness_action_'+TODAY_STR, swapResult);
      setReadinessAction(swapResult);
    }

    if (action.id === "postpone") {
      // Déplacer la séance au lendemain
      const tomorrow = addDays(TODAY_STR, 1);
      const updated = { ...todaySession, date: tomorrow };
      await savePlanned(updated);
      setPlanned(prev => prev.map(p => p.id === updated.id ? updated : p));
      const postponeResult = { done: true, result: `✓ Séance reportée au ${fmtDate(tomorrow, {weekday:"long", day:"numeric"})}` };
      STORE.set('readiness_action_'+TODAY_STR, postponeResult);
      setReadinessAction(postponeResult);
    }

    if (action.id === "reduce" && action.reduced) {
      // Réduire le volume de la séance du jour
      const updated = { ...action.reduced };
      await savePlanned(updated);
      setPlanned(prev => prev.map(p => p.id === updated.id ? updated : p));
      const reduceResult = { done: true, result: `✓ Volume réduit — ${updated.targetDist}km · ${updated.targetDur}min` };
      STORE.set('readiness_action_'+TODAY_STR, reduceResult);
      setReadinessAction(reduceResult);
    }
  }

  async function applyWeekAdjustments(sessions) {
    // Applique les ajustements adaptatifs aux séances restantes
    for (const s of sessions) {
      if (!s.needsAdjust) continue;
      const newDur = Math.round(s.idealDist * (
        s.type === "Sortie longue" ? planConfig.paces.sl :
        s.type === "Endurance fondamentale" ? planConfig.paces.ef :
        planConfig.paces.tempo
      ));
      const updated = { ...s, targetDist: s.idealDist, targetDur: newDur };
      await savePlanned(updated);
      setPlanned(prev => prev.map(p => p.id === updated.id ? updated : p));
    }
    STORE.set('week_adjust_' + wkKey(TODAY_STR), true);
    setWeekAdjustDismissed(true);
    setWeekAdjustModal(null);
  }

  async function applyMove() {
    if (!moveModal) return;
    const { session, mode } = moveModal;

    if (mode === "move" && moveDate) {
      // Déplacer à une date précise
      const updated = { ...session, date: moveDate };
      await savePlanned(updated);
      setPlanned(prev => prev.map(p => p.id === updated.id ? updated : p));
      setMoveModal(null);
      return;
    }

    if (mode === "swap" && moveTargetId) {
      // Échanger avec une autre séance
      const target = planned.find(p => p.id === moveTargetId);
      if (!target) return;
      const sA = { ...session, date: target.date };
      const sB = { ...target, date: session.date };
      await savePlanned(sA);
      await savePlanned(sB);
      setPlanned(prev => prev.map(p => {
        if (p.id === sA.id) return sA;
        if (p.id === sB.id) return sB;
        return p;
      }));
      setMoveModal(null);
    }
  }

  async function askCoach(userMessage=null){
    setCoachLoading(true);
    const context=buildCoachContext();
    const isWeekly=!userMessage;

    const bilanPrompt = `${context}

BILAN DEMANDÉ — réponds en 4 points courts (1-2 phrases chacun, max) :
1. SEMAINE : résumé en 1 phrase (volume, qualité, tendance)
2. SÉANCE DU JOUR : analyse si réalisée, sinon conseil pour celle prévue avec allures précises
3. ALERTE : mentionne uniquement si protection score < 60 ou ACWR > 1.3, sinon passe
4. PROCHAINE SÉANCE : type, distance, allure cible en min/km

Format : utilise ces 4 titres en majuscules, sois direct, pas d'intro ni de conclusion.`;

    const messages = isWeekly
      ? [{ role:"user", content: bilanPrompt }]
      : [
          { role:"user", content: context },
          { role:"assistant", content: "Compris, je connais ton profil. Pose ta question." },
          ...chatHistory.flatMap(m=>[
            {role:"user", content:m.user},
            {role:"assistant", content:m.coach}
          ]),
          { role:"user", content: userMessage }
        ];

    try {
      const resp = await fetch("/api/coach",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          model:"claude-sonnet-4-20250514",
          max_tokens:1000,
          messages,
        })
      });
      const data=await resp.json();
      const reply=data.content?.[0]?.text||"Erreur de réponse.";

      if(isWeekly){
        setCoachMsg(reply);
        setCoachDate(TODAY_STR);
        STORE.set("coach_msg",reply);
        STORE.set("coach_date",TODAY_STR);
      } else {
        const newHistory=[...chatHistory,{user:userMessage,coach:reply}].slice(-10);
        setChatHistory(newHistory);
        STORE.set("coach_chat",newHistory);
        setCoachMsg(reply);
      }
    } catch(e){
      setCoachMsg("Erreur de connexion à l'IA. Vérifie ta connexion.");
    }
    setCoachLoading(false);
  }

  async function sendChat(){
    if(!chatInput.trim()) return;
    const msg=chatInput; setChatInput("");
    await askCoach(msg);
  }

  const weeklyVol=useMemo(()=>{
    const weeks={};
    done.forEach(r=>{
      const wk=wkKey(r.date);
      if(!weeks[wk]) weeks[wk]={dist:0,dur:0,rpe:[]};
      weeks[wk].dist+=r.dist; weeks[wk].dur+=r.dur; weeks[wk].rpe.push(r.rpe||5);
    });
    return Object.entries(weeks).sort(([a],[b])=>b.localeCompare(a)).slice(0,8)
      .map(([wk,d])=>({wk,...d,load:d.dist*(d.rpe.reduce((s,v)=>s+v,0)/d.rpe.length)}));
  },[done]);

  // ACWR unifié : charge aiguë (7j) / charge chronique (moyenne 4×7j) — même calcul que protection score
  const acuteLoadMain = done
    .filter(r => r.date >= addDays(TODAY_STR, -7))
    .reduce((s, r) => s + r.dist * (r.rpe || 5), 0);
  const weeks4Main = [0,1,2,3].map(i =>
    done.filter(r => r.date >= addDays(TODAY_STR, -(i+1)*7) && r.date < addDays(TODAY_STR, -i*7))
        .reduce((s, r) => s + r.dist * (r.rpe || 5), 0)
  );
  const chronicLoadMain = weeks4Main.reduce((s, v) => s + v, 0) / 4;
  const acwr = chronicLoadMain > 0 ? acuteLoadMain / chronicLoadMain : 1;
  const totalKm  = done.reduce((s,r)=>s+r.dist,0);
  const acwrStatus = acwr>1.3?{label:"RISQUE ÉLEVÉ",color:"#FF6B6B"}:acwr>1.15?{label:"CHARGE MODÉRÉE",color:"#FF9F43"}:{label:"OPTIMAL",color:"#4ECDC4"};

  const volumeData=useMemo(()=>{
    const sel=PERIODS.find(p=>p.key===volPeriod);
    const cutoffDate=sel.days?addDays(TODAY_STR,-sel.days):null;
    const cutoffWk=cutoffDate?wkKey(cutoffDate):null;
    const todayWk=wkKey(TODAY_STR);
    const weeks={};
    done.forEach(r=>{
      const wk=wkKey(r.date);
      if(cutoffWk&&wk<cutoffWk) return;
      if(!weeks[wk]) weeks[wk]={dist:0,dur:0,rpe:[],runs:0};
      weeks[wk].dist+=r.dist; weeks[wk].dur+=r.dur; weeks[wk].rpe.push(r.rpe||5); weeks[wk].runs++;
    });
    if(cutoffWk){
      let cur=cutoffWk;
      while(cur<=todayWk){if(!weeks[cur]) weeks[cur]={dist:0,dur:0,rpe:[5],runs:0}; cur=addDays(cur,7);}
    }
    return Object.entries(weeks).sort(([a],[b])=>a.localeCompare(b)).map(([wk,d])=>{
      const avgRpe=d.rpe.length?d.rpe.reduce((s,v)=>s+v,0)/d.rpe.length:5;
      const dist=Math.round(d.dist*10)/10, dur=Math.round(d.dur), load=Math.round(d.dist*avgRpe);
      const [,mm,dd]=wk.split('-');
      return {wk,dist,dur,load,label:`${parseInt(dd)}/${parseInt(mm)}`,value:volMetric==='km'?dist:volMetric==='time'?dur:load};
    });
  },[done,volPeriod,volMetric]);

  // Volume hebdomadaire PRÉVU (séances planifiées futures)
  const plannedVolumeData = useMemo(() => {
    const weeks = {};
    planned.forEach(p => {
      if (!p.targetDist) return;
      const wk = wkKey(p.date);
      if (!weeks[wk]) weeks[wk] = { dist: 0, count: 0 };
      weeks[wk].dist += p.targetDist;
      weeks[wk].count++;
    });
    // Trier et formater comme Chart attend
    return Object.entries(weeks)
      .sort(([a],[b]) => a.localeCompare(b))
      .slice(0, 20) // max 20 semaines
      .map(([wk, d]) => {
        const [,mm,dd] = wk.split('-');
        const isCurrentWk = wkKey(TODAY_STR) === wk;
        return {
          wk,
          dist: Math.round(d.dist * 10) / 10,
          count: d.count,
          label: isCurrentWk ? 'Auj.' : `${parseInt(dd)}/${parseInt(mm)}`,
          value: Math.round(d.dist * 10) / 10,
        };
      });
  }, [planned]);

  const paceData=useMemo(()=>{
    const sel=PERIODS.find(p=>p.key===pacePeriod);
    const cutoff=sel?.days?addDays(TODAY_STR,-sel.days):null;
    return [...done].filter(r=>{
      if(r.type!=="Endurance fondamentale"&&r.type!=="Endurance") return false;
      if(r.dist<5) return false;
      if(cutoff&&parseDate(r.date)<parseDate(cutoff)) return false;
      return true;
    }).sort((a,b)=>a.date.localeCompare(b.date))
      .map(r=>({date:r.date,value:Math.round((r.dur*60)/r.dist),label:fmtDate(r.date,{day:"numeric",month:"numeric"})}));
  },[done,pacePeriod]);

  const varietyData=useMemo(()=>{
    const sel=VARIETY_PERIODS.find(p=>p.key===varPeriod);
    const cutoff=sel?.days?addDays(TODAY_STR,-sel.days):null;
    const filtered=done.filter(r=>!cutoff||parseDate(r.date)>=parseDate(cutoff));
    const counts={};
    filtered.forEach(r=>{ if(!counts[r.type]) counts[r.type]={runs:0,km:0}; counts[r.type].runs++; counts[r.type].km+=r.dist; });
    return counts;
  },[done,varPeriod]);

  const [planForm,setPlanForm]=useState({date:TODAY_STR,type:"Endurance fondamentale",targetDist:"",targetDur:"",targetHR:"",notes:""});
  const [logForm, setLogForm] =useState({date:TODAY_STR,plannedId:"",type:"Endurance fondamentale",dist:"",dur:"",hr:"",rpe:"6",feeling:"3",notes:""});

  async function addPlanned(){
    const p={id:"p"+Date.now(),...planForm,targetDist:+planForm.targetDist,targetDur:+planForm.targetDur,targetHR:planForm.targetHR?+planForm.targetHR:null};
    await savePlanned(p); setPlanned(prev=>[...prev,p]); setModal(null);
  }
  function logSession(prefill=null){
    setLogForm(prefill
      ?{date:prefill.date,plannedId:prefill.id,type:prefill.type,dist:String(prefill.targetDist),dur:String(prefill.targetDur),hr:prefill.targetHR?String(prefill.targetHR):"",rpe:"6",feeling:"3",notes:""}
      :{date:TODAY_STR,plannedId:"",type:"Endurance fondamentale",dist:"",dur:"",hr:"",rpe:"6",feeling:"3",notes:""});
    setModal({type:"log"});
  }
  async function submitDebrief() {
    if (!stravaDebriefModal) return;
    const { stravaSession } = stravaDebriefModal;
    // Mettre à jour uniquement rpe, feeling, notes — dist/dur/hr restent depuis Strava
    const updated = {
      ...stravaSession,
      rpe: parseInt(debriefForm.rpe),
      feeling: parseInt(debriefForm.feeling),
      notes: debriefForm.notes || stravaSession.notes,
    };
    await saveDone(updated);
    setDone(prev => prev.map(r => r.id === updated.id ? updated : r));
    STORE.set("debriefed_"+stravaSession.id, true);
    setStravaDebriefModal(null);
  }

  async function submitLog(){
    const r={id:"d"+Date.now(),...logForm,dist:+logForm.dist,dur:+logForm.dur,hr:logForm.hr?+logForm.hr:null,rpe:+logForm.rpe,feeling:+logForm.feeling};
    await saveDone(r); setDone(prev=>[...prev,r]); setModal(null);
  }
  function openEditPlanned(p) {
    setEditPlannedForm({
      id: p.id, date: p.date, generated: p.generated,
      type: p.type,
      targetDist: String(p.targetDist),
      targetDur: String(p.targetDur),
      targetHR: p.targetHR ? String(p.targetHR) : "",
      notes: p.notes || "",
    });
    setModal({ type: "editPlanned" });
  }

  function openEdit(r){
    setEditForm({...r,dist:String(r.dist),dur:String(r.dur),hr:r.hr?String(r.hr):"",rpe:String(r.rpe||6),feeling:String(r.feeling||3)});
    setModal({type:"edit"});
  }
  async function submitEdit(){
    const u={...editForm,dist:+editForm.dist,dur:+editForm.dur,hr:editForm.hr?+editForm.hr:null,rpe:+editForm.rpe,feeling:+editForm.feeling};
    await saveDone(u); setDone(prev=>prev.map(r=>r.id===u.id?u:r)); setModal(null);
  }

  const selVolMetric=METRICS.find(m=>m.key===volMetric);
  const varietyScore=Object.keys(varietyData).filter(t=>t!=="Footing").length;
  const todayPlanned=planned.filter(p=>p.date===TODAY_STR);
  const upcoming=planned.filter(p=>isFuture(p.date)).sort((a,b)=>a.date.localeCompare(b.date));

  function fmtVol(v){
    if(volMetric==='km') return `${v}km`;
    if(volMetric==='time') return `${Math.floor(v/60)}h${String(v%60).padStart(2,'0')}`;
    return `${v}`;
  }
  function fmtPaceVal(v){ const m=Math.floor(v/60),s=Math.round(v%60); return `${m}'${String(s).padStart(2,'0')}"`; }

  const weekCompare=useMemo(()=>{
    const curWk=wkKey(TODAY_STR);
    const wkPlanned=planned.filter(p=>wkKey(p.date)===curWk);
    const wkDone=done.filter(d=>wkKey(d.date)===curWk);
    const plannedKm=wkPlanned.reduce((s,p)=>s+p.targetDist,0);
    const doneKm=wkDone.reduce((s,d)=>s+d.dist,0);
    const completion=plannedKm>0?Math.round(doneKm/plannedKm*100):null;

    // ── Calcul adaptatif ──────────────────────────────────────────────
    const targetKm = planConfig.targetWeeklyKm || 42;
    const remainingKm = Math.max(0, targetKm - doneKm);

    // Séances restantes (non faites, futures ou aujourd'hui)
    const remaining = wkPlanned.filter(p => {
      const linked = wkDone.find(d => d.plannedId === p.id || (d.date === p.date && d.fromStrava));
      return !linked && p.date >= TODAY_STR;
    }).sort((a,b) => a.date.localeCompare(b.date));

    // Classer les séances restantes par type
    const QUALITY_TYPES = ["Fractionné / VMA", "Tempo / Seuil", "Évaluation VMA"];
    const SL_TYPE = "Sortie longue";

    // Km de qualité déjà faits + restants prévus
    const doneQualKm = wkDone
      .filter(d => QUALITY_TYPES.includes(d.type))
      .reduce((s,d) => s+d.dist, 0);
    const plannedQualKm = remaining
      .filter(p => QUALITY_TYPES.includes(p.type))
      .reduce((s,p) => s+p.targetDist, 0);
    const totalQualKm = doneQualKm + plannedQualKm;

    // Ratio qualité cible : max 25% du volume total
    const maxQualRatio = 0.20; // max 20% qualité
    const qualBudget = Math.min(totalQualKm, targetKm * maxQualRatio);

    // Volume EF+Footing restant budgété
    const easyBudget = remainingKm - Math.max(0, qualBudget - doneQualKm);

    // Calcul distance idéale pour chaque séance restante
    const adaptedSessions = remaining.map(p => {
      const isSL = p.type === SL_TYPE;
      const isQual = QUALITY_TYPES.includes(p.type);
      const isEF = !isSL && !isQual;

      // Nombre de séances EF restantes
      const nEFRemaining = remaining.filter(s => !QUALITY_TYPES.includes(s.type) && s.type !== SL_TYPE).length;
      const nSLRemaining = remaining.filter(s => s.type === SL_TYPE).length;

      let idealDist = p.targetDist;

      if (isSL && nSLRemaining > 0) {
        // SL = 30% du volume total cible
        const slTarget = targetKm * 0.30;
        idealDist = Math.round(slTarget * 10) / 10;
      } else if (isEF && nEFRemaining > 0) {
        // EF = volume restant (hors qualité et SL) / nb séances EF restantes
        const slRemKm = remaining.filter(s=>s.type===SL_TYPE).reduce((s,p)=>s+p.targetDist*0.30/0.28,0);
        const efBudget = remainingKm - Math.max(0, qualBudget - doneQualKm) - (nSLRemaining * targetKm * 0.30);
        idealDist = Math.max(4, Math.round((efBudget / nEFRemaining) * 10) / 10);
      } else if (isQual) {
        idealDist = p.targetDist; // Qualité on ne touche pas (déjà calculée par le générateur)
      }

      const delta = idealDist - p.targetDist;
      const deltaPct = p.targetDist > 0 ? (delta / p.targetDist) * 100 : 0;
      const isAlert = Math.abs(deltaPct) >= 20;
      const needsAdjust = Math.abs(delta) >= 0.5;

      return { ...p, idealDist, delta, deltaPct, isAlert, needsAdjust };
    });

    // Y a-t-il des ajustements significatifs ?
    const hasAdjustments = adaptedSessions.some(s => s.needsAdjust);
    const hasAlerts = adaptedSessions.some(s => s.isAlert);

    // Ratio qualité actuel
    const qualRatio = targetKm > 0 ? Math.round((totalQualKm / targetKm) * 100) : 0;

    return {
      planned:wkPlanned, done:wkDone, plannedKm, doneKm, completion,
      // Adaptatif
      targetKm, remainingKm, adaptedSessions,
      hasAdjustments, hasAlerts, qualRatio,
    };
  },[planned,done,planConfig]);

  // VMA calculée pour le badge header
  const computedVMA = useMemo(() => computeVMA(done), [done]);

  const protectionScore = useMemo(() => {
    const readiness = checkInSaved
      ? (checkIn.readiness ?? (checkIn.hrv || checkIn.recovery ? calcReadiness(checkIn.hrv, checkIn.recovery, checkIn.feeling) : null))
      : null;
    return computeProtectionScore({ done, readiness, weeklyVol });
  }, [done, checkIn, checkInSaved, weeklyVol]);
  const displayVMA = computedVMA?.finalVMA ?? planConfig.vma;
  const vmaDiff = computedVMA ? Math.abs(displayVMA - planConfig.vma) : 0;
  const vmaChanged = vmaDiff >= 0.2;

  const css=`
    @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=JetBrains+Mono:wght@300;400;500&display=swap');
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{background:#080A0E}
    ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:#222}
    .card{background:#0F1117;border:1px solid #1C1F27;border-radius:14px}
    .nav-tab{transition:all .2s;border:none;cursor:pointer;font-family:inherit}
    .btn-primary{transition:all .2s;border:none;cursor:pointer;font-family:inherit}
    .btn-primary:hover{opacity:.85;transform:scale(.98)}
    .btn-ghost{transition:all .2s;background:transparent;border:1px solid #222;cursor:pointer;font-family:inherit;color:#888}
    .btn-ghost:hover{border-color:#444;color:#ccc}
    .inp{background:#080A0E;border:1px solid #1C1F27;color:#E8E4DC;border-radius:8px;padding:10px 12px;font-size:13px;font-family:'JetBrains Mono',monospace;width:100%;outline:none;transition:border .2s}
    .inp:focus{border-color:#444}
    @keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
    .fade-up{animation:fadeUp .35s ease forwards}
    @keyframes pop{0%{transform:scale(.95);opacity:0}100%{transform:scale(1);opacity:1}}
    .pop{animation:pop .2s ease forwards}
    @keyframes popUp{0%{transform:translateY(30px);opacity:0}100%{transform:translateY(0);opacity:1}}
    .pill{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:20px;font-size:11px;font-family:'JetBrains Mono',monospace}
    .score-ring{transition:stroke-dashoffset 1s ease}
    @keyframes spin{to{transform:rotate(360deg)}}
    .spin{animation:spin 1s linear infinite;display:inline-block}
    .type-btn{transition:all .15s;border:2px solid transparent;cursor:pointer;border-radius:10px;padding:8px 4px;background:transparent;font-family:'JetBrains Mono',monospace;font-size:9px;flex:1;text-align:center;line-height:1.3}
    .seg-btn{transition:all .15s;border:none;cursor:pointer;font-family:'JetBrains Mono',monospace;font-size:10px;padding:5px 8px;border-radius:6px;letter-spacing:.5px}
    .smooth-btn{transition:all .15s;border:1px solid #222;cursor:pointer;font-family:'JetBrains Mono',monospace;font-size:9px;padding:4px 8px;border-radius:6px;background:transparent;color:#888}
    .smooth-btn.active{border-color:#555;color:#E8E4DC;background:#1C1F27}
    .chat-inp{background:#080A0E;border:1px solid #1C1F27;color:#E8E4DC;border-radius:12px;padding:12px 14px;font-size:13px;font-family:'JetBrains Mono',monospace;width:100%;outline:none;resize:none}
    .chat-inp:focus{border-color:#333}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
    .pulse{animation:pulse 1.5s ease-in-out infinite}
    .vma-badge{transition:all .2s;cursor:pointer}
    .vma-badge:hover{opacity:.8;transform:scale(.97)}
  `;

  if(loading) return (
    <div style={{minHeight:"100vh",background:"#080A0E",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16}}>
      <style>{css}</style>
      <div className="spin" style={{fontSize:32,color:"#E8E4DC"}}>↻</div>
      <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:"#555",letterSpacing:2}}>CHARGEMENT...</div>
    </div>
  );

  return (
    <div style={{minHeight:"100vh",background:"#080A0E",fontFamily:"'Syne',sans-serif",color:"#E8E4DC",maxWidth:480,margin:"0 auto",paddingBottom:`calc(84px + env(safe-area-inset-bottom, 16px))`}}>
      <style>{css}</style>

      {/* TOP */}
      <div style={{padding:`calc(env(safe-area-inset-top, 0px) + 20px) 20px 0`,display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
        <div>
          <div style={{fontSize:11,color:"#555",letterSpacing:3,fontFamily:"'JetBrains Mono',monospace"}}>MARATHON DE LILLE</div>
          <div style={{fontSize:28,fontWeight:800,letterSpacing:-1,marginTop:2}}>
            {DAYS_LEFT}<span style={{fontSize:14,color:"#555",fontWeight:400,marginLeft:4}}>jours</span>
            <span style={{fontSize:14,color:"#333",margin:"0 6px"}}>·</span>
            {WEEKS_LEFT}<span style={{fontSize:14,color:"#555",fontWeight:400,marginLeft:4}}>sem.</span>
          </div>
          <div style={{fontSize:10,color:"#333",fontFamily:"'JetBrains Mono',monospace",marginTop:2,letterSpacing:1}}>25 OCT 2026</div>
        </div>

        {/* BADGES HEADER */}
        <div style={{display:"flex",gap:6,alignItems:"flex-start"}}>

        {/* READINESS BADGE */}
        {checkInSaved && (()=>{
          const r = checkIn.readiness ?? calcReadiness(checkIn.hrv, checkIn.recovery, checkIn.feeling);
          const rc = r >= 85 ? "#4ECDC4" : r >= 65 ? "#6BF178" : r >= 45 ? "#FF9F43" : "#FF6B6B";
          const rl = r >= 85 ? "TOP" : r >= 65 ? "BON" : r >= 45 ? "MOY." : "BAS";
          return (
            <div style={{background:"#0F1117",border:`1px solid ${rc}33`,borderRadius:14,padding:"10px 12px",textAlign:"center",width:72,cursor:"pointer",flexShrink:0}}
              onClick={()=>setView("today")}>
              <div style={{fontSize:8,color:"#555",letterSpacing:1,fontFamily:"'JetBrains Mono',monospace",marginBottom:4}}>READY</div>
              <div style={{fontSize:20,fontWeight:800,color:rc,letterSpacing:-1,lineHeight:1}}>{r}</div>
              <div style={{fontSize:8,color:rc,fontFamily:"'JetBrains Mono',monospace",marginTop:3}}>{rl}</div>
            </div>
          );
        })()}

        {/* VMA BADGE — cliquable */}
        <div className="vma-badge" onClick={() => setShowVMA(true)}
          style={{position:"relative",background:vmaChanged?"linear-gradient(135deg,#001a24,#00D2FF18)":"#0F1117",border:`1px solid ${vmaChanged?"#00D2FF55":"#1C1F27"}`,borderRadius:14,padding:"10px 12px",textAlign:"center",width:72,flexShrink:0}}>

          <div style={{fontSize:8,color:"#555",letterSpacing:1,fontFamily:"'JetBrains Mono',monospace",marginBottom:4}}>VMA</div>
          <div style={{fontSize:20,fontWeight:800,color:vmaChanged?"#00D2FF":"#E8E4DC",letterSpacing:-1,lineHeight:1}}>{displayVMA.toFixed(1)}</div>
          <div style={{fontSize:8,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginTop:3}}>km/h</div>
        </div>
        </div>{/* fin badges header */}
      </div>







      <div style={{padding:"20px 20px 0"}}>

        {/* ═══ TODAY ═══ */}
        {view==="today" && (
          <div className="fade-up">

            {/* ── CHECK-IN MATIN ── */}
            {(()=>{
              const readiness = checkInSaved && !checkInEditing
                ? (checkIn.readiness ?? calcReadiness(checkIn.hrv, checkIn.recovery, checkIn.feeling))
                : (checkIn.hrv || checkIn.recovery || checkIn.feeling !== null)
                  ? calcReadiness(checkIn.hrv, checkIn.recovery, checkIn.feeling) : null;
              const reco = readiness !== null
                ? getReadinessReco(readiness, checkIn.hrv, todayPlanned[0]?.type) : null;
              const rc = readiness === null ? "#555"
                : readiness >= 85 ? "#4ECDC4"
                : readiness >= 65 ? "#6BF178"
                : readiness >= 45 ? "#FF9F43" : "#FF6B6B";
              const rl = readiness === null ? "—"
                : readiness >= 85 ? "EXCELLENT"
                : readiness >= 65 ? "BON"
                : readiness >= 45 ? "MODÉRÉ" : "FATIGUE";
              const feelEmoji = checkIn.feeling === 0 ? "🟢" : checkIn.feeling === 1 ? "🟡" : checkIn.feeling === 2 ? "🔴" : null;

              // Mode réduit après sauvegarde
              if (checkInSaved && !checkInEditing) return (
                <div className="card" style={{padding:"16px 20px",marginBottom:14,background:"linear-gradient(135deg,#0F1117,#0d1a0f)",border:`1px solid ${rc}22`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div style={{display:"flex",alignItems:"center",gap:14}}>
                      <div>
                        <div style={{fontSize:36,fontWeight:800,color:rc,lineHeight:1}}>{readiness}</div>
                        <div style={{fontSize:8,color:rc,fontFamily:"'JetBrains Mono',monospace",letterSpacing:1,marginTop:2}}>{rl}</div>
                      </div>
                      <div>
                        <div style={{fontSize:10,color:"#6BF178",letterSpacing:2,fontFamily:"'JetBrains Mono',monospace",marginBottom:4}}>🌅 READINESS</div>
                        <div style={{display:"flex",gap:8,fontSize:11,fontFamily:"'JetBrains Mono',monospace",color:"#888"}}>
                          {checkIn.hrv && <span>VFC <span style={{color:"#E8E4DC"}}>{checkIn.hrv}ms</span></span>}
                          {checkIn.recovery && <span>Récup <span style={{color:"#E8E4DC"}}>{checkIn.recovery}%</span></span>}
                          {feelEmoji && <span>{feelEmoji}</span>}
                        </div>
                        {reco && <div style={{fontSize:11,color:"#666",fontFamily:"'JetBrains Mono',monospace",marginTop:4,maxWidth:220,lineHeight:1.5}}>{reco}</div>}
                      </div>
                    </div>
                    <button onClick={()=>setCheckInEditing(true)} className="btn-ghost"
                      style={{borderRadius:8,padding:"6px 10px",fontSize:10,fontFamily:"'JetBrains Mono',monospace",flexShrink:0}}>
                      ✎ MODIFIER
                    </button>
                  </div>
                </div>
              );

              // Mode saisie
              return (
                <div className="card" style={{padding:20,marginBottom:14,background:"linear-gradient(135deg,#0F1117,#0d1a0f)",border:"1px solid #6BF17822"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                    <div>
                      <div style={{fontSize:10,color:"#6BF178",letterSpacing:3,fontFamily:"'JetBrains Mono',monospace"}}>🌅 CHECK-IN MATIN</div>
                      <div style={{fontSize:11,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginTop:2}}>Comment tu démarres ?</div>
                    </div>
                    {readiness !== null && (
                      <div style={{textAlign:"center"}}>
                        <div style={{fontSize:28,fontWeight:800,color:rc,lineHeight:1}}>{readiness}</div>
                        <div style={{fontSize:8,color:rc,fontFamily:"'JetBrains Mono',monospace",letterSpacing:1}}>{rl}</div>
                      </div>
                    )}
                  </div>

                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
                    <div>
                      <div style={{fontSize:9,color:"#555",letterSpacing:2,fontFamily:"'JetBrains Mono',monospace",marginBottom:6}}>VFC BEVEL (ms)</div>
                      <input type="number" className="inp" placeholder="ex: 82" value={checkIn.hrv}
                        onChange={e=>setCheckIn(c=>({...c, hrv:e.target.value}))}
                        style={{borderColor: checkIn.hrv ? "#6BF17844" : "#1C1F27"}}/>
                    </div>
                    <div>
                      <div style={{fontSize:9,color:"#555",letterSpacing:2,fontFamily:"'JetBrains Mono',monospace",marginBottom:6}}>RÉCUP BEVEL (%)</div>
                      <input type="number" className="inp" placeholder="ex: 78" value={checkIn.recovery}
                        onChange={e=>setCheckIn(c=>({...c, recovery:e.target.value}))}
                        style={{borderColor: checkIn.recovery ? "#6BF17844" : "#1C1F27"}}/>
                    </div>
                  </div>

                  <div style={{marginBottom:14}}>
                    <div style={{fontSize:9,color:"#555",letterSpacing:2,fontFamily:"'JetBrains Mono',monospace",marginBottom:8}}>SENSATION GÉNÉRALE</div>
                    <div style={{display:"flex",gap:8}}>
                      {[{idx:0,emoji:"🟢",label:"FRAIS",color:"#4ECDC4"},{idx:1,emoji:"🟡",label:"CORRECT",color:"#FFE66D"},{idx:2,emoji:"🔴",label:"FATIGUÉ",color:"#FF6B6B"}].map(({idx,emoji,label,color})=>(
                        <button key={idx} onClick={()=>setCheckIn(c=>({...c, feeling:idx}))}
                          style={{flex:1,border:`2px solid ${checkIn.feeling===idx?color:"#1C1F27"}`,background:checkIn.feeling===idx?color+"22":"transparent",borderRadius:10,padding:"10px 4px",cursor:"pointer",fontFamily:"'JetBrains Mono',monospace",textAlign:"center"}}>
                          <div style={{fontSize:18,marginBottom:4}}>{emoji}</div>
                          <div style={{fontSize:9,color:checkIn.feeling===idx?color:"#555",letterSpacing:1}}>{label}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {reco && (
                    <div style={{padding:"12px 14px",background:"#080A0E",borderRadius:10,border:`1px solid ${rc}33`,marginBottom:12,fontSize:12,color:"#ccc",fontFamily:"'JetBrains Mono',monospace",lineHeight:1.7}}>
                      {reco}
                    </div>
                  )}

                  <div style={{display:"flex",gap:8}}>
                    {checkInEditing && (
                      <button onClick={()=>setCheckInEditing(false)} className="btn-ghost"
                        style={{flex:1,borderRadius:10,padding:"10px",fontSize:12,fontFamily:"'JetBrains Mono',monospace"}}>
                        ANNULER
                      </button>
                    )}
                    <button onClick={()=>saveCheckIn({...checkIn})}
                      style={{flex:2,background:"#6BF178",color:"#080A0E",border:"none",borderRadius:10,padding:"10px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"'JetBrains Mono',monospace"}}>
                      SAUVEGARDER ✓
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* ── READINESS ADVISOR ── */}
            {(()=>{
              if (!checkInSaved) return null;
              const readiness = checkIn.readiness ?? calcReadiness(checkIn.hrv, checkIn.recovery, checkIn.feeling);
              const curWk = wkKey(TODAY_STR);
              const weekPlanned = planned.filter(p => wkKey(p.date) === curWk);
              const todayUnlinked = todayPlanned.filter(p => !done.find(d => d.plannedId === p.id));
              if (todayUnlinked.length === 0) return null;

              const todaySession = todayUnlinked[0];
              const advice = readinessAction?.done
                ? null
                : getReadinessAdvice(readiness, todaySession, weekPlanned, done);

              if (!advice && !readinessAction?.done) return null;

              // Résultat après action
              if (readinessAction?.done) return (
                <div className="card" style={{padding:"14px 18px",marginBottom:14,border:"1px solid #4ECDC433",background:"#0d2b20"}}>
                  <div style={{fontSize:12,color:"#4ECDC4",fontFamily:"'JetBrains Mono',monospace"}}>{readinessAction.result || "✓ Action appliquée"}</div>
                </div>
              );

              return (
                <div className="card" style={{padding:20,marginBottom:14,border:`2px solid ${advice.color}44`,background:`${advice.color}08`}}>
                  {/* Header */}
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
                    <div style={{fontSize:24,flexShrink:0}}>{advice.icon}</div>
                    <div style={{flex:1}}>
                      <div style={{fontSize:13,fontWeight:800,color:advice.color}}>{advice.title}</div>
                      <div style={{fontSize:10,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginTop:1}}>ADAPTATION SUGGÉRÉE</div>
                    </div>
                    <div style={{
                      width:36,height:36,borderRadius:10,
                      background: advice.level==="danger"?"#FF6B6B22":advice.level==="warning"?"#FF9F4322":"#FFE66D22",
                      display:"flex",alignItems:"center",justifyContent:"center",
                      fontSize:14,fontWeight:800,color:advice.color,fontFamily:"'JetBrains Mono',monospace",
                    }}>{readiness}</div>
                  </div>

                  {/* Message */}
                  <div style={{
                    padding:"12px 14px",background:"#080A0E",borderRadius:10,
                    marginBottom:14,fontSize:12,color:"#ccc",
                    fontFamily:"'JetBrains Mono',monospace",lineHeight:1.7,
                    borderLeft:`3px solid ${advice.color}`,
                  }}>
                    {advice.message}
                  </div>

                  {/* Actions */}
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    {advice.actions.map((action, i) => (
                      <button key={action.id+i}
                        onClick={()=>{ setReadinessAction({advice, action}); applyReadinessAction(action, todaySession); }}
                        style={{
                          width:"100%",
                          background: action.primary ? advice.color : action.ghost ? "transparent" : advice.color+"22",
                          color: action.primary ? "#080A0E" : action.ghost ? "#555" : advice.color,
                          border: action.ghost ? "1px solid #1C1F27" : `1px solid ${advice.color}44`,
                          borderRadius:10,padding:"12px 14px",
                          fontSize:11,fontWeight:action.ghost?400:700,
                          cursor:"pointer",fontFamily:"'JetBrains Mono',monospace",
                          display:"flex",alignItems:"center",justifyContent:"center",gap:8,
                          letterSpacing:action.ghost?0:0.5,
                        }}>
                        <span style={{fontSize:14}}>{action.icon}</span>
                        {action.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()}

            {todayPlanned.length===0&&(
              <div className="card" style={{padding:28,textAlign:"center"}}>
                <div style={{fontSize:40,marginBottom:12}}>🏃</div>
                <div style={{fontSize:14,color:"#555",fontFamily:"'JetBrains Mono',monospace"}}>Rien de planifié aujourd'hui</div>
                <button className="btn-primary" onClick={()=>setModal({type:"plan"})} style={{marginTop:16,background:"#E8E4DC",color:"#080A0E",borderRadius:10,padding:"10px 20px",fontSize:12,fontWeight:700}}>Planifier une séance</button>
              </div>
            )}
            {todayPlanned.map(p=>{
              const tm=TYPE_META[p.type]||TYPE_META["Footing"];
              // Chercher par plannedId d'abord, sinon par date (séance Strava non encore liée)
              const linked=done.find(d=>d.plannedId===p.id) || done.find(d=>d.date===p.date&&d.fromStrava&&!d.plannedId);
              const score=linked?scoreSession(p,linked):null;
              return (
                <div key={p.id} className="card" style={{padding:22,marginBottom:14,borderLeft:`3px solid ${tm.color}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
                    <div>
                      <span className="pill" style={{background:tm.dark,color:tm.color,marginBottom:8}}>{tm.icon} {p.type}</span>
                      <div style={{fontSize:22,fontWeight:800}}>{p.targetDist} km</div>
                      <div style={{fontSize:12,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginTop:2}}>~{p.targetDur} min · {p.targetHR?`FC ${p.targetHR} bpm`:"FC libre"}</div>
                      <div style={{fontSize:11,color:tm.color,fontFamily:"'JetBrains Mono',monospace",marginTop:4}}>{tm.desc}</div>
                    </div>
                    {score!==null&&(
                      <div style={{textAlign:"center"}}>
                        <svg width={56} height={56} viewBox="0 0 56 56">
                          <circle cx={28} cy={28} r={22} fill="none" stroke="#1C1F27" strokeWidth={4}/>
                          <circle cx={28} cy={28} r={22} fill="none" stroke={score>79?"#4ECDC4":score>59?"#FFE66D":"#FF6B6B"} strokeWidth={4} strokeLinecap="round" strokeDasharray={138.2} strokeDashoffset={138.2*(1-score/100)} transform="rotate(-90 28 28)" className="score-ring"/>
                          <text x={28} y={32} textAnchor="middle" fill="#E8E4DC" fontSize={13} fontWeight={700} fontFamily="Syne">{score}</text>
                        </svg>
                        <div style={{fontSize:9,color:"#555",fontFamily:"'JetBrains Mono',monospace"}}>SCORE</div>
                      </div>
                    )}
                  </div>
                  {p.notes&&<div style={{fontSize:12,color:"#888",fontFamily:"'JetBrains Mono',monospace",marginBottom:14,padding:"10px 12px",background:"#080A0E",borderRadius:8}}>{p.notes}</div>}
                  {!linked
                    ?<div>
                      {/* Séance non encore importée depuis Strava */}
                      <div style={{padding:"12px 14px",background:"#080A0E",borderRadius:10,marginBottom:10,fontSize:11,color:"#555",fontFamily:"'JetBrains Mono',monospace",lineHeight:1.7,textAlign:"center"}}>
                        ⏳ En attente de l'import Strava...
                      </div>
                      <button className="btn-ghost" onClick={()=>logSession(p)} style={{width:"100%",borderRadius:10,padding:"10px 0",fontSize:11,fontFamily:"'JetBrains Mono',monospace"}}>
                        ✎ Saisir manuellement (sans montre)
                      </button>
                    </div>
                    :<div>
                      <div style={{display:"flex",gap:12,marginBottom:10}}>
                        {[["DIST",`${linked.dist} km`],["DURÉE",`${linked.dur} min`],["ALLURE",pace(linked.dist,linked.dur)]].map(([l,v])=>(
                          <div key={l} style={{flex:1,background:"#080A0E",borderRadius:8,padding:"10px 8px",textAlign:"center"}}>
                            <div style={{fontSize:9,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginBottom:4}}>{l}</div>
                            <div style={{fontSize:15,fontWeight:700}}>{v}</div>
                          </div>
                        ))}
                      </div>
                      <CompareBar planned={p} done={linked}/>
                    </div>
                  }
                </div>
              );
            })}

            <div className="card" style={{padding:20,marginBottom:14}}>
              <div style={{fontSize:10,color:"#555",letterSpacing:3,fontFamily:"'JetBrains Mono',monospace",marginBottom:14}}>SEMAINE EN COURS · PLAN VS RÉEL</div>
              <div style={{display:"flex",gap:10,marginBottom:14}}>
                <div style={{flex:1,background:"#080A0E",borderRadius:10,padding:"12px",textAlign:"center"}}>
                  <div style={{fontSize:9,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginBottom:4}}>PLANIFIÉ</div>
                  <div style={{fontSize:22,fontWeight:800}}>{weekCompare.plannedKm.toFixed(0)}<span style={{fontSize:12,color:"#555"}}>km</span></div>
                  <div style={{fontSize:10,color:"#555",fontFamily:"'JetBrains Mono',monospace"}}>{weekCompare.planned.length} séances</div>
                </div>
                <div style={{flex:1,background:"#080A0E",borderRadius:10,padding:"12px",textAlign:"center"}}>
                  <div style={{fontSize:9,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginBottom:4}}>RÉALISÉ</div>
                  <div style={{fontSize:22,fontWeight:800,color:weekCompare.completion>=90?"#4ECDC4":weekCompare.completion>=60?"#FFE66D":"#FF6B6B"}}>{weekCompare.doneKm.toFixed(0)}<span style={{fontSize:12,color:"#555"}}>km</span></div>
                  <div style={{fontSize:10,color:"#555",fontFamily:"'JetBrains Mono',monospace"}}>{weekCompare.done.length} séances</div>
                </div>
                {weekCompare.completion!==null&&(
                  <div style={{width:64,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
                    <svg width={56} height={56} viewBox="0 0 56 56">
                      <circle cx={28} cy={28} r={22} fill="none" stroke="#1C1F27" strokeWidth={4}/>
                      <circle cx={28} cy={28} r={22} fill="none"
                        stroke={weekCompare.completion>=90?"#4ECDC4":weekCompare.completion>=60?"#FFE66D":"#FF6B6B"}
                        strokeWidth={4} strokeLinecap="round"
                        strokeDasharray={138.2} strokeDashoffset={138.2*(1-Math.min(weekCompare.completion,100)/100)}
                        transform="rotate(-90 28 28)" className="score-ring"/>
                      <text x={28} y={33} textAnchor="middle" fill="#E8E4DC" fontSize={12} fontWeight={700} fontFamily="Syne">{weekCompare.completion}%</text>
                    </svg>
                  </div>
                )}
              </div>
              {weekCompare.plannedKm>0&&(
                <div style={{height:5,background:"#1C1F27",borderRadius:3}}>
                  <div style={{height:5,width:`${Math.min(weekCompare.doneKm/weekCompare.plannedKm*100,100)}%`,background:weekCompare.completion>=90?"#4ECDC4":weekCompare.completion>=60?"#FFE66D":"#FF6B6B",borderRadius:3,transition:"width .8s ease"}}/>
                </div>
              )}
            </div>

            {upcoming.slice(0,3).length>0&&(
              <div style={{marginTop:14}}>
                <div style={{fontSize:10,color:"#555",letterSpacing:3,fontFamily:"'JetBrains Mono',monospace",marginBottom:10}}>PROCHAINES SÉANCES</div>
                {upcoming.slice(0,3).map(p=>{
                  const tm=TYPE_META[p.type]||TYPE_META["Footing"];
                  return (
                    <div key={p.id} className="card" style={{padding:"14px 16px",marginBottom:8,display:"flex",alignItems:"center",gap:14}}>
                      <div style={{width:40,height:40,borderRadius:10,background:tm.dark,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>{tm.icon}</div>
                      <div style={{flex:1}}>
                        <div style={{fontSize:11,color:"#555",fontFamily:"'JetBrains Mono',monospace"}}>{fmtDate(p.date)}</div>
                        <div style={{fontSize:14,fontWeight:700,marginTop:2}}>{p.type} · {p.targetDist} km</div>
                      </div>
                      <div style={{fontSize:11,color:tm.color,fontFamily:"'JetBrains Mono',monospace"}}>{Math.ceil((parseDate(p.date)-TODAY)/86400000)}j →</div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── SEMAINE ADAPTIVE ── */}
            {weekCompare.hasAdjustments && !weekAdjustDismissed && (
              <div className="card" style={{padding:18,marginTop:14,border:`1px solid ${weekCompare.hasAlerts?"#FF9F4344":"#00D2FF33"}`,background:weekCompare.hasAlerts?"#2b1a00":"#001a24"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                  <div>
                    <div style={{fontSize:10,color:weekCompare.hasAlerts?"#FF9F43":"#00D2FF",letterSpacing:3,fontFamily:"'JetBrains Mono',monospace",marginBottom:4}}>
                      {weekCompare.hasAlerts?"⚠ AJUSTEMENT SEMAINE":"◎ AJUSTEMENT SEMAINE"}
                    </div>
                    <div style={{fontSize:13,fontWeight:700,color:"#E8E4DC"}}>
                      {weekCompare.doneKm.toFixed(1)}km faits · objectif {weekCompare.targetKm}km
                    </div>
                    <div style={{fontSize:11,color:"#888",fontFamily:"'JetBrains Mono',monospace",marginTop:2}}>
                      {weekCompare.remainingKm.toFixed(1)}km restants à répartir · qualité {weekCompare.qualRatio}% de la semaine
                    </div>
                  </div>
                </div>
                {/* Liste des ajustements */}
                <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:12}}>
                  {weekCompare.adaptedSessions.filter(s=>s.needsAdjust).map(s=>{
                    const color = s.isAlert?"#FF9F43":"#00D2FF";
                    return (
                      <div key={s.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 12px",background:"#080A0E",borderRadius:8,border:`1px solid ${color}22`}}>
                        <div>
                          <div style={{fontSize:11,color:"#E8E4DC",fontFamily:"'JetBrains Mono',monospace"}}>{s.type.split(' ')[0]} · {s.date}</div>
                          <div style={{fontSize:10,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginTop:2}}>
                            prévu {s.targetDist}km → idéal {s.idealDist}km
                          </div>
                        </div>
                        <div style={{textAlign:"right"}}>
                          <div style={{fontSize:13,fontWeight:700,color}}>{s.delta>0?"+":""}{s.delta.toFixed(1)}km</div>
                          {s.isAlert&&<div style={{fontSize:9,color:"#FF9F43",fontFamily:"'JetBrains Mono',monospace"}}>⚠ +{Math.round(s.deltaPct)}%</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>setWeekAdjustModal({sessions:weekCompare.adaptedSessions.filter(s=>s.needsAdjust)})}
                    style={{flex:2,background:weekCompare.hasAlerts?"#FF9F43":"#00D2FF",color:"#080A0E",border:"none",borderRadius:10,padding:"10px",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"'JetBrains Mono',monospace"}}>
                    APPLIQUER LES AJUSTEMENTS
                  </button>
                  <button onClick={()=>{STORE.set('week_adjust_'+wkKey(TODAY_STR),true);setWeekAdjustDismissed(true);}}
                    style={{flex:1,background:"transparent",border:"1px solid #333",color:"#555",borderRadius:10,padding:"10px",fontSize:11,cursor:"pointer",fontFamily:"'JetBrains Mono',monospace"}}>
                    IGNORER
                  </button>
                </div>
              </div>
            )}

            {/* ── PROTECTION SCORE ── */}
            <div className="card" onClick={()=>setShowProtectionDetail(true)} style={{padding:20,marginTop:14,border:`1px solid ${protectionScore.level.color}33`,background:`${protectionScore.level.bg}`,cursor:"pointer"}}>
              {/* Header */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
                <div>
                  <div style={{fontSize:10,color:protectionScore.level.color,letterSpacing:3,fontFamily:"'JetBrains Mono',monospace",marginBottom:4}}>
                    {protectionScore.level.icon} PROTECTION BLESSURE
                  </div>
                  <div style={{fontSize:22,fontWeight:800,color:protectionScore.level.color}}>{protectionScore.level.label}</div>
                  <div style={{fontSize:10,color:protectionScore.level.color+"88",fontFamily:"'JetBrains Mono',monospace",marginTop:4}}>Appuyer pour le détail →</div>
                </div>
                <div style={{textAlign:"center"}}>
                  <div style={{fontSize:44,fontWeight:800,color:protectionScore.level.color,lineHeight:1,letterSpacing:-2}}>{protectionScore.total}</div>
                  <div style={{fontSize:9,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginTop:2}}>/100</div>
                </div>
              </div>

              {/* Barre globale */}
              <div style={{height:6,background:"#1C1F27",borderRadius:3,marginBottom:16,overflow:"hidden"}}>
                <div style={{height:"100%",width:`${protectionScore.total}%`,background:`linear-gradient(90deg,${protectionScore.level.color}88,${protectionScore.level.color})`,borderRadius:3,transition:"width 1s ease"}}/>
              </div>

              {/* Signaux détaillés */}
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {protectionScore.signals.map(sig => (
                  <div key={sig.key}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                      <span style={{fontSize:10,color:"#888",fontFamily:"'JetBrains Mono',monospace"}}>{sig.label}</span>
                      <div style={{display:"flex",gap:8,alignItems:"center"}}>
                        <span style={{fontSize:9,color:"#555",fontFamily:"'JetBrains Mono',monospace"}}>{sig.value}</span>
                        <span style={{fontSize:10,fontWeight:700,fontFamily:"'JetBrains Mono',monospace",color:sig.score>=75?"#4ECDC4":sig.score>=50?"#FF9F43":"#FF6B6B",minWidth:28,textAlign:"right"}}>{sig.score}</span>
                      </div>
                    </div>
                    <div style={{height:3,background:"#1C1F27",borderRadius:2,overflow:"hidden"}}>
                      <div style={{height:"100%",width:`${sig.score}%`,background:sig.score>=75?"#4ECDC4":sig.score>=50?"#FF9F43":"#FF6B6B",borderRadius:2,transition:"width 0.8s ease"}}/>
                    </div>
                  </div>
                ))}
              </div>

              {/* Message si check-in pas fait */}
              {!checkInSaved && (
                <div style={{marginTop:12,padding:"10px 12px",background:"#080A0E",borderRadius:8,fontSize:11,color:"#555",fontFamily:"'JetBrains Mono',monospace",lineHeight:1.6}}>
                  💡 Fais ton check-in matin pour affiner le score avec ta VFC et récupération
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══ PLAN ═══ */}
        {view==="plan" && (
          <div className="fade-up">
            {!showSettings ? (
              <>
                <div className="card" style={{padding:20,marginBottom:14,border:"1px solid #00D2FF22",background:"linear-gradient(135deg,#001a24,#080A0E)"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
                    <div>
                      <div style={{fontSize:10,color:"#00D2FF",letterSpacing:3,fontFamily:"'JetBrains Mono',monospace",marginBottom:4}}>⚡ PLAN ACTIF</div>
                      <div style={{fontSize:16,fontWeight:800}}>VMA {planConfig.vma} km/h · {planConfig.intensity === "soft" ? "Douce" : planConfig.intensity === "ambitious" ? "Ambitieuse" : "Standard"}</div>
                      <div style={{fontSize:11,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginTop:2}}>{planned.filter(p=>p.generated).length} séances générées · {planned.filter(p=>p.generated&&parseDate(p.date)>parseDate(TODAY_STR)).length} restantes</div>
                    </div>
                    <div style={{display:"flex",gap:8}}>
                      <button onClick={()=>setShowSettings(true)} className="btn-ghost" style={{borderRadius:10,padding:"8px 12px",fontSize:11,fontFamily:"'JetBrains Mono',monospace"}}>⚙ RÉGLAGES</button>
                    </div>
                  </div>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:14}}>
                    {[
                      {label:"EF",   key:"ef",    color:"#6BF178"},
                      {label:"SL",   key:"sl",    color:"#C77DFF"},
                      {label:"Tempo",key:"tempo", color:"#FF9F43"},
                      {label:"VMA",  key:"vma",   color:"#FF6B6B"},
                    ].map(({label,key,color})=>{
                      const editing = paceEdit === key;
                      return editing ? (
                        <span key={key} style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:10,padding:"2px 8px",borderRadius:20,background:color+"22",border:`1px solid ${color}88`,fontFamily:"'JetBrains Mono',monospace"}}>
                          <span style={{color}}>{label} ·</span>
                          <input
                            autoFocus
                            defaultValue={fmtPace(planConfig.paces[key])}
                            onBlur={e=>{
                              const raw = e.target.value.replace(/"/g,'').trim();
                              const parts = raw.split(/[':]/);
                              const parsed = parts.length===2 ? parseInt(parts[0])+parseInt(parts[1])/60 : parseFloat(raw)||planConfig.paces[key];
                              handleSettingsUpdate({paces:{...planConfig.paces,[key]:parsed}});
                              setPaceEdit(null);
                            }}
                            onKeyDown={e=>{if(e.key==="Enter") e.target.blur(); if(e.key==="Escape") setPaceEdit(null);}}
                            style={{width:52,background:"transparent",border:"none",outline:"none",color:"#E8E4DC",fontFamily:"'JetBrains Mono',monospace",fontSize:10,textAlign:"center"}}
                          />
                          <span style={{color:"#555"}}>/km</span>
                        </span>
                      ) : (
                        <span key={key} onClick={()=>setPaceEdit(key)} style={{fontSize:10,padding:"4px 10px",borderRadius:20,background:color+"11",color,fontFamily:"'JetBrains Mono',monospace",border:`1px solid ${color}33`,cursor:"pointer"}} title="Cliquer pour modifier">
                          {label} · {fmtPace(planConfig.paces[key])}/km ✎
                        </span>
                      );
                    })}
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    <button onClick={()=>setShowWizard(true)} className="btn-ghost" style={{flex:1,borderRadius:10,padding:"10px",fontSize:11,fontFamily:"'JetBrains Mono',monospace",textAlign:"center"}}>
                      🔄 NOUVEAU PLAN
                    </button>
                    <button onClick={()=>generateAndSavePlan(planConfig)} className="btn-primary"
                      style={{flex:2,background:"#00D2FF",color:"#080A0E",borderRadius:10,padding:"10px",fontSize:12,fontWeight:700,fontFamily:"'JetBrains Mono',monospace",border:"none",cursor:"pointer"}}>
                      {planGenLoading?<span className="spin">↻</span>:"⚡ REGÉNÉRER"}
                    </button>
                  </div>
                </div>

                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <div style={{fontSize:10,color:"#555",letterSpacing:3,fontFamily:"'JetBrains Mono',monospace"}}>PLANNING · {planned.filter(p=>isFuture(p.date)).length} À VENIR</div>
                  <button className="btn-ghost" onClick={()=>setModal({type:"plan"})} style={{borderRadius:8,padding:"6px 12px",fontSize:11,fontFamily:"'JetBrains Mono',monospace"}}>+ AJOUTER</button>
                </div>

                {(()=>{
                  // Grouper par semaine
                  // Inclure : futures, aujourd'hui, et TOUTES les séances de la semaine courante (même passées)
                  const curWkKey = wkKey(TODAY_STR);
                  const sorted=[...planned].sort((a,b)=>a.date.localeCompare(b.date)).filter(p=>{
                    // Semaine en cours (toute la semaine, passé inclus) + futures uniquement
                    if(wkKey(p.date) >= curWkKey) return true;
                    return false;
                  });
                  const weeks={};
                  sorted.forEach(p=>{
                    const wk=wkKey(p.date);
                    if(!weeks[wk]) weeks[wk]=[];
                    weeks[wk].push(p);
                  });
                  return Object.entries(weeks).sort(([a],[b])=>a.localeCompare(b)).map(([wk,sessions])=>{
                    const totalKm=sessions.reduce((s,p)=>s+(p.targetDist||0),0);
                    const totalMin=sessions.reduce((s,p)=>s+(p.targetDur||0),0);
                    const totalH=Math.floor(totalMin/60);
                    const totalM=totalMin%60;
                    const doneCount=sessions.filter(p=>
                      done.find(d=>d.plannedId===p.id) ||
                      done.find(d=>d.date===p.date && d.fromStrava && !d.plannedId)
                    ).length;
                    const doneKm=sessions.reduce((s,p)=>{
                      const linked=done.find(d=>d.plannedId===p.id)||done.find(d=>d.date===p.date&&d.fromStrava&&!d.plannedId);
                      return s+(linked?linked.dist:0);
                    },0);
                    const maxKm=80; // référence barre = 80km
                    const barPct=Math.min((totalKm/maxKm)*100,100);
                    const wkDate=new Date(wk+"T00:00:00");
                    const wkEnd=new Date(wkDate); wkEnd.setDate(wkEnd.getDate()+6);
                    const wkLabel=`${wkDate.getDate()} ${wkDate.toLocaleDateString("fr-FR",{month:"short"})} – ${wkEnd.getDate()} ${wkEnd.toLocaleDateString("fr-FR",{month:"short"})}`;
                    const isCurrentWk=wkKey(TODAY_STR)===wk;
                    return (
                      <div key={wk} style={{marginBottom:20}}>
                        {/* Header semaine */}
                        <div style={{marginBottom:8}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:4}}>
                            <span style={{fontSize:10,color:isCurrentWk?"#FFE66D":"#555",fontFamily:"'JetBrains Mono',monospace",letterSpacing:2}}>
                              {isCurrentWk?"▶ SEMAINE EN COURS":wkLabel}
                            </span>
                            <span style={{fontSize:10,fontFamily:"'JetBrains Mono',monospace",color:"#888"}}>
                              {doneKm>0
                                ? <><span style={{color:"#4ECDC4",fontWeight:700}}>{doneKm.toFixed(0)}</span><span style={{color:"#555"}}>/{totalKm.toFixed(0)} km</span></>
                                : <span style={{color:"#E8E4DC",fontWeight:700}}>{totalKm.toFixed(0)} km</span>
                              }
                              <span style={{color:"#555",margin:"0 4px"}}>·</span>
                              <span style={{color:"#888"}}>{totalH>0?`${totalH}h${String(totalM).padStart(2,"0")}`:`${totalMin}min`}</span>
                              <span style={{color:"#555",margin:"0 4px"}}>·</span>
                              <span style={{color:doneCount===sessions.length&&sessions.length>0?"#4ECDC4":doneCount>0?"#FFE66D":"#555"}}>{doneCount}/{sessions.length}</span>
                            </span>
                          </div>
                          {/* Barre volume */}
                          <div style={{height:3,background:"#1C1F27",borderRadius:2,overflow:"hidden"}}>
                            <div style={{height:"100%",width:`${barPct}%`,background:isCurrentWk?"#FFE66D":totalKm>60?"#FF6B6B":totalKm>40?"#FF9F43":"#6BF178",borderRadius:2,transition:"width 0.3s"}}/>
                          </div>
                        </div>
                        {/* Séances de la semaine */}
                        {sessions.map(p=>{
                  const tm=TYPE_META[p.type]||TYPE_META["Footing"];
                  const linked=done.find(d=>d.plannedId===p.id);
                  const score=linked?scoreSession(p,linked):null;
                  const today=isToday(p.date);
                  return (
                    <div key={p.id} className="card" style={{padding:"16px 18px",marginBottom:8,borderLeft:`3px solid ${today?tm.color:linked?"#4ECDC4":p.generated?"#00D2FF22":"#1C1F27"}`}}>
                      <div style={{display:"flex",gap:12,alignItems:"center"}}>
                        <div style={{width:44,height:44,borderRadius:10,background:tm.dark,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>{tm.icon}</div>
                        <div style={{flex:1}}>
                          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3}}>
                            <span style={{fontSize:11,color:today?"#FFE66D":"#aaa",fontFamily:"'JetBrains Mono',monospace"}}>{today?"AUJOURD'HUI":fmtDate(p.date,{weekday:"short",day:"numeric",month:"short"})}</span>
                            {linked&&<span style={{fontSize:9,color:"#4ECDC4",fontFamily:"'JetBrains Mono',monospace"}}>✓ FAIT</span>}
                            {p.generated&&!linked&&<span style={{fontSize:9,color:"#00D2FF55",fontFamily:"'JetBrains Mono',monospace"}}>AUTO</span>}
                          </div>
                          <div style={{fontSize:15,fontWeight:700}}>{p.type} · {p.targetDist} km</div>
                          <div style={{fontSize:11,color:"#555",fontFamily:"'JetBrains Mono',monospace"}}>~{p.targetDur} min{p.targetHR?` · FC ${p.targetHR}`:""}</div>
                        </div>
                        <div style={{display:"flex",flexDirection:"column",gap:4,alignItems:"flex-end"}}>
                          {score!==null
                            ?<div style={{textAlign:"center"}}><div style={{fontSize:22,fontWeight:800,color:score>79?"#4ECDC4":score>59?"#FFE66D":"#FF6B6B"}}>{score}</div><div style={{fontSize:9,color:"#555",fontFamily:"'JetBrains Mono',monospace"}}>SCORE</div></div>
                            :<button className="btn-ghost" onClick={()=>{ setMoveModal({session:p, mode:"swap"}); setMoveTargetId(null); setMoveDate(addDays(p.date,1)); }} style={{borderRadius:8,padding:"6px 10px",fontSize:11,fontFamily:"'JetBrains Mono',monospace"}}>⇄</button>
                          }
                          {!linked&&(<>
                            <button className="btn-ghost" onClick={()=>openEditPlanned(p)} style={{borderRadius:6,padding:"4px 8px",fontSize:10,fontFamily:"'JetBrains Mono',monospace",marginTop:2}}>✏</button>
                            <button onClick={()=>{ if(window.confirm("Supprimer cette séance ?")) deleteSession(p.id); }} style={{
                              background:"#FF6B6B18",border:"1px solid #FF6B6B33",color:"#FF6B6B88",
                              cursor:"pointer",fontSize:11,padding:"4px 8px",borderRadius:6,
                              fontFamily:"'JetBrains Mono',monospace",lineHeight:1,
                            }}>🗑</button>
                          </>)}
                        </div>
                      </div>
                      {/* Badge ajustement adaptatif */}
                      {(()=>{
                        const adj = weekCompare.adaptedSessions?.find(s=>s.id===p.id&&s.needsAdjust);
                        if(!adj) return null;
                        return (
                          <div style={{marginTop:8,padding:"6px 10px",background:adj.isAlert?"#2b1a00":"#001a24",borderRadius:6,border:`1px solid ${adj.isAlert?"#FF9F4344":"#00D2FF33"}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                            <span style={{fontSize:10,color:adj.isAlert?"#FF9F43":"#00D2FF",fontFamily:"'JetBrains Mono',monospace"}}>
                              {adj.isAlert?"⚠":""} Adaptatif : {adj.delta>0?"+":""}{adj.delta.toFixed(1)}km → {adj.idealDist}km
                            </span>
                            <button onClick={e=>{e.stopPropagation();setWeekAdjustModal({sessions:[adj]});}}
                              style={{fontSize:9,color:adj.isAlert?"#FF9F43":"#00D2FF",background:"transparent",border:`1px solid ${adj.isAlert?"#FF9F4333":"#00D2FF33"}`,borderRadius:4,padding:"2px 6px",cursor:"pointer",fontFamily:"'JetBrains Mono',monospace"}}>
                              APPLIQUER
                            </button>
                          </div>
                        );
                      })()}
                      {p.notes&&<div style={{fontSize:10,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginTop:8,lineHeight:1.5}}>💬 {p.notes}</div>}
                      {linked&&<CompareBar planned={p} done={linked}/>}
                    </div>
                  );
                })}
                      </div>
                    );
                  });
                })()}

                {/* ── GRAPHE VOLUME PRÉVU ── */}
                {plannedVolumeData.length > 1 && (
                  <div className="card" style={{padding:20,marginTop:14}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
                      <div>
                        <div style={{fontSize:10,color:"#555",letterSpacing:3,fontFamily:"'JetBrains Mono',monospace"}}>VOLUME PLANIFIÉ</div>
                        <div style={{fontSize:11,color:"#888",fontFamily:"'JetBrains Mono',monospace",marginTop:2}}>Kilomètres prévus par semaine</div>
                      </div>
                      <div style={{textAlign:"right"}}>
                        <div style={{fontSize:20,fontWeight:800,color:"#00D2FF"}}>
                          {Math.round(plannedVolumeData.reduce((s,d)=>s+d.value,0)/plannedVolumeData.length)}
                          <span style={{fontSize:11,color:"#555",fontWeight:400}}> km moy.</span>
                        </div>
                        <div style={{fontSize:10,color:"#555",fontFamily:"'JetBrains Mono',monospace"}}>
                          pic {Math.max(...plannedVolumeData.map(d=>d.value))} km
                        </div>
                      </div>
                    </div>
                    <Chart data={plannedVolumeData} color="#00D2FF" formatY={v=>`${v}km`} smooth={false}/>
                    <div style={{display:"flex",gap:8,marginTop:14}}>
                      {[
                        ["SEMAINES",`${plannedVolumeData.length}`,"#555"],
                        ["VOLUME MOY",`${Math.round(plannedVolumeData.reduce((s,d)=>s+d.value,0)/plannedVolumeData.length)} km`,"#00D2FF"],
                        ["PIC",`${Math.max(...plannedVolumeData.map(d=>d.value))} km`,"#FF9F43"],
                        ["TOTAL",`${Math.round(plannedVolumeData.reduce((s,d)=>s+d.value,0))} km`,"#6BF178"],
                      ].map(([l,v,c])=>(
                        <div key={l} style={{flex:1,background:"#080A0E",borderRadius:8,padding:"10px 6px",textAlign:"center"}}>
                          <div style={{fontSize:8,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginBottom:3,letterSpacing:1}}>{l}</div>
                          <div style={{fontSize:13,fontWeight:700,color:c}}>{v}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
                  <div style={{fontSize:18,fontWeight:800}}>Réglages du plan</div>
                  <button onClick={()=>setShowSettings(false)} style={{background:"transparent",border:"none",color:"#555",fontSize:20,cursor:"pointer"}}>✕</button>
                </div>
                <PlanSettings
                  config={planConfig}
                  onUpdate={handleSettingsUpdate}
                  onRegenerate={()=>generateAndSavePlan(planConfig)}
                  onOpenWizard={()=>{setShowSettings(false);setShowWizard(true);}}
                  isRegenerating={planGenLoading}
                />
              </div>
            )}
          </div>
        )}

        {/* ═══ COACH IA ═══ */}
        {view==="coach" && (
          <div className="fade-up" style={{display:"flex",flexDirection:"column",height:`calc(100vh - 84px - env(safe-area-inset-bottom,16px) - 20px)`}}>

            {/* ── HEADER FIXE ── */}
            <div style={{flexShrink:0}}>
              {/* Stats + bouton bilan */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <div>
                  <div style={{fontSize:10,color:"#6BF178",letterSpacing:3,fontFamily:"'JetBrains Mono',monospace"}}>✦ COACH IA</div>
                  <div style={{fontSize:11,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginTop:2}}>
                    {coachDate?`Bilan du ${fmtDate(coachDate,{day:"numeric",month:"short"})}`:"Pas encore de bilan"}
                  </div>
                </div>
                <button onClick={()=>askCoach(null)}
                  style={{background:"#6BF17822",color:"#6BF178",border:"1px solid #6BF17844",borderRadius:10,padding:"8px 14px",fontSize:11,fontWeight:700,fontFamily:"'JetBrains Mono',monospace",cursor:"pointer",flexShrink:0}}>
                  {coachLoading&&!chatInput?<span className="spin" style={{color:"#6BF178"}}>↻</span>:"✦ BILAN"}
                </button>
              </div>

              {/* Stats rapides */}
              <div style={{display:"flex",gap:6,marginBottom:10}}>
                {[
                  ["VMA",`${planConfig.vma}km/h`,"#00D2FF"],
                  ["PROTECT.",`${protectionScore.total}/100`,protectionScore.level.color],
                  ["READINESS",checkInSaved?`${checkIn.readiness??calcReadiness(checkIn.hrv,checkIn.recovery,checkIn.feeling)}/100`:"—","#6BF178"],
                  ["KM",`${totalKm.toFixed(0)}km`,"#FFE66D"],
                ].map(([l,v,c])=>(
                  <div key={l} style={{flex:1,background:"#0F1117",border:"1px solid #1C1F27",borderRadius:8,padding:"8px 6px",textAlign:"center"}}>
                    <div style={{fontSize:8,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginBottom:3,letterSpacing:1}}>{l}</div>
                    <div style={{fontSize:12,fontWeight:700,color:c}}>{v}</div>
                  </div>
                ))}
              </div>

              {/* Bilan compact — affiché si disponible */}
              {coachMsg&&(
                <div style={{background:"#0d1f14",border:"1px solid #6BF17822",borderRadius:12,padding:"12px 14px",marginBottom:10}}>
                  <div style={{fontSize:9,color:"#6BF178",letterSpacing:2,fontFamily:"'JetBrains Mono',monospace",marginBottom:8}}>✦ DERNIER BILAN</div>
                  <div style={{fontSize:12,color:"#ccc",lineHeight:1.7,whiteSpace:"pre-wrap"}}>{coachMsg}</div>
                </div>
              )}
              {coachLoading&&!chatInput&&(
                <div style={{background:"#0d1f14",border:"1px solid #6BF17822",borderRadius:12,padding:"14px",marginBottom:10,textAlign:"center"}}>
                  <span className="pulse" style={{fontSize:16,color:"#6BF178"}}>✦</span>
                  <span style={{fontSize:11,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginLeft:8}}>Analyse en cours...</span>
                </div>
              )}

              {/* Séparateur */}
              {chatHistory.length>0&&<div style={{height:1,background:"#1C1F27",marginBottom:8}}/>}
            </div>

            {/* ── ZONE CHAT SCROLLABLE ── */}
            <div style={{flex:1,overflowY:"auto",paddingBottom:8}}>
              {chatHistory.length===0&&!coachMsg&&(
                <div style={{textAlign:"center",padding:"32px 20px"}}>
                  <div style={{fontSize:32,marginBottom:12}}>✦</div>
                  <div style={{fontSize:13,color:"#555",fontFamily:"'JetBrains Mono',monospace",lineHeight:1.7}}>
                    Pose une question ou demande un bilan.<br/>
                    <span style={{color:"#333",fontSize:11}}>Ex: "Mes allures EF progressent ?" · "Prochaine séance ?"</span>
                  </div>
                </div>
              )}
              {chatHistory.map((m,i)=>(
                <div key={i} style={{marginBottom:10}}>
                  <div style={{display:"flex",justifyContent:"flex-end",marginBottom:5}}>
                    <div style={{background:"#1C1F27",borderRadius:"12px 12px 4px 12px",padding:"10px 14px",maxWidth:"82%",fontSize:13,color:"#E8E4DC",lineHeight:1.5}}>{m.user}</div>
                  </div>
                  <div style={{display:"flex",justifyContent:"flex-start"}}>
                    <div style={{background:"#0d1f14",border:"1px solid #6BF17822",borderRadius:"4px 12px 12px 12px",padding:"10px 14px",maxWidth:"90%",fontSize:13,color:"#ccc",lineHeight:1.6,whiteSpace:"pre-wrap"}}>{m.coach}</div>
                  </div>
                </div>
              ))}
              {coachLoading&&chatInput&&(
                <div style={{display:"flex",justifyContent:"flex-start",marginBottom:10}}>
                  <div style={{background:"#0d1f14",border:"1px solid #6BF17822",borderRadius:"4px 12px 12px 12px",padding:"10px 14px"}}>
                    <span className="pulse" style={{color:"#6BF178",fontSize:14}}>✦</span>
                  </div>
                </div>
              )}
            </div>

            {/* ── INPUT FIXE EN BAS ── */}
            <div style={{flexShrink:0,paddingTop:8,borderTop:"1px solid #1C1F27"}}>
              <div style={{display:"flex",gap:8,alignItems:"flex-end"}}>
                <textarea className="chat-inp" rows={1} value={chatInput}
                  onChange={e=>setChatInput(e.target.value)}
                  onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendChat();}}}
                  placeholder="Message au coach..."
                  style={{resize:"none",minHeight:40,maxHeight:100}}/>
                <button onClick={sendChat}
                  style={{background:"#6BF178",color:"#080A0E",border:"none",borderRadius:10,padding:"10px 14px",fontSize:16,flexShrink:0,cursor:"pointer",height:42}}>
                  {coachLoading&&chatInput?<span className="spin" style={{color:"#080A0E",fontSize:13}}>↻</span>:"→"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ═══ ANALYSE ═══ */}
        {view==="analyse" && (
          <div className="fade-up">
            <div className="card" style={{padding:22,marginBottom:14}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
                <div>
                  <div style={{fontSize:10,color:"#555",letterSpacing:3,fontFamily:"'JetBrains Mono',monospace"}}>VOLUME HEBDOMADAIRE</div>
                  <div style={{fontSize:11,color:"#888",fontFamily:"'JetBrains Mono',monospace",marginTop:2}}>{selVolMetric.desc}</div>
                </div>

              </div>
              <div style={{display:"flex",gap:4,background:"#080A0E",borderRadius:8,padding:3,marginBottom:10}}>
                {METRICS.map(m=>(
                  <button key={m.key} className="seg-btn" onClick={()=>setVolMetric(m.key)}
                    style={{flex:1,background:volMetric===m.key?"#1C1F27":"transparent",color:volMetric===m.key?"#E8E4DC":"#555",borderRadius:6}}>{m.label}</button>
                ))}
              </div>
              <div style={{display:"flex",gap:4,marginBottom:14}}>
                {PERIODS.map(p=>(
                  <button key={p.key} className="seg-btn" onClick={()=>setVolPeriod(p.key)}
                    style={{flex:1,background:volPeriod===p.key?"#FFE66D":"#080A0E",color:volPeriod===p.key?"#080A0E":"#555",borderRadius:8,fontWeight:volPeriod===p.key?700:400}}>{p.label}</button>
                ))}
              </div>
              <Chart data={volumeData} color="#FFE66D" formatY={fmtVol} smooth={volSmooth}/>
              {volumeData.length>0&&(()=>{
                const nz=volumeData.filter(d=>d.value>0);
                const avg=nz.length?Math.round(nz.reduce((s,d)=>s+d.value,0)/nz.length):0;
                const max=nz.length?Math.max(...nz.map(d=>d.value)):0;
                const last=volumeData[volumeData.length-1]?.value||0;
                return (
                  <div style={{display:"flex",gap:8,marginTop:14}}>
                    {[["CETTE SEM.",fmtVol(last)],["MOYENNE",fmtVol(avg)],["MAX",fmtVol(max)]].map(([l,v])=>(
                      <div key={l} style={{flex:1,background:"#080A0E",borderRadius:8,padding:"10px 8px",textAlign:"center"}}>
                        <div style={{fontSize:9,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginBottom:4}}>{l}</div>
                        <div style={{fontSize:14,fontWeight:700}}>{v}</div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>

            <div className="card" onClick={()=>setShowACWRDetail(true)} style={{padding:22,marginBottom:14,borderColor:acwr>1.3?"#FF6B6B44":"#1C1F27",cursor:"pointer"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
                <div style={{fontSize:10,color:"#555",letterSpacing:3,fontFamily:"'JetBrains Mono',monospace"}}>CHARGE · ACWR</div>
                <div style={{fontSize:10,color:"#555",fontFamily:"'JetBrains Mono',monospace"}}>Détail →</div>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:14}}>
                <div>
                  <div style={{fontSize:42,fontWeight:800,color:acwrStatus.color,lineHeight:1}}>{acwr.toFixed(2)}</div>
                  <div style={{fontSize:13,color:acwrStatus.color,fontFamily:"'JetBrains Mono',monospace",marginTop:4}}>{acwrStatus.label}</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:11,color:"#555",fontFamily:"'JetBrains Mono',monospace"}}>Zone optimale · 4 sem. glissantes</div>
                  <div style={{fontSize:13,color:"#4ECDC4",fontFamily:"'JetBrains Mono',monospace"}}>0.80 → 1.30</div>
                </div>
              </div>
              <div style={{display:"flex",gap:8,marginBottom:14}}>
                {[
                  ["CHARGE 7J", Math.round(acuteLoadMain), "#E8E4DC"],
                  ["MOY. 28J",  Math.round(chronicLoadMain), "#888"],
                  ["RATIO",     acwr.toFixed(2), acwrStatus.color],
                ].map(([l,v,c])=>(
                  <div key={l} style={{flex:1,background:"#080A0E",borderRadius:8,padding:"8px 6px",textAlign:"center"}}>
                    <div style={{fontSize:8,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginBottom:3,letterSpacing:1}}>{l}</div>
                    <div style={{fontSize:13,fontWeight:700,color:c}}>{v}</div>
                  </div>
                ))}
              </div>
              <div style={{height:8,background:"#1C1F27",borderRadius:4,position:"relative"}}>
                <div style={{position:"absolute",left:"40%",width:"15%",height:8,background:"#4ECDC433",borderRadius:4}}/>
                <div style={{position:"absolute",left:`${Math.min(acwr/2*100,95)}%`,width:12,height:12,top:-2,borderRadius:"50%",background:acwrStatus.color,transform:"translateX(-50%)",border:"2px solid #080A0E"}}/>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"#333",fontFamily:"'JetBrains Mono',monospace",marginTop:4,marginBottom:10}}>
                <span>0</span><span>0.8</span><span>1.0</span><span>1.3</span><span>1.5</span><span>2.0</span>
              </div>
              <div style={{padding:"10px 12px",background:"#080A0E",borderRadius:8,fontSize:11,color:"#888",fontFamily:"'JetBrains Mono',monospace",lineHeight:1.7}}>
                {acwr>1.3?"⚠ Risque de blessure élevé. Réduis la charge de 20-30%.":acwr>1.15?"△ Charge modérée. Surveille ta récupération.":"✓ Tu es dans la zone optimale. Continue !"}
              </div>
            </div>

            <div className="card" style={{padding:22,marginBottom:14}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
                <div>
                  <div style={{fontSize:10,color:"#555",letterSpacing:3,fontFamily:"'JetBrains Mono',monospace"}}>PROGRESSION ALLURE</div>
                  <div style={{fontSize:11,color:"#888",fontFamily:"'JetBrains Mono',monospace",marginTop:2}}>EF &gt;5km · bas = plus rapide 🏃</div>
                </div>

              </div>
              <div style={{display:"flex",gap:4,marginBottom:14}}>
                {PERIODS.map(p=>(
                  <button key={p.key} className="seg-btn" onClick={()=>setPacePeriod(p.key)}
                    style={{flex:1,background:pacePeriod===p.key?"#FC4C02":"#080A0E",color:pacePeriod===p.key?"#fff":"#555",borderRadius:8,fontWeight:pacePeriod===p.key?700:400}}>{p.label}</button>
                ))}
              </div>
              <Chart data={paceData} color="#FC4C02" formatY={fmtPaceVal} smooth={paceSmooth}/>
              {paceData.length>=2&&(()=>{
                const first=paceData[0].value, last=paceData[paceData.length-1].value, diff=first-last;
                return (
                  <div style={{marginTop:14,padding:"12px",background:"#080A0E",borderRadius:8,fontSize:11,color:diff>0?"#6BF178":"#FF9F43",fontFamily:"'JetBrains Mono',monospace"}}>
                    {diff>0?`✓ Gain de ${Math.floor(Math.abs(diff)/60)}'${String(Math.round(Math.abs(diff)%60)).padStart(2,'0')}" /km 🔥`:`△ Allure stable — continue à accumuler du volume en zone 2`}
                  </div>
                );
              })()}
            </div>

            <div className="card" style={{padding:22,marginBottom:14}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                <div>
                  <div style={{fontSize:10,color:"#555",letterSpacing:3,fontFamily:"'JetBrains Mono',monospace"}}>VARIÉTÉ DES SÉANCES</div>
                  <div style={{fontSize:11,color:varietyScore>=4?"#4ECDC4":varietyScore>=3?"#FFE66D":"#FF6B6B",fontFamily:"'JetBrains Mono',monospace",marginTop:2}}>
                    {varietyScore>=4?"EXCELLENTE":varietyScore>=3?"BONNE":"À AMÉLIORER"}
                  </div>
                </div>
              </div>
              <div style={{display:"flex",gap:4,marginBottom:16}}>
                {VARIETY_PERIODS.map(p=>(
                  <button key={p.key} className="seg-btn" onClick={()=>setVarPeriod(p.key)}
                    style={{flex:1,background:varPeriod===p.key?"#C77DFF":"#080A0E",color:varPeriod===p.key?"#080A0E":"#555",borderRadius:8,fontWeight:varPeriod===p.key?700:400}}>{p.label}</button>
                ))}
              </div>
              {Object.entries(varietyData).sort((a,b)=>b[1].runs-a[1].runs).map(([type,data])=>{
                const tm=TYPE_META[type]||TYPE_META["Footing"];
                const total=Object.values(varietyData).reduce((s,v)=>s+v.runs,0);
                return (
                  <div key={type} style={{marginBottom:12}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:5,fontSize:12}}>
                      <span style={{color:tm.color}}>{tm.icon} {type}</span>
                      <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11}}>
                        <span style={{color:"#aaa"}}>{data.runs} séance{data.runs>1?"s":""}</span>
                        <span style={{color:"#555",margin:"0 5px"}}>·</span>
                        <span style={{color:tm.color}}>{data.km.toFixed(1)}km</span>
                        <span style={{color:"#555",margin:"0 5px"}}>·</span>
                        <span style={{color:"#555"}}>{Math.round(data.runs/total*100)}%</span>
                      </span>
                    </div>
                    <div style={{height:5,background:"#1C1F27",borderRadius:3}}>
                      <div style={{height:5,width:`${data.runs/total*100}%`,background:tm.color,borderRadius:3}}/>
                    </div>
                  </div>
                );
              })}
              {(()=>{
                const missing=["Endurance fondamentale","Fractionné / VMA","Sortie longue"].filter(t=>!Object.keys(varietyData).includes(t));
                if(missing.length>0) return (
                  <div style={{marginTop:12,padding:"10px 12px",background:"#2b1a0033",border:"1px solid #FF9F4333",borderRadius:8,fontSize:11,color:"#FF9F43",fontFamily:"'JetBrains Mono',monospace"}}>
                    💡 Manque : {missing.join(", ")}
                  </div>
                );
                return null;
              })()}
            </div>
          </div>
        )}

        {/* ═══ JOURNAL ═══ */}
        {view==="journal" && (
          <div className="fade-up">
            {/* Strava sync dans le journal */}
            {!stravaConnected?(
              <button onClick={stravaLogin} style={{width:"100%",background:"#FC4C02",border:"none",borderRadius:10,padding:"12px",color:"#fff",fontSize:13,fontWeight:700,fontFamily:"'JetBrains Mono',monospace",cursor:"pointer",marginBottom:14}}>
                🔗 CONNECTER STRAVA
              </button>
            ):(
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:"#0F1117",border:"1px solid #1C1F27",borderRadius:10,padding:"10px 14px",marginBottom:14}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <div style={{width:8,height:8,borderRadius:"50%",background:"#FC4C02"}}/>
                  <span style={{fontSize:11,color:"#888",fontFamily:"'JetBrains Mono',monospace"}}>{syncStatus||`STRAVA · ${done.filter(d=>d.fromStrava).length} séances`}</span>
                </div>
                <button onClick={syncStrava} className="btn-ghost" style={{borderRadius:8,padding:"4px 10px",fontSize:11,fontFamily:"'JetBrains Mono',monospace"}}>
                  {stravaLoading?<span className="spin">↻</span>:"↻ SYNC"}
                </button>
              </div>
            )}
            <div style={{fontSize:11,color:"#555",letterSpacing:3,fontFamily:"'JetBrains Mono',monospace",marginBottom:14}}>
              {done.length} SÉANCES · {totalKm.toFixed(0)} KM TOTAL
              {done.filter(d=>d.fromStrava).length>0&&<span style={{color:"#FC4C02",marginLeft:8}}>· {done.filter(d=>d.fromStrava).length} STRAVA</span>}
            </div>
            {[...done].sort((a,b)=>b.date.localeCompare(a.date)).map(r=>{
              const tm=TYPE_META[r.type]||TYPE_META["Footing"];
              const linked=planned.find(p=>p.id===r.plannedId);
              const score=linked?scoreSession(linked,r):null;
              return (
                <div key={r.id} className="card" style={{padding:"16px 18px",marginBottom:8}}>
                  <div style={{display:"flex",gap:12,alignItems:"center"}}>
                    <div style={{width:44,height:44,borderRadius:10,background:tm.dark,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>{tm.icon}</div>
                    <div style={{flex:1}}>
                      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                        <span style={{fontSize:11,color:"#555",fontFamily:"'JetBrains Mono',monospace"}}>{fmtDate(r.date,{weekday:"long",day:"numeric",month:"long"})}</span>
                        {r.fromStrava&&<span style={{fontSize:9,color:"#FC4C02",fontFamily:"'JetBrains Mono',monospace"}}>STRAVA</span>}
                      </div>
                      <span className="pill" style={{background:tm.dark,color:tm.color}}>{tm.icon} {r.type}</span>
                      <div style={{display:"flex",gap:12,marginTop:6,flexWrap:"wrap"}}>
                        {[`${r.dist} km`,`${r.dur} min`,pace(r.dist,r.dur)+"/km",r.hr?`${r.hr} bpm`:""].filter(Boolean).map(v=>(
                          <span key={v} style={{fontSize:11,color:"#888",fontFamily:"'JetBrains Mono',monospace"}}>{v}</span>
                        ))}
                      </div>
                    </div>
                    <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:6}}>
                      <span style={{fontSize:20}}>{FEELINGS[(r.feeling||3)-1]}</span>
                      {score!==null&&<div style={{fontSize:13,fontWeight:700,color:score>79?"#4ECDC4":score>59?"#FFE66D":"#FF6B6B"}}>{score}/100</div>}
                      <button className="btn-ghost" onClick={()=>openEdit(r)} style={{borderRadius:8,padding:"4px 10px",fontSize:10,fontFamily:"'JetBrains Mono',monospace"}}>✏ MODIFIER</button>
                      <button onClick={()=>deleteJournalEntry(r)} style={{background:"#FF6B6B18",border:"1px solid #FF6B6B33",color:"#FF6B6B88",cursor:"pointer",fontSize:10,padding:"4px 8px",borderRadius:6,fontFamily:"'JetBrains Mono',monospace",lineHeight:1}}>🗑 SUPPR.</button>
                    </div>
                  </div>
                  {r.notes&&<div style={{marginTop:10,fontSize:11,color:"#666",fontFamily:"'JetBrains Mono',monospace",borderTop:"1px solid #1C1F27",paddingTop:10}}>💬 {r.notes}</div>}
                  <div style={{marginTop:10,display:"flex",gap:3,alignItems:"center"}}>
                    <span style={{fontSize:9,color:"#444",fontFamily:"'JetBrains Mono',monospace",marginRight:4}}>RPE</span>
                    {Array.from({length:10}).map((_,i)=><div key={i} style={{flex:1,height:6,borderRadius:1,background:i<(r.rpe||5)?tm.color:"#1C1F27"}}/>)}
                    <span style={{fontSize:9,color:"#444",fontFamily:"'JetBrains Mono',monospace",marginLeft:4}}>{r.rpe||"?"}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* BOTTOM NAV */}
      <div style={{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:480,maxWidth:"100vw",background:"#0F1117",borderTop:"1px solid #1C1F27",display:"flex",zIndex:50,paddingBottom:"env(safe-area-inset-bottom, 16px)"}}>
        {[["today","⊙","AUJOURD'HUI"],["plan","◫","PLAN"],["coach","✦","COACH"],["analyse","◈","ANALYSE"],["journal","≡","JOURNAL"]].map(([v,ico,lbl])=>{
          const active = view===v;
          const accent = v==="coach"?"#6BF178":v==="today"?"#00D2FF":v==="plan"?"#FFE66D":v==="analyse"?"#C77DFF":"#FC4C02";
          return (
            <button key={v} className="nav-tab" onClick={()=>setView(v)}
              style={{flex:1,padding:"12px 0 8px",color:active?accent:"#444",background:"transparent",display:"flex",flexDirection:"column",alignItems:"center",gap:4,border:"none",position:"relative"}}>
              {active && <div style={{position:"absolute",top:0,left:"50%",transform:"translateX(-50%)",width:28,height:2,background:accent,borderRadius:"0 0 2px 2px"}}/>}
              <span style={{fontSize:18,lineHeight:1}}>{ico}</span>
              <span style={{fontSize:9,letterSpacing:1.5,fontFamily:"'JetBrains Mono',monospace",fontWeight:active?700:400}}>{lbl}</span>
            </button>
          );
        })}
      </div>

      {/* ── MODAL DÉBRIEF POST-STRAVA ── */}
      {stravaDebriefModal && (
        <div onClick={()=>setStravaDebriefModal(null)}
          style={{position:"fixed",inset:0,background:"rgba(0,0,0,.88)",zIndex:300,display:"flex",alignItems:"flex-end",justifyContent:"center",backdropFilter:"blur(8px)"}}>
          <div onClick={e=>e.stopPropagation()} className="pop"
            style={{background:"#0F1117",border:"1px solid #1C1F27",borderRadius:"20px 20px 0 0",padding:28,width:"100%",maxWidth:480,paddingBottom:`calc(28px + env(safe-area-inset-bottom, 12px))`}}>

            {/* Header */}
            <div style={{marginBottom:20}}>
              <div style={{fontSize:10,color:"#4ECDC4",letterSpacing:3,fontFamily:"'JetBrains Mono',monospace",marginBottom:6}}>🏃 SÉANCE DÉTECTÉE VIA STRAVA</div>
              <div style={{fontSize:20,fontWeight:800}}>{stravaDebriefModal.stravaSession.type}</div>
              <div style={{fontSize:11,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginTop:2}}>
                Comment s'est passée cette sortie ?
              </div>
            </div>

            {/* Stats Strava */}
            <div style={{display:"flex",gap:8,marginBottom:20}}>
              {[
                ["DISTANCE", `${stravaDebriefModal.stravaSession.dist} km`],
                ["DURÉE",    `${stravaDebriefModal.stravaSession.dur} min`],
                ["ALLURE",   pace(stravaDebriefModal.stravaSession.dist, stravaDebriefModal.stravaSession.dur)],
                ...(stravaDebriefModal.stravaSession.hr ? [["FC MOY", `${stravaDebriefModal.stravaSession.hr} bpm`]] : []),
              ].map(([l,v])=>(
                <div key={l} style={{flex:1,background:"#080A0E",borderRadius:8,padding:"10px 6px",textAlign:"center",border:"1px solid #FC4C0233"}}>
                  <div style={{fontSize:8,color:"#FC4C02",fontFamily:"'JetBrains Mono',monospace",marginBottom:4,letterSpacing:1}}>{l}</div>
                  <div style={{fontSize:13,fontWeight:700}}>{v}</div>
                </div>
              ))}
            </div>

            {/* RPE */}
            <div style={{marginBottom:16}}>
              <div style={{fontSize:9,color:"#555",letterSpacing:2,fontFamily:"'JetBrains Mono',monospace",marginBottom:8}}>EFFORT PERÇU · {debriefForm.rpe}/10</div>
              <input type="range" min="1" max="10" value={debriefForm.rpe}
                onChange={e=>setDebriefForm(f=>({...f,rpe:e.target.value}))}
                style={{width:"100%",accentColor:"#FFE66D"}}/>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"#444",fontFamily:"'JetBrains Mono',monospace",marginTop:4}}>
                <span>LÉGER</span><span>MODÉRÉ</span><span>MAX</span>
              </div>
            </div>

            {/* Ressenti */}
            <div style={{marginBottom:16}}>
              <div style={{fontSize:9,color:"#555",letterSpacing:2,fontFamily:"'JetBrains Mono',monospace",marginBottom:8}}>RESSENTI</div>
              <div style={{display:"flex",gap:8,justifyContent:"center"}}>
                {FEELINGS.map((f,i)=>(
                  <button key={i} onClick={()=>setDebriefForm(df=>({...df,feeling:String(i+1)}))}
                    style={{fontSize:28,background:"transparent",border:`2px solid ${+debriefForm.feeling===i+1?"#FFE66D":"transparent"}`,borderRadius:10,padding:"4px 8px",cursor:"pointer"}}>
                    {f}
                  </button>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div style={{marginBottom:20}}>
              <div style={{fontSize:9,color:"#555",letterSpacing:2,fontFamily:"'JetBrains Mono',monospace",marginBottom:6}}>NOTES (optionnel)</div>
              <textarea className="inp" rows={2} placeholder="Conditions, sensations, douleurs..."
                value={debriefForm.notes}
                onChange={e=>setDebriefForm(f=>({...f,notes:e.target.value}))}
                style={{resize:"none"}}/>
            </div>

            {/* Boutons */}
            <div style={{display:"flex",gap:10}}>
              <button className="btn-ghost" onClick={()=>setStravaDebriefModal(null)}
                style={{flex:1,borderRadius:12,padding:14,fontFamily:"'JetBrains Mono',monospace",fontSize:12}}>
                PLUS TARD
              </button>
              <button onClick={submitDebrief}
                style={{flex:2,background:"#4ECDC4",color:"#080A0E",border:"none",borderRadius:12,padding:14,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"'JetBrains Mono',monospace"}}>
                ENREGISTRER ✓
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL DÉPLACEMENT SÉANCE ── */}
      {moveModal && (()=>{
        const { session, mode } = moveModal;
        const tm = TYPE_META[session.type] || TYPE_META["Footing"];
        // Séances futures disponibles pour l'échange (pas celle-ci, pas déjà faites)
        const swapCandidates = planned
          .filter(p => p.id !== session.id && parseDate(p.date) >= parseDate(TODAY_STR) && !done.find(d => d.plannedId === p.id))
          .sort((a,b) => a.date.localeCompare(b.date))
          .slice(0, 14); // 2 semaines max
        return (
          <div onClick={()=>setMoveModal(null)}
            style={{position:"fixed",inset:0,background:"rgba(0,0,0,.88)",zIndex:300,display:"flex",alignItems:"flex-end",justifyContent:"center",backdropFilter:"blur(8px)"}}>
            <div onClick={e=>e.stopPropagation()} className="pop"
              style={{background:"#0F1117",border:"1px solid #1C1F27",borderRadius:"20px 20px 0 0",padding:28,width:"100%",maxWidth:480,maxHeight:"85vh",overflowY:"auto",paddingBottom:`calc(28px + env(safe-area-inset-bottom,12px))`}}>

              {/* Header */}
              <div style={{marginBottom:20}}>
                <div style={{fontSize:10,color:tm.color,letterSpacing:3,fontFamily:"'JetBrains Mono',monospace",marginBottom:6}}>{tm.icon} DÉPLACER LA SÉANCE</div>
                <div style={{fontSize:18,fontWeight:800}}>{session.type}</div>
                <div style={{fontSize:11,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginTop:2}}>
                  {fmtDate(session.date,{weekday:"long",day:"numeric",month:"long"})} · {session.targetDist}km
                </div>
              </div>

              {/* Sélecteur de mode */}
              <div style={{display:"flex",gap:8,marginBottom:20}}>
                {[["swap","⇄ ÉCHANGER","Swapper avec une autre séance"],["move","→ REPORTER","Choisir une nouvelle date"]].map(([m,label,desc])=>(
                  <button key={m} onClick={()=>setMoveModal(prev=>({...prev,mode:m}))}
                    style={{flex:1,border:`2px solid ${mode===m?tm.color:"#1C1F27"}`,background:mode===m?tm.color+"22":"transparent",borderRadius:12,padding:"12px 8px",cursor:"pointer",textAlign:"center"}}>
                    <div style={{fontSize:13,fontWeight:700,color:mode===m?tm.color:"#555",fontFamily:"'JetBrains Mono',monospace"}}>{label}</div>
                    <div style={{fontSize:10,color:"#444",fontFamily:"'JetBrains Mono',monospace",marginTop:3}}>{desc}</div>
                  </button>
                ))}
              </div>

              {/* Mode SWAP : liste des séances */}
              {mode==="swap" && (
                <div>
                  <div style={{fontSize:9,color:"#555",letterSpacing:2,fontFamily:"'JetBrains Mono',monospace",marginBottom:10}}>CHOISIR AVEC QUELLE SÉANCE ÉCHANGER</div>
                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    {swapCandidates.map(target=>{
                      const ttm = TYPE_META[target.type]||TYPE_META["Footing"];
                      const isSel = moveTargetId === target.id;
                      return (
                        <button key={target.id} onClick={()=>setMoveTargetId(target.id)}
                          style={{border:`2px solid ${isSel?ttm.color:"#1C1F27"}`,background:isSel?ttm.color+"11":"#080A0E",borderRadius:10,padding:"12px 14px",cursor:"pointer",textAlign:"left",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                          <div>
                            <div style={{fontSize:10,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginBottom:2}}>{fmtDate(target.date,{weekday:"short",day:"numeric",month:"short"})}</div>
                            <div style={{fontSize:13,fontWeight:700,color:isSel?ttm.color:"#aaa"}}>{ttm.icon} {target.type}</div>
                            <div style={{fontSize:10,color:"#555",fontFamily:"'JetBrains Mono',monospace"}}>{target.targetDist}km · ~{target.targetDur}min</div>
                          </div>
                          {isSel && <span style={{fontSize:18,color:ttm.color}}>✓</span>}
                        </button>
                      );
                    })}
                    {swapCandidates.length===0 && (
                      <div style={{fontSize:11,color:"#555",fontFamily:"'JetBrains Mono',monospace",padding:14,textAlign:"center"}}>Aucune séance disponible pour l'échange</div>
                    )}
                  </div>
                </div>
              )}

              {/* Mode MOVE : sélecteur de date */}
              {mode==="move" && (
                <div>
                  <div style={{fontSize:9,color:"#555",letterSpacing:2,fontFamily:"'JetBrains Mono',monospace",marginBottom:10}}>NOUVELLE DATE</div>
                  <input type="date" className="inp" value={moveDate}
                    onChange={e=>setMoveDate(e.target.value)}
                    min={TODAY_STR}
                    style={{marginBottom:8}}/>
                  <div style={{fontSize:10,color:"#555",fontFamily:"'JetBrains Mono',monospace"}}>
                    {moveDate && moveDate !== session.date ? `→ ${fmtDate(moveDate,{weekday:"long",day:"numeric",month:"long"})}` : "Sélectionne une date"}
                  </div>
                </div>
              )}

              {/* Boutons */}
              <div style={{display:"flex",gap:10,marginTop:20}}>
                <button className="btn-ghost" onClick={()=>setMoveModal(null)}
                  style={{flex:1,borderRadius:12,padding:14,fontFamily:"'JetBrains Mono',monospace",fontSize:12}}>
                  ANNULER
                </button>
                <button onClick={applyMove}
                  disabled={mode==="swap"?!moveTargetId : !moveDate||moveDate===session.date}
                  style={{flex:2,background:tm.color,color:"#080A0E",border:"none",borderRadius:12,padding:14,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"'JetBrains Mono',monospace",opacity:(mode==="swap"?!moveTargetId:!moveDate||moveDate===session.date)?0.4:1}}>
                  {mode==="swap"?"⇄ ÉCHANGER":"→ REPORTER"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── MODAL PROTECTION BLESSURE ── */}
      {showProtectionDetail && (()=>{
        const ps = protectionScore;

        // Données brutes pour chaque signal
        const acwrSig  = ps.signals.find(s=>s.key==="ACWR");
        const volSig   = ps.signals.find(s=>s.key==="VOL");
        const monoSig  = ps.signals.find(s=>s.key==="MONO");
        const readySig = ps.signals.find(s=>s.key==="READY");

        // Calcul ACWR brut pour jauge
        const acwrRaw = parseFloat(acwrSig?.value) || 1;

        // Séances 7 derniers jours pour monotonie
        const last7Runs = done.filter(r => r.date >= addDays(TODAY_STR, -14));
        const last7ByType = {};
        last7Runs.forEach(r => { if(!last7ByType[r.type]) last7ByType[r.type]={runs:0,km:0}; last7ByType[r.type].runs++; last7ByType[r.type].km+=r.dist; });

        // Vol semaine courante vs précédente
        const curKmRaw  = weeklyVol[0]?.dist || 0;
        const prevKmRaw = weeklyVol[1]?.dist || 0;

        function SigColor(score) { return score>=75?"#4ECDC4":score>=50?"#FF9F43":"#FF6B6B"; }

        return (
          <div onClick={()=>setShowProtectionDetail(false)}
            style={{position:"fixed",inset:0,background:"rgba(0,0,0,.92)",zIndex:400,display:"flex",alignItems:"flex-end",justifyContent:"center",backdropFilter:"blur(10px)"}}>
            <div onClick={e=>e.stopPropagation()}
              style={{width:"100%",maxWidth:480,background:"#0F1117",border:"1px solid #1C1F27",borderRadius:"22px 22px 0 0",padding:"28px 24px",paddingBottom:"calc(28px + env(safe-area-inset-bottom,12px))",maxHeight:"90vh",overflowY:"auto"}}>

              {/* Header modal */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:24}}>
                <div>
                  <div style={{fontSize:10,color:ps.level.color,letterSpacing:3,fontFamily:"'JetBrains Mono',monospace",marginBottom:6}}>{ps.level.icon} PROTECTION BLESSURE</div>
                  <div style={{display:"flex",alignItems:"baseline",gap:10}}>
                    <span style={{fontSize:48,fontWeight:800,color:ps.level.color,letterSpacing:-3,lineHeight:1}}>{ps.total}</span>
                    <span style={{fontSize:14,color:"#555",fontFamily:"'JetBrains Mono',monospace"}}>/100 · {ps.level.label}</span>
                  </div>
                </div>
                <button onClick={()=>setShowProtectionDetail(false)}
                  style={{background:"#1C1F27",border:"none",color:"#888",fontSize:18,cursor:"pointer",borderRadius:10,width:36,height:36,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
              </div>

              {/* Barre globale */}
              <div style={{height:8,background:"#1C1F27",borderRadius:4,marginBottom:28,overflow:"hidden"}}>
                <div style={{height:"100%",width:`${ps.total}%`,background:`linear-gradient(90deg,${ps.level.color}66,${ps.level.color})`,borderRadius:4,transition:"width 1s ease"}}/>
              </div>

              {/* ── 1. READINESS (45%) ── */}
              <div style={{marginBottom:24,padding:"18px",background:SigColor(readySig?.score||0)+"0A",border:`1px solid ${SigColor(readySig?.score||0)}22`,borderRadius:16}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <div>
                    <div style={{fontSize:10,color:SigColor(readySig?.score||0),letterSpacing:2,fontFamily:"'JetBrains Mono',monospace",marginBottom:3}}>READINESS · POIDS 45%</div>
                    <div style={{fontSize:16,fontWeight:800,color:SigColor(readySig?.score||0)}}>{readySig?.value||"—"}</div>
                  </div>
                  <div style={{fontSize:36,fontWeight:800,color:SigColor(readySig?.score||0),letterSpacing:-2}}>{readySig?.score||0}</div>
                </div>
                {/* Jauge VFC + récup */}
                {checkInSaved ? (
                  <div style={{display:"flex",gap:8,marginBottom:10}}>
                    {[
                      {label:"VFC",value:checkIn.hrv?`${checkIn.hrv}ms`:"—",target:"≥78ms",ok:(parseFloat(checkIn.hrv)||0)>=78},
                      {label:"RÉCUP.",value:checkIn.recovery?`${checkIn.recovery}%`:"—",target:"≥70%",ok:(parseFloat(checkIn.recovery)||0)>=70},
                      {label:"SENSATION",value:checkIn.feeling===0?"🟢 Frais":checkIn.feeling===1?"🟡 Correct":"🔴 Fatigué",target:"Frais",ok:checkIn.feeling===0},
                    ].map(({label,value,target,ok})=>(
                      <div key={label} style={{flex:1,background:"#080A0E",borderRadius:10,padding:"10px 8px",textAlign:"center",border:`1px solid ${ok?"#4ECDC433":"#FF6B6B33"}`}}>
                        <div style={{fontSize:8,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginBottom:4,letterSpacing:1}}>{label}</div>
                        <div style={{fontSize:12,fontWeight:700,color:ok?"#4ECDC4":"#FF9F43"}}>{value}</div>
                        <div style={{fontSize:8,color:"#444",fontFamily:"'JetBrains Mono',monospace",marginTop:3}}>cible {target}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{padding:"10px 12px",background:"#080A0E",borderRadius:8,fontSize:11,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginBottom:10}}>
                    💡 Fais ton check-in matin pour avoir des données précises
                  </div>
                )}
                <div style={{fontSize:10,color:"#555",fontFamily:"'JetBrains Mono',monospace",lineHeight:1.6}}>
                  Le signal le plus important — ta VFC reflète la capacité de ton système nerveux à encaisser une charge. En dessous de 70ms ou récup &lt;60%, le risque de blessure augmente significativement.
                </div>
              </div>

              {/* ── 2. ACWR (35%) ── */}
              <div style={{marginBottom:24,padding:"18px",background:SigColor(acwrSig?.score||0)+"0A",border:`1px solid ${SigColor(acwrSig?.score||0)}22`,borderRadius:16}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <div>
                    <div style={{fontSize:10,color:SigColor(acwrSig?.score||0),letterSpacing:2,fontFamily:"'JetBrains Mono',monospace",marginBottom:3}}>CHARGE AIGUË/CHRONIQUE · 35%</div>
                    <div style={{fontSize:16,fontWeight:800,color:SigColor(acwrSig?.score||0)}}>ACWR {acwrSig?.value||"—"}</div>
                  </div>
                  <div style={{fontSize:36,fontWeight:800,color:SigColor(acwrSig?.score||0),letterSpacing:-2}}>{acwrSig?.score||0}</div>
                </div>
                {/* Jauge ACWR */}
                <div style={{marginBottom:12}}>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"#444",fontFamily:"'JetBrains Mono',monospace",marginBottom:5}}>
                    <span>Sous-chargé</span><span style={{color:"#4ECDC4"}}>Zone optimale</span><span>Surcharge</span>
                  </div>
                  <div style={{height:10,background:"#1C1F27",borderRadius:5,position:"relative",overflow:"visible"}}>
                    {/* Zone optimale 0.8-1.3 en vert */}
                    <div style={{position:"absolute",left:"26.7%",width:"16.7%",height:"100%",background:"#4ECDC422",borderRadius:2}}/>
                    {/* Curseur */}
                    <div style={{position:"absolute",top:-3,left:`${Math.min(Math.max(acwrRaw/2,0),1)*95}%`,width:16,height:16,borderRadius:"50%",background:SigColor(acwrSig?.score||0),border:"2px solid #080A0E",transform:"translateX(-50%)",transition:"left 0.8s ease",boxShadow:`0 0 8px ${SigColor(acwrSig?.score||0)}66`}}/>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"#333",fontFamily:"'JetBrains Mono',monospace",marginTop:4}}>
                    <span>0</span><span>0.8</span><span>1.0</span><span>1.3</span><span>1.5</span><span>2.0</span>
                  </div>
                </div>
                {/* Charge aiguë vs chronique */}
                <div style={{display:"flex",gap:8,marginBottom:10}}>
                  {[
                    {label:"CHARGE 7J",value:Math.round(weeklyVol[0]?.load||0),color:"#E8E4DC"},
                    {label:"MOY. 28J",value:Math.round(weeklyVol.slice(0,4).reduce((s,w)=>s+(w?.load||0),0)/4),color:"#888"},
                    {label:"RATIO",value:acwrSig?.value,color:SigColor(acwrSig?.score||0)},
                  ].map(({label,value,color})=>(
                    <div key={label} style={{flex:1,background:"#080A0E",borderRadius:8,padding:"8px 6px",textAlign:"center"}}>
                      <div style={{fontSize:8,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginBottom:3,letterSpacing:1}}>{label}</div>
                      <div style={{fontSize:13,fontWeight:700,color}}>{value}</div>
                    </div>
                  ))}
                </div>
                <div style={{fontSize:10,color:"#555",fontFamily:"'JetBrains Mono',monospace",lineHeight:1.6}}>
                  Compare ta charge des 7 derniers jours à ta moyenne sur 4 semaines. Zone optimale : 0.8–1.3. Au-delà de 1.5, le risque de blessure augmente exponentiellement.
                </div>
              </div>

              {/* ── 3. MONOTONIE (10%) ── */}
              <div onClick={()=>{setShowProtectionDetail(false);setShowMonoDetail(true);}} style={{marginBottom:24,padding:"18px",background:SigColor(monoSig?.score||0)+"0A",border:`1px solid ${SigColor(monoSig?.score||0)}22`,borderRadius:16,cursor:"pointer"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <div>
                    <div style={{fontSize:10,color:SigColor(monoSig?.score||0),letterSpacing:2,fontFamily:"'JetBrains Mono',monospace",marginBottom:3}}>MONOTONIE · 10%</div>
                    <div style={{fontSize:16,fontWeight:800,color:SigColor(monoSig?.score||0)}}>{monoSig?.value||"—"}</div>
                    <div style={{fontSize:10,color:SigColor(monoSig?.score||0)+"88",fontFamily:"'JetBrains Mono',monospace",marginTop:3}}>Voir détail →</div>
                  </div>
                  <div style={{fontSize:36,fontWeight:800,color:SigColor(monoSig?.score||0),letterSpacing:-2}}>{monoSig?.score||0}</div>
                </div>
                {/* Types des 7 derniers jours */}
                {/* Sous-titre monotonie */}
                {monoSig?.detail&&(
                  <div style={{fontSize:11,color:"#888",fontFamily:"'JetBrains Mono',monospace",marginBottom:10}}>{monoSig.detail}</div>
                )}
                {last7Runs.length > 0 ? (
                  <div style={{marginBottom:10}}>
                    <div style={{fontSize:9,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginBottom:6,letterSpacing:1}}>SÉANCES 14 DERNIERS JOURS</div>
                    {Object.entries(last7ByType).map(([type,data])=>{
                      const tm={
                        "Endurance fondamentale":{color:"#6BF178",icon:"◈"},
                        "Fractionné / VMA":{color:"#FF6B6B",icon:"▲▲"},
                        "Tempo / Seuil":{color:"#FF9F43",icon:"◇"},
                        "Sortie longue":{color:"#C77DFF",icon:"◈◈◈"},
                        "Footing":{color:"#A8DADC",icon:"〜"},
                      }[type]||{color:"#888",icon:"○"};
                      return (
                        <div key={type} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 10px",background:"#080A0E",borderRadius:8,marginBottom:4,borderLeft:`3px solid ${tm.color}`}}>
                          <span style={{fontSize:11,color:tm.color,fontFamily:"'JetBrains Mono',monospace"}}>{tm.icon} {type}</span>
                          <span style={{fontSize:11,color:"#888",fontFamily:"'JetBrains Mono',monospace"}}>{data.runs} × {data.km.toFixed(1)}km</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{padding:"10px",background:"#080A0E",borderRadius:8,fontSize:11,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginBottom:10}}>
                    Pas assez de données (7 derniers jours)
                  </div>
                )}
                <div style={{fontSize:10,color:"#555",fontFamily:"'JetBrains Mono',monospace",lineHeight:1.6}}>
                  Trop de séances au même RPE ou même type = risque de surcharge tissulaire. Varie intensité et types pour garder la monotonie basse.
                </div>
              </div>

              {/* ── 4. PROGRESSION VOLUME (10%) ── */}
              <div style={{marginBottom:16,padding:"18px",background:SigColor(volSig?.score||0)+"0A",border:`1px solid ${SigColor(volSig?.score||0)}22`,borderRadius:16}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <div>
                    <div style={{fontSize:10,color:SigColor(volSig?.score||0),letterSpacing:2,fontFamily:"'JetBrains Mono',monospace",marginBottom:3}}>PROGRESSION VOLUME · 10%</div>
                    <div style={{fontSize:16,fontWeight:800,color:SigColor(volSig?.score||0)}}>{volSig?.value||"0%"}</div>
                  </div>
                  <div style={{fontSize:36,fontWeight:800,color:SigColor(volSig?.score||0),letterSpacing:-2}}>{volSig?.score||0}</div>
                </div>
                {/* Semaine courante vs précédente */}
                <div style={{display:"flex",gap:8,marginBottom:10}}>
                  {[
                    {label:"SEMAINE PREC.",value:`${prevKmRaw.toFixed(1)} km`,color:"#888"},
                    {label:"CETTE SEMAINE",value:`${curKmRaw.toFixed(1)} km`,color:"#E8E4DC"},
                    {label:"ÉVOLUTION",value:volSig?.value||"0%",color:SigColor(volSig?.score||0)},
                  ].map(({label,value,color})=>(
                    <div key={label} style={{flex:1,background:"#080A0E",borderRadius:8,padding:"8px 6px",textAlign:"center"}}>
                      <div style={{fontSize:8,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginBottom:3,letterSpacing:1}}>{label}</div>
                      <div style={{fontSize:13,fontWeight:700,color}}>{value}</div>
                    </div>
                  ))}
                </div>
                {/* Barres comparatives */}
                <div style={{marginBottom:10}}>
                  {[[prevKmRaw,"S-1","#555"],[curKmRaw,"Cette sem.",SigColor(volSig?.score||0)]].map(([km,label,color])=>{
                    const max=Math.max(prevKmRaw,curKmRaw,1);
                    return (
                      <div key={label} style={{marginBottom:6}}>
                        <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginBottom:3}}>
                          <span>{label}</span><span style={{color}}>{km.toFixed(1)} km</span>
                        </div>
                        <div style={{height:5,background:"#1C1F27",borderRadius:3,overflow:"hidden"}}>
                          <div style={{height:"100%",width:`${(km/max)*100}%`,background:color,borderRadius:3,transition:"width 0.8s ease"}}/>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{fontSize:10,color:"#555",fontFamily:"'JetBrains Mono',monospace",lineHeight:1.6}}>
                  Règle des 10% : ne pas augmenter le volume de plus de 10% par semaine. Au-delà de +20%, le risque de blessure augmente fortement.
                </div>
              </div>

            </div>
          </div>
        );
      })()}

      {/* ── MODAL AJUSTEMENT SEMAINE ── */}
      {weekAdjustModal && (
        <div onClick={()=>setWeekAdjustModal(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.92)",zIndex:400,display:"flex",alignItems:"flex-end",justifyContent:"center",backdropFilter:"blur(10px)"}}>
          <div onClick={e=>e.stopPropagation()} style={{width:"100%",maxWidth:480,background:"#0F1117",border:"1px solid #1C1F27",borderRadius:"22px 22px 0 0",padding:"28px 24px",paddingBottom:"calc(28px + env(safe-area-inset-bottom,12px))"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div>
                <div style={{fontSize:10,color:"#00D2FF",letterSpacing:3,fontFamily:"'JetBrains Mono',monospace",marginBottom:4}}>◎ AJUSTEMENT ADAPTATIF</div>
                <div style={{fontSize:18,fontWeight:800}}>Optimiser la semaine</div>
              </div>
              <button onClick={()=>setWeekAdjustModal(null)} style={{background:"#1C1F27",border:"none",color:"#888",fontSize:18,cursor:"pointer",borderRadius:10,width:36,height:36,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
            </div>

            <div style={{fontSize:11,color:"#888",fontFamily:"'JetBrains Mono',monospace",lineHeight:1.7,marginBottom:16,padding:"10px 14px",background:"#080A0E",borderRadius:8}}>
              Objectif semaine : <span style={{color:"#E8E4DC"}}>{weekCompare.targetKm}km</span> · Déjà fait : <span style={{color:"#4ECDC4"}}>{weekCompare.doneKm.toFixed(1)}km</span> · Qualité : <span style={{color:"#FF9F43"}}>{weekCompare.qualRatio}%</span> du volume
            </div>

            <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:20}}>
              {weekAdjustModal.sessions.map(s=>{
                const color = s.isAlert?"#FF9F43":"#00D2FF";
                const typeMeta = {"Sortie longue":"◈◈◈","Endurance fondamentale":"◈","Fractionné / VMA":"▲▲","Tempo / Seuil":"◇","Footing":"〜"};
                return (
                  <div key={s.id} style={{padding:"14px",background:"#080A0E",borderRadius:12,border:`1px solid ${color}33`}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                      <span style={{fontSize:12,fontWeight:700,color}}>{typeMeta[s.type]||"○"} {s.type}</span>
                      <span style={{fontSize:10,color:"#555",fontFamily:"'JetBrains Mono',monospace"}}>{s.date}</span>
                    </div>
                    <div style={{display:"flex",gap:8}}>
                      {[["PRÉVU",`${s.targetDist}km`,"#555"],["IDÉAL",`${s.idealDist}km`,color],["ÉCART",`${s.delta>0?"+":""}${s.delta.toFixed(1)}km`,color]].map(([l,v,c])=>(
                        <div key={l} style={{flex:1,background:"#0F1117",borderRadius:8,padding:"8px",textAlign:"center"}}>
                          <div style={{fontSize:8,color:"#444",fontFamily:"'JetBrains Mono',monospace",marginBottom:3}}>{l}</div>
                          <div style={{fontSize:13,fontWeight:700,color:c}}>{v}</div>
                        </div>
                      ))}
                    </div>
                    {s.isAlert&&(
                      <div style={{marginTop:8,fontSize:10,color:"#FF9F43",fontFamily:"'JetBrains Mono',monospace",lineHeight:1.5}}>
                        ⚠ Augmentation de +{Math.round(s.deltaPct)}% — surveille ta récupération après cette séance.
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div style={{display:"flex",gap:10}}>
              <button onClick={()=>{
                // "Max possible" = appliquer mais plafonner à +20% si alerte
                const capped = weekAdjustModal.sessions.map(s=>({
                  ...s,
                  idealDist: s.isAlert ? Math.round(s.targetDist*1.20*10)/10 : s.idealDist,
                }));
                applyWeekAdjustments(capped);
              }} style={{flex:1,background:"#1C1F27",color:"#888",border:"none",borderRadius:12,padding:14,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"'JetBrains Mono',monospace"}}>
                MAX SAFE<br/><span style={{fontWeight:400,fontSize:9}}>plafonné +20%</span>
              </button>
              <button onClick={()=>applyWeekAdjustments(weekAdjustModal.sessions)}
                style={{flex:2,background:"#00D2FF",color:"#080A0E",border:"none",borderRadius:12,padding:14,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"'JetBrains Mono',monospace"}}>
                APPLIQUER TOUT ✓
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL MONOTONIE DÉTAIL ── */}
      {showMonoDetail && (()=>{
        const HARD = ["Fractionné / VMA", "Tempo / Seuil", "Évaluation VMA"];
        const last14 = done.filter(r => r.date >= addDays(TODAY_STR, -14))
          .sort((a,b) => a.date.localeCompare(b.date));
        const monoSig = protectionScore.signals.find(s=>s.key==="MONO");
        const color = monoSig?.score>=75?"#4ECDC4":monoSig?.score>=50?"#FF9F43":"#FF6B6B";

        // Grouper par type pour le donut
        const byType = {};
        last14.forEach(r => {
          if(!byType[r.type]) byType[r.type]={count:0,km:0};
          byType[r.type].count++;
          byType[r.type].km += r.dist;
        });
        const total = last14.length;
        const TMETA = {
          "Endurance fondamentale":{color:"#6BF178",icon:"◈"},
          "Fractionné / VMA":{color:"#FF6B6B",icon:"▲▲"},
          "Tempo / Seuil":{color:"#FF9F43",icon:"◇"},
          "Sortie longue":{color:"#C77DFF",icon:"◈◈◈"},
          "Footing":{color:"#A8DADC",icon:"〜"},
          "Évaluation VMA":{color:"#00D2FF",icon:"⚡"},
        };

        // Barres par semaine (S-2 et S-1)
        const weeks = [1,0].map(i => {
          const wkRuns = done.filter(r =>
            r.date >= addDays(TODAY_STR, -(i+1)*7) &&
            r.date < addDays(TODAY_STR, -i*7)
          );
          const hard = wkRuns.filter(r=>HARD.includes(r.type));
          const easy = wkRuns.filter(r=>!HARD.includes(r.type));
          const wkLabel = i===0?"S-1 (semaine passée)":"S-2";
          return { label:wkLabel, isCurrent:i===0, runs:wkRuns.length, hard:hard.length, easy:easy.length,
            hardKm:Math.round(hard.reduce((s,r)=>s+r.dist,0)*10)/10,
            easyKm:Math.round(easy.reduce((s,r)=>s+r.dist,0)*10)/10,
          };
        });

        // Semaine en cours
        const curWkRuns = done.filter(r => r.date >= addDays(TODAY_STR, -7));
        const curHard = curWkRuns.filter(r=>HARD.includes(r.type));
        const curEasy = curWkRuns.filter(r=>!HARD.includes(r.type));

        return (
          <div onClick={()=>setShowMonoDetail(false)}
            style={{position:"fixed",inset:0,background:"rgba(0,0,0,.92)",zIndex:500,display:"flex",alignItems:"flex-end",justifyContent:"center",backdropFilter:"blur(10px)"}}>
            <div onClick={e=>e.stopPropagation()}
              style={{width:"100%",maxWidth:480,background:"#0F1117",border:"1px solid #1C1F27",borderRadius:"22px 22px 0 0",padding:"28px 24px",paddingBottom:"calc(28px + env(safe-area-inset-bottom,12px))",maxHeight:"90vh",overflowY:"auto"}}>

              {/* Header */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:24}}>
                <div>
                  <div style={{fontSize:10,color,letterSpacing:3,fontFamily:"'JetBrains Mono',monospace",marginBottom:6}}>MONOTONIE DE L'ENTRAÎNEMENT</div>
                  <div style={{display:"flex",alignItems:"baseline",gap:10}}>
                    <span style={{fontSize:36,fontWeight:800,color,letterSpacing:-2,lineHeight:1}}>{monoSig?.score||0}</span>
                    <span style={{fontSize:16,color:"#555",fontFamily:"'JetBrains Mono',monospace"}}>/100 · {monoSig?.value}</span>
                  </div>
                  {monoSig?.detail&&<div style={{fontSize:11,color:"#888",fontFamily:"'JetBrains Mono',monospace",marginTop:4}}>{monoSig.detail}</div>}
                </div>
                <button onClick={()=>setShowMonoDetail(false)}
                  style={{background:"#1C1F27",border:"none",color:"#888",fontSize:18,cursor:"pointer",borderRadius:10,width:36,height:36,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
              </div>

              {/* Répartition visuelle semaine courante */}
              <div style={{marginBottom:20}}>
                <div style={{fontSize:10,color:"#555",letterSpacing:2,fontFamily:"'JetBrains Mono',monospace",marginBottom:10}}>CETTE SEMAINE (7 DERNIERS JOURS)</div>
                {curWkRuns.length > 0 ? (<>
                  {/* Barre intensité vs facile */}
                  <div style={{display:"flex",height:36,borderRadius:10,overflow:"hidden",marginBottom:8,gap:2}}>
                    {curEasy.length>0&&<div style={{flex:curEasy.length,background:"#6BF17833",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:"#6BF178",fontFamily:"'JetBrains Mono',monospace"}}>
                      {curEasy.length} facile{curEasy.length>1?"s":""}
                    </div>}
                    {curHard.length>0&&<div style={{flex:curHard.length,background:"#FF6B6B33",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:"#FF6B6B",fontFamily:"'JetBrains Mono',monospace"}}>
                      {curHard.length} intensi{curHard.length>1?"ves":"ve"}
                    </div>}
                  </div>
                  <div style={{fontSize:10,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginBottom:12}}>
                    Cible : 1-2 séances intensives · {Math.round((1.5/Math.max(curWkRuns.length,4))*100)}–{Math.round((2/Math.max(curWkRuns.length,4))*100)}% du total
                  </div>
                </>) : <div style={{fontSize:11,color:"#444",fontFamily:"'JetBrains Mono',monospace",marginBottom:12}}>Pas encore de séances cette semaine</div>}
              </div>

              {/* Répartition par type sur 14j */}
              <div style={{marginBottom:20}}>
                <div style={{fontSize:10,color:"#555",letterSpacing:2,fontFamily:"'JetBrains Mono',monospace",marginBottom:10}}>RÉPARTITION PAR TYPE — 14 JOURS ({total} séances)</div>
                {total > 0 ? (
                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    {Object.entries(byType).sort(([,a],[,b])=>b.count-a.count).map(([type,data])=>{
                      const tm = TMETA[type]||{color:"#888",icon:"○"};
                      const pct = Math.round((data.count/total)*100);
                      return (
                        <div key={type}>
                          <div style={{display:"flex",justifyContent:"space-between",fontSize:10,fontFamily:"'JetBrains Mono',monospace",marginBottom:4}}>
                            <span style={{color:tm.color}}>{tm.icon} {type}</span>
                            <span style={{color:"#888"}}>{data.count} séance{data.count>1?"s":""} · {data.km.toFixed(0)}km · {pct}%</span>
                          </div>
                          <div style={{height:6,background:"#1C1F27",borderRadius:3,overflow:"hidden"}}>
                            <div style={{height:"100%",width:`${pct}%`,background:tm.color,borderRadius:3,transition:"width 0.8s ease"}}/>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : <div style={{fontSize:11,color:"#444",fontFamily:"'JetBrains Mono',monospace"}}>Pas assez de données (14 jours)</div>}
              </div>

              {/* Comparaison S-2 vs S-1 */}
              <div style={{marginBottom:20}}>
                <div style={{fontSize:10,color:"#555",letterSpacing:2,fontFamily:"'JetBrains Mono',monospace",marginBottom:10}}>INTENSITÉ PAR SEMAINE</div>
                <div style={{display:"flex",gap:8}}>
                  {weeks.map(w=>(
                    <div key={w.label} style={{flex:1,background:"#080A0E",borderRadius:10,padding:"12px 10px",border:"1px solid #1C1F27"}}>
                      <div style={{fontSize:9,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginBottom:8}}>{w.label}</div>
                      <div style={{marginBottom:6}}>
                        <div style={{display:"flex",justifyContent:"space-between",fontSize:10,fontFamily:"'JetBrains Mono',monospace",marginBottom:3}}>
                          <span style={{color:"#6BF178"}}>Facile</span>
                          <span style={{color:"#6BF178"}}>{w.easyKm}km</span>
                        </div>
                        <div style={{height:5,background:"#1C1F27",borderRadius:3,overflow:"hidden"}}>
                          <div style={{height:"100%",width:`${(w.easyKm/Math.max(w.easyKm+w.hardKm,1))*100}%`,background:"#6BF17844",borderRadius:3}}/>
                        </div>
                      </div>
                      <div>
                        <div style={{display:"flex",justifyContent:"space-between",fontSize:10,fontFamily:"'JetBrains Mono',monospace",marginBottom:3}}>
                          <span style={{color:"#FF6B6B"}}>Intensif</span>
                          <span style={{color:"#FF6B6B"}}>{w.hardKm}km</span>
                        </div>
                        <div style={{height:5,background:"#1C1F27",borderRadius:3,overflow:"hidden"}}>
                          <div style={{height:"100%",width:`${(w.hardKm/Math.max(w.easyKm+w.hardKm,1))*100}%`,background:"#FF6B6B44",borderRadius:3}}/>
                        </div>
                      </div>
                      <div style={{fontSize:9,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginTop:6}}>{w.runs} séances</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Explication */}
              <div style={{padding:"14px 16px",background:"#080A0E",borderRadius:12,border:"1px solid #1C1F27",fontSize:11,color:"#666",fontFamily:"'JetBrains Mono',monospace",lineHeight:1.8}}>
                <span style={{color:"#E8E4DC"}}>Monotonie = répétition des mêmes stimuli.</span><br/>
                Un entraînement varié (mix EF, VMA, SL) stimule mieux les adaptations et réduit le risque de blessure par surcharge localisée.<br/><br/>
                <span style={{color:"#6BF178"}}>Idéal :</span> 1-2 séances intensives + 2-3 séances faciles/semaine. <span style={{color:"#FF9F43"}}>Attention</span> si 3+ séances intensives consécutives.
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── MODAL ACWR DÉTAIL ── */}
      {showACWRDetail && (()=>{
        // Calcul des 4 semaines individuelles
        const weeks4Detail = [0,1,2,3].map(i => {
          const runs = done.filter(r =>
            r.date >= addDays(TODAY_STR, -(i+1)*7) &&
            r.date < addDays(TODAY_STR, -i*7)
          );
          const load = runs.reduce((s,r) => s + r.dist*(r.rpe||5), 0);
          const dist = runs.reduce((s,r) => s + r.dist, 0);
          const wkStart = addDays(TODAY_STR, -(i+1)*7);
          const [,mm,dd] = wkStart.split('-');
          return { label: `S-${i+1} (${parseInt(dd)}/${parseInt(mm)})`, load: Math.round(load), dist: Math.round(dist*10)/10, runs: runs.length, isCurrent: i===0 };
        });
        const maxLoad = Math.max(...weeks4Detail.map(w=>w.load), 1);

        return (
          <div onClick={()=>setShowACWRDetail(false)}
            style={{position:"fixed",inset:0,background:"rgba(0,0,0,.92)",zIndex:400,display:"flex",alignItems:"flex-end",justifyContent:"center",backdropFilter:"blur(10px)"}}>
            <div onClick={e=>e.stopPropagation()}
              style={{width:"100%",maxWidth:480,background:"#0F1117",border:"1px solid #1C1F27",borderRadius:"22px 22px 0 0",padding:"28px 24px",paddingBottom:"calc(28px + env(safe-area-inset-bottom,12px))",maxHeight:"85vh",overflowY:"auto"}}>

              {/* Header */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:24}}>
                <div>
                  <div style={{fontSize:10,color:acwrStatus.color,letterSpacing:3,fontFamily:"'JetBrains Mono',monospace",marginBottom:6}}>CHARGE AIGUË / CHRONIQUE</div>
                  <div style={{display:"flex",alignItems:"baseline",gap:10}}>
                    <span style={{fontSize:48,fontWeight:800,color:acwrStatus.color,letterSpacing:-3,lineHeight:1}}>{acwr.toFixed(2)}</span>
                    <span style={{fontSize:14,color:"#555",fontFamily:"'JetBrains Mono',monospace"}}>{acwrStatus.label}</span>
                  </div>
                  <div style={{fontSize:11,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginTop:4}}>Zone optimale : 0.80 → 1.30</div>
                </div>
                <button onClick={()=>setShowACWRDetail(false)}
                  style={{background:"#1C1F27",border:"none",color:"#888",fontSize:18,cursor:"pointer",borderRadius:10,width:36,height:36,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
              </div>

              {/* Jauge ACWR */}
              <div style={{marginBottom:24}}>
                <div style={{height:10,background:"#1C1F27",borderRadius:5,position:"relative",marginBottom:6}}>
                  <div style={{position:"absolute",left:"40%",width:"15%",height:"100%",background:"#4ECDC433",borderRadius:3}}/>
                  <div style={{position:"absolute",top:-3,left:`${Math.min(acwr/2*100,95)}%`,width:16,height:16,borderRadius:"50%",background:acwrStatus.color,border:"2px solid #080A0E",transform:"translateX(-50%)",boxShadow:`0 0 8px ${acwrStatus.color}66`}}/>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"#333",fontFamily:"'JetBrains Mono',monospace"}}>
                  <span>0</span><span style={{color:"#4ECDC4"}}>0.8</span><span style={{color:"#4ECDC4"}}>1.3</span><span>1.5</span><span>2.0</span>
                </div>
              </div>

              {/* Résumé 3 stats */}
              <div style={{display:"flex",gap:8,marginBottom:24}}>
                {[
                  ["CHARGE AIGUË (7j)", Math.round(acuteLoadMain), "#E8E4DC", "km×RPE cette semaine"],
                  ["CHARGE CHRONIQUE", Math.round(chronicLoadMain), "#888", "moyenne 4 semaines"],
                  ["RATIO ACWR", acwr.toFixed(2), acwrStatus.color, "aiguë ÷ chronique"],
                ].map(([l,v,c,sub])=>(
                  <div key={l} style={{flex:1,background:"#080A0E",borderRadius:10,padding:"12px 8px",textAlign:"center",border:`1px solid ${c}22`}}>
                    <div style={{fontSize:8,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginBottom:6,letterSpacing:1,lineHeight:1.4}}>{l}</div>
                    <div style={{fontSize:18,fontWeight:800,color:c,marginBottom:4}}>{v}</div>
                    <div style={{fontSize:8,color:"#444",fontFamily:"'JetBrains Mono',monospace"}}>{sub}</div>
                  </div>
                ))}
              </div>

              {/* Détail 4 semaines */}
              <div style={{fontSize:10,color:"#555",letterSpacing:2,fontFamily:"'JetBrains Mono',monospace",marginBottom:12}}>DÉTAIL PAR SEMAINE</div>
              <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:20}}>
                {weeks4Detail.map((w,i)=>(
                  <div key={i} style={{background:"#080A0E",borderRadius:10,padding:"12px 14px",border:`1px solid ${w.isCurrent?"#FFE66D33":"#1C1F27"}`}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <span style={{fontSize:11,fontFamily:"'JetBrains Mono',monospace",color:w.isCurrent?"#FFE66D":"#888"}}>{w.label}</span>
                        {w.isCurrent && <span style={{fontSize:9,color:"#FFE66D",border:"1px solid #FFE66D44",borderRadius:4,padding:"1px 5px",fontFamily:"'JetBrains Mono',monospace"}}>EN COURS</span>}
                      </div>
                      <span style={{fontSize:13,fontWeight:700,color:w.isCurrent?"#FFE66D":"#aaa",fontFamily:"'JetBrains Mono',monospace"}}>charge {w.load}</span>
                    </div>
                    <div style={{display:"flex",gap:12,fontSize:11,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginBottom:8}}>
                      <span>{w.dist} km</span>
                      <span>·</span>
                      <span>{w.runs} séance{w.runs>1?"s":""}</span>
                    </div>
                    {/* Barre charge relative */}
                    <div style={{height:4,background:"#1C1F27",borderRadius:2,overflow:"hidden"}}>
                      <div style={{height:"100%",width:`${(w.load/maxLoad)*100}%`,background:w.isCurrent?`linear-gradient(90deg,${acwrStatus.color}88,${acwrStatus.color})`:"#444",borderRadius:2,transition:"width 0.8s ease"}}/>
                    </div>
                  </div>
                ))}
              </div>

              {/* Explication */}
              <div style={{padding:"14px 16px",background:"#080A0E",borderRadius:12,border:"1px solid #1C1F27",fontSize:11,color:"#666",fontFamily:"'JetBrains Mono',monospace",lineHeight:1.8}}>
                <span style={{color:"#E8E4DC"}}>Charge = km × RPE</span> pour chaque séance.<br/>
                <span style={{color:"#E8E4DC"}}>ACWR = charge 7j ÷ moyenne des 4 semaines.</span><br/>
                Zone verte 0.8–1.3 : tu charges suffisamment sans risquer la surcharge. En dessous de 0.8, tu es sous-entraîné. Au-dessus de 1.5, risque de blessure élevé.
              </div>
            </div>
          </div>
        );
      })()}

      {/* VMA MODAL */}
      {showVMA && (
        <VMAModal
          done={done}
          currentVMA={planConfig.vma}
          onClose={() => setShowVMA(false)}
        />
      )}

      {/* WIZARD MODAL */}
      {showWizard&&(
        <div onClick={()=>setShowWizard(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.9)",zIndex:300,display:"flex",alignItems:"flex-end",justifyContent:"center",backdropFilter:"blur(8px)"}}>
          <div onClick={e=>e.stopPropagation()} className="pop" style={{width:"100%",maxWidth:480,maxHeight:"92vh",overflowY:"auto"}}>
            <PlanWizard
              vma={planConfig.vma}
              initialConfig={planConfig}
              onComplete={handleWizardComplete}
              onCancel={()=>setShowWizard(false)}
            />
          </div>
        </div>
      )}

      {/* MODALS */}
      {modal&&(
        <div onClick={()=>setModal(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.85)",zIndex:200,display:"flex",alignItems:"flex-end",justifyContent:"center",backdropFilter:"blur(6px)"}}>
          <div onClick={e=>e.stopPropagation()} className="pop" style={{background:"#0F1117",border:"1px solid #1C1F27",borderRadius:"20px 20px 0 0",padding:28,width:"100%",maxWidth:480,maxHeight:"85vh",overflowY:"auto",paddingBottom:`calc(28px + env(safe-area-inset-bottom, 12px))`}}>

            {modal.type==="editPlanned"&&editPlannedForm&&(<>
              <div style={{fontSize:22,fontWeight:800,marginBottom:6}}>Modifier la séance</div>
              <div style={{fontSize:11,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginBottom:20}}>{fmtDate(editPlannedForm.date,{weekday:"long",day:"numeric",month:"long"})}</div>
              <div style={{marginBottom:16}}>
                <div style={{fontSize:9,color:"#555",letterSpacing:2,fontFamily:"'JetBrains Mono',monospace",marginBottom:10}}>TYPE</div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {Object.entries(TYPE_META).map(([type,tmeta])=>(
                    <button key={type} className="type-btn" onClick={()=>setEditPlannedForm(f=>({...f,type}))}
                      style={{borderColor:editPlannedForm.type===type?tmeta.color:"transparent",color:editPlannedForm.type===type?tmeta.color:"#555",background:editPlannedForm.type===type?tmeta.dark:"transparent",minWidth:70}}>
                      <div style={{fontSize:16,marginBottom:3}}>{tmeta.icon}</div>
                      <div>{type.split(' ')[0]}</div>
                    </button>
                  ))}
                </div>
              </div>
              <FormGrid>
                <Field label="DISTANCE CIBLE (km)"><input type="number" className="inp" value={editPlannedForm.targetDist} onChange={e=>setEditPlannedForm(f=>({...f,targetDist:e.target.value}))}/></Field>
                <Field label="DURÉE CIBLE (min)"><input type="number" className="inp" value={editPlannedForm.targetDur} onChange={e=>setEditPlannedForm(f=>({...f,targetDur:e.target.value}))}/></Field>
                <Field label="FC CIBLE (bpm)"><input type="number" className="inp" placeholder="optionnel" value={editPlannedForm.targetHR} onChange={e=>setEditPlannedForm(f=>({...f,targetHR:e.target.value}))}/></Field>
                <Field label="NOTES" full><textarea className="inp" rows={2} value={editPlannedForm.notes} onChange={e=>setEditPlannedForm(f=>({...f,notes:e.target.value}))} style={{resize:"none"}}/></Field>
              </FormGrid>
              <div style={{display:"flex",gap:10,marginTop:24}}>
                <button className="btn-ghost" onClick={()=>setModal(null)} style={{flex:1,borderRadius:12,padding:14,fontFamily:"'JetBrains Mono',monospace",fontSize:12}}>ANNULER</button>
                <button className="btn-primary" onClick={async()=>{
                  const updated={...editPlannedForm,targetDist:parseFloat(editPlannedForm.targetDist)||0,targetDur:parseInt(editPlannedForm.targetDur)||0,targetHR:editPlannedForm.targetHR?parseInt(editPlannedForm.targetHR):null};
                  await savePlanned(updated);
                  setPlanned(prev=>prev.map(s=>s.id===updated.id?updated:s));
                  setModal(null);
                }} style={{flex:2,background:TYPE_META[editPlannedForm.type]?.color||"#E8E4DC",color:"#080A0E",borderRadius:12,padding:14,fontSize:13,fontWeight:700}}>SAUVEGARDER ✓</button>
              </div>
            </>)}

            {modal.type==="plan"&&(<>
              <div style={{fontSize:22,fontWeight:800,marginBottom:24}}>Planifier une séance</div>
              <div style={{marginBottom:16}}>
                <div style={{fontSize:9,color:"#555",letterSpacing:2,fontFamily:"'JetBrains Mono',monospace",marginBottom:10}}>TYPE</div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {Object.entries(TYPE_META).map(([type,tm])=>(
                    <button key={type} className="type-btn" onClick={()=>setPlanForm({...planForm,type})}
                      style={{borderColor:planForm.type===type?tm.color:"transparent",color:planForm.type===type?tm.color:"#555",background:planForm.type===type?tm.dark:"transparent",minWidth:70}}>
                      <div style={{fontSize:16,marginBottom:3}}>{tm.icon}</div>
                      <div>{type}</div>
                    </button>
                  ))}
                </div>
              </div>
              <FormGrid>
                <Field label="DATE"><input type="date" className="inp" value={planForm.date} onChange={e=>setPlanForm({...planForm,date:e.target.value})}/></Field>
                <Field label="DISTANCE CIBLE (km)"><input type="number" className="inp" placeholder="10" value={planForm.targetDist} onChange={e=>setPlanForm({...planForm,targetDist:e.target.value})}/></Field>
                <Field label="DURÉE CIBLE (min)"><input type="number" className="inp" placeholder="65" value={planForm.targetDur} onChange={e=>setPlanForm({...planForm,targetDur:e.target.value})}/></Field>
                <Field label="FC CIBLE (bpm)"><input type="number" className="inp" placeholder="145" value={planForm.targetHR} onChange={e=>setPlanForm({...planForm,targetHR:e.target.value})}/></Field>
                <Field label="NOTES" full><textarea className="inp" rows={3} placeholder="Description..." value={planForm.notes} onChange={e=>setPlanForm({...planForm,notes:e.target.value})} style={{resize:"none"}}/></Field>
              </FormGrid>
              <div style={{display:"flex",gap:10,marginTop:24}}>
                <button className="btn-ghost" onClick={()=>setModal(null)} style={{flex:1,borderRadius:12,padding:14,fontFamily:"'JetBrains Mono',monospace",fontSize:12}}>ANNULER</button>
                <button className="btn-primary" onClick={addPlanned} style={{flex:2,background:"#E8E4DC",color:"#080A0E",borderRadius:12,padding:14,fontSize:13,fontWeight:700}}>ENREGISTRER</button>
              </div>
            </>)}

            {modal.type==="log"&&(<>
              <div style={{fontSize:22,fontWeight:800,marginBottom:24}}>Enregistrer une séance</div>
              <div style={{marginBottom:16}}>
                <div style={{fontSize:9,color:"#555",letterSpacing:2,fontFamily:"'JetBrains Mono',monospace",marginBottom:10}}>TYPE</div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {Object.entries(TYPE_META).map(([type,tm])=>(
                    <button key={type} className="type-btn" onClick={()=>setLogForm({...logForm,type})}
                      style={{borderColor:logForm.type===type?tm.color:"transparent",color:logForm.type===type?tm.color:"#555",background:logForm.type===type?tm.dark:"transparent",minWidth:70}}>
                      <div style={{fontSize:16,marginBottom:3}}>{tm.icon}</div>
                      <div>{type}</div>
                    </button>
                  ))}
                </div>
              </div>
              <FormGrid>
                <Field label="DATE"><input type="date" className="inp" value={logForm.date} onChange={e=>setLogForm({...logForm,date:e.target.value})}/></Field>
                <Field label="DISTANCE TOTALE (km)"><input type="number" className="inp" placeholder="10.5" value={logForm.dist} onChange={e=>setLogForm({...logForm,dist:e.target.value})}/></Field>
                <Field label="DURÉE TOTALE (min)"><input type="number" className="inp" placeholder="68" value={logForm.dur} onChange={e=>setLogForm({...logForm,dur:e.target.value})}/></Field>
              </FormGrid>
              {logForm.type==="Évaluation VMA"&&(
                <div style={{padding:"12px 14px",background:"#001f2b",border:"1px solid #00D2FF33",borderRadius:10,marginBottom:16}}>
                  <div style={{fontSize:10,color:"#00D2FF",letterSpacing:2,fontFamily:"'JetBrains Mono',monospace",marginBottom:8}}>⚡ TEST 6 MIN — DONNÉES PRÉCISES</div>
                  <div style={{fontSize:11,color:"#888",fontFamily:"'JetBrains Mono',monospace",marginBottom:10,lineHeight:1.6}}>
                    Indique la distance couverte <span style={{color:"#E8E4DC"}}>uniquement pendant les 6 minutes</span> à fond (sans l'échauffement ni le retour au calme). C'est ce chiffre qui sera utilisé pour calculer ta VMA.
                  </div>
                  <Field label="DISTANCE 6 MIN PURES (km)" full>
                    <input type="number" className="inp" placeholder="ex: 1.85" step="0.01"
                      value={logForm.vma6minDist||""}
                      onChange={e=>setLogForm({...logForm,vma6minDist:e.target.value})}
                      style={{borderColor:"#00D2FF44"}}/>
                  </Field>
                  {logForm.vma6minDist&&parseFloat(logForm.vma6minDist)>0&&(
                    <div style={{marginTop:8,fontSize:12,fontFamily:"'JetBrains Mono',monospace",color:"#00D2FF"}}>
                      → VMA estimée : <span style={{fontWeight:700,fontSize:16}}>{(parseFloat(logForm.vma6minDist)/6*60*1.05).toFixed(2)} km/h</span>
                    </div>
                  )}
                </div>
              )}
              <FormGrid>
                <Field label="FC MOY (bpm)"><input type="number" className="inp" placeholder="145" value={logForm.hr} onChange={e=>setLogForm({...logForm,hr:e.target.value})}/></Field>
                <Field label={`RPE · ${logForm.rpe}/10`} full>
                  <input type="range" min="1" max="10" value={logForm.rpe} onChange={e=>setLogForm({...logForm,rpe:e.target.value})} style={{width:"100%",accentColor:"#FFE66D"}}/>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"#444",fontFamily:"'JetBrains Mono',monospace",marginTop:4}}><span>LÉGER</span><span>MODÉRÉ</span><span>MAX</span></div>
                </Field>
                <Field label="RESSENTI" full>
                  <div style={{display:"flex",gap:8,justifyContent:"center"}}>
                    {FEELINGS.map((f,i)=><button key={i} onClick={()=>setLogForm({...logForm,feeling:String(i+1)})} style={{fontSize:28,background:"transparent",border:`2px solid ${+logForm.feeling===i+1?"#FFE66D":"transparent"}`,borderRadius:10,padding:"4px 8px",cursor:"pointer"}}>{f}</button>)}
                  </div>
                </Field>
                <Field label="NOTES" full><textarea className="inp" rows={2} placeholder="Ressenti, conditions..." value={logForm.notes} onChange={e=>setLogForm({...logForm,notes:e.target.value})} style={{resize:"none"}}/></Field>
              </FormGrid>
              <div style={{display:"flex",gap:10,marginTop:24}}>
                <button className="btn-ghost" onClick={()=>setModal(null)} style={{flex:1,borderRadius:12,padding:14,fontFamily:"'JetBrains Mono',monospace",fontSize:12}}>ANNULER</button>
                <button className="btn-primary" onClick={submitLog} style={{flex:2,background:"#4ECDC4",color:"#080A0E",borderRadius:12,padding:14,fontSize:13,fontWeight:700}}>ENREGISTRER ✓</button>
              </div>
            </>)}

            {modal.type==="edit"&&editForm&&(<>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24}}>
                <div style={{fontSize:22,fontWeight:800}}>Modifier la séance</div>
                <div style={{fontSize:11,color:"#555",fontFamily:"'JetBrains Mono',monospace"}}>{fmtDate(editForm.date,{day:"numeric",month:"long"})}</div>
              </div>
              <div style={{marginBottom:16}}>
                <div style={{fontSize:9,color:"#555",letterSpacing:2,fontFamily:"'JetBrains Mono',monospace",marginBottom:10}}>TYPE DE SÉANCE</div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {Object.entries(TYPE_META).map(([type,tm])=>(
                    <button key={type} className="type-btn" onClick={()=>setEditForm({...editForm,type})}
                      style={{borderColor:editForm.type===type?tm.color:"transparent",color:editForm.type===type?tm.color:"#555",background:editForm.type===type?tm.dark:"transparent",minWidth:70}}>
                      <div style={{fontSize:16,marginBottom:3}}>{tm.icon}</div>
                      <div>{type}</div>
                    </button>
                  ))}
                </div>
              </div>
              <FormGrid>
                <Field label="DISTANCE (km)"><input type="number" className="inp" value={editForm.dist} onChange={e=>setEditForm({...editForm,dist:e.target.value})}/></Field>
                <Field label="DURÉE (min)"><input type="number" className="inp" value={editForm.dur} onChange={e=>setEditForm({...editForm,dur:e.target.value})}/></Field>
                <Field label="FC MOY (bpm)"><input type="number" className="inp" value={editForm.hr||""} onChange={e=>setEditForm({...editForm,hr:e.target.value})}/></Field>
                <Field label={`RPE · ${editForm.rpe}/10`}>
                  <input type="range" min="1" max="10" value={editForm.rpe} onChange={e=>setEditForm({...editForm,rpe:e.target.value})} style={{width:"100%",accentColor:"#FFE66D",marginTop:8}}/>
                </Field>
                <Field label="RESSENTI" full>
                  <div style={{display:"flex",gap:8,justifyContent:"center"}}>
                    {FEELINGS.map((f,i)=><button key={i} onClick={()=>setEditForm({...editForm,feeling:String(i+1)})} style={{fontSize:28,background:"transparent",border:`2px solid ${+editForm.feeling===i+1?"#FFE66D":"transparent"}`,borderRadius:10,padding:"4px 8px",cursor:"pointer"}}>{f}</button>)}
                  </div>
                </Field>
                <Field label="NOTES" full><textarea className="inp" rows={2} value={editForm.notes||""} onChange={e=>setEditForm({...editForm,notes:e.target.value})} style={{resize:"none"}}/></Field>
              </FormGrid>
              <div style={{display:"flex",gap:10,marginTop:24}}>
                <button className="btn-ghost" onClick={()=>setModal(null)} style={{flex:1,borderRadius:12,padding:14,fontFamily:"'JetBrains Mono',monospace",fontSize:12}}>ANNULER</button>
                <button className="btn-primary" onClick={submitEdit} style={{flex:2,background:"#FFE66D",color:"#080A0E",borderRadius:12,padding:14,fontSize:13,fontWeight:700}}>SAUVEGARDER ✓</button>
              </div>
            </>)}
          </div>
        </div>
      )}
    </div>
  );
}

function CompareBar({planned,done}){
  const items=[
    {label:"Distance",target:planned.targetDist,actual:done.dist,unit:"km"},
    {label:"Durée",target:planned.targetDur,actual:done.dur,unit:"min"},
    ...(planned.targetHR&&done.hr?[{label:"FC",target:planned.targetHR,actual:done.hr,unit:"bpm"}]:[]),
  ];
  return (
    <div style={{marginTop:14,display:"flex",flexDirection:"column",gap:8}}>
      {items.map(({label,target,actual,unit})=>{
        const diff=((actual-target)/target*100).toFixed(0);
        const ok=Math.abs(actual-target)/target<0.1;
        return (
          <div key={label}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:3,fontSize:11,fontFamily:"'JetBrains Mono',monospace"}}>
              <span style={{color:"#555"}}>{label}</span>
              <span><span style={{color:"#aaa"}}>{actual}{unit}</span><span style={{color:"#444"}}> / {target}{unit}</span><span style={{color:ok?"#4ECDC4":Math.abs(+diff)<20?"#FFE66D":"#FF6B6B",marginLeft:6}}>{+diff>0?"+":""}{diff}%</span></span>
            </div>
            <div style={{height:4,background:"#1C1F27",borderRadius:2}}>
              <div style={{height:4,width:`${Math.min(Math.abs(actual/target)*100,100)}%`,background:ok?"#4ECDC4":Math.abs(+diff)<20?"#FFE66D":"#FF6B6B",borderRadius:2}}/>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FormGrid({children}){return <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>{children}</div>;}
function Field({label,children,full}){
  return (
    <div style={{gridColumn:full?"span 2":"span 1"}}>
      <div style={{fontSize:9,color:"#555",letterSpacing:2,fontFamily:"'JetBrains Mono',monospace",marginBottom:6}}>{label}</div>
      {children}
    </div>
  );
}