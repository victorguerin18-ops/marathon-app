// ─── PLAN WIZARD & SETTINGS ──────────────────────────────────────────
// Composant autonome : wizard first-run + page réglages permanente

import { useState, useMemo } from "react";

const MARATHON_DATE = "2026-10-25";
const TODAY_STR     = "2026-03-11";

// ── Date helpers ──────────────────────────────────────────────────────
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

// ── Allure helpers ────────────────────────────────────────────────────
export function vmaToMinKm(vma, pct) { return 60 / (vma * pct); }
export function fmtPace(minKm) {
  const m = Math.floor(minKm); const s = Math.round((minKm-m)*60);
  return `${m}'${String(s).padStart(2,'0')}"`;
}
function parsePaceInput(str) {
  // accepts "5'30"" or "5:30" or "5.5"
  const clean = str.replace(/"/g,'').trim();
  const parts = clean.split(/[':]/);
  if(parts.length===2) return parseInt(parts[0]) + parseInt(parts[1])/60;
  return parseFloat(clean) || 6;
}

// ── VMA exercise library ──────────────────────────────────────────────
export const VMA_EXERCISES = [
  {
    id:"6x3",
    label:"6×3 min",
    desc:"6 répétitions de 3 min à VMA · récup 90s trot",
    detail:"Classique de développement VMA. Bon compromis volume/intensité.",
    totalWork:18,
    icon:"▲",
    difficulty:2,
    buildNotes: (pace, phase) => `6×3min à ${pace}/km · récup 90s trot · ${phase==='base'?'allure soutenue':'VMA franche'}`,
  },
  {
    id:"10x1",
    label:"10×1 min",
    desc:"10 répétitions de 1 min à 105% VMA · récup 1min",
    detail:"Idéal pour développer la puissance maximale. Très intense mais courte.",
    totalWork:10,
    icon:"▲▲",
    difficulty:3,
    buildNotes: (pace, phase) => `10×1min à 105% VMA (${pace}/km) · récup 1min marche/trot`,
  },
  {
    id:"3x8",
    label:"3×8 min",
    desc:"3 répétitions de 8 min à 95% VMA · récup 3min",
    detail:"Développe la capacité à tenir VMA longtemps. Demande de la régularité.",
    totalWork:24,
    icon:"▲",
    difficulty:3,
    buildNotes: (pace, phase) => `3×8min à 95% VMA (${pace}/km) · récup 3min trot · régularité`,
  },
  {
    id:"pyramide",
    label:"Pyramide",
    desc:"1-2-3-2-1 min à VMA · récup = durée effort",
    detail:"Variation qui rompt la monotonie. Bon pour travailler sans se bloquer sur un rythme.",
    totalWork:9,
    icon:"△",
    difficulty:2,
    buildNotes: (pace, phase) => `Pyramide 1-2-3-2-1min à ${pace}/km · récup = durée effort`,
  },
  {
    id:"30_30",
    label:"30/30",
    desc:"15–20× 30s à 110% VMA / 30s récup · série de 15min",
    detail:"Parfait en phase de base pour habituer le corps à l'intensité sans se blesser.",
    totalWork:10,
    icon:"〜",
    difficulty:1,
    buildNotes: (pace, phase) => `20×(30s à 110% VMA / 30s récup) · 2 séries · ${pace}/km à vitesse`,
  },
];

// ── Tempo exercise library ────────────────────────────────────────────
export const TEMPO_EXERCISES = [
  {
    id:"2x20",
    label:"2×20 min",
    desc:"2 répétitions de 20 min au seuil · récup 5min",
    detail:"Développe l'endurance au seuil. Le classique des plans marathon.",
    buildNotes: (pace) => `2×20min à ${pace}/km · récup 5min trot léger`,
  },
  {
    id:"3x10",
    label:"3×10 min",
    desc:"3 répétitions de 10 min au seuil · récup 3min",
    detail:"Plus abordable que le 2×20, bon point d'entrée seuil.",
    buildNotes: (pace) => `3×10min à ${pace}/km · récup 3min trot`,
  },
  {
    id:"continu",
    label:"Tempo continu",
    desc:"30–40 min en continu à allure seuil",
    detail:"Pour les semaines de charge haute. Développe la résistance mentale.",
    buildNotes: (pace) => `35min continu à ${pace}/km · allure seuil régulière`,
  },
  {
    id:"progressif",
    label:"Run progressif",
    desc:"10km progressif : EF → allure marathon → seuil",
    detail:"Simule la course réelle. Très efficace en phase marathon.",
    buildNotes: (pace) => `10km progressif : 4km EF → 3km allure marathon → 3km seuil ${pace}/km`,
  },
];

// ── Phase intensity multipliers ───────────────────────────────────────
const INTENSITY = {
  soft:      { label:"Douce",      mult:0.85, slMult:0.80, color:"#4ECDC4", desc:"Volume réduit, progression lente. Idéal si tu reprends ou tu es blessé." },
  standard:  { label:"Standard",   mult:1.00, slMult:1.00, color:"#FFE66D", desc:"Plan équilibré, progression régulière. Recommandé pour un premier marathon." },
  ambitious: { label:"Ambitieuse", mult:1.15, slMult:1.20, color:"#FF6B6B", desc:"Volume élevé, objectif sub-3h30 réaliste. Nécessite 4 séances/semaine régulières." },
};

// ── Day names ─────────────────────────────────────────────────────────
const DAYS_OF_WEEK = [
  {dow:1, short:"LUN", long:"Lundi"},
  {dow:2, short:"MAR", long:"Mardi"},
  {dow:3, short:"MER", long:"Mercredi"},
  {dow:4, short:"JEU", long:"Jeudi"},
  {dow:5, short:"VEN", long:"Vendredi"},
  {dow:6, short:"SAM", long:"Samedi"},
  {dow:0, short:"DIM", long:"Dimanche"},
];

// ── Default config ────────────────────────────────────────────────────
export function defaultConfig(vma=15.24) {
  return {
    vma,
    runDays: [2,4,6,0], // Tue Thu Sat Sun
    intensity: "standard",
    vmaExercise: "6x3",
    tempoExercise: "2x20",
    paces: {
      ef:    parseFloat((vmaToMinKm(vma,0.70)).toFixed(3)),
      tempo: parseFloat((vmaToMinKm(vma,0.875)).toFixed(3)),
      vma:   parseFloat((vmaToMinKm(vma,1.00)).toFixed(3)),
      sl:    parseFloat((vmaToMinKm(vma,0.65)).toFixed(3)),
    },
    weekTemplate: [
      // slot 0-3 for runDays[0-3] — semaine A
      {slot:0, type:"Endurance fondamentale"},
      {slot:1, type:"Fractionné / VMA"},
      {slot:2, type:"Endurance fondamentale"},
      {slot:3, type:"Sortie longue"},
    ],
    weekTemplateB: [
      // semaine B — alternance
      {slot:0, type:"Endurance fondamentale"},
      {slot:1, type:"Tempo / Seuil"},
      {slot:2, type:"Endurance fondamentale"},
      {slot:3, type:"Sortie longue"},
    ],
  };
}

// ── Plan generator (pure function) ───────────────────────────────────
export function generatePlanFromConfig(config, existingPlanned=[]) {
  const { runDays, intensity, vmaExercise, tempoExercise, paces, weekTemplate, weekTemplateB } = config;
  const intConf = INTENSITY[intensity];
  const vmaEx   = VMA_EXERCISES.find(e=>e.id===vmaExercise) || VMA_EXERCISES[0];
  const tempoEx = TEMPO_EXERCISES.find(e=>e.id===tempoExercise) || TEMPO_EXERCISES[0];

  const efPace    = fmtPace(paces.ef);
  const tempoPace = fmtPace(paces.tempo);
  const vmaPace   = fmtPace(paces.vma);
  const slPace    = fmtPace(paces.sl);

  // Don't overwrite manually-created sessions (non-generated) in the future
  const existingDates = new Set(
    existingPlanned
      .filter(p => !p.generated && parseDate(p.date) > parseDate(TODAY_STR))
      .map(p => p.date)
  );

  const sessions = [];
  const startDate = addDays(TODAY_STR, 1);

  let cur = parseDate(startDate);
  const end = parseDate(MARATHON_DATE);
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
    const phase = w<=8?"base": w<=20?"specific": w<=28?"marathon":"taper";
    const isEvalWeek = [0,6,12,18,24].includes(w);
    const isRecoveryWeek = [4,9,14,19,24].includes(w);
    const recMult = isRecoveryWeek ? 0.75 : 1;
    const m = intConf.mult * recMult;
    const msl = intConf.slMult * recMult;

    // Map slot to type from weekTemplate A or B (alternating weeks)
    const activeTpl = (weekNum % 2 === 0) ? weekTemplate : (weekTemplateB || weekTemplate);
    const tplSlot = activeTpl.find(s=>s.slot===slotIdx);
    const sessionType = tplSlot?.type || ["Endurance fondamentale","Fractionné / VMA","Footing","Sortie longue"][slotIdx] || "Footing";

    let session = null;

    // ── Base phase S1–S8 ─────────────────────────────────────────────
    if(phase==="base") {
      if(sessionType==="Endurance fondamentale") {
        const dist = Math.round((8 + w*0.4) * m * 10)/10;
        const dur  = Math.round(dist * paces.ef);
        session = {type:"Endurance fondamentale",targetDist:dist,targetDur:dur,targetHR:148,
          notes:`Zone 2 · ${efPace}/km · FC 140–150 · conversation possible`};
      }
      if(sessionType==="Fractionné / VMA") {
        const dist = Math.round((6 + w*0.3) * m * 10)/10;
        const dur  = Math.round(dist * paces.ef + 10);
        if(isEvalWeek) {
          session={type:"Évaluation VMA",targetDist:6,targetDur:40,targetHR:null,
            notes:"Test 6 min à fond sur piste · note la distance couverte → recalibre ta VMA"};
        } else {
          session={type:"Fractionné / VMA",targetDist:dist,targetDur:dur,targetHR:175,
            notes:vmaEx.buildNotes(vmaPace,"base")};
        }
      }
      if(sessionType==="Footing") {
        const dist = Math.round(7 * m * 10)/10;
        const dur  = Math.round(dist * paces.ef + 5);
        session={type:"Footing",targetDist:dist,targetDur:dur,targetHR:138,
          notes:`Footing récup très léger · plus lent que ${efPace}/km · relâchement total`};
      }
      if(sessionType==="Sortie longue") {
        const dist = Math.round(Math.min(12+w*0.8, 22) * msl * 10)/10;
        const dur  = Math.round(dist * paces.sl);
        session={type:"Sortie longue",targetDist:dist,targetDur:dur,targetHR:145,
          notes:`SL · ${slPace}/km · zone 2 stricte · hydratation toutes les 20min`};
      }
      if(sessionType==="Tempo / Seuil") {
        const dist = Math.round(9 * m * 10)/10;
        const dur  = Math.round(dist * paces.tempo + 10);
        session={type:"Tempo / Seuil",targetDist:dist,targetDur:dur,targetHR:165,
          notes:tempoEx.buildNotes(tempoPace)};
      }
    }

    // ── Specific phase S9–S20 ────────────────────────────────────────
    if(phase==="specific") {
      const wInPhase = w-8;
      if(sessionType==="Endurance fondamentale") {
        const dist = Math.round((11 + wInPhase*0.3) * m * 10)/10;
        const dur  = Math.round(dist * paces.ef);
        session={type:"Endurance fondamentale",targetDist:dist,targetDur:dur,targetHR:148,
          notes:`Zone 2 · ${efPace}/km · peut inclure 4×100m de foulées en fin`};
      }
      if(sessionType==="Fractionné / VMA") {
        if(isEvalWeek) {
          session={type:"Évaluation VMA",targetDist:6,targetDur:40,targetHR:null,
            notes:"Test 6 min · compare avec la dernière éval · ajuste ta VMA"};
        } else {
          const dist = Math.round((8 + wInPhase*0.25) * m * 10)/10;
          const dur  = Math.round(dist * paces.ef + 12);
          session={type:"Fractionné / VMA",targetDist:dist,targetDur:dur,targetHR:178,
            notes:vmaEx.buildNotes(vmaPace,"specific")};
        }
      }
      if(sessionType==="Footing") {
        const dist = Math.round(9 * m * 10)/10;
        const dur  = Math.round(dist * paces.ef);
        session={type:"Footing",targetDist:dist,targetDur:dur,targetHR:140,
          notes:"EF milieu de semaine · maintien de la base aérobie"};
      }
      if(sessionType==="Sortie longue") {
        const dist = Math.round(Math.min(20+wInPhase*0.7,32) * msl * 10)/10;
        const dur  = Math.round(dist * paces.sl);
        session={type:"Sortie longue",targetDist:dist,targetDur:dur,targetHR:150,
          notes:`SL progressive · ${slPace}/km · derniers 5km à allure marathon ${tempoPace}`};
      }
      if(sessionType==="Tempo / Seuil") {
        const dist = Math.round((10 + wInPhase*0.2) * m * 10)/10;
        const dur  = Math.round(dist * paces.tempo + 12);
        session={type:"Tempo / Seuil",targetDist:dist,targetDur:dur,targetHR:168,
          notes:tempoEx.buildNotes(tempoPace)};
      }
    }

    // ── Marathon phase S21–S28 ───────────────────────────────────────
    if(phase==="marathon") {
      const wInPhase = w-20;
      const amPace = fmtPace(paces.tempo * 0.95); // ~allure marathon
      if(sessionType==="Endurance fondamentale") {
        const dist = Math.round(14 * m * 10)/10;
        const dur  = Math.round(dist * paces.ef);
        session={type:"Endurance fondamentale",targetDist:dist,targetDur:dur,targetHR:148,
          notes:`Zone 2 · ${efPace}/km · économie de course · foulée relâchée`};
      }
      if(sessionType==="Fractionné / VMA") {
        const dist = Math.round(10 * m * 10)/10;
        const dur  = Math.round(dist * paces.tempo + 10);
        session={type:"Tempo / Seuil",targetDist:dist,targetDur:dur,targetHR:168,
          notes:`Allure marathon ${amPace}/km · ${tempoEx.buildNotes(amPace)}`};
      }
      if(sessionType==="Footing") {
        const dist = Math.round(10 * m * 10)/10;
        const dur  = Math.round(dist * paces.ef);
        session={type:"Footing",targetDist:dist,targetDur:dur,targetHR:138,
          notes:"Récupération active · jambes fraîches pour la SL du week-end"};
      }
      if(sessionType==="Sortie longue") {
        const dist = Math.round(Math.min(28+wInPhase*1.2,35) * msl * 10)/10;
        const dur  = Math.round(dist * paces.sl);
        session={type:"Sortie longue",targetDist:dist,targetDur:dur,targetHR:150,
          notes:`SL longue · ${slPace}/km · ravitaillement · simulation marathon`};
      }
      if(sessionType==="Tempo / Seuil") {
        const dist = Math.round(12 * m * 10)/10;
        const dur  = Math.round(dist * paces.tempo);
        session={type:"Tempo / Seuil",targetDist:dist,targetDur:dur,targetHR:168,
          notes:tempoEx.buildNotes(tempoPace)};
      }
    }

    // ── Taper S29–S31 ────────────────────────────────────────────────
    if(phase==="taper") {
      const factor = w<=29?0.65:w<=30?0.50:0.35;
      if(sessionType==="Endurance fondamentale") {
        const dist = Math.round(12*factor*10)/10;
        session={type:"Endurance fondamentale",targetDist:dist,targetDur:Math.round(dist*paces.ef),targetHR:145,
          notes:`Affûtage · ${efPace}/km · volume réduit · intensité maintenue`};
      }
      if(sessionType==="Fractionné / VMA") {
        const dist = Math.round(8*factor*10)/10;
        session={type:"Fractionné / VMA",targetDist:dist,targetDur:Math.round(dist*paces.ef+8),targetHR:175,
          notes:`Courtes répétitions · 4×2min à ${vmaPace}/km · rester vif · jambes légères`};
      }
      if(sessionType==="Footing") {
        const dist = Math.round(6*factor*10)/10;
        session={type:"Footing",targetDist:Math.max(dist,3),targetDur:Math.round(Math.max(dist,3)*paces.ef),targetHR:135,
          notes:"Footing très léger · confiance mentale · pas de fatigue"};
      }
      if(sessionType==="Sortie longue") {
        const dist = Math.round(18*factor*10)/10;
        session={type:"Sortie longue",targetDist:Math.max(dist,8),targetDur:Math.round(Math.max(dist,8)*paces.sl),targetHR:145,
          notes:"SL courte · jambes fraîches · mémoriser la sensation marathon"};
      }
    }

    // ── Race day ─────────────────────────────────────────────────────
    if(ds===MARATHON_DATE) {
      session={type:"Course",targetDist:42.195,targetDur:210,targetHR:null,
        notes:"🏅 MARATHON DE LILLE · Objectif Sub-3h30 · 4'58\"/km · PROFITE !"};
    }

    if(session) {
      const id = `gen-${ds}-${slotIdx}`;
      sessions.push({
        id, date:ds, ...session,
        generated:true,
        configSnapshot: JSON.stringify({intensity,vmaExercise,tempoExercise}),
      });
    }

    cur.setDate(cur.getDate()+1);
  }

  return sessions;
}

// ═════════════════════════════════════════════════════════════════════
// ── WIZARD COMPONENT ─────────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════════

const STEP_LABELS = ["Jours","Semaine","Allures","Intensité","VMA","Aperçu"];

export function PlanWizard({ onComplete, onCancel, initialConfig, vma }) {
  const [step, setStep] = useState(0);
  const [cfg, setCfg]   = useState(() => initialConfig || defaultConfig(vma));
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
    update({ paces:{
      ef:    vmaToMinKm(v,0.70),
      tempo: vmaToMinKm(v,0.875),
      vma:   vmaToMinKm(v,1.00),
      sl:    vmaToMinKm(v,0.65),
    }});
  }

  const SESSION_TYPES = [
    "Endurance fondamentale","Fractionné / VMA","Tempo / Seuil","Sortie longue","Footing",
  ];

  const css = `
    .wiz-btn{transition:all .15s;border:none;cursor:pointer;font-family:'JetBrains Mono',monospace}
    .wiz-btn:hover{opacity:.85}
    .day-pill{transition:all .15s;border:2px solid #1C1F27;cursor:pointer;border-radius:10px;padding:8px 6px;background:transparent;font-family:'JetBrains Mono',monospace;font-size:10px;text-align:center;flex:1}
    .ex-card{transition:all .15s;border:2px solid #1C1F27;cursor:pointer;border-radius:12px;padding:14px;background:#080A0E;text-align:left;width:100%}
    .ex-card:hover{border-color:#333}
    .ex-card.selected{border-color:#FF6B6B;background:#2b0d0d}
    .tempo-card.selected{border-color:#FF9F43;background:#2b1a00}
    .wiz-inp{background:#080A0E;border:1px solid #1C1F27;color:#E8E4DC;border-radius:8px;padding:10px 12px;font-size:14px;font-family:'JetBrains Mono',monospace;width:100%;outline:none}
    .wiz-inp:focus{border-color:#444}
  `;

  // Preview: both weeks A and B
  const previewWeeks = useMemo(()=>{
    const dow2name={0:"Dim",1:"Lun",2:"Mar",3:"Mer",4:"Jeu",5:"Ven",6:"Sam"};
    const meta = {
      "Endurance fondamentale":{dist:10,dur:Math.round(10*cfg.paces.ef),notes:`${fmtPace(cfg.paces.ef)}/km · Zone 2`},
      "Fractionné / VMA":{dist:8, dur:Math.round(8*cfg.paces.ef+10),notes:VMA_EXERCISES.find(e=>e.id===cfg.vmaExercise)?.buildNotes(fmtPace(cfg.paces.vma),"base")||""},
      "Tempo / Seuil":{dist:10,dur:Math.round(10*cfg.paces.tempo+10),notes:TEMPO_EXERCISES.find(e=>e.id===cfg.tempoExercise)?.buildNotes(fmtPace(cfg.paces.tempo))||""},
      "Sortie longue":{dist:14,dur:Math.round(14*cfg.paces.sl),notes:`${fmtPace(cfg.paces.sl)}/km · Zone 2`},
      "Footing":{dist:7,dur:Math.round(7*cfg.paces.ef+5),notes:"Récupération légère"},
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
          return {dow,dayName:dow2name[dow],type,...m,slotIdx};
        })
      };
    });
  },[cfg]);

  const TYPEMETA={
    "Endurance fondamentale":{color:"#6BF178",icon:"◈"},
    "Fractionné / VMA":{color:"#FF6B6B",icon:"▲▲"},
    "Tempo / Seuil":{color:"#FF9F43",icon:"◇"},
    "Sortie longue":{color:"#C77DFF",icon:"◈◈◈"},
    "Footing":{color:"#A8DADC",icon:"〜"},
  };

  return (
    <div style={{background:"#0F1117",borderRadius:"20px 20px 0 0",padding:24,maxHeight:"90vh",overflowY:"auto",paddingBottom:"calc(24px + env(safe-area-inset-bottom, 12px))"}}>
      <style>{css}</style>

      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <div>
          <div style={{fontSize:10,color:"#00D2FF",letterSpacing:3,fontFamily:"'JetBrains Mono',monospace"}}>⚡ PLAN INTELLIGENT</div>
          <div style={{fontSize:18,fontWeight:800,marginTop:2}}>{STEP_LABELS[step]}</div>
        </div>
        <button onClick={onCancel} style={{background:"transparent",border:"none",color:"#555",fontSize:22,cursor:"pointer"}}>✕</button>
      </div>

      {/* Progress */}
      <div style={{display:"flex",gap:4,marginBottom:24}}>
        {STEP_LABELS.map((_,i)=>(
          <div key={i} style={{flex:1,height:3,borderRadius:2,background:i<=step?"#00D2FF":"#1C1F27"}}/>
        ))}
      </div>

      {/* ── STEP 0 : Jours ── */}
      {step===0 && (
        <div>
          <div style={{fontSize:12,color:"#888",fontFamily:"'JetBrains Mono',monospace",marginBottom:16,lineHeight:1.6}}>
            Choisis 4 jours de course. Tu pourras toujours ajouter une séance bonus ou en reporter une.
          </div>
          <div style={{display:"flex",gap:6,marginBottom:24}}>
            {DAYS_OF_WEEK.map(({dow,short})=>{
              const sel = cfg.runDays.includes(dow);
              return (
                <button key={dow} className="day-pill"
                  style={{borderColor:sel?"#00D2FF":"#1C1F27",color:sel?"#00D2FF":"#555",background:sel?"#001a24":"transparent"}}
                  onClick={()=>{
                    if(sel && cfg.runDays.length<=2) return;
                    update({runDays: sel ? cfg.runDays.filter(d=>d!==dow) : [...cfg.runDays,dow].sort((a,b)=>{
                      const order=[1,2,3,4,5,6,0];
                      return order.indexOf(a)-order.indexOf(b);
                    })});
                  }}>
                  {short}
                </button>
              );
            })}
          </div>
          <div style={{fontSize:11,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginBottom:4}}>
            {cfg.runDays.length} jour{cfg.runDays.length>1?"s":""} sélectionné{cfg.runDays.length>1?"s":""} · {cfg.runDays.length<4?"⚠ 4 jours recommandés":"✓ Optimal"}
          </div>
        </div>
      )}

      {/* ── STEP 1 : Semaine type A/B ── */}
      {step===1 && (
        <div>
          <div style={{fontSize:12,color:"#888",fontFamily:"'JetBrains Mono',monospace",marginBottom:12,lineHeight:1.6}}>
            Configure deux semaines types qui alternent (A une semaine, B la suivante). Parfait pour alterner VMA et Seuil.
          </div>

          {["A","B"].map(week=>{
            const isA = week==="A";
            const tplKey = isA?"weekTemplate":"weekTemplateB";
            const tpl = cfg[tplKey] || cfg.weekTemplate;
            const weekColor = isA?"#00D2FF":"#C77DFF";
            return (
              <div key={week} style={{marginBottom:20}}>
                <div style={{
                  fontSize:10,color:weekColor,letterSpacing:3,
                  fontFamily:"'JetBrains Mono',monospace",marginBottom:10,
                  padding:"6px 12px",background:weekColor+"11",
                  borderRadius:8,border:`1px solid ${weekColor}33`,
                  display:"inline-block"
                }}>
                  SEMAINE {week} {isA?"(semaines impaires)":"(semaines paires)"}
                </div>
                {cfg.runDays.map((dow,slotIdx)=>{
                  const dow2name={0:"Dimanche",1:"Lundi",2:"Mardi",3:"Mercredi",4:"Jeudi",5:"Vendredi",6:"Samedi"};
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
                            }} style={{
                              border:`2px solid ${isSel?t.color:"#1C1F27"}`,
                              background:isSel?t.color+"22":"transparent",
                              color:isSel?t.color:"#555",
                              borderRadius:8,padding:"5px 8px",
                              fontSize:9,cursor:"pointer",
                              fontFamily:"'JetBrains Mono',monospace",
                            }}>
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

      {/* ── STEP 2 : Allures ── */}
      {step===2 && (
        <div>
          <div style={{fontSize:12,color:"#888",fontFamily:"'JetBrains Mono',monospace",marginBottom:4,lineHeight:1.6}}>
            Allures pré-remplies depuis ta VMA {cfg.vma} km/h. Modifie-les librement.
          </div>
          <button onClick={resetPacesFromVMA} style={{fontSize:10,color:"#00D2FF",background:"transparent",border:"1px solid #00D2FF44",borderRadius:6,padding:"4px 10px",cursor:"pointer",fontFamily:"'JetBrains Mono',monospace",marginBottom:18}}>
            ↺ Recalculer depuis VMA
          </button>
          {[
            {key:"ef",   label:"Endurance fondamentale",hint:"Zone 2 · 65–75% VMA",color:"#6BF178"},
            {key:"sl",   label:"Sortie longue",          hint:"60–70% VMA · zone 2 stricte",color:"#C77DFF"},
            {key:"tempo",label:"Tempo / Seuil",          hint:"85–90% VMA · seuil lactique",color:"#FF9F43"},
            {key:"vma",  label:"Fractionné / VMA",       hint:"95–105% VMA · effort max",color:"#FF6B6B"},
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
                  placeholder={`ex: 5'30"`}
                  style={{borderColor:color+"44"}}/>
                <div style={{fontSize:11,color:"#555",fontFamily:"'JetBrains Mono',monospace",flexShrink:0}}>/km</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── STEP 3 : Intensité ── */}
      {step===3 && (
        <div>
          <div style={{fontSize:12,color:"#888",fontFamily:"'JetBrains Mono',monospace",marginBottom:16,lineHeight:1.6}}>
            Choisir l'intensité globale du plan. Les semaines de récupération (S4, S9…) sont automatiquement allégées de 25%.
          </div>
          {Object.entries(INTENSITY).map(([key,conf])=>(
            <button key={key} onClick={()=>update({intensity:key})}
              style={{width:"100%",marginBottom:10,border:`2px solid ${cfg.intensity===key?conf.color:"#1C1F27"}`,
                background:cfg.intensity===key?conf.color+"11":"#080A0E",
                borderRadius:12,padding:16,textAlign:"left",cursor:"pointer"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                <span style={{fontSize:14,fontWeight:700,color:cfg.intensity===key?conf.color:"#aaa",fontFamily:"'Syne',sans-serif"}}>{conf.label}</span>
                {cfg.intensity===key&&<span style={{color:conf.color,fontSize:12}}>✓</span>}
              </div>
              <div style={{fontSize:11,color:"#666",fontFamily:"'JetBrains Mono',monospace",lineHeight:1.5}}>{conf.desc}</div>
              <div style={{marginTop:8,fontSize:10,color:"#444",fontFamily:"'JetBrains Mono',monospace"}}>
                Volume : ×{conf.mult} · Sorties longues : ×{conf.slMult}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* ── STEP 4 : Exercices VMA & Tempo ── */}
      {step===4 && (
        <div>
          <div style={{fontSize:10,color:"#FF6B6B",letterSpacing:2,fontFamily:"'JetBrains Mono',monospace",marginBottom:8}}>▲▲ FORMAT VMA</div>
          <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:20}}>
            {VMA_EXERCISES.map(ex=>(
              <button key={ex.id} className={`ex-card${cfg.vmaExercise===ex.id?" selected":""}`}
                onClick={()=>update({vmaExercise:ex.id})}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div style={{fontSize:14,fontWeight:700,color:cfg.vmaExercise===ex.id?"#FF6B6B":"#aaa",fontFamily:"'Syne',sans-serif"}}>{ex.label}</div>
                  <div style={{display:"flex",gap:3}}>
                    {Array.from({length:3}).map((_,i)=>(
                      <div key={i} style={{width:6,height:6,borderRadius:1,background:i<ex.difficulty?"#FF6B6B":"#1C1F27"}}/>
                    ))}
                  </div>
                </div>
                <div style={{fontSize:11,color:"#888",fontFamily:"'JetBrains Mono',monospace",marginTop:4}}>{ex.desc}</div>
                {cfg.vmaExercise===ex.id&&(
                  <div style={{fontSize:10,color:"#FF6B6B",fontFamily:"'JetBrains Mono',monospace",marginTop:6,borderTop:"1px solid #2b0d0d",paddingTop:6}}>{ex.detail}</div>
                )}
              </button>
            ))}
          </div>

          <div style={{fontSize:10,color:"#FF9F43",letterSpacing:2,fontFamily:"'JetBrains Mono',monospace",marginBottom:8}}>◇ FORMAT TEMPO / SEUIL</div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {TEMPO_EXERCISES.map(ex=>(
              <button key={ex.id} className={`ex-card tempo-card${cfg.tempoExercise===ex.id?" selected":""}`}
                onClick={()=>update({tempoExercise:ex.id})}
                style={{borderColor:cfg.tempoExercise===ex.id?"#FF9F43":"#1C1F27",background:cfg.tempoExercise===ex.id?"#2b1a00":"#080A0E"}}>
                <div style={{fontSize:14,fontWeight:700,color:cfg.tempoExercise===ex.id?"#FF9F43":"#aaa",fontFamily:"'Syne',sans-serif"}}>{ex.label}</div>
                <div style={{fontSize:11,color:"#888",fontFamily:"'JetBrains Mono',monospace",marginTop:4}}>{ex.desc}</div>
                {cfg.tempoExercise===ex.id&&(
                  <div style={{fontSize:10,color:"#FF9F43",fontFamily:"'JetBrains Mono',monospace",marginTop:6,borderTop:"1px solid #2b1a00",paddingTop:6}}>{ex.detail}</div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── STEP 5 : Aperçu ── */}
      {step===5 && (
        <div>
          <div style={{fontSize:12,color:"#888",fontFamily:"'JetBrains Mono',monospace",marginBottom:16,lineHeight:1.6}}>
            Aperçu de tes deux semaines types. Elles alternent : semaine A (impaires), semaine B (paires).
          </div>

          {/* Config recap */}
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:16}}>
            <span style={{fontSize:10,padding:"4px 10px",borderRadius:20,background:"#001a24",color:"#00D2FF",fontFamily:"'JetBrains Mono',monospace"}}>
              VMA {cfg.vma} km/h
            </span>
            <span style={{fontSize:10,padding:"4px 10px",borderRadius:20,background:INTENSITY[cfg.intensity].color+"22",color:INTENSITY[cfg.intensity].color,fontFamily:"'JetBrains Mono',monospace"}}>
              {INTENSITY[cfg.intensity].label}
            </span>
            <span style={{fontSize:10,padding:"4px 10px",borderRadius:20,background:"#2b0d0d",color:"#FF6B6B",fontFamily:"'JetBrains Mono',monospace"}}>
              VMA : {VMA_EXERCISES.find(e=>e.id===cfg.vmaExercise)?.label}
            </span>
          </div>

          {/* Week A/B preview */}
          {previewWeeks.map(({week,sessions})=>{
            const wColor = week==="A"?"#00D2FF":"#C77DFF";
            return (
              <div key={week} style={{marginBottom:16}}>
                <div style={{fontSize:10,color:wColor,letterSpacing:2,fontFamily:"'JetBrains Mono',monospace",marginBottom:8,padding:"4px 10px",background:wColor+"11",borderRadius:6,display:"inline-block"}}>
                  SEMAINE {week}
                </div>
                {sessions.map(s=>{
                  const tm=TYPEMETA[s.type]||TYPEMETA["Footing"];
                  return (
                    <div key={s.dow} style={{padding:"12px 14px",marginBottom:6,background:"#080A0E",border:`1px solid ${tm.color}22`,borderLeft:`3px solid ${tm.color}`,borderRadius:10}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                        <div style={{fontSize:11,color:"#555",fontFamily:"'JetBrains Mono',monospace"}}>{s.dayName}</div>
                        <div style={{fontSize:12,fontWeight:700}}>{s.dist} km · ~{s.dur} min</div>
                      </div>
                      <div style={{fontSize:11,color:tm.color,fontFamily:"'JetBrains Mono',monospace"}}>{tm.icon} {s.type}</div>
                    </div>
                  );
                })}
              </div>
            );
          })}

          <div style={{marginTop:12,padding:"12px",background:"#080A0E",borderRadius:8,fontSize:11,color:"#555",fontFamily:"'JetBrains Mono',monospace",lineHeight:1.6}}>
            💡 Seules les séances futures non modifiées manuellement seront regénérées. Tes séances passées et personnalisées sont protégées.
          </div>
        </div>
      )}

      {/* Navigation */}
      <div style={{display:"flex",gap:10,marginTop:24}}>
        <button onClick={step===0?onCancel:()=>setStep(s=>s-1)}
          style={{flex:1,background:"transparent",border:"1px solid #222",borderRadius:12,padding:14,color:"#888",cursor:"pointer",fontFamily:"'JetBrains Mono',monospace",fontSize:12}}>
          {step===0?"ANNULER":"← RETOUR"}
        </button>
        {step<5?(
          <button onClick={()=>{commitPaces();setStep(s=>s+1);}}
            style={{flex:2,background:"#00D2FF",color:"#080A0E",border:"none",borderRadius:12,padding:14,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"'JetBrains Mono',monospace"}}>
            SUIVANT →
          </button>
        ):(
          <button onClick={()=>onComplete(cfg)}
            style={{flex:2,background:"#6BF178",color:"#080A0E",border:"none",borderRadius:12,padding:14,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"'JetBrains Mono',monospace"}}>
            ⚡ GÉNÉRER LE PLAN
          </button>
        )}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// ── SETTINGS PAGE (réglages permanents) ──────────────────────────────
// ═════════════════════════════════════════════════════════════════════

export function PlanSettings({ config, onUpdate, onRegenerate, isRegenerating }) {
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

  const TYPEMETA={
    "Endurance fondamentale":{color:"#6BF178",icon:"◈"},
    "Fractionné / VMA":{color:"#FF6B6B",icon:"▲▲"},
    "Tempo / Seuil":{color:"#FF9F43",icon:"◇"},
    "Sortie longue":{color:"#C77DFF",icon:"◈◈◈"},
    "Footing":{color:"#A8DADC",icon:"〜"},
  };
  const SESSION_TYPES=["Endurance fondamentale","Fractionné / VMA","Tempo / Seuil","Sortie longue","Footing"];
  const DOW2NAME={0:"Dim",1:"Lun",2:"Mar",3:"Mer",4:"Jeu",5:"Ven",6:"Sam"};

  return (
    <div>
      {/* Jours */}
      <div style={{fontSize:10,color:"#555",letterSpacing:3,fontFamily:"'JetBrains Mono',monospace",marginBottom:10}}>JOURS DE COURSE</div>
      <div style={{display:"flex",gap:6,marginBottom:20}}>
        {DAYS_OF_WEEK.map(({dow,short})=>{
          const sel=config.runDays.includes(dow);
          return (
            <button key={dow} onClick={()=>{
              if(sel&&config.runDays.length<=2) return;
              onUpdate({runDays:sel
                ?config.runDays.filter(d=>d!==dow)
                :[...config.runDays,dow].sort((a,b)=>{const o=[1,2,3,4,5,6,0];return o.indexOf(a)-o.indexOf(b);})
              });
            }} style={{
              flex:1,border:`2px solid ${sel?"#00D2FF":"#1C1F27"}`,
              color:sel?"#00D2FF":"#555",
              background:sel?"#001a24":"transparent",
              borderRadius:8,padding:"8px 4px",
              fontSize:10,cursor:"pointer",
              fontFamily:"'JetBrains Mono',monospace",
            }}>{short}</button>
          );
        })}
      </div>

      {/* Semaines A/B */}
      <div style={{fontSize:10,color:"#555",letterSpacing:3,fontFamily:"'JetBrains Mono',monospace",marginBottom:10}}>SEMAINES TYPE (A/B ALTERNÉES)</div>
      {["A","B"].map(week=>{
        const isA=week==="A";
        const tplKey=isA?"weekTemplate":"weekTemplateB";
        const tpl=config[tplKey]||config.weekTemplate;
        const wColor=isA?"#00D2FF":"#C77DFF";
        return (
          <div key={week} style={{marginBottom:16}}>
            <div style={{fontSize:10,color:wColor,fontFamily:"'JetBrains Mono',monospace",marginBottom:8,
              padding:"4px 10px",background:wColor+"11",borderRadius:6,display:"inline-block",letterSpacing:2}}>
              SEM. {week} {isA?"(impaires)":"(paires)"}
            </div>
            {config.runDays.map((dow,slotIdx)=>{
              const slot=tpl.find(s=>s.slot===slotIdx);
              const current=slot?.type||"Footing";
              const tm=TYPEMETA[current]||TYPEMETA["Footing"];
              return (
                <div key={dow} style={{marginBottom:10}}>
                  <div style={{fontSize:10,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginBottom:5}}>
                    {DOW2NAME[dow]||"?"}
                  </div>
                  <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                    {SESSION_TYPES.map(type=>{
                      const t=TYPEMETA[type]||TYPEMETA["Footing"];
                      const isSel=current===type;
                      return (
                        <button key={type} onClick={()=>{
                          const newTpl=tpl.filter(s=>s.slot!==slotIdx);
                          newTpl.push({slot:slotIdx,type});
                          onUpdate({[tplKey]:newTpl});
                        }} style={{
                          border:`2px solid ${isSel?t.color:"#1C1F27"}`,
                          background:isSel?t.color+"22":"transparent",
                          color:isSel?t.color:"#555",
                          borderRadius:8,padding:"5px 8px",
                          fontSize:9,cursor:"pointer",
                          fontFamily:"'JetBrains Mono',monospace",
                        }}>
                          {type.split(' ')[0]}
                        </button>
                      );
                    })}
                  </div>
                  <div style={{fontSize:10,color:tm.color,fontFamily:"'JetBrains Mono',monospace",marginTop:4}}>
                    {tm.icon} {current}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}

      {/* Allures */}
      <div style={{fontSize:10,color:"#555",letterSpacing:3,fontFamily:"'JetBrains Mono',monospace",marginBottom:10,marginTop:8}}>ALLURES CIBLES</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:20}}>
        {[
          {key:"ef",   label:"EF",    color:"#6BF178"},
          {key:"sl",   label:"SL",    color:"#C77DFF"},
          {key:"tempo",label:"Tempo", color:"#FF9F43"},
          {key:"vma",  label:"VMA",   color:"#FF6B6B"},
        ].map(({key,label,color})=>(
          <div key={key}>
            <div style={{fontSize:9,color,fontFamily:"'JetBrains Mono',monospace",marginBottom:4}}>{label} /km</div>
            <input style={{
              background:"#080A0E",border:`1px solid ${color}33`,
              color:"#E8E4DC",borderRadius:8,padding:"8px 10px",
              fontSize:13,fontFamily:"'JetBrains Mono',monospace",
              width:"100%",outline:"none",
            }}
              value={paceInputs[key]}
              onChange={e=>setPaceInputs(p=>({...p,[key]:e.target.value}))}
              onBlur={commitPaces}
              placeholder="ex: 5'30\""/>
          </div>
        ))}
      </div>

      {/* Intensité */}
      <div style={{fontSize:10,color:"#555",letterSpacing:3,fontFamily:"'JetBrains Mono',monospace",marginBottom:10}}>INTENSITÉ</div>
      <div style={{display:"flex",gap:6,marginBottom:20}}>
        {Object.entries(INTENSITY).map(([key,conf])=>(
          <button key={key} onClick={()=>onUpdate({intensity:key})}
            style={{
              flex:1,border:`2px solid ${config.intensity===key?conf.color:"#1C1F27"}`,
              background:config.intensity===key?conf.color+"22":"transparent",
              color:config.intensity===key?conf.color:"#555",
              borderRadius:10,padding:"8px 4px",fontSize:10,cursor:"pointer",
              fontFamily:"'JetBrains Mono',monospace",
            }}>
            {conf.label}
          </button>
        ))}
      </div>

      {/* VMA Exercise */}
      <div style={{fontSize:10,color:"#555",letterSpacing:3,fontFamily:"'JetBrains Mono',monospace",marginBottom:10}}>FORMAT VMA</div>
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:20}}>
        {VMA_EXERCISES.map(ex=>(
          <button key={ex.id} onClick={()=>onUpdate({vmaExercise:ex.id})}
            style={{
              border:`2px solid ${config.vmaExercise===ex.id?"#FF6B6B":"#1C1F27"}`,
              background:config.vmaExercise===ex.id?"#2b0d0d":"transparent",
              color:config.vmaExercise===ex.id?"#FF6B6B":"#555",
              borderRadius:8,padding:"6px 10px",fontSize:10,cursor:"pointer",
              fontFamily:"'JetBrains Mono',monospace",
            }}>
            {ex.label}
          </button>
        ))}
      </div>

      {/* Tempo Exercise */}
      <div style={{fontSize:10,color:"#555",letterSpacing:3,fontFamily:"'JetBrains Mono',monospace",marginBottom:10}}>FORMAT TEMPO</div>
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:24}}>
        {TEMPO_EXERCISES.map(ex=>(
          <button key={ex.id} onClick={()=>onUpdate({tempoExercise:ex.id})}
            style={{
              border:`2px solid ${config.tempoExercise===ex.id?"#FF9F43":"#1C1F27"}`,
              background:config.tempoExercise===ex.id?"#2b1a00":"transparent",
              color:config.tempoExercise===ex.id?"#FF9F43":"#555",
              borderRadius:8,padding:"6px 10px",fontSize:10,cursor:"pointer",
              fontFamily:"'JetBrains Mono',monospace",
            }}>
            {ex.label}
          </button>
        ))}
      </div>

      {/* Regenerate */}
      <button onClick={onRegenerate} style={{
        width:"100%",background:"#00D2FF",color:"#080A0E",border:"none",
        borderRadius:12,padding:16,fontSize:13,fontWeight:700,cursor:"pointer",
        fontFamily:"'JetBrains Mono',monospace",
        display:"flex",alignItems:"center",justifyContent:"center",gap:8,
      }}>
        {isRegenerating
          ?<span style={{display:"inline-block",animation:"spin 1s linear infinite"}}>↻</span>
          :"⚡ REGÉNÉRER LES SEMAINES FUTURES"
        }
      </button>
      <div style={{fontSize:10,color:"#444",fontFamily:"'JetBrains Mono',monospace",marginTop:8,textAlign:"center"}}>
        Seules les séances futures générées automatiquement seront modifiées.<br/>
        Tes séances manuelles et passées sont protégées.
      </div>
    </div>
  );
}
