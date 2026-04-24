import { useState, useMemo } from "react";
import { savePlanned } from '../db';
import { TYPE_META, TODAY_STR } from '../constants';
import { isFuture, isToday, fmtDate, wkKey, parseDate, addDays } from '../utils/dates';
import { scoreSession } from '../utils/scores';
import CompareBar from '../components/CompareBar';
import Chart from '../components/Chart';
import { PlanSettings, fmtPace } from '../PlanWizard';

export default function PlanView({
  planned, done, setPlanned,
  planConfig, handleSettingsUpdate,
  generateAndSavePlan, planGenLoading,
  setShowWizard,
  weekCompare,
  setWeekAdjustModal,
  setModal,
  deleteSession,
}) {
  const [showSettings, setShowSettings] = useState(false);
  const [paceEdit,     setPaceEdit]     = useState(null);
  const [moveModal,    setMoveModal]     = useState(null);
  const [moveTargetId, setMoveTargetId] = useState(null);
  const [moveDate,     setMoveDate]     = useState("");

  const plannedVolumeData = useMemo(() => {
    const weeks = {};
    planned.forEach(p => {
      if (!p.targetDist) return;
      const wk = wkKey(p.date);
      if (!weeks[wk]) weeks[wk] = { dist: 0, count: 0 };
      weeks[wk].dist += p.targetDist;
      weeks[wk].count++;
    });
    return Object.entries(weeks)
      .sort(([a],[b]) => a.localeCompare(b))
      .slice(0, 20)
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

  async function applyMove() {
    if (!moveModal) return;
    const { session, mode } = moveModal;
    if (mode === "move" && moveDate) {
      const updated = { ...session, date: moveDate };
      await savePlanned(updated);
      setPlanned(prev => prev.map(p => p.id === updated.id ? updated : p));
      setMoveModal(null);
      return;
    }
    if (mode === "swap" && moveTargetId) {
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

  return (
    <div className="fade-up">
      {!showSettings ? (
        <>
          {/* ── PLAN ACTIF ── */}
          <div className="card" style={{padding:20,marginBottom:14}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
              <div>
                <div style={{fontSize:11,color:"#0A84FF",fontWeight:500,fontFamily:"'Inter',sans-serif",marginBottom:4}}>⚡ PLAN ACTIF</div>
                <div style={{fontSize:18,fontWeight:700,color:"#fff",letterSpacing:-0.3}}>VMA {planConfig.vma} km/h</div>
                <div style={{fontSize:12,color:"#888",fontFamily:"'Inter',sans-serif",marginTop:2}}>{planConfig.intensity === "soft" ? "Intensité douce" : planConfig.intensity === "ambitious" ? "Intensité ambitieuse" : "Intensité standard"}</div>
                <div style={{fontSize:11,color:"#555",fontFamily:"'Inter',sans-serif",marginTop:4}}>{planned.filter(p=>p.generated).length} séances · {planned.filter(p=>p.generated&&parseDate(p.date)>parseDate(TODAY_STR)).length} restantes</div>
              </div>
              <button onClick={()=>setShowSettings(true)} className="btn-ghost" style={{borderRadius:50,padding:"8px 14px",fontSize:11}}>⚙ Réglages</button>
            </div>

            {/* Allures */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
              {[
                {label:"EF",   key:"ef",    color:"#6BF178"},
                {label:"SL",   key:"sl",    color:"#C77DFF"},
                {label:"Tempo",key:"tempo", color:"#FF9F43"},
                {label:"VMA",  key:"vma",   color:"#FF6B6B"},
              ].map(({label,key,color})=>{
                const editing = paceEdit === key;
                return editing ? (
                  <div key={key} style={{background:"#333",borderRadius:12,padding:"10px 12px"}}>
                    <div style={{fontSize:9,color,fontFamily:"'Inter',sans-serif",fontWeight:600,marginBottom:4}}>{label}</div>
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
                      style={{width:"100%",background:"transparent",border:"none",outline:"none",color:"#fff",fontFamily:"'JetBrains Mono',monospace",fontSize:14,fontWeight:700}}
                    />
                  </div>
                ) : (
                  <div key={key} onClick={()=>setPaceEdit(key)} style={{background:"#333",borderRadius:12,padding:"10px 12px",cursor:"pointer"}}>
                    <div style={{fontSize:9,color,fontFamily:"'Inter',sans-serif",fontWeight:600,marginBottom:4}}>{label}</div>
                    <div style={{fontSize:14,fontWeight:700,color:"#fff",fontFamily:"'JetBrains Mono',monospace"}}>{fmtPace(planConfig.paces[key])}/km</div>
                  </div>
                );
              })}
            </div>

            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setShowWizard(true)} className="btn-ghost" style={{flex:1,borderRadius:50,padding:"10px",fontSize:11,textAlign:"center"}}>
                🔄 Nouveau plan
              </button>
              <button onClick={()=>generateAndSavePlan(planConfig)}
                style={{flex:2,background:"#fff",color:"#000",borderRadius:50,padding:"10px",fontSize:12,fontWeight:700,fontFamily:"'Inter',sans-serif",border:"none",cursor:"pointer"}}>
                {planGenLoading?<span className="spin">↻</span>:"⚡ Regénérer"}
              </button>
            </div>
          </div>

          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <div style={{fontSize:18,fontWeight:700,color:"#fff",letterSpacing:-0.3}}>Planning</div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:12,color:"#555",fontFamily:"'Inter',sans-serif"}}>{planned.filter(p=>isFuture(p.date)).length} à venir</span>
              <button className="btn-ghost" onClick={()=>setModal({type:"plan"})} style={{borderRadius:50,padding:"6px 12px",fontSize:11}}>+ Ajouter</button>
            </div>
          </div>

          {(()=>{
            const curWkKey = wkKey(TODAY_STR);
            const sorted=[...planned].sort((a,b)=>a.date.localeCompare(b.date)).filter(p=>wkKey(p.date) >= curWkKey);
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
              const maxKm=80;
              const barPct=Math.min((totalKm/maxKm)*100,100);
              const wkDate=new Date(wk+"T00:00:00");
              const wkEnd=new Date(wkDate); wkEnd.setDate(wkEnd.getDate()+6);
              const wkLabel=`${wkDate.getDate()} ${wkDate.toLocaleDateString("fr-FR",{month:"short"})} – ${wkEnd.getDate()} ${wkEnd.toLocaleDateString("fr-FR",{month:"short"})}`;
              const isCurrentWk=wkKey(TODAY_STR)===wk;
              return (
                <div key={wk} style={{marginBottom:20}}>
                  <div style={{marginBottom:8}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:4}}>
                      <span style={{fontSize:12,color:isCurrentWk?"#FFE66D":"#555",fontFamily:"'Inter',sans-serif",fontWeight:isCurrentWk?700:500}}>
                        {isCurrentWk?"▶ Semaine en cours":wkLabel}
                      </span>
                      <span style={{fontSize:11,fontFamily:"'Inter',sans-serif",color:"#888"}}>
                        {doneKm>0
                          ? <><span style={{color:"#32D74B",fontWeight:700}}>{doneKm.toFixed(0)}</span><span style={{color:"#555"}}>/{totalKm.toFixed(0)} km</span></>
                          : <span style={{color:"#fff",fontWeight:700}}>{totalKm.toFixed(0)} km</span>
                        }
                        <span style={{color:"#555",margin:"0 4px"}}>·</span>
                        <span style={{color:"#888"}}>{totalH>0?`${totalH}h${String(totalM).padStart(2,"0")}`:`${totalMin}min`}</span>
                        <span style={{color:"#555",margin:"0 4px"}}>·</span>
                        <span style={{color:doneCount===sessions.length&&sessions.length>0?"#32D74B":doneCount>0?"#FFE66D":"#555"}}>{doneCount}/{sessions.length}</span>
                      </span>
                    </div>
                    <div style={{height:3,background:"#333",borderRadius:2,overflow:"hidden"}}>
                      <div style={{height:"100%",width:`${barPct}%`,background:isCurrentWk?"#FFE66D":totalKm>60?"#FF453A":totalKm>40?"#FF9F0A":"#32D74B",borderRadius:2,transition:"width 0.3s"}}/>
                    </div>
                  </div>
                  {sessions.map(p=>{
                    const tm=TYPE_META[p.type]||TYPE_META["Footing"];
                    const linked=done.find(d=>d.plannedId===p.id);
                    const score=linked?scoreSession(p,linked):null;
                    const today=isToday(p.date);
                    return (
                      <div key={p.id} className="card" style={{padding:"16px 18px",marginBottom:8,borderLeft:`3px solid ${today?tm.color:linked?"#32D74B":p.generated?"#0A84FF22":"transparent"}`}}>
                        <div style={{display:"flex",gap:12,alignItems:"center"}}>
                          <div style={{width:44,height:44,borderRadius:12,background:tm.dark,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>{tm.icon}</div>
                          <div style={{flex:1}}>
                            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3}}>
                              <span style={{fontSize:11,color:today?"#FFE66D":"#888",fontFamily:"'Inter',sans-serif",fontWeight:500}}>{today?"Aujourd'hui":fmtDate(p.date,{weekday:"short",day:"numeric",month:"short"})}</span>
                              {linked&&<span style={{fontSize:9,color:"#32D74B",fontFamily:"'Inter',sans-serif",fontWeight:600}}>✓ FAIT</span>}
                              {p.generated&&!linked&&<span style={{fontSize:9,color:"#0A84FF66",fontFamily:"'Inter',sans-serif",fontWeight:500}}>AUTO</span>}
                            </div>
                            <div style={{fontSize:15,fontWeight:700,color:"#fff"}}>{p.type} · {p.targetDist} km</div>
                            <div style={{fontSize:11,color:"#555",fontFamily:"'Inter',sans-serif"}}>~{p.targetDur} min{p.targetHR?` · FC ${p.targetHR}`:""}</div>
                          </div>
                          <div style={{display:"flex",flexDirection:"column",gap:4,alignItems:"flex-end"}}>
                            {score!==null
                              ?<div style={{textAlign:"center"}}><div style={{fontSize:22,fontWeight:800,color:score>79?"#32D74B":score>59?"#FFE66D":"#FF453A"}}>{score}</div><div style={{fontSize:9,color:"#555",fontFamily:"'Inter',sans-serif"}}>SCORE</div></div>
                              :<button className="btn-ghost" onClick={()=>{ setMoveModal({session:p, mode:"swap"}); setMoveTargetId(null); setMoveDate(addDays(p.date,1)); }} style={{borderRadius:50,padding:"6px 10px",fontSize:11}}>⇄</button>
                            }
                            {!linked&&(<>
                              <button className="btn-ghost" onClick={()=>setModal({type:'editPlanned', session:p})} style={{borderRadius:50,padding:"4px 8px",fontSize:10,marginTop:2}}>✏</button>
                              <button onClick={()=>{ if(window.confirm("Supprimer cette séance ?")) deleteSession(p.id); }} style={{
                                background:"#FF453A18",border:"none",color:"#FF453A88",
                                cursor:"pointer",fontSize:10,padding:"4px 8px",borderRadius:20,
                                fontFamily:"'Inter',sans-serif",lineHeight:1,
                              }}>🗑</button>
                            </>)}
                          </div>
                        </div>
                        {(()=>{
                          const adj = weekCompare.adaptedSessions?.find(s=>s.id===p.id&&s.needsAdjust);
                          if(!adj) return null;
                          return (
                            <div style={{marginTop:8,padding:"6px 10px",background:adj.isAlert?"#FF9F0A11":"#0A84FF11",borderRadius:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                              <span style={{fontSize:10,color:adj.isAlert?"#FF9F0A":"#0A84FF",fontFamily:"'Inter',sans-serif"}}>
                                {adj.isAlert?"⚠":""} Adaptatif : {adj.delta>0?"+":""}{adj.delta.toFixed(1)}km → {adj.idealDist}km
                              </span>
                              <button onClick={e=>{e.stopPropagation();setWeekAdjustModal({sessions:[adj]});}}
                                style={{fontSize:9,color:adj.isAlert?"#FF9F0A":"#0A84FF",background:"transparent",border:`1px solid ${adj.isAlert?"#FF9F0A44":"#0A84FF44"}`,borderRadius:20,padding:"2px 8px",cursor:"pointer",fontFamily:"'Inter',sans-serif",fontWeight:600}}>
                                APPLIQUER
                              </button>
                            </div>
                          );
                        })()}
                        {p.notes&&<div style={{fontSize:10,color:"#555",fontFamily:"'Inter',sans-serif",marginTop:8,lineHeight:1.5}}>💬 {p.notes}</div>}
                        {linked&&<CompareBar planned={p} done={linked}/>}
                      </div>
                    );
                  })}
                </div>
              );
            });
          })()}

          {plannedVolumeData.length > 1 && (
            <div className="card" style={{padding:20,marginTop:14}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
                <div>
                  <div style={{fontSize:18,fontWeight:700,color:"#fff",letterSpacing:-0.3}}>Volume planifié</div>
                  <div style={{fontSize:12,color:"#888",fontFamily:"'Inter',sans-serif",marginTop:2}}>Kilomètres prévus par semaine</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:20,fontWeight:800,color:"#0A84FF",letterSpacing:-1}}>
                    {Math.round(plannedVolumeData.reduce((s,d)=>s+d.value,0)/plannedVolumeData.length)}
                    <span style={{fontSize:11,color:"#555",fontWeight:400}}> km moy.</span>
                  </div>
                  <div style={{fontSize:11,color:"#555",fontFamily:"'Inter',sans-serif"}}>
                    pic {Math.max(...plannedVolumeData.map(d=>d.value))} km
                  </div>
                </div>
              </div>
              <Chart data={plannedVolumeData} color="#0A84FF" formatY={v=>`${v}km`} smooth={false}/>
              <div style={{display:"flex",gap:8,marginTop:14}}>
                {[
                  ["SEMAINES",`${plannedVolumeData.length}`,"#555"],
                  ["VOLUME MOY",`${Math.round(plannedVolumeData.reduce((s,d)=>s+d.value,0)/plannedVolumeData.length)} km`,"#0A84FF"],
                  ["PIC",`${Math.max(...plannedVolumeData.map(d=>d.value))} km`,"#FF9F0A"],
                  ["TOTAL",`${Math.round(plannedVolumeData.reduce((s,d)=>s+d.value,0))} km`,"#32D74B"],
                ].map(([l,v,c])=>(
                  <div key={l} style={{flex:1,background:"#333",borderRadius:10,padding:"10px 6px",textAlign:"center"}}>
                    <div style={{fontSize:8,color:"#555",fontFamily:"'Inter',sans-serif",fontWeight:500,marginBottom:3}}>{l}</div>
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
            <div style={{fontSize:20,fontWeight:700,color:"#fff",letterSpacing:-0.3}}>Réglages du plan</div>
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

      {/* ── MODAL DÉPLACEMENT ── */}
      {moveModal && (()=>{
        const { session, mode } = moveModal;
        const tm = TYPE_META[session.type] || TYPE_META["Footing"];
        const swapCandidates = planned
          .filter(p => p.id !== session.id && parseDate(p.date) >= parseDate(TODAY_STR) && !done.find(d => d.plannedId === p.id))
          .sort((a,b) => a.date.localeCompare(b.date))
          .slice(0, 14);
        return (
          <div onClick={()=>setMoveModal(null)}
            style={{position:"fixed",inset:0,background:"rgba(0,0,0,.88)",zIndex:300,display:"flex",alignItems:"flex-end",justifyContent:"center",backdropFilter:"blur(8px)"}}>
            <div onClick={e=>e.stopPropagation()} className="pop"
              style={{background:"#242426",borderRadius:"20px 20px 0 0",padding:28,width:"100%",maxWidth:480,maxHeight:"85vh",overflowY:"auto",paddingBottom:`calc(28px + env(safe-area-inset-bottom,12px))`}}>
              <div style={{marginBottom:20}}>
                <div style={{fontSize:11,color:tm.color,fontWeight:500,fontFamily:"'Inter',sans-serif",marginBottom:6}}>{tm.icon} Déplacer la séance</div>
                <div style={{fontSize:20,fontWeight:700,color:"#fff",letterSpacing:-0.3}}>{session.type}</div>
                <div style={{fontSize:11,color:"#555",fontFamily:"'Inter',sans-serif",marginTop:2}}>
                  {fmtDate(session.date,{weekday:"long",day:"numeric",month:"long"})} · {session.targetDist}km
                </div>
              </div>
              <div style={{display:"flex",gap:8,marginBottom:20}}>
                {[["swap","⇄ Échanger","Swapper avec une autre séance"],["move","→ Reporter","Choisir une nouvelle date"]].map(([m,label,desc])=>(
                  <button key={m} onClick={()=>setMoveModal(prev=>({...prev,mode:m}))}
                    style={{flex:1,border:`2px solid ${mode===m?tm.color:"#333"}`,background:mode===m?tm.color+"22":"transparent",borderRadius:14,padding:"12px 8px",cursor:"pointer",textAlign:"center"}}>
                    <div style={{fontSize:13,fontWeight:700,color:mode===m?tm.color:"#555",fontFamily:"'Inter',sans-serif"}}>{label}</div>
                    <div style={{fontSize:10,color:"#555",fontFamily:"'Inter',sans-serif",marginTop:3}}>{desc}</div>
                  </button>
                ))}
              </div>
              {mode==="swap" && (
                <div>
                  <div style={{fontSize:11,color:"#555",fontWeight:500,fontFamily:"'Inter',sans-serif",marginBottom:10}}>Choisir avec quelle séance échanger</div>
                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    {swapCandidates.map(target=>{
                      const ttm = TYPE_META[target.type]||TYPE_META["Footing"];
                      const isSel = moveTargetId === target.id;
                      return (
                        <button key={target.id} onClick={()=>setMoveTargetId(target.id)}
                          style={{border:`2px solid ${isSel?ttm.color:"#333"}`,background:isSel?ttm.color+"11":"#333",borderRadius:12,padding:"12px 14px",cursor:"pointer",textAlign:"left",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                          <div>
                            <div style={{fontSize:10,color:"#555",fontFamily:"'Inter',sans-serif",marginBottom:2}}>{fmtDate(target.date,{weekday:"short",day:"numeric",month:"short"})}</div>
                            <div style={{fontSize:13,fontWeight:700,color:isSel?ttm.color:"#aaa"}}>{ttm.icon} {target.type}</div>
                            <div style={{fontSize:10,color:"#555",fontFamily:"'Inter',sans-serif"}}>{target.targetDist}km · ~{target.targetDur}min</div>
                          </div>
                          {isSel && <span style={{fontSize:18,color:ttm.color}}>✓</span>}
                        </button>
                      );
                    })}
                    {swapCandidates.length===0 && (
                      <div style={{fontSize:11,color:"#555",fontFamily:"'Inter',sans-serif",padding:14,textAlign:"center"}}>Aucune séance disponible pour l'échange</div>
                    )}
                  </div>
                </div>
              )}
              {mode==="move" && (
                <div>
                  <div style={{fontSize:11,color:"#555",fontWeight:500,fontFamily:"'Inter',sans-serif",marginBottom:10}}>Nouvelle date</div>
                  <input type="date" className="inp" value={moveDate}
                    onChange={e=>setMoveDate(e.target.value)}
                    min={TODAY_STR}
                    style={{marginBottom:8}}/>
                  <div style={{fontSize:10,color:"#555",fontFamily:"'Inter',sans-serif"}}>
                    {moveDate && moveDate !== session.date ? `→ ${fmtDate(moveDate,{weekday:"long",day:"numeric",month:"long"})}` : "Sélectionne une date"}
                  </div>
                </div>
              )}
              <div style={{display:"flex",gap:10,marginTop:20}}>
                <button className="btn-ghost" onClick={()=>setMoveModal(null)}
                  style={{flex:1,borderRadius:50,padding:14,fontSize:12}}>
                  Annuler
                </button>
                <button onClick={applyMove}
                  disabled={mode==="swap"?!moveTargetId : !moveDate||moveDate===session.date}
                  style={{flex:2,background:tm.color,color:"#000",border:"none",borderRadius:50,padding:14,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"'Inter',sans-serif",opacity:(mode==="swap"?!moveTargetId:!moveDate||moveDate===session.date)?0.4:1}}>
                  {mode==="swap"?"⇄ Échanger":"→ Reporter"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
