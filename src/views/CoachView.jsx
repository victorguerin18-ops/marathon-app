import { useState } from "react";
import { STORE, TODAY_STR, DAYS_LEFT, WEEKS_LEFT } from '../constants';
import { wkKey, fmtDate, parseDate } from '../utils/dates';
import { calcReadiness } from '../utils/scores';
import { fmtPace } from '../PlanWizard';

export default function CoachView({
  planned, done,
  checkIn, checkInSaved,
  planConfig,
  protectionScore,
}) {
  const [coachMsg,    setCoachMsg]    = useState(()=>STORE.get("coach_msg",null));
  const [coachDate,   setCoachDate]   = useState(()=>STORE.get("coach_date",null));
  const [coachLoading,setCoachLoading]= useState(false);
  const [chatHistory, setChatHistory] = useState(()=>STORE.get("coach_chat",[]));
  const [chatInput,   setChatInput]   = useState("");

  const totalKm = done.reduce((s,r)=>s+r.dist,0);

  function buildCoachContext() {
    const recentDone=[...done].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,15);
    const weeks={};
    done.forEach(r=>{
      const wk=wkKey(r.date);
      if(!weeks[wk]) weeks[wk]={dist:0,runs:0,rpe:[]};
      weeks[wk].dist+=r.dist; weeks[wk].runs++; weeks[wk].rpe.push(r.rpe||5);
    });
    const wkList=Object.entries(weeks).sort(([a],[b])=>b.localeCompare(a)).slice(0,4);
    const planUpcoming=[...planned].filter(p=>parseDate(p.date)>=parseDate(TODAY_STR)).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,6);
    const efRuns=done.filter(r=>r.type==="Endurance fondamentale"&&r.dist>5).sort((a,b)=>a.date.localeCompare(b.date));
    const lastPace=efRuns.length?(efRuns[efRuns.length-1].dur*60)/efRuns[efRuns.length-1].dist:null;
    const todayDone=done.find(d=>d.date===TODAY_STR);
    const todayPlannedSession=planned.find(p=>p.date===TODAY_STR);
    const readiness=checkInSaved?(checkIn.readiness??calcReadiness(parseFloat(checkIn.bevelRecovery)||0,parseFloat(checkIn.hrv)||0,parseFloat(checkIn.restingHR)||0,parseFloat(checkIn.sleepHours)||0,checkIn.feelingScore||3)):null;
    const ps=protectionScore;

    return `Tu es le coach marathon de Victor. Sois CONCIS (max 5 phrases sauf si question précise). Pose une question si tu as besoin d'une info manquante. Pas d'intro générique, va droit au but.

PROFIL : Victor, Marathon de Lille 25/10/2026 (${DAYS_LEFT}j/${WEEKS_LEFT}sem), sub-3h30, VMA ${planConfig.vma}km/h, allures : EF ${fmtPace(planConfig.paces.ef)}/km · Seuil ${fmtPace(planConfig.paces.tempo)}/km · VMA ${fmtPace(planConfig.paces.vma)}/km · Marathon ~4'58"/km

ÉTAT DU JOUR :
- Readiness : ${readiness!==null?`${readiness}/100 (Bevel récup ${checkIn.bevelRecovery||'?'}%, VFC ${checkIn.hrv||'?'}ms, FC repos ${checkIn.restingHR||'?'}bpm, sommeil ${checkIn.sleepHours||'?'}h, sensation ${['','Épuisé','Fatigué','Correct','Bien','Excellent'][checkIn.feelingScore||3]})`:'check-in non fait'}
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

  async function askCoach(userMessage=null) {
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

  async function sendChat() {
    if(!chatInput.trim()) return;
    const msg=chatInput; setChatInput("");
    await askCoach(msg);
  }

  const readiness = checkInSaved
    ? (checkIn.readiness ?? calcReadiness(checkIn.hrv, checkIn.recovery, checkIn.feeling))
    : null;

  return (
    <div className="fade-up" style={{display:"flex",flexDirection:"column",height:`calc(100vh - 84px - env(safe-area-inset-bottom,16px) - 20px)`}}>

      <div style={{flexShrink:0}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <div>
            <div style={{fontSize:20,fontWeight:700,color:"#fff",letterSpacing:-0.3}}>Coach IA</div>
            <div style={{fontSize:12,color:"#888",fontFamily:"'Inter',sans-serif",marginTop:2}}>
              {coachDate?`Bilan du ${fmtDate(coachDate,{day:"numeric",month:"short"})}`:"Pas encore de bilan"}
            </div>
          </div>
          <button onClick={()=>askCoach(null)}
            style={{background:"#fff",color:"#000",border:"none",borderRadius:50,padding:"8px 16px",fontSize:11,fontWeight:700,fontFamily:"'Inter',sans-serif",cursor:"pointer",flexShrink:0}}>
            {coachLoading&&!chatInput?<span className="spin" style={{color:"#000"}}>↻</span>:"✦ BILAN"}
          </button>
        </div>

        <div style={{display:"flex",gap:6,marginBottom:14}}>
          {[
            ["VMA",`${planConfig.vma}km/h`,"#0A84FF"],
            ["PROTECT.",`${protectionScore.total}/100`,protectionScore.level.color],
            ["READINESS",readiness!==null?`${readiness}/100`:"—","#32D74B"],
            ["KM",`${totalKm.toFixed(0)}km`,"#FFE66D"],
          ].map(([l,v,c])=>(
            <div key={l} style={{flex:1,background:"#333",borderRadius:12,padding:"8px 6px",textAlign:"center"}}>
              <div style={{fontSize:8,color:"#555",fontFamily:"'Inter',sans-serif",fontWeight:500,marginBottom:3}}>{l}</div>
              <div style={{fontSize:12,fontWeight:700,color:c}}>{v}</div>
            </div>
          ))}
        </div>

        {coachMsg&&(
          <div className="card" style={{padding:"12px 14px",marginBottom:10}}>
            <div style={{fontSize:9,color:"#32D74B",fontWeight:600,fontFamily:"'Inter',sans-serif",marginBottom:8}}>✦ DERNIER BILAN</div>
            <div style={{fontSize:12,color:"#ccc",lineHeight:1.7,whiteSpace:"pre-wrap"}}>{coachMsg}</div>
          </div>
        )}
        {coachLoading&&!chatInput&&(
          <div className="card" style={{padding:"14px",marginBottom:10,textAlign:"center"}}>
            <span className="pulse" style={{fontSize:16,color:"#32D74B"}}>✦</span>
            <span style={{fontSize:11,color:"#555",fontFamily:"'Inter',sans-serif",marginLeft:8}}>Analyse en cours...</span>
          </div>
        )}

        {chatHistory.length>0&&<div style={{height:1,background:"#333",marginBottom:8}}/>}
      </div>

      <div style={{flex:1,overflowY:"auto",paddingBottom:8}}>
        {chatHistory.length===0&&!coachMsg&&(
          <div style={{textAlign:"center",padding:"32px 20px"}}>
            <div style={{fontSize:32,marginBottom:12}}>✦</div>
            <div style={{fontSize:13,color:"#555",fontFamily:"'Inter',sans-serif",lineHeight:1.7}}>
              Pose une question ou demande un bilan.<br/>
              <span style={{color:"#333",fontSize:11}}>Ex: "Mes allures EF progressent ?" · "Prochaine séance ?"</span>
            </div>
          </div>
        )}
        {chatHistory.map((m,i)=>(
          <div key={i} style={{marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"flex-end",marginBottom:5}}>
              <div style={{background:"#333",borderRadius:"12px 12px 4px 12px",padding:"10px 14px",maxWidth:"82%",fontSize:13,color:"#fff",lineHeight:1.5}}>{m.user}</div>
            </div>
            <div style={{display:"flex",justifyContent:"flex-start"}}>
              <div className="card" style={{borderRadius:"4px 12px 12px 12px",padding:"10px 14px",maxWidth:"90%",fontSize:13,color:"#ccc",lineHeight:1.6,whiteSpace:"pre-wrap"}}>{m.coach}</div>
            </div>
          </div>
        ))}
        {coachLoading&&chatInput&&(
          <div style={{display:"flex",justifyContent:"flex-start",marginBottom:10}}>
            <div className="card" style={{borderRadius:"4px 12px 12px 12px",padding:"10px 14px"}}>
              <span className="pulse" style={{color:"#32D74B",fontSize:14}}>✦</span>
            </div>
          </div>
        )}
      </div>

      <div style={{flexShrink:0,paddingTop:8,borderTop:"1px solid #333"}}>
        <div style={{display:"flex",gap:8,alignItems:"flex-end"}}>
          <textarea className="chat-inp" rows={1} value={chatInput}
            onChange={e=>setChatInput(e.target.value)}
            onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendChat();}}}
            placeholder="Message au coach..."
            style={{resize:"none",minHeight:40,maxHeight:100}}/>
          <button onClick={sendChat}
            style={{background:"#32D74B",color:"#000",border:"none",borderRadius:14,padding:"10px 14px",fontSize:16,flexShrink:0,cursor:"pointer",height:42,fontWeight:700}}>
            {coachLoading&&chatInput?<span className="spin" style={{color:"#000",fontSize:13}}>↻</span>:"→"}
          </button>
        </div>
      </div>
    </div>
  );
}
