import { useState, useMemo, useEffect } from "react";
import { stravaLogin, exchangeToken, fetchActivities, getValidToken } from './strava';
import { syncToGitHub } from './sync';
import { loadPlanned, loadDone, savePlanned, saveDone, saveManyDone, deletePlanned, deleteDone, loadCheckin, saveCheckin, loadRecentCheckins } from './db';
import { PlanWizard, generatePlanFromConfig, defaultConfig } from './PlanWizard';
import { VMA_DEFAULT, STORE, TODAY_STR, TYPE_META, FEELINGS } from './constants';
import { fmtDate, wkKey, addDays, parseDate, isFuture } from './utils/dates';
import { calcReadiness, computeProtectionScore, computeVMA } from './utils/scores';
import { FormGrid, Field } from './components/FormGrid';
import BottomNav from './components/BottomNav';
import VMAModal from './components/modals/VMAModal';
import StravaDebriefModal from './components/modals/StravaDebriefModal';
import WeekAdjustModal from './components/modals/WeekAdjustModal';
import EditPlannedModal from './components/modals/EditPlannedModal';
import TodayView from './views/TodayView';
import PlanView from './views/PlanView';
import CoachView from './views/CoachView';
import AnalyseView from './views/AnalyseView';
import JournalView from './views/JournalView';

const DAYS_LEFT  = Math.ceil((new Date("2026-10-25") - new Date()) / 86400000);
const WEEKS_LEFT = Math.floor(DAYS_LEFT / 7);

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

  const [planConfig,    setPlanConfig]    = useState(()=>STORE.get("plan_config",null)||defaultConfig(VMA_DEFAULT));
  const [showWizard,    setShowWizard]    = useState(false);
  const [planGenLoading,setPlanGenLoading]= useState(false);

  const [checkIn,     setCheckIn]     = useState({ hrv: '', bevelRecovery: '', restingHR: '', sleepHours: '', feelingScore: 3, readiness: null, morningBrief: null, briefDate: null });
  const [checkInSaved,setCheckInSaved]= useState(false);
  const [recentCheckins, setRecentCheckins] = useState([]);

  const [weekAdjustModal,     setWeekAdjustModal]     = useState(null);
  const [weekAdjustDismissed, setWeekAdjustDismissed] = useState(()=>STORE.get('week_adjust_'+wkKey(TODAY_STR), false));

  const [stravaDebriefModal, setStravaDebriefModal] = useState(null);
  const [debriefForm,        setDebriefForm]        = useState({rpe:"6", feeling:"3", notes:""});

  const [readinessAction, setReadinessAction] = useState(()=>STORE.get('readiness_action_'+TODAY_STR, null));
  const [githubSyncing,   setGithubSyncing]   = useState(false);
  const [githubSyncMsg,   setGithubSyncMsg]   = useState("");

  const [planForm, setPlanForm] = useState({date:TODAY_STR,type:"Endurance fondamentale",targetDist:"",targetDur:"",targetHR:"",notes:""});
  const [logForm,  setLogForm]  = useState({date:TODAY_STR,plannedId:"",type:"Endurance fondamentale",dist:"",dur:"",hr:"",rpe:"6",feeling:"3",notes:""});

  useEffect(()=>{
    async function init(){
      setLoading(true);
      const [p,d,ci,rc]=await Promise.all([loadPlanned(),loadDone(),loadCheckin(TODAY_STR),loadRecentCheckins(8)]);
      setPlanned(p); setDone(d); setRecentCheckins(rc);
      if(ci){ setCheckIn(ci); setCheckInSaved(true); }
      setLoading(false);
      const token = await getValidToken();
      if(token) {
        try {
          const activities = await fetchActivities();
          const existingMap = new Map(d.map(r=>[r.id,r]));
          const toSave = activities.map(a=>mergeStravaActivity(a, existingMap.get(a.id), p));
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
        const toSave=activities.map(a=>mergeStravaActivity(a, existingMap.get(a.id), planned));
        const newCount=toSave.filter(a=>!existingMap.has(a.id)).length;
        if(toSave.length>0){await saveManyDone(toSave); setDone(prev=>{const m=new Map(prev.map(r=>[r.id,r])); toSave.forEach(a=>m.set(a.id,a)); return Array.from(m.values());});}
        setSyncStatus(`✓ ${newCount} nouvelles · ${toSave.length-newCount} mises à jour`);
        setTimeout(()=>setSyncStatus(""),4000); setStravaLoading(false);
      });
      window.history.replaceState({},'','/');
    }).catch(()=>{setStravaLoading(false);setSyncStatus("");});
  },[done]);// eslint-disable-line react-hooks/exhaustive-deps

  function mergeStravaActivity(incoming, existing, plannedList) {
    const pList = plannedList || planned;
    const autoPlannedId = (() => {
      if (existing?.plannedId) return existing.plannedId;
      const match = pList.find(p =>
        p.date === incoming.date &&
        !done.find(d => d.plannedId === p.id && d.id !== incoming.id)
      );
      return match?.id || null;
    })();
    if (!existing) return { ...incoming, plannedId: autoPlannedId };
    return {
      ...incoming,
      type:               existing.type,
      rpe:                existing.rpe,
      feeling:            existing.feeling,
      notes:              existing.notes ?? incoming.notes,
      plannedId:          existing.plannedId || autoPlannedId,
      description_strava: existing.description_strava || incoming.description_strava,
    };
  }

  async function handleGithubSync() {
    setGithubSyncing(true);
    setGithubSyncMsg("");
    try {
      await syncToGitHub({ done, planned, checkIn, recentCheckins, planConfig });
      setGithubSyncMsg("✓ Synced");
    } catch (e) {
      setGithubSyncMsg("✗ Erreur");
    }
    setGithubSyncing(false);
    setTimeout(() => setGithubSyncMsg(""), 3000);
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

  function checkForTodayStravaDebrief(doneList, plannedList) {
    const todayStrava = doneList.find(d => d.date === TODAY_STR && d.fromStrava);
    if (!todayStrava) return;
    if (todayStrava.feeling !== 3 || STORE.get("debriefed_"+todayStrava.id, false)) return;
    const pSession = plannedList.find(p => p.date === TODAY_STR) || null;
    setStravaDebriefModal({ stravaSession: todayStrava, plannedSession: pSession });
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
  }

  async function onSaveCheckIn(data) {
    const readiness = calcReadiness(
      parseFloat(data.bevelRecovery)||0, parseFloat(data.hrv)||0,
      parseFloat(data.restingHR)||0, parseFloat(data.sleepHours)||0,
      data.feelingScore||3
    );
    const fullData = { ...data, readiness };
    await saveCheckin(TODAY_STR, fullData);
    setCheckIn(fullData);
    setCheckInSaved(true);
    setRecentCheckins(prev => {
      const filtered = prev.filter(c => c.date !== TODAY_STR);
      return [{ date: TODAY_STR, hrv: parseFloat(fullData.hrv)||null, bevelRecovery: parseInt(fullData.bevelRecovery)||null, restingHR: parseFloat(fullData.restingHR)||null, sleepHours: parseFloat(fullData.sleepHours)||null, feelingScore: fullData.feelingScore||3, readiness }, ...filtered];
    });
  }

  async function applyReadinessAction(action, todaySession) {
    if (action.id === "ignore") {
      const updated = { done: true, result: null };
      STORE.set('readiness_action_'+TODAY_STR, updated);
      setReadinessAction(updated);
      return;
    }
    if (action.id === "swap" && action.swapWith) {
      const sessionA = { ...todaySession,    date: action.swapWith.date };
      const sessionB = { ...action.swapWith, date: todaySession.date };
      await savePlanned(sessionA);
      await savePlanned(sessionB);
      setPlanned(prev => prev.map(p => {
        if (p.id === sessionA.id) return sessionA;
        if (p.id === sessionB.id) return sessionB;
        return p;
      }));
      const r = { done: true, result: `✓ Séances échangées — ${sessionB.type} déplacé au ${fmtDate(sessionB.date, {weekday:"long", day:"numeric"})}` };
      STORE.set('readiness_action_'+TODAY_STR, r);
      setReadinessAction(r);
    }
    if (action.id === "postpone") {
      const tomorrow = addDays(TODAY_STR, 1);
      const updated = { ...todaySession, date: tomorrow };
      await savePlanned(updated);
      setPlanned(prev => prev.map(p => p.id === updated.id ? updated : p));
      const r = { done: true, result: `✓ Séance reportée au ${fmtDate(tomorrow, {weekday:"long", day:"numeric"})}` };
      STORE.set('readiness_action_'+TODAY_STR, r);
      setReadinessAction(r);
    }
    if (action.id === "reduce" && action.reduced) {
      const updated = { ...action.reduced };
      await savePlanned(updated);
      setPlanned(prev => prev.map(p => p.id === updated.id ? updated : p));
      const r = { done: true, result: `✓ Volume réduit — ${updated.targetDist}km · ${updated.targetDur}min` };
      STORE.set('readiness_action_'+TODAY_STR, r);
      setReadinessAction(r);
    }
  }

  async function applyWeekAdjustments(sessions) {
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

  async function submitDebrief() {
    if (!stravaDebriefModal) return;
    const { stravaSession } = stravaDebriefModal;
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

  const weeklyVol = useMemo(()=>{
    const weeks={};
    done.forEach(r=>{
      const wk=wkKey(r.date);
      if(!weeks[wk]) weeks[wk]={dist:0,dur:0,rpe:[]};
      weeks[wk].dist+=r.dist; weeks[wk].dur+=r.dur; weeks[wk].rpe.push(r.rpe||5);
    });
    return Object.entries(weeks).sort(([a],[b])=>b.localeCompare(a)).slice(0,8)
      .map(([wk,d])=>({wk,...d,load:d.dist*(d.rpe.reduce((s,v)=>s+v,0)/d.rpe.length)}));
  },[done]);

  const weekCompare = useMemo(()=>{
    const curWk=wkKey(TODAY_STR);
    const wkPlanned=planned.filter(p=>wkKey(p.date)===curWk);
    const wkDone=done.filter(d=>wkKey(d.date)===curWk);
    const plannedKm=wkPlanned.reduce((s,p)=>s+p.targetDist,0);
    const doneKm=wkDone.reduce((s,d)=>s+d.dist,0);
    const completion=plannedKm>0?Math.round(doneKm/plannedKm*100):null;
    const targetKm = planConfig.targetWeeklyKm || 42;
    const remainingKm = Math.max(0, targetKm - doneKm);
    const remaining = wkPlanned.filter(p => {
      const linked = wkDone.find(d => d.plannedId === p.id || (d.date === p.date && d.fromStrava));
      return !linked && p.date >= TODAY_STR;
    }).sort((a,b) => a.date.localeCompare(b.date));
    const QUALITY_TYPES = ["Fractionné / VMA", "Tempo / Seuil", "Évaluation VMA"];
    const SL_TYPE = "Sortie longue";
    const doneQualKm = wkDone.filter(d=>QUALITY_TYPES.includes(d.type)).reduce((s,d)=>s+d.dist,0);
    const plannedQualKm = remaining.filter(p=>QUALITY_TYPES.includes(p.type)).reduce((s,p)=>s+p.targetDist,0);
    const totalQualKm = doneQualKm + plannedQualKm;
    const qualBudget = Math.min(totalQualKm, targetKm * 0.20);
    const adaptedSessions = remaining.map(p => {
      const isSL = p.type === SL_TYPE;
      const isQual = QUALITY_TYPES.includes(p.type);
      const nEFRemaining = remaining.filter(s => !QUALITY_TYPES.includes(s.type) && s.type !== SL_TYPE).length;
      const nSLRemaining = remaining.filter(s => s.type === SL_TYPE).length;
      let idealDist = p.targetDist;
      if (isSL && nSLRemaining > 0) {
        idealDist = Math.round(targetKm * 0.30 * 10) / 10;
      } else if (!isSL && !isQual && nEFRemaining > 0) {
        const efBudget = remainingKm - Math.max(0, qualBudget - doneQualKm) - (nSLRemaining * targetKm * 0.30);
        idealDist = Math.max(4, Math.round((efBudget / nEFRemaining) * 10) / 10);
      }
      const delta = idealDist - p.targetDist;
      const deltaPct = p.targetDist > 0 ? (delta / p.targetDist) * 100 : 0;
      return { ...p, idealDist, delta, deltaPct, isAlert: Math.abs(deltaPct) >= 20, needsAdjust: Math.abs(delta) >= 0.5 };
    });
    const qualRatio = targetKm > 0 ? Math.round((totalQualKm / targetKm) * 100) : 0;
    return {
      planned:wkPlanned, done:wkDone, plannedKm, doneKm, completion,
      targetKm, remainingKm, adaptedSessions,
      hasAdjustments: adaptedSessions.some(s=>s.needsAdjust),
      hasAlerts: adaptedSessions.some(s=>s.isAlert),
      qualRatio,
    };
  },[planned,done,planConfig]);

  const computedVMA = useMemo(() => computeVMA(done), [done]);

  const protectionScore = useMemo(() => {
    const readiness = checkInSaved
      ? (checkIn.readiness ?? calcReadiness(parseFloat(checkIn.bevelRecovery)||0, parseFloat(checkIn.hrv)||0, parseFloat(checkIn.restingHR)||0, parseFloat(checkIn.sleepHours)||0, checkIn.feelingScore||3))
      : null;
    return computeProtectionScore({ done, readiness, weeklyVol });
  }, [done, checkIn, checkInSaved, weeklyVol]);

  const displayVMA  = computedVMA?.finalVMA ?? planConfig.vma;
  const vmaDiff     = computedVMA ? Math.abs(displayVMA - planConfig.vma) : 0;
  const vmaChanged  = vmaDiff >= 0.2;
  const todayPlanned = planned.filter(p=>p.date===TODAY_STR);
  const upcoming     = planned.filter(p=>isFuture(p.date)).sort((a,b)=>a.date.localeCompare(b.date));

  const css=`
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@300;400;500&display=swap');
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{background:#161618}
    ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:#333}
    .card{background:#242426;border-radius:18px}
    .nav-tab{transition:all .2s;border:none;cursor:pointer;font-family:inherit}
    .btn-primary{transition:all .2s;border:none;cursor:pointer;font-family:inherit}
    .btn-primary:hover{opacity:.85;transform:scale(.98)}
    .btn-ghost{transition:all .2s;background:#333;border:none;cursor:pointer;font-family:'Inter',sans-serif;color:#aaa;border-radius:50px;padding:8px 14px;font-size:11px;font-weight:600}
    .btn-ghost:hover{background:#444;color:#fff}
    .inp{background:#333;border:none;color:#fff;border-radius:10px;padding:10px 12px;font-size:13px;font-family:'Inter',sans-serif;width:100%;outline:none;transition:background .2s}
    .inp:focus{background:#3a3a3c}
    @keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
    .fade-up{animation:fadeUp .35s ease forwards}
    @keyframes pop{0%{transform:scale(.95);opacity:0}100%{transform:scale(1);opacity:1}}
    .pop{animation:pop .2s ease forwards}
    @keyframes popUp{0%{transform:translateY(30px);opacity:0}100%{transform:translateY(0);opacity:1}}
    .pill{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:20px;font-size:11px;font-family:'Inter',sans-serif;font-weight:600}
    .score-ring{transition:stroke-dashoffset 1s ease}
    @keyframes spin{to{transform:rotate(360deg)}}
    .spin{animation:spin 1s linear infinite;display:inline-block}
    .type-btn{transition:all .15s;border:2px solid transparent;cursor:pointer;border-radius:10px;padding:8px 4px;background:transparent;font-family:'Inter',sans-serif;font-size:9px;flex:1;text-align:center;line-height:1.3;font-weight:500}
    .seg-btn{transition:all .15s;border:none;cursor:pointer;font-family:'Inter',sans-serif;font-size:10px;padding:5px 8px;border-radius:6px;font-weight:600}
    .smooth-btn{transition:all .15s;border:none;cursor:pointer;font-family:'Inter',sans-serif;font-size:9px;padding:4px 8px;border-radius:6px;background:transparent;color:#666}
    .smooth-btn.active{color:#fff;background:#333}
    .chat-inp{background:#1a1a1c;border:none;color:#fff;border-radius:12px;padding:12px 14px;font-size:13px;font-family:'Inter',sans-serif;width:100%;outline:none;resize:none}
    .chat-inp:focus{outline:1px solid #444}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
    .pulse{animation:pulse 1.5s ease-in-out infinite}
    .vma-badge{transition:all .2s;cursor:pointer}
    .vma-badge:hover{opacity:.8;transform:scale(.97)}
  `;

  if(loading) return (
    <div style={{minHeight:"100vh",background:"#161618",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16}}>
      <style>{css}</style>
      <div className="spin" style={{fontSize:32,color:"#fff"}}>↻</div>
      <div style={{fontFamily:"'Inter',sans-serif",fontSize:12,color:"#555",letterSpacing:1,fontWeight:500}}>CHARGEMENT...</div>
    </div>
  );

  return (
    <div style={{minHeight:"100vh",background:"#161618",fontFamily:"'Inter',sans-serif",color:"#fff",maxWidth:480,margin:"0 auto",paddingBottom:`calc(84px + env(safe-area-inset-bottom, 16px))`}}>
      <style>{css}</style>

      {/* ── HEADER ── */}
      <div style={{padding:`calc(env(safe-area-inset-top, 0px) + 20px) 20px 0`,display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
        <div>
          <div style={{fontSize:11,color:"#555",letterSpacing:2,fontFamily:"'Inter',sans-serif",fontWeight:500}}>MARATHON DE LILLE</div>
          <div style={{fontSize:28,fontWeight:800,letterSpacing:-1,marginTop:2}}>
            {DAYS_LEFT}<span style={{fontSize:14,color:"#555",fontWeight:400,marginLeft:4}}>jours</span>
            <span style={{fontSize:14,color:"#333",margin:"0 6px"}}>·</span>
            {WEEKS_LEFT}<span style={{fontSize:14,color:"#555",fontWeight:400,marginLeft:4}}>sem.</span>
          </div>
          <div style={{fontSize:10,color:"#444",fontFamily:"'Inter',sans-serif",marginTop:2,fontWeight:500}}>25 OCT 2026</div>
        </div>
        <div style={{display:"flex",gap:6,alignItems:"flex-start"}}>
          {checkInSaved && (()=>{
            const r = checkIn.readiness ?? calcReadiness(parseFloat(checkIn.bevelRecovery)||0, parseFloat(checkIn.hrv)||0, parseFloat(checkIn.restingHR)||0, parseFloat(checkIn.sleepHours)||0, checkIn.feelingScore||3);
            const rc = r >= 85 ? "#32D74B" : r >= 65 ? "#0A84FF" : r >= 45 ? "#FF9F0A" : "#FF453A";
            const rl = r >= 85 ? "TOP" : r >= 65 ? "BON" : r >= 45 ? "MOY." : "BAS";
            return (
              <div style={{background:"#242426",borderRadius:14,padding:"10px 12px",textAlign:"center",width:72,cursor:"pointer",flexShrink:0}}
                onClick={()=>setView("today")}>
                <div style={{fontSize:8,color:"#555",letterSpacing:1,fontFamily:"'Inter',sans-serif",fontWeight:500,marginBottom:4}}>READY</div>
                <div style={{fontSize:20,fontWeight:800,color:rc,letterSpacing:-1,lineHeight:1}}>{r}</div>
                <div style={{fontSize:8,color:rc,fontFamily:"'Inter',sans-serif",fontWeight:600,marginTop:3}}>{rl}</div>
              </div>
            );
          })()}
          <div className="vma-badge" onClick={() => setShowVMA(true)}
            style={{position:"relative",background:"#242426",borderRadius:14,padding:"10px 12px",textAlign:"center",width:72,flexShrink:0}}>
            <div style={{fontSize:8,color:"#555",letterSpacing:1,fontFamily:"'Inter',sans-serif",fontWeight:500,marginBottom:4}}>VMA</div>
            <div style={{fontSize:20,fontWeight:800,color:vmaChanged?"#0A84FF":"#fff",letterSpacing:-1,lineHeight:1}}>{displayVMA.toFixed(1)}</div>
            <div style={{fontSize:8,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginTop:3}}>km/h</div>
          </div>
        </div>
      </div>

      {/* ── SYNC COACH BUTTON ── */}
      {view === "today" && (
        <div style={{padding:"8px 20px 0",display:"flex",justifyContent:"flex-end"}}>
          <button
            className="btn-ghost"
            onClick={handleGithubSync}
            disabled={githubSyncing}
            style={{opacity:githubSyncing?0.6:1,display:"flex",alignItems:"center",gap:6}}>
            {githubSyncing
              ? <><span className="spin">↻</span> Sync...</>
              : githubSyncMsg || "⟳ Sync Coach"}
          </button>
        </div>
      )}

      {/* ── VIEWS ── */}
      <div style={{padding:"20px 20px 0"}}>
        {view==="today" && (
          <TodayView
            planned={planned} done={done}
            checkIn={checkIn} setCheckIn={setCheckIn} checkInSaved={checkInSaved}
            onSaveCheckIn={onSaveCheckIn}
            recentCheckins={recentCheckins}
            weekCompare={weekCompare} protectionScore={protectionScore} weeklyVol={weeklyVol}
            todayPlanned={todayPlanned} upcoming={upcoming}
            logSession={logSession}
            readinessAction={readinessAction} setReadinessAction={setReadinessAction} applyReadinessAction={applyReadinessAction}
            weekAdjustDismissed={weekAdjustDismissed} setWeekAdjustDismissed={setWeekAdjustDismissed}
            setWeekAdjustModal={setWeekAdjustModal}
          />
        )}
        {view==="plan" && (
          <PlanView
            planned={planned} done={done} setPlanned={setPlanned}
            planConfig={planConfig} handleSettingsUpdate={handleSettingsUpdate}
            generateAndSavePlan={generateAndSavePlan} planGenLoading={planGenLoading}
            setShowWizard={setShowWizard}
            weekCompare={weekCompare}
            setWeekAdjustModal={setWeekAdjustModal}
            setModal={setModal}
            deleteSession={deleteSession}
          />
        )}
        {view==="coach" && (
          <CoachView
            planned={planned} done={done}
            checkIn={checkIn} checkInSaved={checkInSaved}
            planConfig={planConfig}
            protectionScore={protectionScore}
          />
        )}
        {view==="analyse" && (
          <AnalyseView done={done} />
        )}
        {view==="journal" && (
          <JournalView
            done={done} planned={planned}
            stravaConnected={stravaConnected} stravaLoading={stravaLoading} syncStatus={syncStatus}
            syncStrava={syncStrava} stravaLogin={stravaLogin}
            setModal={setModal}
            openEdit={openEdit}
            deleteJournalEntry={deleteJournalEntry}
          />
        )}
      </div>

      {/* ── BOTTOM NAV ── */}
      <BottomNav view={view} setView={setView} />

      {/* ── MODAL DÉBRIEF POST-STRAVA ── */}
      {stravaDebriefModal && (
        <StravaDebriefModal
          stravaDebriefModal={stravaDebriefModal}
          debriefForm={debriefForm}
          setDebriefForm={setDebriefForm}
          onClose={()=>setStravaDebriefModal(null)}
          onSubmit={submitDebrief}
        />
      )}

      {/* ── MODAL AJUSTEMENT SEMAINE ── */}
      {weekAdjustModal && (
        <WeekAdjustModal
          weekAdjustModal={weekAdjustModal}
          weekCompare={weekCompare}
          onClose={()=>setWeekAdjustModal(null)}
          onApply={applyWeekAdjustments}
        />
      )}

      {/* ── VMA MODAL ── */}
      {showVMA && (
        <VMAModal
          done={done}
          currentVMA={planConfig.vma}
          onClose={() => setShowVMA(false)}
        />
      )}

      {/* ── WIZARD MODAL ── */}
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

      {/* ── MODALS PLAN / LOG / EDIT / EDIT PLANNED ── */}
      {modal&&(
        <div onClick={()=>setModal(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.85)",zIndex:200,display:"flex",alignItems:"flex-end",justifyContent:"center",backdropFilter:"blur(6px)"}}>
          <div onClick={e=>e.stopPropagation()} className="pop" style={{background:"#242426",borderRadius:"20px 20px 0 0",padding:28,width:"100%",maxWidth:480,maxHeight:"85vh",overflowY:"auto",paddingBottom:`calc(28px + env(safe-area-inset-bottom, 12px))`}}>

            {modal.type==="editPlanned"&&modal.session&&(
              <EditPlannedModal
                session={modal.session}
                onSave={(updated)=>{setPlanned(prev=>prev.map(s=>s.id===updated.id?updated:s));}}
                onClose={()=>setModal(null)}
              />
            )}

            {modal.type==="plan"&&(<>
              <div style={{fontSize:22,fontWeight:800,color:"#fff",marginBottom:24}}>Planifier une séance</div>
              <div style={{marginBottom:16}}>
                <div style={{fontSize:9,color:"#555",letterSpacing:1,fontFamily:"'Inter',sans-serif",fontWeight:500,marginBottom:10}}>TYPE</div>
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
                <button className="btn-ghost" onClick={()=>setModal(null)} style={{flex:1,padding:14,fontSize:12}}>ANNULER</button>
                <button onClick={addPlanned} style={{flex:2,background:"#fff",color:"#000",border:"none",borderRadius:50,padding:14,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"'Inter',sans-serif"}}>ENREGISTRER</button>
              </div>
            </>)}

            {modal.type==="log"&&(<>
              <div style={{fontSize:22,fontWeight:800,color:"#fff",marginBottom:24}}>Enregistrer une séance</div>
              <div style={{marginBottom:16}}>
                <div style={{fontSize:9,color:"#555",letterSpacing:1,fontFamily:"'Inter',sans-serif",fontWeight:500,marginBottom:10}}>TYPE</div>
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
                <div style={{padding:"12px 14px",background:"#0A84FF11",borderRadius:10,marginBottom:16}}>
                  <div style={{fontSize:10,color:"#0A84FF",letterSpacing:1,fontFamily:"'Inter',sans-serif",fontWeight:600,marginBottom:8}}>⚡ TEST 6 MIN — DONNÉES PRÉCISES</div>
                  <div style={{fontSize:11,color:"#888",fontFamily:"'Inter',sans-serif",marginBottom:10,lineHeight:1.6}}>
                    Indique la distance couverte <span style={{color:"#fff"}}>uniquement pendant les 6 minutes</span> à fond (sans l'échauffement ni le retour au calme). C'est ce chiffre qui sera utilisé pour calculer ta VMA.
                  </div>
                  <Field label="DISTANCE 6 MIN PURES (km)" full>
                    <input type="number" className="inp" placeholder="ex: 1.85" step="0.01"
                      value={logForm.vma6minDist||""}
                      onChange={e=>setLogForm({...logForm,vma6minDist:e.target.value})}/>
                  </Field>
                  {logForm.vma6minDist&&parseFloat(logForm.vma6minDist)>0&&(
                    <div style={{marginTop:8,fontSize:12,fontFamily:"'JetBrains Mono',monospace",color:"#0A84FF"}}>
                      → VMA estimée : <span style={{fontWeight:700,fontSize:16}}>{(parseFloat(logForm.vma6minDist)/6*60*1.05).toFixed(2)} km/h</span>
                    </div>
                  )}
                </div>
              )}
              <FormGrid>
                <Field label="FC MOY (bpm)"><input type="number" className="inp" placeholder="145" value={logForm.hr} onChange={e=>setLogForm({...logForm,hr:e.target.value})}/></Field>
                <Field label={`RPE · ${logForm.rpe}/10`} full>
                  <input type="range" min="1" max="10" value={logForm.rpe} onChange={e=>setLogForm({...logForm,rpe:e.target.value})} style={{width:"100%",accentColor:"#FFE66D"}}/>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"#444",fontFamily:"'Inter',sans-serif",marginTop:4}}><span>LÉGER</span><span>MODÉRÉ</span><span>MAX</span></div>
                </Field>
                <Field label="RESSENTI" full>
                  <div style={{display:"flex",gap:8,justifyContent:"center"}}>
                    {FEELINGS.map((f,i)=><button key={i} onClick={()=>setLogForm({...logForm,feeling:String(i+1)})} style={{fontSize:28,background:"transparent",border:`2px solid ${+logForm.feeling===i+1?"#FFE66D":"transparent"}`,borderRadius:10,padding:"4px 8px",cursor:"pointer"}}>{f}</button>)}
                  </div>
                </Field>
                <Field label="NOTES" full><textarea className="inp" rows={2} placeholder="Ressenti, conditions..." value={logForm.notes} onChange={e=>setLogForm({...logForm,notes:e.target.value})} style={{resize:"none"}}/></Field>
              </FormGrid>
              <div style={{display:"flex",gap:10,marginTop:24}}>
                <button className="btn-ghost" onClick={()=>setModal(null)} style={{flex:1,padding:14,fontSize:12}}>ANNULER</button>
                <button onClick={submitLog} style={{flex:2,background:"#32D74B",color:"#000",border:"none",borderRadius:50,padding:14,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"'Inter',sans-serif"}}>ENREGISTRER ✓</button>
              </div>
            </>)}

            {modal.type==="edit"&&editForm&&(<>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24}}>
                <div style={{fontSize:22,fontWeight:800,color:"#fff"}}>Modifier la séance</div>
                <div style={{fontSize:11,color:"#555",fontFamily:"'Inter',sans-serif"}}>{fmtDate(editForm.date,{day:"numeric",month:"long"})}</div>
              </div>
              <div style={{marginBottom:16}}>
                <div style={{fontSize:9,color:"#555",letterSpacing:1,fontFamily:"'Inter',sans-serif",fontWeight:500,marginBottom:10}}>TYPE DE SÉANCE</div>
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
                <button className="btn-ghost" onClick={()=>setModal(null)} style={{flex:1,padding:14,fontSize:12}}>ANNULER</button>
                <button onClick={submitEdit} style={{flex:2,background:"#FFE66D",color:"#000",border:"none",borderRadius:50,padding:14,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"'Inter',sans-serif"}}>SAUVEGARDER ✓</button>
              </div>
            </>)}
          </div>
        </div>
      )}
    </div>
  );
}
