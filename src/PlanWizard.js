// ─── PLAN WIZARD & SETTINGS ──────────────────────────────────────────
import { useState, useMemo } from "react";

const MARATHON_DATE = "2026-10-25";
const TODAY_STR     = new Date().toISOString().split('T')[0];

function parseDate(str) {
  const [y,m,d] = str.split('-'); return new Date(+y,+m-1,+d);
}
function addDays(str, n) {
  const dt = parseDate(str); dt.setDate(dt.getDate()+n);
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
}
function wkKey(str) {
  const dt = parseDate(str); const day = dt.getDay()||7;
  const m = new Date(dt); m.setDate(dt.getDate()-day+1);
  return `${m.getFullYear()}-${String(m.getMonth()+1).padStart(2,'0')}-${String(m.getDate()).padStart(2,'0')}`;
}

export function vmaToMinKm(vma, pct) { return 60 / (vma * pct); }
export function fmtPace(minKm) {
  const m = Math.floor(minKm); const s = Math.round((minKm-m)*60);
  return `${m}'${String(s).padStart(2,'0')}"`;
}
function parsePaceInput(str) {
  const clean = str.replace(/"/g,'').trim();
  const parts = clean.split(/[':]/);
  if(parts.length===2) return parseInt(parts[0]) + parseInt(parts[1])/60;
  return parseFloat(clean) || 6;
}

// ─── ÉCHAUFFEMENT/COOL-DOWN ──────────────────────────────────────────
// 10min EF avant + 10min EF après chaque séance intense
// dist EF approx: 10min à allure EF
function efWarmupDist(paceEf) { return Math.round((10 / paceEf) * 10) / 10; }

// ─── LIBRAIRIE VMA ───────────────────────────────────────────────────
export const VMA_EXERCISES = [
  {
    id: "400m",
    label: "10×400m",
    type: "vma",
    desc: "10 × 400m à VMA · récup 1min trot",
    detail: "Puissance aérobie pure. Développe la capacité maximale à consommer O₂.",
    difficulty: 3,
    icon: "▲▲",
    // Distance totale : 10×400m + récup trot (10×200m) + échauffement + cool-down
    distWork: 4.0, // km d'intervalles
    buildNotes: (pace, efPace) =>
      `Échauff. 10min ${efPace}/km · 10×400m à ${pace}/km · récup 1min trot · Cool-down 10min ${efPace}/km`,
    calcDist: (paceEf) => {
      const wd = efWarmupDist(paceEf);
      return Math.round((wd * 2 + 4.0 + 2.0) * 10) / 10; // intervalles + récup trot
    },
    calcDur: (paceVma, paceEf) => {
      const warmup = 10 + 10; // 2×10min
      const work = Math.round(10 * (0.4 * paceVma)); // 10×400m
      const recov = 10; // 10×1min trot
      return warmup + work + recov;
    },
  },
  {
    id: "600m",
    label: "8×600m",
    type: "vma",
    desc: "8 × 600m à VMA · récup 1min15 trot",
    detail: "Excellent compromis volume/intensité. Développe l'endurance à VMA.",
    difficulty: 3,
    icon: "▲▲",
    distWork: 4.8,
    buildNotes: (pace, efPace) =>
      `Échauff. 10min ${efPace}/km · 8×600m à ${pace}/km · récup 1'15 trot · Cool-down 10min ${efPace}/km`,
    calcDist: (paceEf) => {
      const wd = efWarmupDist(paceEf);
      return Math.round((wd * 2 + 4.8 + 1.6) * 10) / 10;
    },
    calcDur: (paceVma, paceEf) => {
      const warmup = 20;
      const work = Math.round(8 * (0.6 * paceVma));
      const recov = Math.round(8 * 1.25);
      return warmup + work + recov;
    },
  },
  {
    id: "1000m",
    label: "5×1000m",
    type: "vma",
    desc: "5 × 1000m à VMA · récup 1min45 trot",
    detail: "Volume de qualité élevé. Parfait en phase spécifique marathon.",
    difficulty: 3,
    icon: "▲",
    distWork: 5.0,
    buildNotes: (pace, efPace) =>
      `Échauff. 10min ${efPace}/km · 5×1000m à ${pace}/km · récup 1'45 trot · Cool-down 10min ${efPace}/km`,
    calcDist: (paceEf) => {
      const wd = efWarmupDist(paceEf);
      return Math.round((wd * 2 + 5.0 + 1.5) * 10) / 10;
    },
    calcDur: (paceVma, paceEf) => {
      const warmup = 20;
      const work = Math.round(5 * (1.0 * paceVma));
      const recov = Math.round(5 * 1.75);
      return warmup + work + recov;
    },
  },
  {
    id:"pyramide",
    label:"Pyramide",
    type: "vma",
    desc:"1-2-3-2-1 min à VMA · récup = durée effort",
    detail:"Variation qui rompt la monotonie. Bon pour travailler sans se bloquer sur un rythme.",
    difficulty: 2,
    icon: "△",
    distWork: 3.0,
    buildNotes: (pace, efPace) => `Échauff. 10min ${efPace}/km · Pyramide 1-2-3-2-1min à ${pace}/km · récup = durée · Cool-down 10min ${efPace}/km`,
    calcDist: (paceEf) => Math.round((efWarmupDist(paceEf)*2 + 3.0 + 1.5)*10)/10,
    calcDur: (paceVma, paceEf) => 20 + Math.round((1+2+3+2+1) * paceVma) + (1+2+3+2+1),
  },
  {
    id:"30_30",
    label:"30/30",
    type: "vma",
    desc:"20× 30s à 110% VMA / 30s récup · 2 séries",
    detail:"Parfait en phase de base pour habituer le corps à l'intensité sans surcharger.",
    difficulty: 1,
    icon: "〜",
    distWork: 2.5,
    buildNotes: (pace, efPace) => `Échauff. 10min ${efPace}/km · 2 séries 20×(30s à 110% VMA / 30s récup) · Cool-down 10min ${efPace}/km`,
    calcDist: (paceEf) => Math.round((efWarmupDist(paceEf)*2 + 2.5 + 2.5)*10)/10,
    calcDur: (paceVma, paceEf) => 20 + 20 + Math.round(2 * 20 * 0.5 * (paceVma * 0.9)),
  },
];

// ─── LIBRAIRIE SEUIL ─────────────────────────────────────────────────
export const TEMPO_EXERCISES = [
  {
    id: "2x2000",
    label: "3×2000m",
    type: "tempo",
    desc: "3 × 2000m au seuil · récup 2min trot",
    detail: "Développe l'endurance lactique. Idéal début de cycle seuil.",
    difficulty: 2,
    icon: "◇",
    distWork: 6.0,
    buildNotes: (pace, efPace) =>
      `Échauff. 10min ${efPace}/km · 3×2000m à ${pace}/km · récup 2min trot · Cool-down 10min ${efPace}/km`,
    calcDist: (paceEf) => Math.round((efWarmupDist(paceEf)*2 + 6.0 + 1.2)*10)/10,
    calcDur: (paceT, paceEf) => 20 + Math.round(3 * 2.0 * paceT) + 6,
  },
  {
    id: "2x3000",
    label: "2×3000m",
    type: "tempo",
    desc: "2 × 3000m au seuil · récup 3min trot",
    detail: "Volume seuil plus élevé. Renforce la résistance à l'allure marathon.",
    difficulty: 3,
    icon: "◇◇",
    distWork: 6.0,
    buildNotes: (pace, efPace) =>
      `Échauff. 10min ${efPace}/km · 2×3000m à ${pace}/km · récup 3min trot · Cool-down 10min ${efPace}/km`,
    calcDist: (paceEf) => Math.round((efWarmupDist(paceEf)*2 + 6.0 + 1.0)*10)/10,
    calcDur: (paceT, paceEf) => 20 + Math.round(2 * 3.0 * paceT) + 6,
  },
  {
    id: "tempo",
    label: "Tempo 25min",
    type: "tempo",
    desc: "25 min continu à allure seuil",
    detail: "Développe la résistance mentale et l'économie de course au seuil.",
    difficulty: 2,
    icon: "◇",
    distWork: 5.5,
    buildNotes: (pace, efPace) =>
      `Échauff. 10min ${efPace}/km · 25min continu à ${pace}/km · Cool-down 10min ${efPace}/km`,
    calcDist: (paceEf) => Math.round((efWarmupDist(paceEf)*2 + 5.5)*10)/10,
    calcDur: (paceT, paceEf) => 20 + 25,
  },
  {
    id: "progressif",
    label: "Run progressif",
    type: "tempo",
    desc: "10km : EF → allure marathon → seuil",
    detail: "Simule la course réelle. Très efficace en phase spécifique.",
    difficulty: 2,
    icon: "↗",
    distWork: 10.0,
    buildNotes: (pace, efPace) =>
      `4km ${efPace}/km → 3km allure marathon → 3km seuil ${pace}/km (pas d'échauff séparé)`,
    calcDist: () => 10.0,
    calcDur: (paceT, paceEf) => Math.round(4*paceEf + 3*(paceT*1.07) + 3*paceT),
  },
];

// ─── PROGRESSION RATES ───────────────────────────────────────────────
// Basé sur la littérature : progression différenciée par type de séance
// EF = progression principale · SL > EF · VMA/Seuil progressent moins vite
export const PROGRESSION_RATES = [
  {
    id: "flat",
    label: "0% — Volume stable",
    desc: "Maintien du volume. Idéal phase de maintien ou après blessure.",
    color: "#4ECDC4",
    weeklyPct: 0,
    // Multiplicateurs relatifs par type (base = EF)
    efMult: 1.00, slMult: 1.00, qualMult: 1.00,
  },
  {
    id: "prudent",
    label: "+5% — Prudent",
    desc: "Progression lente et sûre. Recommandé si volume > 50km/sem.",
    color: "#6BF178",
    weeklyPct: 5,
    efMult: 1.00, slMult: 1.15, qualMult: 0.80,
    // SL progresse 15% plus vite que le global · VMA/Seuil 20% moins vite
  },
  {
    id: "standard",
    label: "+8% — Standard",
    desc: "Progression classique. Règle des 10% respectée avec tolérance.",
    color: "#FFE66D",
    weeklyPct: 8,
    efMult: 1.00, slMult: 1.20, qualMult: 0.75,
  },
  {
    id: "ambitieux",
    label: "+10% — Ambitieux",
    desc: "Progression rapide. Nécessite un suivi attentif de la récupération.",
    color: "#FF9F43",
    weeklyPct: 10,
    efMult: 1.00, slMult: 1.25, qualMult: 0.70,
  },
];

const INTENSITY = {
  soft:      { label:"Douce",      mult:0.85, color:"#4ECDC4", desc:"Volume réduit. Idéal reprise ou prévention blessure." },
  standard:  { label:"Standard",   mult:1.00, color:"#FFE66D", desc:"Plan équilibré. Recommandé pour un premier marathon." },
  ambitious: { label:"Ambitieuse", mult:1.15, color:"#FF6B6B", desc:"Volume élevé. Sub-3h30 réaliste. 4 séances/semaine." },
};

const DAYS_OF_WEEK = [
  {dow:1,short:"LUN"},{dow:2,short:"MAR"},{dow:3,short:"MER"},
  {dow:4,short:"JEU"},{dow:5,short:"VEN"},{dow:6,short:"SAM"},{dow:0,short:"DIM"},
];

// ─── DEFAULT CONFIG ───────────────────────────────────────────────────
export function defaultConfig(vma=15.24) {
  return {
    vma,
    nbWeeks: 16,
    targetWeeklyKm: 42,        // ← NOUVEAU : volume cible hebdo
    progressionRate: "standard", // ← NOUVEAU : taux de progression
    runDays: [2,4,6,0],
    intensity: "standard",
    // Multi-sélection VMA et Seuil
    vmaExercises: ["400m","1000m"],   // ← NOUVEAU : liste (rotation)
    tempoExercises: ["2x2000","tempo"], // ← NOUVEAU : liste (rotation)
    // Gardé pour rétro-compatibilité
    vmaExercise: "400m",
    tempoExercise: "2x2000",
    paces: {
      ef:    parseFloat((vmaToMinKm(vma,0.70)).toFixed(3)),
      tempo: parseFloat((vmaToMinKm(vma,0.875)).toFixed(3)),
      vma:   parseFloat((vmaToMinKm(vma,1.00)).toFixed(3)),
      sl:    parseFloat((vmaToMinKm(vma,0.65)).toFixed(3)),
    },
    weekTemplate: [
      {slot:0, type:"Endurance fondamentale"},
      {slot:1, type:"Fractionné / VMA"},
      {slot:2, type:"Endurance fondamentale"},
      {slot:3, type:"Sortie longue"},
    ],
    weekTemplateB: [
      {slot:0, type:"Endurance fondamentale"},
      {slot:1, type:"Tempo / Seuil"},
      {slot:2, type:"Endurance fondamentale"},
      {slot:3, type:"Sortie longue"},
    ],
  };
}

// ─── PLAN GENERATOR ──────────────────────────────────────────────────
export function generatePlanFromConfig(config, existingPlanned=[]) {
  const {
    runDays, intensity, paces, weekTemplate, weekTemplateB, nbWeeks,
    targetWeeklyKm = 42,
    progressionRate = "standard",
    vmaExercises = ["400m"],
    tempoExercises = ["2x2000"],
  } = config;

  const intConf   = INTENSITY[intensity] || INTENSITY.standard;
  const progConf  = PROGRESSION_RATES.find(r=>r.id===progressionRate) || PROGRESSION_RATES[2];

  const efPace    = fmtPace(paces.ef);
  const tempoPace = fmtPace(paces.tempo);
  const vmaPace   = fmtPace(paces.vma);
  const slPace    = fmtPace(paces.sl);

  // Séances en rotation
  const vmaList   = vmaExercises.map(id => VMA_EXERCISES.find(e=>e.id===id)).filter(Boolean);
  const tempoList = tempoExercises.map(id => TEMPO_EXERCISES.find(e=>e.id===id)).filter(Boolean);
  const vmaExFallback   = VMA_EXERCISES[0];
  const tempoExFallback = TEMPO_EXERCISES[0];

  // Compteurs de rotation
  let vmaRotIdx   = 0;
  let tempoRotIdx = 0;

  const planEndDate = addDays(TODAY_STR, (nbWeeks || 16) * 7);
  const endDate = planEndDate < MARATHON_DATE ? planEndDate : MARATHON_DATE;

  const existingDates = new Set(
    existingPlanned
      .filter(p => !p.generated && parseDate(p.date) > parseDate(TODAY_STR))
      .map(p => p.date)
  );

  const sessions = [];
  let cur = parseDate(addDays(TODAY_STR, 1));
  const end = parseDate(endDate);
  let weekNum = 0;
  let lastMonday = wkKey(TODAY_STR);

  while(cur <= end) {
    const ds = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}-${String(cur.getDate()).padStart(2,'0')}`;
    const curWk = wkKey(ds);
    if(curWk !== lastMonday) { weekNum++; lastMonday = curWk; }

    const dow = cur.getDay();
    const slotIdx = runDays.indexOf(dow);
    if(slotIdx === -1) { cur.setDate(cur.getDate()+1); continue; }
    if(existingDates.has(ds)) { cur.setDate(cur.getDate()+1); continue; }

    const w = weekNum;

    // ── Semaines de décharge automatiques (toutes les 3 semaines de build) ──
    const isRecoveryWeek = progConf.weeklyPct > 0 && (w > 0) && (w % 4 === 3);
    const isEvalWeek     = [0, 6, 12, 18].includes(w);

    // ── Volume de base adapté à la progression ──────────────────────
    // Volume hebdo cible = targetWeeklyKm × (1 + weeklyPct/100)^semaine
    const growthFactor = isRecoveryWeek
      ? Math.pow(1 + progConf.weeklyPct/100, Math.max(0, w-1)) * 0.80
      : Math.pow(1 + progConf.weeklyPct/100, w);
    const baseVol = targetWeeklyKm * growthFactor * intConf.mult;

    // Distribution du volume selon les types (% du volume hebo)
    // SL ~28%, EF×2 ~50%, VMA/Seuil ~22%
    const slTargetDist   = baseVol * 0.28 * progConf.slMult;
    const efTargetDist   = baseVol * 0.25; // par séance EF (×2 = 50%)
    // qualTargetDist retiré (non utilisé)

    const activeTpl = (weekNum % 2 === 0) ? weekTemplate : (weekTemplateB || weekTemplate);
    const tplSlot   = activeTpl.find(s=>s.slot===slotIdx);
    const sessionType = tplSlot?.type || "Endurance fondamentale";

    let session = null;

    // ── ÉVALUATION VMA (priorité absolue) ───────────────────────────
    if(isEvalWeek && sessionType==="Fractionné / VMA") {
      session = {
        type:"Évaluation VMA", targetDist:6, targetDur:40, targetHR:null,
        notes:"Test 6 min à fond sur piste · note la distance couverte → recalibre ta VMA dans les réglages",
      };
      cur.setDate(cur.getDate()+1); // skip rotation increment
    }

    // ── ENDURANCE FONDAMENTALE ───────────────────────────────────────
    else if(sessionType==="Endurance fondamentale") {
      const dist = Math.round(Math.max(6, Math.min(efTargetDist, 18)) * 10) / 10;
      const dur  = Math.round(dist * paces.ef);
      session = {
        type:"Endurance fondamentale", targetDist:dist, targetDur:dur, targetHR:148,
        notes:`Zone 2 · ${efPace}/km · FC 140–152 · conversation possible`,
      };
    }

    // ── SORTIE LONGUE ────────────────────────────────────────────────
    else if(sessionType==="Sortie longue") {
      const raw  = Math.max(10, Math.min(slTargetDist, 35));
      const dist = Math.round(raw * 10) / 10;
      const dur  = Math.round(dist * paces.sl);
      // Notes adaptées selon la distance
      const slNote = dist >= 28
        ? `SL longue · ${slPace}/km · ravitaillement toutes les 30min · simulation marathon`
        : dist >= 20
          ? `SL progressive · ${slPace}/km · derniers 5km à ${fmtPace(paces.tempo * 1.05)}/km`
          : `SL · ${slPace}/km · zone 2 stricte · hydratation toutes les 20min`;
      session = { type:"Sortie longue", targetDist:dist, targetDur:dur, targetHR:148, notes:slNote };
    }

    // ── FRACTIONNÉ / VMA (rotation) ─────────────────────────────────
    else if(sessionType==="Fractionné / VMA") {
      const ex = vmaList.length > 0
        ? vmaList[vmaRotIdx % vmaList.length]
        : vmaExFallback;
      vmaRotIdx++;

      const dist = ex.calcDist(paces.ef);
      const dur  = ex.calcDur(paces.vma, paces.ef);
      session = {
        type:"Fractionné / VMA", targetDist:dist, targetDur:dur, targetHR:178,
        notes: ex.buildNotes(vmaPace, efPace),
      };
    }

    // ── TEMPO / SEUIL (rotation) ─────────────────────────────────────
    else if(sessionType==="Tempo / Seuil") {
      const ex = tempoList.length > 0
        ? tempoList[tempoRotIdx % tempoList.length]
        : tempoExFallback;
      tempoRotIdx++;

      const dist = ex.calcDist(paces.ef);
      const dur  = ex.calcDur(paces.tempo, paces.ef);
      session = {
        type:"Tempo / Seuil", targetDist:dist, targetDur:dur, targetHR:168,
        notes: ex.buildNotes(tempoPace, efPace),
      };
    }

    // ── FOOTING ─────────────────────────────────────────────────────
    else if(sessionType==="Footing") {
      const dist = Math.round(Math.max(4, baseVol * 0.12) * 10) / 10;
      const dur  = Math.round(dist * paces.ef + 5);
      session = {
        type:"Footing", targetDist:dist, targetDur:dur, targetHR:138,
        notes:`Récupération active · allure libre · relâchement total`,
      };
    }

    // ── TAPER (affûtage — dernières 3 semaines) ─────────────────────
    const weeksLeft = Math.ceil((parseDate(MARATHON_DATE) - cur) / (7*86400000));
    if(weeksLeft <= 3 && session) {
      const taperFactor = weeksLeft === 3 ? 0.70 : weeksLeft === 2 ? 0.55 : 0.40;
      session.targetDist = Math.round(Math.max(session.targetDist * taperFactor, 3) * 10) / 10;
      session.targetDur  = Math.round(session.targetDist * (session.type==="Sortie longue"?paces.sl:paces.ef));
      session.notes = `[AFFÛTAGE] ${session.notes}`;
    }

    // ── RACE DAY ────────────────────────────────────────────────────
    if(ds === MARATHON_DATE) {
      session = {
        type:"Course", targetDist:42.195, targetDur:210, targetHR:null,
        notes:"🏅 MARATHON DE LILLE · Sub-3h30 · 4'58\"/km · PROFITE !",
      };
    }

    if(session) {
      sessions.push({
        id: `gen-${ds}-${slotIdx}`,
        date: ds,
        ...session,
        generated: true,
        configSnapshot: JSON.stringify({ intensity, progressionRate, vmaExercises, tempoExercises }),
      });
    }

    cur.setDate(cur.getDate()+1);
  }

  return sessions;
}

// ═══════════════════════════════════════════════════════════════════
// ── WIZARD ─────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════

const STEP_LABELS = ["Jours","Durée","Volume","Semaines","Allures","Séances","Aperçu"];

const TYPEMETA = {
  "Endurance fondamentale":{color:"#6BF178",icon:"◈"},
  "Fractionné / VMA":{color:"#FF6B6B",icon:"▲▲"},
  "Tempo / Seuil":{color:"#FF9F43",icon:"◇"},
  "Sortie longue":{color:"#C77DFF",icon:"◈◈◈"},
  "Footing":{color:"#A8DADC",icon:"〜"},
};

const SESSION_TYPES = ["Endurance fondamentale","Fractionné / VMA","Tempo / Seuil","Sortie longue","Footing"];

export function PlanWizard({ onComplete, onCancel, initialConfig, vma }) {
  const [step, setStep] = useState(0);
  const [cfg, setCfg]   = useState(() => {
    const base = initialConfig || defaultConfig(vma);
    // Assurer rétro-compat : si vmaExercises absent, dériver de vmaExercise
    if(!base.vmaExercises)   base.vmaExercises   = [base.vmaExercise || "400m"];
    if(!base.tempoExercises) base.tempoExercises = [base.tempoExercise || "2x2000"];
    if(!base.targetWeeklyKm) base.targetWeeklyKm = 42;
    if(!base.progressionRate) base.progressionRate = "standard";
    return base;
  });

  const [paceInputs, setPaceInputs] = useState({
    ef:    fmtPace(cfg.paces.ef),
    tempo: fmtPace(cfg.paces.tempo),
    vma:   fmtPace(cfg.paces.vma),
    sl:    fmtPace(cfg.paces.sl),
  });

  function update(patch) { setCfg(c=>({...c,...patch})); }

  function commitPaces() {
    update({ paces:{
      ef:    parsePaceInput(paceInputs.ef),
      tempo: parsePaceInput(paceInputs.tempo),
      vma:   parsePaceInput(paceInputs.vma),
      sl:    parsePaceInput(paceInputs.sl),
    }});
  }

  function resetPacesFromVMA() {
    const v = cfg.vma;
    const p = {
      ef:    fmtPace(vmaToMinKm(v,0.70)),
      tempo: fmtPace(vmaToMinKm(v,0.875)),
      vma:   fmtPace(vmaToMinKm(v,1.00)),
      sl:    fmtPace(vmaToMinKm(v,0.65)),
    };
    setPaceInputs(p);
    update({ paces:{ ef:vmaToMinKm(v,0.70), tempo:vmaToMinKm(v,0.875), vma:vmaToMinKm(v,1.00), sl:vmaToMinKm(v,0.65) }});
  }

  function toggleExercise(listKey, id) {
    const current = cfg[listKey] || [];
    const next = current.includes(id)
      ? current.filter(x=>x!==id)
      : [...current, id];
    if(next.length === 0) return; // au moins 1 sélectionné
    update({ [listKey]: next });
  }

  const endDate = addDays(TODAY_STR, (cfg.nbWeeks||16)*7);
  const endFmt  = parseDate(endDate).toLocaleDateString("fr-FR",{day:"numeric",month:"long",year:"numeric"});

  // Aperçu semaines A/B
  const previewWeeks = useMemo(()=>{
    const dow2name={0:"Dim",1:"Lun",2:"Mar",3:"Mer",4:"Jeu",5:"Ven",6:"Sam"};
    const vmaEx   = VMA_EXERCISES.find(e=>e.id===(cfg.vmaExercises||["400m"])[0]) || VMA_EXERCISES[0];
    const tempoEx = TEMPO_EXERCISES.find(e=>e.id===(cfg.tempoExercises||["2x2000"])[0]) || TEMPO_EXERCISES[0];
    const meta = {
      "Endurance fondamentale":{dist:10,dur:Math.round(10*cfg.paces.ef),notes:`${fmtPace(cfg.paces.ef)}/km · Zone 2`},
      "Fractionné / VMA":{
        dist:vmaEx.calcDist(cfg.paces.ef),
        dur:vmaEx.calcDur(cfg.paces.vma,cfg.paces.ef),
        notes:vmaEx.buildNotes(fmtPace(cfg.paces.vma),fmtPace(cfg.paces.ef)),
      },
      "Tempo / Seuil":{
        dist:tempoEx.calcDist(cfg.paces.ef),
        dur:tempoEx.calcDur(cfg.paces.tempo,cfg.paces.ef),
        notes:tempoEx.buildNotes(fmtPace(cfg.paces.tempo),fmtPace(cfg.paces.ef)),
      },
      "Sortie longue":{dist:Math.round(cfg.targetWeeklyKm*0.28),dur:Math.round(cfg.targetWeeklyKm*0.28*cfg.paces.sl),notes:`${fmtPace(cfg.paces.sl)}/km · Zone 2`},
      "Footing":{dist:6,dur:Math.round(6*cfg.paces.ef+5),notes:"Récupération légère"},
    };
    return ["A","B"].map(week=>{
      const tplKey = week==="A"?"weekTemplate":"weekTemplateB";
      const tpl = cfg[tplKey] || cfg.weekTemplate;
      return {
        week,
        sessions: cfg.runDays.map((dow,slotIdx)=>{
          const slot = tpl.find(s=>s.slot===slotIdx);
          const type = slot?.type || "Footing";
          const m = meta[type]||meta["Footing"];
          return {dow, dayName:dow2name[dow], type, ...m};
        })
      };
    });
  },[cfg]);

  const css = `
    .wiz-btn{transition:all .15s;border:none;cursor:pointer;font-family:'JetBrains Mono',monospace}
    .day-pill{transition:all .15s;border:2px solid #1C1F27;cursor:pointer;border-radius:10px;padding:8px 6px;background:transparent;font-family:'JetBrains Mono',monospace;font-size:10px;text-align:center;flex:1}
    .ex-card{transition:all .15s;border:2px solid #1C1F27;cursor:pointer;border-radius:12px;padding:14px;background:#080A0E;text-align:left;width:100%}
    .ex-card:hover{border-color:#333}
    .ex-card.sel-vma{border-color:#FF6B6B;background:#2b0d0d}
    .ex-card.sel-tempo{border-color:#FF9F43;background:#2b1a00}
    .wiz-inp{background:#080A0E;border:1px solid #1C1F27;color:#E8E4DC;border-radius:8px;padding:10px 12px;font-size:14px;font-family:'JetBrains Mono',monospace;width:100%;outline:none}
    .wiz-inp:focus{border-color:#444}
    .weeks-btn{border:2px solid #1C1F27;background:transparent;color:#555;border-radius:10px;width:44px;height:44px;font-size:18px;cursor:pointer;font-family:'JetBrains Mono',monospace;transition:all .15s}
    .weeks-btn:hover{border-color:#444;color:#aaa}
    .prog-card{border:2px solid #1C1F27;cursor:pointer;border-radius:12px;padding:14px 16px;background:#080A0E;text-align:left;width:100%;transition:all .15s}
  `;

  return (
    <div style={{background:"#0F1117",borderRadius:"20px 20px 0 0",padding:24,maxHeight:"90vh",overflowY:"auto",paddingBottom:"calc(24px + env(safe-area-inset-bottom,12px))"}}>
      <style>{css}</style>

      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <div>
          <div style={{fontSize:10,color:"#00D2FF",letterSpacing:3,fontFamily:"'JetBrains Mono',monospace"}}>⚡ PLAN INTELLIGENT</div>
          <div style={{fontSize:18,fontWeight:800,marginTop:2}}>{STEP_LABELS[step]}</div>
        </div>
        <button onClick={onCancel} style={{background:"transparent",border:"none",color:"#555",fontSize:22,cursor:"pointer"}}>✕</button>
      </div>

      {/* Progress bar */}
      <div style={{display:"flex",gap:4,marginBottom:24}}>
        {STEP_LABELS.map((_,i)=>(
          <div key={i} style={{flex:1,height:3,borderRadius:2,background:i<=step?"#00D2FF":"#1C1F27"}}/>
        ))}
      </div>

      {/* ── STEP 0 : Jours ── */}
      {step===0 && (
        <div>
          <div style={{fontSize:12,color:"#888",fontFamily:"'JetBrains Mono',monospace",marginBottom:16,lineHeight:1.6}}>
            Choisis tes jours de course. 4 jours recommandés pour un plan marathon.
          </div>
          <div style={{display:"flex",gap:6,marginBottom:16}}>
            {DAYS_OF_WEEK.map(({dow,short})=>{
              const sel = cfg.runDays.includes(dow);
              return (
                <button key={dow} className="day-pill"
                  style={{borderColor:sel?"#00D2FF":"#1C1F27",color:sel?"#00D2FF":"#555",background:sel?"#001a24":"transparent"}}
                  onClick={()=>{
                    if(sel && cfg.runDays.length<=2) return;
                    update({runDays: sel
                      ? cfg.runDays.filter(d=>d!==dow)
                      : [...cfg.runDays,dow].sort((a,b)=>[1,2,3,4,5,6,0].indexOf(a)-[1,2,3,4,5,6,0].indexOf(b))
                    });
                  }}>
                  {short}
                </button>
              );
            })}
          </div>
          <div style={{fontSize:11,color:"#555",fontFamily:"'JetBrains Mono',monospace"}}>
            {cfg.runDays.length} jour{cfg.runDays.length>1?"s":""} · {cfg.runDays.length<4?"⚠ 4 jours recommandés":"✓ Optimal"}
          </div>
        </div>
      )}

      {/* ── STEP 1 : Durée ── */}
      {step===1 && (
        <div>
          <div style={{fontSize:12,color:"#888",fontFamily:"'JetBrains Mono',monospace",marginBottom:24,lineHeight:1.6}}>
            Durée du plan en semaines.
          </div>
          <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:20,marginBottom:24}}>
            <button className="weeks-btn" onClick={()=>update({nbWeeks:Math.max(1,(cfg.nbWeeks||16)-1)})}>−</button>
            <div style={{textAlign:"center"}}>
              <div style={{fontSize:48,fontWeight:800,color:"#00D2FF",lineHeight:1}}>{cfg.nbWeeks||16}</div>
              <div style={{fontSize:12,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginTop:4}}>semaines</div>
            </div>
            <button className="weeks-btn" onClick={()=>update({nbWeeks:Math.min(32,(cfg.nbWeeks||16)+1)})}>+</button>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {[
              {weeks:16,label:"Maintien",desc:"Volume stable · 38–42km",color:"#4ECDC4"},
              {weeks:4, label:"Transition",desc:"Montée progressive",color:"#FFE66D"},
              {weeks:11,label:"Prépa spécifique",desc:"Août → mi-octobre",color:"#FF9F43"},
              {weeks:3, label:"Affûtage",desc:"2–3 semaines avant · −30%",color:"#C77DFF"},
            ].map(({weeks,label,desc,color})=>(
              <button key={weeks} onClick={()=>update({nbWeeks:weeks})} style={{
                border:`2px solid ${(cfg.nbWeeks||16)===weeks?color:"#1C1F27"}`,
                background:(cfg.nbWeeks||16)===weeks?color+"11":"#080A0E",
                borderRadius:10,padding:"12px 14px",cursor:"pointer",textAlign:"left",
              }}>
                <div style={{display:"flex",justifyContent:"space-between"}}>
                  <span style={{fontSize:13,fontWeight:700,color:(cfg.nbWeeks||16)===weeks?color:"#aaa"}}>{label}</span>
                  <span style={{fontSize:16,fontWeight:800,color:(cfg.nbWeeks||16)===weeks?color:"#333",fontFamily:"'JetBrains Mono',monospace"}}>{weeks} sem.</span>
                </div>
                <div style={{fontSize:10,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginTop:3}}>{desc}</div>
              </button>
            ))}
          </div>
          <div style={{marginTop:14,padding:"10px 14px",background:"#080A0E",borderRadius:8,border:"1px solid #1C1F27"}}>
            <div style={{fontSize:10,color:"#555",fontFamily:"'JetBrains Mono',monospace"}}>FIN DU PLAN</div>
            <div style={{fontSize:13,color:"#E8E4DC",fontFamily:"'JetBrains Mono',monospace",marginTop:3}}>{endFmt}</div>
          </div>
        </div>
      )}

      {/* ── STEP 2 : Volume & Progression ── */}
      {step===2 && (
        <div>
          {/* Volume cible */}
          <div style={{fontSize:10,color:"#555",letterSpacing:2,fontFamily:"'JetBrains Mono',monospace",marginBottom:12}}>VOLUME CIBLE HEBDOMADAIRE</div>
          <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:16,marginBottom:8}}>
            <button className="weeks-btn" onClick={()=>update({targetWeeklyKm:Math.max(20,(cfg.targetWeeklyKm||42)-2)})}>−</button>
            <div style={{textAlign:"center"}}>
              <div style={{fontSize:48,fontWeight:800,color:"#6BF178",lineHeight:1}}>{cfg.targetWeeklyKm||42}</div>
              <div style={{fontSize:12,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginTop:4}}>km / semaine</div>
            </div>
            <button className="weeks-btn" onClick={()=>update({targetWeeklyKm:Math.min(80,(cfg.targetWeeklyKm||42)+2)})}>+</button>
          </div>
          {/* Presets volume */}
          <div style={{display:"flex",gap:6,marginBottom:24}}>
            {[{km:35,label:"Débutant"},{km:42,label:"Intermédiaire"},{km:55,label:"Confirmé"},{km:65,label:"Avancé"}].map(({km,label})=>(
              <button key={km} onClick={()=>update({targetWeeklyKm:km})} style={{
                flex:1,border:`1px solid ${(cfg.targetWeeklyKm||42)===km?"#6BF178":"#1C1F27"}`,
                background:(cfg.targetWeeklyKm||42)===km?"#0d2b0f":"transparent",
                color:(cfg.targetWeeklyKm||42)===km?"#6BF178":"#555",
                borderRadius:8,padding:"6px 4px",cursor:"pointer",
                fontFamily:"'JetBrains Mono',monospace",fontSize:9,textAlign:"center",
              }}>
                <div style={{fontWeight:700,marginBottom:2}}>{km}km</div>
                <div>{label}</div>
              </button>
            ))}
          </div>

          {/* Taux de progression */}
          <div style={{fontSize:10,color:"#555",letterSpacing:2,fontFamily:"'JetBrains Mono',monospace",marginBottom:12}}>TAUX DE PROGRESSION HEBDOMADAIRE</div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {PROGRESSION_RATES.map(rate=>{
              const sel = (cfg.progressionRate||"standard") === rate.id;
              return (
                <button key={rate.id} className="prog-card" onClick={()=>update({progressionRate:rate.id})}
                  style={{borderColor:sel?rate.color:"#1C1F27",background:sel?rate.color+"11":"#080A0E"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                    <span style={{fontSize:13,fontWeight:700,color:sel?rate.color:"#aaa",fontFamily:"'Syne',sans-serif"}}>{rate.label}</span>
                    {sel && <span style={{color:rate.color,fontSize:14}}>✓</span>}
                  </div>
                  <div style={{fontSize:11,color:"#666",fontFamily:"'JetBrains Mono',monospace",lineHeight:1.5}}>{rate.desc}</div>
                  {sel && rate.weeklyPct > 0 && (
                    <div style={{marginTop:8,fontSize:10,color:"#444",fontFamily:"'JetBrains Mono',monospace",borderTop:`1px solid ${rate.color}22`,paddingTop:6}}>
                      EF : +{rate.weeklyPct}%/sem · SL : +{Math.round(rate.weeklyPct*rate.slMult)}%/sem · Qualité : +{Math.round(rate.weeklyPct*rate.qualMult)}%/sem · Décharge S4
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── STEP 3 : Semaines A/B ── */}
      {step===3 && (
        <div>
          <div style={{fontSize:12,color:"#888",fontFamily:"'JetBrains Mono',monospace",marginBottom:12,lineHeight:1.6}}>
            Deux semaines types qui alternent.
          </div>
          {["A","B"].map(week=>{
            const isA = week==="A";
            const tplKey = isA?"weekTemplate":"weekTemplateB";
            const tpl = cfg[tplKey] || cfg.weekTemplate;
            const wColor = isA?"#00D2FF":"#C77DFF";
            return (
              <div key={week} style={{marginBottom:20}}>
                <div style={{fontSize:10,color:wColor,letterSpacing:2,fontFamily:"'JetBrains Mono',monospace",marginBottom:10,padding:"5px 10px",background:wColor+"11",borderRadius:8,border:`1px solid ${wColor}33`,display:"inline-block"}}>
                  SEM. {week} {isA?"(impaires)":"(paires)"}
                </div>
                {cfg.runDays.map((dow,slotIdx)=>{
                  const dow2name={0:"Dim",1:"Lun",2:"Mar",3:"Mer",4:"Jeu",5:"Ven",6:"Sam"};
                  const slot = tpl.find(s=>s.slot===slotIdx);
                  const current = slot?.type || "Footing";
                  const tm = TYPEMETA[current]||TYPEMETA["Footing"];
                  return (
                    <div key={dow} style={{marginBottom:10}}>
                      <div style={{fontSize:10,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginBottom:5}}>{dow2name[dow]}</div>
                      <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                        {SESSION_TYPES.map(type=>{
                          const t=TYPEMETA[type]||TYPEMETA["Footing"];
                          const isSel=current===type;
                          return (
                            <button key={type} onClick={()=>{
                              const newTpl=tpl.filter(s=>s.slot!==slotIdx);
                              newTpl.push({slot:slotIdx,type});
                              update({[tplKey]:newTpl});
                            }} style={{border:`2px solid ${isSel?t.color:"#1C1F27"}`,background:isSel?t.color+"22":"transparent",color:isSel?t.color:"#555",borderRadius:8,padding:"5px 8px",fontSize:9,cursor:"pointer",fontFamily:"'JetBrains Mono',monospace"}}>
                              {type.split(' ')[0]}
                            </button>
                          );
                        })}
                      </div>
                      <div style={{fontSize:10,color:tm.color,fontFamily:"'JetBrains Mono',monospace",marginTop:3}}>{tm.icon} {current}</div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {/* ── STEP 4 : Allures ── */}
      {step===4 && (
        <div>
          <div style={{fontSize:12,color:"#888",fontFamily:"'JetBrains Mono',monospace",marginBottom:4,lineHeight:1.6}}>
            Allures pré-remplies depuis ta VMA {cfg.vma} km/h.
          </div>
          <button onClick={resetPacesFromVMA} style={{fontSize:10,color:"#00D2FF",background:"transparent",border:"1px solid #00D2FF44",borderRadius:6,padding:"4px 10px",cursor:"pointer",fontFamily:"'JetBrains Mono',monospace",marginBottom:18}}>
            ↺ Recalculer depuis VMA
          </button>
          {[
            {key:"ef",   label:"Endurance fondamentale", hint:"65–72% VMA · Zone 2", color:"#6BF178"},
            {key:"sl",   label:"Sortie longue",           hint:"60–68% VMA · Zone 2 stricte", color:"#C77DFF"},
            {key:"tempo",label:"Tempo / Seuil",           hint:"85–90% VMA · seuil lactique", color:"#FF9F43"},
            {key:"vma",  label:"Fractionné / VMA",        hint:"95–105% VMA", color:"#FF6B6B"},
          ].map(({key,label,hint,color})=>(
            <div key={key} style={{marginBottom:16}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                <div style={{fontSize:11,color,fontFamily:"'JetBrains Mono',monospace"}}>{label}</div>
                <div style={{fontSize:10,color:"#555",fontFamily:"'JetBrains Mono',monospace"}}>{hint}</div>
              </div>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <input className="wiz-inp" value={paceInputs[key]}
                  onChange={e=>setPaceInputs(p=>({...p,[key]:e.target.value}))}
                  onBlur={commitPaces}
                  placeholder="ex: 5'30&quot;"
                  style={{borderColor:color+"44"}}/>
                <div style={{fontSize:11,color:"#555",fontFamily:"'JetBrains Mono',monospace",flexShrink:0}}>/km</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── STEP 5 : Séances VMA & Seuil (multi-select) ── */}
      {step===5 && (
        <div>
          {/* VMA */}
          <div style={{fontSize:10,color:"#FF6B6B",letterSpacing:2,fontFamily:"'JetBrains Mono',monospace",marginBottom:4}}>▲▲ SÉANCES VMA — sélectionne celles à intégrer (rotation)</div>
          <div style={{fontSize:11,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginBottom:12,lineHeight:1.5}}>
            {(cfg.vmaExercises||[]).length} sélectionnée{(cfg.vmaExercises||[]).length>1?"s":""} · elles alternent à chaque séance VMA
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:24}}>
            {VMA_EXERCISES.map(ex=>{
              const sel = (cfg.vmaExercises||[]).includes(ex.id);
              return (
                <button key={ex.id} className={`ex-card${sel?" sel-vma":""}`} onClick={()=>toggleExercise("vmaExercises", ex.id)}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                    <div style={{flex:1}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                        <div style={{fontSize:14,fontWeight:700,color:sel?"#FF6B6B":"#aaa"}}>{ex.label}</div>
                        {sel && <span style={{fontSize:10,color:"#FF6B6B",border:"1px solid #FF6B6B44",borderRadius:4,padding:"1px 6px",fontFamily:"'JetBrains Mono',monospace"}}>✓ INCLUS</span>}
                      </div>
                      <div style={{fontSize:11,color:"#888",fontFamily:"'JetBrains Mono',monospace"}}>{ex.desc}</div>
                      {sel && <div style={{fontSize:10,color:"#FF6B6B99",fontFamily:"'JetBrains Mono',monospace",marginTop:6,lineHeight:1.5}}>{ex.detail}</div>}
                    </div>
                    <div style={{display:"flex",gap:3,marginLeft:10,flexShrink:0}}>
                      {Array.from({length:3}).map((_,i)=>(
                        <div key={i} style={{width:6,height:6,borderRadius:1,background:i<ex.difficulty?"#FF6B6B":"#1C1F27"}}/>
                      ))}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Seuil */}
          <div style={{fontSize:10,color:"#FF9F43",letterSpacing:2,fontFamily:"'JetBrains Mono',monospace",marginBottom:4}}>◇ SÉANCES SEUIL — sélectionne celles à intégrer (rotation)</div>
          <div style={{fontSize:11,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginBottom:12}}>
            {(cfg.tempoExercises||[]).length} sélectionnée{(cfg.tempoExercises||[]).length>1?"s":""}
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {TEMPO_EXERCISES.map(ex=>{
              const sel = (cfg.tempoExercises||[]).includes(ex.id);
              return (
                <button key={ex.id} className={`ex-card${sel?" sel-tempo":""}`} onClick={()=>toggleExercise("tempoExercises", ex.id)}
                  style={{borderColor:sel?"#FF9F43":"#1C1F27",background:sel?"#2b1a00":"#080A0E"}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                    <div style={{fontSize:14,fontWeight:700,color:sel?"#FF9F43":"#aaa"}}>{ex.label}</div>
                    {sel && <span style={{fontSize:10,color:"#FF9F43",border:"1px solid #FF9F4344",borderRadius:4,padding:"1px 6px",fontFamily:"'JetBrains Mono',monospace"}}>✓ INCLUS</span>}
                  </div>
                  <div style={{fontSize:11,color:"#888",fontFamily:"'JetBrains Mono',monospace"}}>{ex.desc}</div>
                  {sel && <div style={{fontSize:10,color:"#FF9F4399",fontFamily:"'JetBrains Mono',monospace",marginTop:6,lineHeight:1.5}}>{ex.detail}</div>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── STEP 6 : Aperçu ── */}
      {step===6 && (
        <div>
          <div style={{fontSize:12,color:"#888",fontFamily:"'JetBrains Mono',monospace",marginBottom:14,lineHeight:1.6}}>
            Aperçu type sur {cfg.nbWeeks} semaines · Volume cible {cfg.targetWeeklyKm}km/sem.
          </div>
          {/* Résumé config */}
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:16}}>
            <span style={{fontSize:10,padding:"4px 10px",borderRadius:20,background:"#001a24",color:"#00D2FF",fontFamily:"'JetBrains Mono',monospace"}}>{cfg.nbWeeks} semaines</span>
            <span style={{fontSize:10,padding:"4px 10px",borderRadius:20,background:"#0d2b0f",color:"#6BF178",fontFamily:"'JetBrains Mono',monospace"}}>{cfg.targetWeeklyKm}km/sem</span>
            <span style={{fontSize:10,padding:"4px 10px",borderRadius:20,background:PROGRESSION_RATES.find(r=>r.id===cfg.progressionRate)?.color+"22"||"#1C1F27",color:PROGRESSION_RATES.find(r=>r.id===cfg.progressionRate)?.color||"#555",fontFamily:"'JetBrains Mono',monospace"}}>
              {PROGRESSION_RATES.find(r=>r.id===cfg.progressionRate)?.label||""}
            </span>
            <span style={{fontSize:10,padding:"4px 10px",borderRadius:20,background:"#2b0d0d",color:"#FF6B6B",fontFamily:"'JetBrains Mono',monospace"}}>
              VMA : {(cfg.vmaExercises||[]).map(id=>VMA_EXERCISES.find(e=>e.id===id)?.label).join(" · ")}
            </span>
            <span style={{fontSize:10,padding:"4px 10px",borderRadius:20,background:"#2b1a00",color:"#FF9F43",fontFamily:"'JetBrains Mono',monospace"}}>
              Seuil : {(cfg.tempoExercises||[]).map(id=>TEMPO_EXERCISES.find(e=>e.id===id)?.label).join(" · ")}
            </span>
          </div>
          {/* Semaines type */}
          {previewWeeks.map(({week,sessions})=>{
            const wColor = week==="A"?"#00D2FF":"#C77DFF";
            const totalKm = sessions.reduce((s,ss)=>s+ss.dist,0);
            return (
              <div key={week} style={{marginBottom:16}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                  <div style={{fontSize:10,color:wColor,letterSpacing:2,fontFamily:"'JetBrains Mono',monospace",padding:"4px 10px",background:wColor+"11",borderRadius:6,display:"inline-block"}}>SEM. {week}</div>
                  <div style={{fontSize:10,color:"#888",fontFamily:"'JetBrains Mono',monospace"}}>{totalKm.toFixed(0)} km estimés</div>
                </div>
                {sessions.map(s=>{
                  const tm=TYPEMETA[s.type]||TYPEMETA["Footing"];
                  return (
                    <div key={s.dow} style={{padding:"11px 14px",marginBottom:5,background:"#080A0E",border:`1px solid ${tm.color}22`,borderLeft:`3px solid ${tm.color}`,borderRadius:10}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3}}>
                        <div style={{fontSize:10,color:"#555",fontFamily:"'JetBrains Mono',monospace"}}>{s.dayName}</div>
                        <div style={{fontSize:12,fontWeight:700}}>{s.dist} km · ~{s.dur} min</div>
                      </div>
                      <div style={{fontSize:10,color:tm.color,fontFamily:"'JetBrains Mono',monospace"}}>{tm.icon} {s.type}</div>
                    </div>
                  );
                })}
              </div>
            );
          })}
          <div style={{padding:"12px",background:"#080A0E",borderRadius:8,fontSize:11,color:"#555",fontFamily:"'JetBrains Mono',monospace",lineHeight:1.6}}>
            💡 Séances VMA et Seuil tournent en rotation · décharge automatique toutes les 4 semaines · séances passées et manuelles protégées.
          </div>
        </div>
      )}

      {/* Navigation */}
      <div style={{display:"flex",gap:10,marginTop:24}}>
        <button onClick={step===0?onCancel:()=>setStep(s=>s-1)}
          style={{flex:1,background:"transparent",border:"1px solid #222",borderRadius:12,padding:14,color:"#888",cursor:"pointer",fontFamily:"'JetBrains Mono',monospace",fontSize:12}}>
          {step===0?"ANNULER":"← RETOUR"}
        </button>
        {step<6
          ? <button onClick={()=>{commitPaces();setStep(s=>s+1);}}
              style={{flex:2,background:"#00D2FF",color:"#080A0E",border:"none",borderRadius:12,padding:14,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"'JetBrains Mono',monospace"}}>
              SUIVANT →
            </button>
          : <button onClick={()=>onComplete(cfg)}
              style={{flex:2,background:"#6BF178",color:"#080A0E",border:"none",borderRadius:12,padding:14,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"'JetBrains Mono',monospace"}}>
              ⚡ GÉNÉRER LE PLAN
            </button>
        }
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ── SETTINGS PAGE ──────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════

export function PlanSettings({ config, onUpdate, onRegenerate, onOpenWizard, isRegenerating }) {
  const [paceInputs, setPaceInputs] = useState({
    ef:    fmtPace(config.paces.ef),
    tempo: fmtPace(config.paces.tempo),
    vma:   fmtPace(config.paces.vma),
    sl:    fmtPace(config.paces.sl),
  });

  function commitPaces() {
    onUpdate({ paces:{
      ef:    parsePaceInput(paceInputs.ef),
      tempo: parsePaceInput(paceInputs.tempo),
      vma:   parsePaceInput(paceInputs.vma),
      sl:    parsePaceInput(paceInputs.sl),
    }});
  }

  const TYPEMETA2={
    "Endurance fondamentale":{color:"#6BF178",icon:"◈"},
    "Fractionné / VMA":{color:"#FF6B6B",icon:"▲▲"},
    "Tempo / Seuil":{color:"#FF9F43",icon:"◇"},
    "Sortie longue":{color:"#C77DFF",icon:"◈◈◈"},
    "Footing":{color:"#A8DADC",icon:"〜"},
  };
  const SESSION_TYPES2=["Endurance fondamentale","Fractionné / VMA","Tempo / Seuil","Sortie longue","Footing"];
  const DOW2NAME={0:"Dim",1:"Lun",2:"Mar",3:"Mer",4:"Jeu",5:"Ven",6:"Sam"};
  const nbWeeks = config.nbWeeks || 16;
  const endDate = addDays(TODAY_STR, nbWeeks*7);
  const endFmt  = parseDate(endDate).toLocaleDateString("fr-FR",{day:"numeric",month:"long",year:"numeric"});
  const vmaExercises   = config.vmaExercises   || [config.vmaExercise   || "400m"];
  const tempoExercises = config.tempoExercises || [config.tempoExercise || "2x2000"];
  const targetWeeklyKm = config.targetWeeklyKm || 42;
  const progressionRate = config.progressionRate || "standard";

  function toggleEx(listKey, id) {
    const current = (config[listKey] || []);
    const next = current.includes(id) ? current.filter(x=>x!==id) : [...current, id];
    if(next.length === 0) return;
    onUpdate({ [listKey]: next });
  }

  return (
    <div>
      {/* Durée */}
      <div style={{fontSize:10,color:"#555",letterSpacing:3,fontFamily:"'JetBrains Mono',monospace",marginBottom:10}}>DURÉE DU PLAN</div>
      <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:6}}>
        <button onClick={()=>onUpdate({nbWeeks:Math.max(1,nbWeeks-1)})} style={{border:"2px solid #1C1F27",background:"transparent",color:"#555",borderRadius:8,width:36,height:36,fontSize:16,cursor:"pointer"}}>−</button>
        <div style={{flex:1,textAlign:"center"}}>
          <span style={{fontSize:28,fontWeight:800,color:"#00D2FF"}}>{nbWeeks}</span>
          <span style={{fontSize:12,color:"#555",fontFamily:"'JetBrains Mono',monospace"}}> semaines</span>
        </div>
        <button onClick={()=>onUpdate({nbWeeks:Math.min(32,nbWeeks+1)})} style={{border:"2px solid #1C1F27",background:"transparent",color:"#555",borderRadius:8,width:36,height:36,fontSize:16,cursor:"pointer"}}>+</button>
      </div>
      <div style={{fontSize:10,color:"#444",fontFamily:"'JetBrains Mono',monospace",marginBottom:20}}>Fin : {endFmt}</div>

      {/* Volume cible */}
      <div style={{fontSize:10,color:"#555",letterSpacing:3,fontFamily:"'JetBrains Mono',monospace",marginBottom:10}}>VOLUME CIBLE HEBDOMADAIRE</div>
      <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:6}}>
        <button onClick={()=>onUpdate({targetWeeklyKm:Math.max(20,targetWeeklyKm-2)})} style={{border:"2px solid #1C1F27",background:"transparent",color:"#555",borderRadius:8,width:36,height:36,fontSize:16,cursor:"pointer"}}>−</button>
        <div style={{flex:1,textAlign:"center"}}>
          <span style={{fontSize:28,fontWeight:800,color:"#6BF178"}}>{targetWeeklyKm}</span>
          <span style={{fontSize:12,color:"#555",fontFamily:"'JetBrains Mono',monospace"}}> km/sem</span>
        </div>
        <button onClick={()=>onUpdate({targetWeeklyKm:Math.min(80,targetWeeklyKm+2)})} style={{border:"2px solid #1C1F27",background:"transparent",color:"#555",borderRadius:8,width:36,height:36,fontSize:16,cursor:"pointer"}}>+</button>
      </div>
      <div style={{fontSize:10,color:"#444",fontFamily:"'JetBrains Mono',monospace",marginBottom:20}}>
        SL cible : ~{Math.round(targetWeeklyKm*0.28)}km · EF : ~{Math.round(targetWeeklyKm*0.25)}km/séance
      </div>

      {/* Progression */}
      <div style={{fontSize:10,color:"#555",letterSpacing:3,fontFamily:"'JetBrains Mono',monospace",marginBottom:10}}>TAUX DE PROGRESSION</div>
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:20}}>
        {PROGRESSION_RATES.map(rate=>{
          const sel = progressionRate===rate.id;
          return (
            <button key={rate.id} onClick={()=>onUpdate({progressionRate:rate.id})} style={{
              border:`2px solid ${sel?rate.color:"#1C1F27"}`,
              background:sel?rate.color+"22":"transparent",
              color:sel?rate.color:"#555",
              borderRadius:10,padding:"8px 10px",fontSize:10,cursor:"pointer",
              fontFamily:"'JetBrains Mono',monospace",textAlign:"center",
            }}>
              {rate.id==="flat"?"Stable":rate.label.split(" ")[0]}
            </button>
          );
        })}
      </div>

      {/* Jours */}
      <div style={{fontSize:10,color:"#555",letterSpacing:3,fontFamily:"'JetBrains Mono',monospace",marginBottom:10}}>JOURS DE COURSE</div>
      <div style={{display:"flex",gap:6,marginBottom:20}}>
        {DAYS_OF_WEEK.map(({dow,short})=>{
          const sel=config.runDays.includes(dow);
          return (
            <button key={dow} onClick={()=>{
              if(sel&&config.runDays.length<=2) return;
              onUpdate({runDays:sel?config.runDays.filter(d=>d!==dow):[...config.runDays,dow].sort((a,b)=>{const o=[1,2,3,4,5,6,0];return o.indexOf(a)-o.indexOf(b);})});
            }} style={{flex:1,border:`2px solid ${sel?"#00D2FF":"#1C1F27"}`,color:sel?"#00D2FF":"#555",background:sel?"#001a24":"transparent",borderRadius:8,padding:"8px 4px",fontSize:10,cursor:"pointer",fontFamily:"'JetBrains Mono',monospace"}}>{short}</button>
          );
        })}
      </div>

      {/* Semaines A/B */}
      <div style={{fontSize:10,color:"#555",letterSpacing:3,fontFamily:"'JetBrains Mono',monospace",marginBottom:10}}>SEMAINES TYPE (A/B)</div>
      {["A","B"].map(week=>{
        const isA=week==="A";
        const tplKey=isA?"weekTemplate":"weekTemplateB";
        const tpl=config[tplKey]||config.weekTemplate;
        const wColor=isA?"#00D2FF":"#C77DFF";
        return (
          <div key={week} style={{marginBottom:16}}>
            <div style={{fontSize:10,color:wColor,fontFamily:"'JetBrains Mono',monospace",marginBottom:8,padding:"3px 10px",background:wColor+"11",borderRadius:6,display:"inline-block",letterSpacing:2}}>
              SEM. {week} {isA?"(impaires)":"(paires)"}
            </div>
            {config.runDays.map((dow,slotIdx)=>{
              const slot=tpl.find(s=>s.slot===slotIdx);
              const current=slot?.type||"Footing";
              const tm=TYPEMETA2[current]||TYPEMETA2["Footing"];
              return (
                <div key={dow} style={{marginBottom:10}}>
                  <div style={{fontSize:10,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginBottom:5}}>{DOW2NAME[dow]||"?"}</div>
                  <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                    {SESSION_TYPES2.map(type=>{
                      const t=TYPEMETA2[type]||TYPEMETA2["Footing"];
                      const isSel=current===type;
                      return (
                        <button key={type} onClick={()=>{const newTpl=tpl.filter(s=>s.slot!==slotIdx);newTpl.push({slot:slotIdx,type});onUpdate({[tplKey]:newTpl});}}
                          style={{border:`2px solid ${isSel?t.color:"#1C1F27"}`,background:isSel?t.color+"22":"transparent",color:isSel?t.color:"#555",borderRadius:8,padding:"5px 8px",fontSize:9,cursor:"pointer",fontFamily:"'JetBrains Mono',monospace"}}>
                          {type.split(' ')[0]}
                        </button>
                      );
                    })}
                  </div>
                  <div style={{fontSize:10,color:tm.color,fontFamily:"'JetBrains Mono',monospace",marginTop:4}}>{tm.icon} {current}</div>
                </div>
              );
            })}
          </div>
        );
      })}

      {/* Allures */}
      <div style={{fontSize:10,color:"#555",letterSpacing:3,fontFamily:"'JetBrains Mono',monospace",marginBottom:10,marginTop:8}}>ALLURES CIBLES</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:20}}>
        {[{key:"ef",label:"EF",color:"#6BF178"},{key:"sl",label:"SL",color:"#C77DFF"},{key:"tempo",label:"Seuil",color:"#FF9F43"},{key:"vma",label:"VMA",color:"#FF6B6B"}].map(({key,label,color})=>(
          <div key={key}>
            <div style={{fontSize:9,color,fontFamily:"'JetBrains Mono',monospace",marginBottom:4}}>{label} /km</div>
            <input style={{background:"#080A0E",border:`1px solid ${color}33`,color:"#E8E4DC",borderRadius:8,padding:"8px 10px",fontSize:13,fontFamily:"'JetBrains Mono',monospace",width:"100%",outline:"none"}}
              value={paceInputs[key]}
              onChange={e=>setPaceInputs(p=>({...p,[key]:e.target.value}))}
              onBlur={commitPaces}
              placeholder="ex: 5'30"/>
          </div>
        ))}
      </div>

      {/* VMA multi-select */}
      <div style={{fontSize:10,color:"#555",letterSpacing:3,fontFamily:"'JetBrains Mono',monospace",marginBottom:10}}>SÉANCES VMA (rotation)</div>
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:20}}>
        {VMA_EXERCISES.map(ex=>{
          const sel=vmaExercises.includes(ex.id);
          return (
            <button key={ex.id} onClick={()=>toggleEx("vmaExercises",ex.id)} style={{
              border:`2px solid ${sel?"#FF6B6B":"#1C1F27"}`,
              background:sel?"#2b0d0d":"transparent",
              color:sel?"#FF6B6B":"#555",
              borderRadius:8,padding:"6px 10px",fontSize:10,cursor:"pointer",fontFamily:"'JetBrains Mono',monospace",
            }}>{ex.label}</button>
          );
        })}
      </div>

      {/* Seuil multi-select */}
      <div style={{fontSize:10,color:"#555",letterSpacing:3,fontFamily:"'JetBrains Mono',monospace",marginBottom:10}}>SÉANCES SEUIL (rotation)</div>
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:24}}>
        {TEMPO_EXERCISES.map(ex=>{
          const sel=tempoExercises.includes(ex.id);
          return (
            <button key={ex.id} onClick={()=>toggleEx("tempoExercises",ex.id)} style={{
              border:`2px solid ${sel?"#FF9F43":"#1C1F27"}`,
              background:sel?"#2b1a00":"transparent",
              color:sel?"#FF9F43":"#555",
              borderRadius:8,padding:"6px 10px",fontSize:10,cursor:"pointer",fontFamily:"'JetBrains Mono',monospace",
            }}>{ex.label}</button>
          );
        })}
      </div>

      {/* Régénérer */}
      <button onClick={onRegenerate} style={{width:"100%",background:"#00D2FF",color:"#080A0E",border:"none",borderRadius:12,padding:16,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"'JetBrains Mono',monospace",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
        {isRegenerating?<span style={{display:"inline-block",animation:"spin 1s linear infinite"}}>↻</span>:"⚡ REGÉNÉRER LES SEMAINES FUTURES"}
      </button>
      <div style={{fontSize:10,color:"#444",fontFamily:"'JetBrains Mono',monospace",marginTop:8,textAlign:"center"}}>
        Séances passées et manuelles protégées.
      </div>
    </div>
  );
}