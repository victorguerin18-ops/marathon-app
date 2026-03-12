import { useState, useMemo, useEffect } from "react";
import { stravaLogin, exchangeToken, fetchActivities } from './strava';
import { loadPlanned, loadDone, savePlanned, saveDone, saveManyDone, deletePlanned } from './db';
import { PlanWizard, PlanSettings, generatePlanFromConfig, defaultConfig, fmtPace, vmaToMinKm } from './PlanWizard';

// ─── CONSTANTS ───────────────────────────────────────────────────────
const MARATHON_DATE = "2026-10-25";
const MARATHON      = new Date(MARATHON_DATE);
const TODAY         = new Date("2026-03-11");
const TODAY_STR     = "2026-03-11";
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
  const [stravaConnected, setStravaConnected] = useState(()=>!!STORE.get("strava_token",null));
  const [stravaLoading,   setStravaLoading]   = useState(false);
  const [syncStatus, setSyncStatus] = useState("");
  const [editForm,  setEditForm]  = useState(null);

  // Plan config (wizard)
  const [planConfig, setPlanConfig] = useState(()=>STORE.get("plan_config",null)||defaultConfig(VMA_DEFAULT));
  const [showWizard, setShowWizard] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [planGenLoading, setPlanGenLoading] = useState(false);

  // Chart state
  const [volPeriod,  setVolPeriod]  = useState("4m");
  const [volMetric,  setVolMetric]  = useState("km");
  const [volSmooth,  setVolSmooth]  = useState(true);
  const [pacePeriod, setPacePeriod] = useState("all");
  const [paceSmooth, setPaceSmooth] = useState(true);
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
      const [p,d]=await Promise.all([loadPlanned(),loadDone()]);
      setPlanned(p); setDone(d); setLoading(false);
    }
    init();
  },[]);

  useEffect(()=>{
    const params=new URLSearchParams(window.location.search);
    const code=params.get('code'); if(!code) return;
    setStravaLoading(true); setSyncStatus("Connexion Strava...");
    exchangeToken(code).then(data=>{
      STORE.set("strava_token",data.access_token); setStravaConnected(true);
      setSyncStatus("Import des séances...");
      fetchActivities(data.access_token).then(async activities=>{
        const ids=new Set(done.map(r=>r.id));
        const news=activities.filter(a=>!ids.has(a.id));
        if(news.length>0){await saveManyDone(news); setDone(prev=>[...prev,...news]);}
        setSyncStatus(`✓ ${news.length} séances importées !`);
        setTimeout(()=>setSyncStatus(""),4000); setStravaLoading(false);
      });
      window.history.replaceState({},'','/');
    }).catch(()=>{setStravaLoading(false);setSyncStatus("");});
  },[done]);

  async function syncStrava(){
    const token=STORE.get("strava_token",null); if(!token) return;
    setStravaLoading(true); setSyncStatus("Synchronisation...");
    const activities=await fetchActivities(token);
    const ids=new Set(done.map(r=>r.id));
    const news=activities.filter(a=>!ids.has(a.id));
    if(news.length>0){await saveManyDone(news); setDone(prev=>[...prev,...news]);}
    setSyncStatus(`✓ ${news.length} nouvelles séances`);
    setTimeout(()=>setSyncStatus(""),3000); setStravaLoading(false);
  }

  // ── Generate plan from config ─────────────────────────────────────
  async function generateAndSavePlan(cfg){
    setPlanGenLoading(true);
    const config = cfg || planConfig;
    // Delete existing generated future sessions
    const toDelete = planned.filter(p=>p.generated && parseDate(p.date) > parseDate(TODAY_STR));
    for(const p of toDelete){ await deletePlanned(p.id); }
    // Generate new sessions
    const sessions = generatePlanFromConfig(config, planned.filter(p=>!p.generated));
    for(const s of sessions){ await savePlanned(s); }
    setPlanned(prev=>{
      const kept = prev.filter(p=>!p.generated || parseDate(p.date) <= parseDate(TODAY_STR));
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

  // ── Coach IA ───────────────────────────────────────────────────────
  function buildCoachContext(){
    const recentDone=[...done].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,20);
    const weeks={};
    done.forEach(r=>{
      const wk=wkKey(r.date);
      if(!weeks[wk]) weeks[wk]={dist:0,runs:0,rpe:[]};
      weeks[wk].dist+=r.dist; weeks[wk].runs++; weeks[wk].rpe.push(r.rpe||5);
    });
    const wkList=Object.entries(weeks).sort(([a],[b])=>b.localeCompare(a)).slice(0,4);
    const planUpcoming=[...planned].filter(p=>isFuture(p.date)).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,8);
    const totalKm=done.reduce((s,r)=>s+r.dist,0);
    const avgPace=done.filter(r=>r.type==="Endurance fondamentale"&&r.dist>5);
    const lastPace=avgPace.length? (avgPace[avgPace.length-1].dur*60)/avgPace[avgPace.length-1].dist : null;

    return `Tu es un coach marathon expert. Voici le profil de l'athlète :

PROFIL :
- Prénom : Victor
- Objectif : Marathon de Lille, 25 octobre 2026 (${DAYS_LEFT} jours restants, ${WEEKS_LEFT} semaines)
- VMA actuelle : ${planConfig.vma} km/h
- Objectif de temps : Sub-3h30 (allure cible ~4'58"/km)
- Premier marathon
- 4 séances/semaine (flexible)
- Utilise Apple Watch + Bevel + Strava

DONNÉES RÉCENTES :
- Total km depuis début : ${totalKm.toFixed(0)} km
- Dernières 4 semaines :
${wkList.map(([wk,d])=>`  ${wk}: ${d.dist.toFixed(1)}km en ${d.runs} séances, RPE moyen ${(d.rpe.reduce((s,v)=>s+v,0)/d.rpe.length).toFixed(1)}`).join('\n')}
- Dernière allure EF : ${lastPace?`${fmtPace(lastPace)}/km`:"pas encore de données"}

ZONES D'ALLURE (basées VMA ${planConfig.vma} km/h) :
- Endurance fondamentale : ${fmtPace(planConfig.paces.ef)}/km
- Tempo/Seuil : ${fmtPace(planConfig.paces.tempo)}/km
- VMA : ${fmtPace(planConfig.paces.vma)}/km
- Allure marathon sub-3h30 : ~4'58"/km

SÉANCES RÉCENTES (20 dernières) :
${recentDone.map(r=>`  ${r.date}: ${r.type} ${r.dist}km en ${r.dur}min, FC ${r.hr||'?'}, RPE ${r.rpe||'?'}, ressenti ${["😣","😕","😐","🙂","😄"][(r.feeling||3)-1]}`).join('\n')}

PLAN À VENIR :
${planUpcoming.map(p=>`  ${p.date}: ${p.type} ${p.targetDist}km`).join('\n')}

Réponds en français, de façon directe et personnalisée comme un vrai coach. Sois précis sur les allures (utilise les min/km). Maximum 3-4 paragraphes courts sauf si l'athlète pose une question précise.`;
  }

  async function askCoach(userMessage=null){
    setCoachLoading(true);
    const context=buildCoachContext();
    const isWeekly=!userMessage;

    const messages = isWeekly
      ? [{ role:"user", content: context+"\n\nFais un bilan hebdomadaire : 1) ce qui s'est bien passé, 2) ce qui peut être amélioré, 3) conseils concrets pour les 7 prochains jours avec allures précises, 4) un mot de motivation." }]
      : [
          { role:"user", content: context },
          { role:"assistant", content: coachMsg || "Je suis prêt à t'aider !" },
          ...chatHistory.flatMap(m=>[
            {role:"user", content:m.user},
            {role:"assistant", content:m.coach}
          ]),
          { role:"user", content: userMessage }
        ];

    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages",{
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

  // ── Weekly stats ───────────────────────────────────────────────────
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

  const curWeek  = weeklyVol[0]||{dist:0,load:0};
  const prevWeek = weeklyVol[1]||{dist:0,load:0};
  const acwr     = prevWeek.load?(curWeek.load/prevWeek.load):1;
  const totalKm  = done.reduce((s,r)=>s+r.dist,0);
  const acwrStatus = acwr>1.3?{label:"RISQUE ÉLEVÉ",color:"#FF6B6B"}:acwr>1.15?{label:"CHARGE MODÉRÉE",color:"#FF9F43"}:{label:"OPTIMAL",color:"#4ECDC4"};

  // ── Volume chart data ──────────────────────────────────────────────
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

  // ── Forms ──────────────────────────────────────────────────────────
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
  async function submitLog(){
    const r={id:"d"+Date.now(),...logForm,dist:+logForm.dist,dur:+logForm.dur,hr:logForm.hr?+logForm.hr:null,rpe:+logForm.rpe,feeling:+logForm.feeling};
    await saveDone(r); setDone(prev=>[...prev,r]); setModal(null);
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

  // ── Week plan vs real ──────────────────────────────────────────────
  const weekCompare=useMemo(()=>{
    const curWk=wkKey(TODAY_STR);
    const wkPlanned=planned.filter(p=>wkKey(p.date)===curWk);
    const wkDone=done.filter(d=>wkKey(d.date)===curWk);
    const plannedKm=wkPlanned.reduce((s,p)=>s+p.targetDist,0);
    const doneKm=wkDone.reduce((s,d)=>s+d.dist,0);
    const completion=plannedKm>0?Math.round(doneKm/plannedKm*100):null;
    return {planned:wkPlanned,done:wkDone,plannedKm,doneKm,completion};
  },[planned,done]);

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
  `;

  if(loading) return (
    <div style={{minHeight:"100vh",background:"#080A0E",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16}}>
      <style>{css}</style>
      <div className="spin" style={{fontSize:32,color:"#E8E4DC"}}>↻</div>
      <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:"#555",letterSpacing:2}}>CHARGEMENT...</div>
    </div>
  );

  return (
    <div style={{minHeight:"100vh",background:"#080A0E",fontFamily:"'Syne',sans-serif",color:"#E8E4DC",maxWidth:480,margin:"0 auto",paddingBottom:`calc(72px + env(safe-area-inset-bottom, 16px))`}}>
      <style>{css}</style>

      {/* TOP */}
      <div style={{padding:"20px 20px 0",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div>
          <div style={{fontSize:11,color:"#555",letterSpacing:3,fontFamily:"'JetBrains Mono',monospace"}}>MARATHON DE LILLE</div>
          <div style={{fontSize:28,fontWeight:800,letterSpacing:-1,marginTop:2}}>
            {DAYS_LEFT}<span style={{fontSize:14,color:"#555",fontWeight:400,marginLeft:4}}>jours</span>
            <span style={{fontSize:14,color:"#333",margin:"0 6px"}}>·</span>
            {WEEKS_LEFT}<span style={{fontSize:14,color:"#555",fontWeight:400,marginLeft:4}}>sem.</span>
          </div>
          <div style={{fontSize:10,color:"#333",fontFamily:"'JetBrains Mono',monospace",marginTop:2,letterSpacing:1}}>25 OCT 2026 · VMA {planConfig.vma} km/h</div>
        </div>
        <div style={{display:"flex",gap:8}}>
          <button className="btn-ghost" onClick={()=>setModal({type:"plan"})} style={{borderRadius:10,padding:"8px 14px",fontSize:12,fontFamily:"'JetBrains Mono',monospace"}}>+ PLANIFIER</button>
          <button className="btn-primary" onClick={()=>logSession()} style={{background:"#E8E4DC",color:"#080A0E",borderRadius:10,padding:"8px 14px",fontSize:12,fontWeight:700,fontFamily:"'JetBrains Mono',monospace"}}>+ LOG</button>
        </div>
      </div>

      <div style={{padding:"12px 20px 0"}}>
        <div style={{height:3,background:"#1C1F27",borderRadius:2}}>
          <div style={{height:3,width:`${Math.round((32-WEEKS_LEFT)/32*100)}%`,background:"linear-gradient(90deg,#4ECDC4,#FFE66D)",borderRadius:2}}/>
        </div>
      </div>

      <div style={{padding:"12px 20px 0"}}>
        {!stravaConnected?(
          <button onClick={stravaLogin} style={{width:"100%",background:"#FC4C02",border:"none",borderRadius:10,padding:"12px",color:"#fff",fontSize:13,fontWeight:700,fontFamily:"'JetBrains Mono',monospace",cursor:"pointer"}}>
            🔗 CONNECTER STRAVA
          </button>
        ):(
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:"#0F1117",border:"1px solid #1C1F27",borderRadius:10,padding:"10px 14px"}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <div style={{width:8,height:8,borderRadius:"50%",background:"#FC4C02"}}/>
              <span style={{fontSize:11,color:"#888",fontFamily:"'JetBrains Mono',monospace"}}>{syncStatus||`STRAVA · ${done.filter(d=>d.fromStrava).length} séances`}</span>
            </div>
            <button onClick={syncStrava} className="btn-ghost" style={{borderRadius:8,padding:"4px 10px",fontSize:11,fontFamily:"'JetBrains Mono',monospace"}}>
              {stravaLoading?<span className="spin">↻</span>:"↻ SYNC"}
            </button>
          </div>
        )}
      </div>

      {/* NAV — 5 onglets */}
      <div style={{display:"flex",gap:3,padding:"16px 20px 0"}}>
        {[["today","⊙","AUJOURD'HUI"],["plan","◫","PLAN"],["coach","✦","COACH"],["analyse","◈","ANALYSE"],["journal","≡","JOURNAL"]].map(([v,ico,lbl])=>(
          <button key={v} className="nav-tab" onClick={()=>setView(v)}
            style={{flex:1,background:view===v?"#1C1F27":"transparent",color:view===v?"#E8E4DC":"#555",borderRadius:8,padding:"8px 0",fontSize:9,letterSpacing:1,fontFamily:"'JetBrains Mono',monospace",display:"flex",flexDirection:"column",alignItems:"center",gap:2,border:"none"}}>
            <span style={{fontSize:14}}>{ico}</span>
            <span>{lbl}</span>
          </button>
        ))}
      </div>

      <div style={{padding:"20px 20px 0"}}>

        {/* ═══ TODAY ═══ */}
        {view==="today" && (
          <div className="fade-up">
            {todayPlanned.length===0&&(
              <div className="card" style={{padding:28,textAlign:"center"}}>
                <div style={{fontSize:40,marginBottom:12}}>🏃</div>
                <div style={{fontSize:14,color:"#555",fontFamily:"'JetBrains Mono',monospace"}}>Rien de planifié aujourd'hui</div>
                <button className="btn-primary" onClick={()=>setModal({type:"plan"})} style={{marginTop:16,background:"#E8E4DC",color:"#080A0E",borderRadius:10,padding:"10px 20px",fontSize:12,fontWeight:700}}>Planifier une séance</button>
              </div>
            )}
            {todayPlanned.map(p=>{
              const tm=TYPE_META[p.type]||TYPE_META["Footing"];
              const linked=done.find(d=>d.plannedId===p.id);
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
                    ?<button className="btn-primary" onClick={()=>logSession(p)} style={{background:tm.color,color:"#080A0E",borderRadius:10,padding:"10px 0",fontSize:12,fontWeight:700,width:"100%"}}>✓ ENREGISTRER LA SÉANCE</button>
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

            {/* Semaine en cours — comparaison plan vs réel */}
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
              <div style={{marginTop:8}}>
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

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:16}}>
              <div className="card" style={{padding:16}}>
                <div style={{fontSize:9,color:"#555",letterSpacing:2,fontFamily:"'JetBrains Mono',monospace",marginBottom:8}}>CETTE SEMAINE</div>
                <div style={{fontSize:28,fontWeight:800}}>{curWeek.dist.toFixed(1)}<span style={{fontSize:13,color:"#555",fontWeight:400}}>km</span></div>
                <div style={{fontSize:11,color:curWeek.dist>prevWeek.dist?"#4ECDC4":"#FF6B6B",fontFamily:"'JetBrains Mono',monospace",marginTop:4}}>
                  {curWeek.dist>prevWeek.dist?"▲":"▼"} {Math.abs(curWeek.dist-prevWeek.dist).toFixed(1)} vs S-1
                </div>
              </div>
              <div className="card" style={{padding:16,borderColor:acwr>1.3?"#FF6B6B33":acwr>1.15?"#FF9F4333":"#1C1F27"}}>
                <div style={{fontSize:9,color:"#555",letterSpacing:2,fontFamily:"'JetBrains Mono',monospace",marginBottom:8}}>RISQUE BLESSURE</div>
                <div style={{fontSize:16,fontWeight:800,color:acwrStatus.color}}>{acwrStatus.label}</div>
                <div style={{fontSize:10,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginTop:4}}>ACWR {acwr.toFixed(2)}</div>
              </div>
            </div>
          </div>
        )}

        {/* ═══ PLAN ═══ */}
        {view==="plan" && (
          <div className="fade-up">

            {/* Plan header */}
            {!showSettings ? (
              <>
                {/* Config summary card */}
                <div className="card" style={{padding:20,marginBottom:14,border:"1px solid #00D2FF22",background:"linear-gradient(135deg,#001a24,#080A0E)"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
                    <div>
                      <div style={{fontSize:10,color:"#00D2FF",letterSpacing:3,fontFamily:"'JetBrains Mono',monospace",marginBottom:4}}>⚡ PLAN ACTIF</div>
                      <div style={{fontSize:16,fontWeight:800}}>VMA {planConfig.vma} km/h · {planConfig.intensity === "soft" ? "Douce" : planConfig.intensity === "ambitious" ? "Ambitieuse" : "Standard"}</div>
                      <div style={{fontSize:11,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginTop:2}}>{planned.filter(p=>p.generated).length} séances générées · {planned.filter(p=>p.generated&&parseDate(p.date)>parseDate(TODAY_STR)).length} restantes</div>
                    </div>
                    <div style={{display:"flex",gap:8"}}>
                      <button onClick={()=>setShowSettings(true)} className="btn-ghost" style={{borderRadius:10,padding:"8px 12px",fontSize:11,fontFamily:"'JetBrains Mono',monospace"}}>⚙ RÉGLAGES</button>
                    </div>
                  </div>

                  {/* Allures pills */}
                  <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:14}}>
                    {[
                      {label:"EF",pace:planConfig.paces.ef,color:"#6BF178"},
                      {label:"SL",pace:planConfig.paces.sl,color:"#C77DFF"},
                      {label:"Tempo",pace:planConfig.paces.tempo,color:"#FF9F43"},
                      {label:"VMA",pace:planConfig.paces.vma,color:"#FF6B6B"},
                    ].map(({label,pace,color})=>(
                      <span key={label} style={{fontSize:10,padding:"4px 10px",borderRadius:20,background:color+"11",color,fontFamily:"'JetBrains Mono',monospace",border:`1px solid ${color}33`}}>
                        {label} · {fmtPace(pace)}/km
                      </span>
                    ))}
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

                {/* Session list */}
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <div style={{fontSize:10,color:"#555",letterSpacing:3,fontFamily:"'JetBrains Mono',monospace"}}>PLANNING · {planned.filter(p=>isFuture(p.date)).length} À VENIR</div>
                  <button className="btn-ghost" onClick={()=>setModal({type:"plan"})} style={{borderRadius:8,padding:"6px 12px",fontSize:11,fontFamily:"'JetBrains Mono',monospace"}}>+ AJOUTER</button>
                </div>

                {[...planned].sort((a,b)=>a.date.localeCompare(b.date)).filter(p=>!isPast(p.date)||done.find(d=>d.plannedId===p.id)).map(p=>{
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
                            :<button className="btn-ghost" onClick={()=>logSession(p)} style={{borderRadius:8,padding:"6px 12px",fontSize:11,fontFamily:"'JetBrains Mono',monospace"}}>LOG</button>
                          }
                        </div>
                      </div>
                      {p.notes&&<div style={{fontSize:10,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginTop:8,lineHeight:1.5}}>💬 {p.notes}</div>}
                      {linked&&<CompareBar planned={p} done={linked}/>}
                    </div>
                  );
                })}
              </>
            ) : (
              /* ── SETTINGS ── */
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
          <div className="fade-up">

            {/* Header card */}
            <div className="card" style={{padding:22,marginBottom:14,background:"linear-gradient(135deg,#0F1117 0%,#0d1f1a 100%)",border:"1px solid #6BF17822"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
                <div>
                  <div style={{fontSize:10,color:"#6BF178",letterSpacing:3,fontFamily:"'JetBrains Mono',monospace"}}>✦ COACH IA · MARATHON</div>
                  <div style={{fontSize:20,fontWeight:800,marginTop:4}}>Bonjour Victor 👋</div>
                  <div style={{fontSize:11,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginTop:2}}>
                    {coachDate?`Dernier bilan : ${fmtDate(coachDate,{day:"numeric",month:"long"})}`:"Demande un bilan pour commencer"}
                  </div>
                </div>
                <button onClick={()=>askCoach(null)} className="btn-primary"
                  style={{background:"#6BF178",color:"#080A0E",borderRadius:12,padding:"10px 14px",fontSize:11,fontWeight:700,fontFamily:"'JetBrains Mono',monospace",flexShrink:0}}>
                  {coachLoading?<span className="spin" style={{color:"#080A0E"}}>↻</span>:"✦ BILAN"}
                </button>
              </div>

              {/* Stats rapides */}
              <div style={{display:"flex",gap:8}}>
                {[
                  ["VMA",`${planConfig.vma} km/h`,"#00D2FF"],
                  ["ALLURE CIBLE","4'58\"/km","#FFE66D"],
                  ["KM TOTAL",`${totalKm.toFixed(0)}km`,"#6BF178"],
                ].map(([l,v,c])=>(
                  <div key={l} style={{flex:1,background:"#080A0E",borderRadius:8,padding:"10px 8px",textAlign:"center"}}>
                    <div style={{fontSize:9,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginBottom:4}}>{l}</div>
                    <div style={{fontSize:13,fontWeight:700,color:c}}>{v}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Message coach */}
            {coachMsg&&(
              <div className="card" style={{padding:22,marginBottom:14,border:"1px solid #6BF17833"}}>
                <div style={{fontSize:9,color:"#6BF178",letterSpacing:3,fontFamily:"'JetBrains Mono',monospace",marginBottom:12}}>✦ MESSAGE DU COACH</div>
                <div style={{fontSize:13,color:"#ccc",lineHeight:1.8,whiteSpace:"pre-wrap"}}>{coachMsg}</div>
              </div>
            )}

            {coachLoading&&!coachMsg&&(
              <div className="card" style={{padding:28,marginBottom:14,textAlign:"center"}}>
                <div className="pulse" style={{fontSize:32,marginBottom:12}}>✦</div>
                <div style={{fontSize:12,color:"#555",fontFamily:"'JetBrains Mono',monospace"}}>Le coach analyse tes données...</div>
              </div>
            )}

            {/* Historique chat */}
            {chatHistory.length>0&&(
              <div style={{marginBottom:14}}>
                {chatHistory.map((m,i)=>(
                  <div key={i} style={{marginBottom:10}}>
                    <div style={{display:"flex",justifyContent:"flex-end",marginBottom:6}}>
                      <div style={{background:"#1C1F27",borderRadius:"12px 12px 4px 12px",padding:"10px 14px",maxWidth:"80%",fontSize:13,color:"#E8E4DC"}}>{m.user}</div>
                    </div>
                    <div style={{display:"flex",justifyContent:"flex-start"}}>
                      <div style={{background:"#0d2b0f",border:"1px solid #6BF17833",borderRadius:"4px 12px 12px 12px",padding:"10px 14px",maxWidth:"90%",fontSize:13,color:"#ccc",lineHeight:1.7}}>{m.coach}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Chat input */}
            <div style={{position:"sticky",bottom:0,paddingBottom:4,background:"#080A0E",paddingTop:8}}>
              <div style={{display:"flex",gap:8,alignItems:"flex-end"}}>
                <textarea className="chat-inp" rows={2} value={chatInput}
                  onChange={e=>setChatInput(e.target.value)}
                  onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendChat();}}}
                  placeholder="Pose une question au coach... (ex: quelle allure pour ma sortie longue demain ?)"/>
                <button onClick={sendChat} className="btn-primary"
                  style={{background:"#6BF178",color:"#080A0E",borderRadius:12,padding:"14px",fontSize:16,flexShrink:0,height:54}}>
                  {coachLoading?<span className="spin" style={{color:"#080A0E",fontSize:14}}>↻</span>:"→"}
                </button>
              </div>
              <div style={{fontSize:9,color:"#333",fontFamily:"'JetBrains Mono',monospace",marginTop:6,textAlign:"center"}}>Propulsé par Claude · Données Strava · VMA {planConfig.vma} km/h</div>
            </div>
          </div>
        )}

        {/* ═══ ANALYSE ═══ */}
        {view==="analyse" && (
          <div className="fade-up">
            <div className="card" style={{padding:22,marginBottom:14,borderColor:acwr>1.3?"#FF6B6B44":"#1C1F27"}}>
              <div style={{fontSize:10,color:"#555",letterSpacing:3,fontFamily:"'JetBrains Mono',monospace",marginBottom:16}}>CHARGE · ACWR</div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:14}}>
                <div>
                  <div style={{fontSize:42,fontWeight:800,color:acwrStatus.color,lineHeight:1}}>{acwr.toFixed(2)}</div>
                  <div style={{fontSize:13,color:acwrStatus.color,fontFamily:"'JetBrains Mono',monospace",marginTop:4}}>{acwrStatus.label}</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:11,color:"#555",fontFamily:"'JetBrains Mono',monospace"}}>Zone optimale</div>
                  <div style={{fontSize:13,color:"#4ECDC4",fontFamily:"'JetBrains Mono',monospace"}}>0.80 → 1.30</div>
                </div>
              </div>
              <div style={{height:8,background:"#1C1F27",borderRadius:4,position:"relative"}}>
                <div style={{position:"absolute",left:"40%",width:"45%",height:8,background:"#4ECDC433",borderRadius:4}}/>
                <div style={{position:"absolute",left:`${Math.min(acwr/2*100,95)}%`,width:12,height:12,top:-2,borderRadius:"50%",background:acwrStatus.color,transform:"translateX(-50%)",border:"2px solid #080A0E"}}/>
              </div>
              <div style={{marginTop:14,padding:"12px",background:"#080A0E",borderRadius:8,fontSize:11,color:"#888",fontFamily:"'JetBrains Mono',monospace",lineHeight:1.7}}>
                {acwr>1.3?"⚠ Risque de blessure élevé. Réduis la charge de 20-30%.":acwr>1.15?"△ Charge modérée. Surveille ta récupération.":"✓ Tu es dans la zone optimale. Continue !"}
              </div>
            </div>

            {/* Volume */}
            <div className="card" style={{padding:22,marginBottom:14}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
                <div>
                  <div style={{fontSize:10,color:"#555",letterSpacing:3,fontFamily:"'JetBrains Mono',monospace"}}>VOLUME HEBDOMADAIRE</div>
                  <div style={{fontSize:11,color:"#888",fontFamily:"'JetBrains Mono',monospace",marginTop:2}}>{selVolMetric.desc}</div>
                </div>
                <div style={{display:"flex",gap:4}}>
                  <button className={`smooth-btn${volSmooth?" active":""}`} onClick={()=>setVolSmooth(true)}>∿ LISSÉ</button>
                  <button className={`smooth-btn${!volSmooth?" active":""}`} onClick={()=>setVolSmooth(false)}>∧ BRUT</button>
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

            {/* Allure */}
            <div className="card" style={{padding:22,marginBottom:14}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
                <div>
                  <div style={{fontSize:10,color:"#555",letterSpacing:3,fontFamily:"'JetBrains Mono',monospace"}}>PROGRESSION ALLURE</div>
                  <div style={{fontSize:11,color:"#888",fontFamily:"'JetBrains Mono',monospace",marginTop:2}}>EF &gt;5km · bas = plus rapide 🏃</div>
                </div>
                <div style={{display:"flex",gap:4}}>
                  <button className={`smooth-btn${paceSmooth?" active":""}`} onClick={()=>setPaceSmooth(true)}>∿ LISSÉ</button>
                  <button className={`smooth-btn${!paceSmooth?" active":""}`} onClick={()=>setPaceSmooth(false)}>∧ BRUT</button>
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

            {/* Variété */}
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
      <div style={{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:480,maxWidth:"100vw",background:"#0F1117",borderTop:"1px solid #1C1F27",display:"flex",zIndex:50,paddingBottom:"env(safe-area-inset-bottom, 12px)"}}>
        {[["today","⊙","AUJOURD'HUI"],["plan","◫","PLAN"],["coach","✦","COACH"],["analyse","◈","ANALYSE"],["journal","≡","JOURNAL"]].map(([v,ico,lbl])=>(
          <button key={v} className="nav-tab" onClick={()=>setView(v)} style={{flex:1,padding:"10px 0 6px",color:view===v?v==="coach"?"#6BF178":"#E8E4DC":"#444",background:"transparent",display:"flex",flexDirection:"column",alignItems:"center",gap:2,border:"none"}}>
            <span style={{fontSize:16}}>{ico}</span>
            <span style={{fontSize:8,letterSpacing:1,fontFamily:"'JetBrains Mono',monospace"}}>{lbl}</span>
          </button>
        ))}
      </div>

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
                <Field label="DISTANCE (km)"><input type="number" className="inp" placeholder="10.5" value={logForm.dist} onChange={e=>setLogForm({...logForm,dist:e.target.value})}/></Field>
                <Field label="DURÉE (min)"><input type="number" className="inp" placeholder="68" value={logForm.dur} onChange={e=>setLogForm({...logForm,dur:e.target.value})}/></Field>
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
