import { useState } from "react";
import { TYPE_META, STORE, TODAY_STR, TODAY } from '../constants';
import { addDays, fmtDate, wkKey, parseDate, pace } from '../utils/dates';
import { calcReadiness, getReadinessReco, getReadinessAdvice, scoreSession } from '../utils/scores';
import CompareBar from '../components/CompareBar';

export default function TodayView({
  planned, done,
  checkIn, setCheckIn, checkInSaved,
  onSaveCheckIn,
  weekCompare, protectionScore, weeklyVol,
  todayPlanned, upcoming,
  logSession,
  readinessAction, setReadinessAction, applyReadinessAction,
  weekAdjustDismissed, setWeekAdjustDismissed,
  setWeekAdjustModal,
}) {
  const [checkInEditing,       setCheckInEditing]       = useState(false);
  const [showProtectionDetail, setShowProtectionDetail] = useState(false);
  const [showMonoDetail,       setShowMonoDetail]       = useState(false);

  // ── CHECK-IN CARD ──────────────────────────────────────────────────────
  const readiness = (checkInSaved && !checkInEditing)
    ? (checkIn.readiness ?? calcReadiness(checkIn.hrv, checkIn.recovery, checkIn.feeling))
    : (checkIn.hrv || checkIn.recovery || checkIn.feeling !== null)
      ? calcReadiness(checkIn.hrv, checkIn.recovery, checkIn.feeling)
      : null;
  const reco = readiness !== null ? getReadinessReco(readiness, checkIn.hrv, todayPlanned[0]?.type) : null;
  const rc = readiness === null ? "#555"
    : readiness >= 85 ? "#4ECDC4" : readiness >= 65 ? "#6BF178" : readiness >= 45 ? "#FF9F43" : "#FF6B6B";
  const rl = readiness === null ? "—"
    : readiness >= 85 ? "EXCELLENT" : readiness >= 65 ? "BON" : readiness >= 45 ? "MODÉRÉ" : "FATIGUE";
  const feelEmoji = checkIn.feeling === 0 ? "🟢" : checkIn.feeling === 1 ? "🟡" : checkIn.feeling === 2 ? "🔴" : null;

  function saveCheckIn() {
    const r = calcReadiness(checkIn.hrv, checkIn.recovery, checkIn.feeling);
    onSaveCheckIn({ ...checkIn, readiness: r });
    setCheckInEditing(false);
  }

  return (
    <div className="fade-up">

      {/* ── CHECK-IN MATIN ── */}
      {checkInSaved && !checkInEditing ? (
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
      ) : (
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
            <button onClick={saveCheckIn}
              style={{flex:2,background:"#6BF178",color:"#080A0E",border:"none",borderRadius:10,padding:"10px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"'JetBrains Mono',monospace"}}>
              SAUVEGARDER ✓
            </button>
          </div>
        </div>
      )}

      {/* ── READINESS ADVISOR ── */}
      {(()=>{
        if (!checkInSaved) return null;
        const r = checkIn.readiness ?? calcReadiness(checkIn.hrv, checkIn.recovery, checkIn.feeling);
        const curWk = wkKey(TODAY_STR);
        const weekPlanned = planned.filter(p => wkKey(p.date) === curWk);
        const todayUnlinked = todayPlanned.filter(p => !done.find(d => d.plannedId === p.id));
        if (todayUnlinked.length === 0) return null;
        const todaySession = todayUnlinked[0];
        const advice = readinessAction?.done
          ? null
          : getReadinessAdvice(r, todaySession, weekPlanned, done);
        if (!advice && !readinessAction?.done) return null;
        if (readinessAction?.done) return (
          <div className="card" style={{padding:"14px 18px",marginBottom:14,border:"1px solid #4ECDC433",background:"#0d2b20"}}>
            <div style={{fontSize:12,color:"#4ECDC4",fontFamily:"'JetBrains Mono',monospace"}}>{readinessAction.result || "✓ Action appliquée"}</div>
          </div>
        );
        return (
          <div className="card" style={{padding:20,marginBottom:14,border:`2px solid ${advice.color}44`,background:`${advice.color}08`}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
              <div style={{fontSize:24,flexShrink:0}}>{advice.icon}</div>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:800,color:advice.color}}>{advice.title}</div>
                <div style={{fontSize:10,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginTop:1}}>ADAPTATION SUGGÉRÉE</div>
              </div>
              <div style={{width:36,height:36,borderRadius:10,background:advice.level==="danger"?"#FF6B6B22":advice.level==="warning"?"#FF9F4322":"#FFE66D22",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:800,color:advice.color,fontFamily:"'JetBrains Mono',monospace"}}>{r}</div>
            </div>
            <div style={{padding:"12px 14px",background:"#080A0E",borderRadius:10,marginBottom:14,fontSize:12,color:"#ccc",fontFamily:"'JetBrains Mono',monospace",lineHeight:1.7,borderLeft:`3px solid ${advice.color}`}}>
              {advice.message}
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {advice.actions.map((action,i)=>(
                <button key={action.id+i}
                  onClick={()=>{ setReadinessAction({advice, action}); applyReadinessAction(action, todaySession); }}
                  style={{width:"100%",background:action.primary?advice.color:action.ghost?"transparent":advice.color+"22",color:action.primary?"#080A0E":action.ghost?"#555":advice.color,border:action.ghost?"1px solid #1C1F27":`1px solid ${advice.color}44`,borderRadius:10,padding:"12px 14px",fontSize:11,fontWeight:action.ghost?400:700,cursor:"pointer",fontFamily:"'JetBrains Mono',monospace",display:"flex",alignItems:"center",justifyContent:"center",gap:8,letterSpacing:action.ghost?0:0.5}}>
                  <span style={{fontSize:14}}>{action.icon}</span>
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── SÉANCES DU JOUR ── */}
      {todayPlanned.length===0&&(
        <div className="card" style={{padding:28,textAlign:"center"}}>
          <div style={{fontSize:40,marginBottom:12}}>🏃</div>
          <div style={{fontSize:14,color:"#555",fontFamily:"'JetBrains Mono',monospace"}}>Rien de planifié aujourd'hui</div>
          <button className="btn-primary" onClick={()=>logSession()} style={{marginTop:16,background:"#E8E4DC",color:"#080A0E",borderRadius:10,padding:"10px 20px",fontSize:12,fontWeight:700}}>Planifier une séance</button>
        </div>
      )}
      {todayPlanned.map(p=>{
        const tm=TYPE_META[p.type]||TYPE_META["Footing"];
        const linked=done.find(d=>d.plannedId===p.id)||done.find(d=>d.date===p.date&&d.fromStrava&&!d.plannedId);
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

      {/* ── SEMAINE EN COURS ── */}
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

      {/* ── PROCHAINES SÉANCES ── */}
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
          <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:12}}>
            {weekCompare.adaptedSessions.filter(s=>s.needsAdjust).map(s=>{
              const color = s.isAlert?"#FF9F43":"#00D2FF";
              return (
                <div key={s.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 12px",background:"#080A0E",borderRadius:8,border:`1px solid ${color}22`}}>
                  <div>
                    <div style={{fontSize:11,color:"#E8E4DC",fontFamily:"'JetBrains Mono',monospace"}}>{s.type.split(' ')[0]} · {s.date}</div>
                    <div style={{fontSize:10,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginTop:2}}>prévu {s.targetDist}km → idéal {s.idealDist}km</div>
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
        <div style={{height:6,background:"#1C1F27",borderRadius:3,marginBottom:16,overflow:"hidden"}}>
          <div style={{height:"100%",width:`${protectionScore.total}%`,background:`linear-gradient(90deg,${protectionScore.level.color}88,${protectionScore.level.color})`,borderRadius:3,transition:"width 1s ease"}}/>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {protectionScore.signals.map(sig=>(
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
        {!checkInSaved&&(
          <div style={{marginTop:12,padding:"10px 12px",background:"#080A0E",borderRadius:8,fontSize:11,color:"#555",fontFamily:"'JetBrains Mono',monospace",lineHeight:1.6}}>
            💡 Fais ton check-in matin pour affiner le score avec ta VFC et récupération
          </div>
        )}
      </div>

      {/* ── MODAL PROTECTION BLESSURE ── */}
      {showProtectionDetail && (()=>{
        const ps = protectionScore;
        const acwrSig  = ps.signals.find(s=>s.key==="ACWR");
        const volSig   = ps.signals.find(s=>s.key==="VOL");
        const monoSig  = ps.signals.find(s=>s.key==="MONO");
        const readySig = ps.signals.find(s=>s.key==="READY");
        const acwrRaw  = parseFloat(acwrSig?.value) || 1;
        const last7Runs   = done.filter(r => r.date >= addDays(TODAY_STR, -14));
        const last7ByType = {};
        last7Runs.forEach(r => { if(!last7ByType[r.type]) last7ByType[r.type]={runs:0,km:0}; last7ByType[r.type].runs++; last7ByType[r.type].km+=r.dist; });
        const curKmRaw  = weeklyVol[0]?.dist || 0;
        const prevKmRaw = weeklyVol[1]?.dist || 0;
        function SigColor(score) { return score>=75?"#4ECDC4":score>=50?"#FF9F43":"#FF6B6B"; }
        return (
          <div onClick={()=>setShowProtectionDetail(false)}
            style={{position:"fixed",inset:0,background:"rgba(0,0,0,.92)",zIndex:400,display:"flex",alignItems:"flex-end",justifyContent:"center",backdropFilter:"blur(10px)"}}>
            <div onClick={e=>e.stopPropagation()}
              style={{width:"100%",maxWidth:480,background:"#0F1117",border:"1px solid #1C1F27",borderRadius:"22px 22px 0 0",padding:"28px 24px",paddingBottom:"calc(28px + env(safe-area-inset-bottom,12px))",maxHeight:"90vh",overflowY:"auto"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:24}}>
                <div>
                  <div style={{fontSize:10,color:ps.level.color,letterSpacing:3,fontFamily:"'JetBrains Mono',monospace",marginBottom:6}}>{ps.level.icon} PROTECTION BLESSURE</div>
                  <div style={{display:"flex",alignItems:"baseline",gap:10}}>
                    <span style={{fontSize:48,fontWeight:800,color:ps.level.color,letterSpacing:-3,lineHeight:1}}>{ps.total}</span>
                    <span style={{fontSize:14,color:"#555",fontFamily:"'JetBrains Mono',monospace"}}>/100 · {ps.level.label}</span>
                  </div>
                </div>
                <button onClick={()=>setShowProtectionDetail(false)} style={{background:"#1C1F27",border:"none",color:"#888",fontSize:18,cursor:"pointer",borderRadius:10,width:36,height:36,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
              </div>
              <div style={{height:8,background:"#1C1F27",borderRadius:4,marginBottom:28,overflow:"hidden"}}>
                <div style={{height:"100%",width:`${ps.total}%`,background:`linear-gradient(90deg,${ps.level.color}66,${ps.level.color})`,borderRadius:4,transition:"width 1s ease"}}/>
              </div>

              {/* Readiness 45% */}
              <div style={{marginBottom:24,padding:"18px",background:SigColor(readySig?.score||0)+"0A",border:`1px solid ${SigColor(readySig?.score||0)}22`,borderRadius:16}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <div>
                    <div style={{fontSize:10,color:SigColor(readySig?.score||0),letterSpacing:2,fontFamily:"'JetBrains Mono',monospace",marginBottom:3}}>READINESS · POIDS 45%</div>
                    <div style={{fontSize:16,fontWeight:800,color:SigColor(readySig?.score||0)}}>{readySig?.value||"—"}</div>
                  </div>
                  <div style={{fontSize:36,fontWeight:800,color:SigColor(readySig?.score||0),letterSpacing:-2}}>{readySig?.score||0}</div>
                </div>
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

              {/* ACWR 35% */}
              <div style={{marginBottom:24,padding:"18px",background:SigColor(acwrSig?.score||0)+"0A",border:`1px solid ${SigColor(acwrSig?.score||0)}22`,borderRadius:16}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <div>
                    <div style={{fontSize:10,color:SigColor(acwrSig?.score||0),letterSpacing:2,fontFamily:"'JetBrains Mono',monospace",marginBottom:3}}>CHARGE AIGUË/CHRONIQUE · 35%</div>
                    <div style={{fontSize:16,fontWeight:800,color:SigColor(acwrSig?.score||0)}}>ACWR {acwrSig?.value||"—"}</div>
                  </div>
                  <div style={{fontSize:36,fontWeight:800,color:SigColor(acwrSig?.score||0),letterSpacing:-2}}>{acwrSig?.score||0}</div>
                </div>
                <div style={{marginBottom:12}}>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"#444",fontFamily:"'JetBrains Mono',monospace",marginBottom:5}}>
                    <span>Sous-chargé</span><span style={{color:"#4ECDC4"}}>Zone optimale</span><span>Surcharge</span>
                  </div>
                  <div style={{height:10,background:"#1C1F27",borderRadius:5,position:"relative",overflow:"visible"}}>
                    <div style={{position:"absolute",left:"26.7%",width:"16.7%",height:"100%",background:"#4ECDC422",borderRadius:2}}/>
                    <div style={{position:"absolute",top:-3,left:`${Math.min(Math.max(acwrRaw/2,0),1)*95}%`,width:16,height:16,borderRadius:"50%",background:SigColor(acwrSig?.score||0),border:"2px solid #080A0E",transform:"translateX(-50%)",transition:"left 0.8s ease",boxShadow:`0 0 8px ${SigColor(acwrSig?.score||0)}66`}}/>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"#333",fontFamily:"'JetBrains Mono',monospace",marginTop:4}}>
                    <span>0</span><span>0.8</span><span>1.0</span><span>1.3</span><span>1.5</span><span>2.0</span>
                  </div>
                </div>
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

              {/* Monotonie 10% — cliquable → modal dédié */}
              <div onClick={()=>{setShowProtectionDetail(false);setShowMonoDetail(true);}}
                style={{marginBottom:24,padding:"18px",background:SigColor(monoSig?.score||0)+"0A",border:`1px solid ${SigColor(monoSig?.score||0)}22`,borderRadius:16,cursor:"pointer"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <div>
                    <div style={{fontSize:10,color:SigColor(monoSig?.score||0),letterSpacing:2,fontFamily:"'JetBrains Mono',monospace",marginBottom:3}}>MONOTONIE · 10%</div>
                    <div style={{fontSize:16,fontWeight:800,color:SigColor(monoSig?.score||0)}}>{monoSig?.value||"—"}</div>
                    <div style={{fontSize:10,color:SigColor(monoSig?.score||0)+"88",fontFamily:"'JetBrains Mono',monospace",marginTop:3}}>Voir détail →</div>
                  </div>
                  <div style={{fontSize:36,fontWeight:800,color:SigColor(monoSig?.score||0),letterSpacing:-2}}>{monoSig?.score||0}</div>
                </div>
                {monoSig?.detail&&(
                  <div style={{fontSize:11,color:"#888",fontFamily:"'JetBrains Mono',monospace",marginBottom:10}}>{monoSig.detail}</div>
                )}
                {last7Runs.length > 0 ? (
                  <div style={{marginBottom:10}}>
                    <div style={{fontSize:9,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginBottom:6,letterSpacing:1}}>SÉANCES 14 DERNIERS JOURS</div>
                    {Object.entries(last7ByType).map(([type,data])=>{
                      const tm={"Endurance fondamentale":{color:"#6BF178",icon:"◈"},"Fractionné / VMA":{color:"#FF6B6B",icon:"▲▲"},"Tempo / Seuil":{color:"#FF9F43",icon:"◇"},"Sortie longue":{color:"#C77DFF",icon:"◈◈◈"},"Footing":{color:"#A8DADC",icon:"〜"}}[type]||{color:"#888",icon:"○"};
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

              {/* Volume 10% */}
              <div style={{marginBottom:16,padding:"18px",background:SigColor(volSig?.score||0)+"0A",border:`1px solid ${SigColor(volSig?.score||0)}22`,borderRadius:16}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <div>
                    <div style={{fontSize:10,color:SigColor(volSig?.score||0),letterSpacing:2,fontFamily:"'JetBrains Mono',monospace",marginBottom:3}}>PROGRESSION VOLUME · 10%</div>
                    <div style={{fontSize:16,fontWeight:800,color:SigColor(volSig?.score||0)}}>{volSig?.value||"0%"}</div>
                  </div>
                  <div style={{fontSize:36,fontWeight:800,color:SigColor(volSig?.score||0),letterSpacing:-2}}>{volSig?.score||0}</div>
                </div>
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

      {/* ── MODAL MONOTONIE DÉTAIL ── */}
      {showMonoDetail && (()=>{
        const HARD = ["Fractionné / VMA", "Tempo / Seuil", "Évaluation VMA"];
        const last14 = done.filter(r => r.date >= addDays(TODAY_STR, -14)).sort((a,b) => a.date.localeCompare(b.date));
        const monoSig = protectionScore.signals.find(s=>s.key==="MONO");
        const color = monoSig?.score>=75?"#4ECDC4":monoSig?.score>=50?"#FF9F43":"#FF6B6B";
        const byType = {};
        last14.forEach(r => { if(!byType[r.type]) byType[r.type]={count:0,km:0}; byType[r.type].count++; byType[r.type].km+=r.dist; });
        const total = last14.length;
        const TMETA = {"Endurance fondamentale":{color:"#6BF178",icon:"◈"},"Fractionné / VMA":{color:"#FF6B6B",icon:"▲▲"},"Tempo / Seuil":{color:"#FF9F43",icon:"◇"},"Sortie longue":{color:"#C77DFF",icon:"◈◈◈"},"Footing":{color:"#A8DADC",icon:"〜"},"Évaluation VMA":{color:"#00D2FF",icon:"⚡"}};
        const weeks = [1,0].map(i => {
          const wkRuns = done.filter(r => r.date >= addDays(TODAY_STR, -(i+1)*7) && r.date < addDays(TODAY_STR, -i*7));
          const hard = wkRuns.filter(r=>HARD.includes(r.type));
          const easy = wkRuns.filter(r=>!HARD.includes(r.type));
          return { label:i===0?"S-1 (semaine passée)":"S-2", runs:wkRuns.length, hard:hard.length, easy:easy.length,
            hardKm:Math.round(hard.reduce((s,r)=>s+r.dist,0)*10)/10, easyKm:Math.round(easy.reduce((s,r)=>s+r.dist,0)*10)/10 };
        });
        const curWkRuns = done.filter(r => r.date >= addDays(TODAY_STR, -7));
        const curHard = curWkRuns.filter(r=>HARD.includes(r.type));
        const curEasy = curWkRuns.filter(r=>!HARD.includes(r.type));
        return (
          <div onClick={()=>setShowMonoDetail(false)}
            style={{position:"fixed",inset:0,background:"rgba(0,0,0,.92)",zIndex:500,display:"flex",alignItems:"flex-end",justifyContent:"center",backdropFilter:"blur(10px)"}}>
            <div onClick={e=>e.stopPropagation()}
              style={{width:"100%",maxWidth:480,background:"#0F1117",border:"1px solid #1C1F27",borderRadius:"22px 22px 0 0",padding:"28px 24px",paddingBottom:"calc(28px + env(safe-area-inset-bottom,12px))",maxHeight:"90vh",overflowY:"auto"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:24}}>
                <div>
                  <div style={{fontSize:10,color,letterSpacing:3,fontFamily:"'JetBrains Mono',monospace",marginBottom:6}}>MONOTONIE DE L'ENTRAÎNEMENT</div>
                  <div style={{display:"flex",alignItems:"baseline",gap:10}}>
                    <span style={{fontSize:36,fontWeight:800,color,letterSpacing:-2,lineHeight:1}}>{monoSig?.score||0}</span>
                    <span style={{fontSize:16,color:"#555",fontFamily:"'JetBrains Mono',monospace"}}>/100 · {monoSig?.value}</span>
                  </div>
                  {monoSig?.detail&&<div style={{fontSize:11,color:"#888",fontFamily:"'JetBrains Mono',monospace",marginTop:4}}>{monoSig.detail}</div>}
                </div>
                <button onClick={()=>setShowMonoDetail(false)} style={{background:"#1C1F27",border:"none",color:"#888",fontSize:18,cursor:"pointer",borderRadius:10,width:36,height:36,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
              </div>
              <div style={{marginBottom:20}}>
                <div style={{fontSize:10,color:"#555",letterSpacing:2,fontFamily:"'JetBrains Mono',monospace",marginBottom:10}}>CETTE SEMAINE (7 DERNIERS JOURS)</div>
                {curWkRuns.length > 0 ? (<>
                  <div style={{display:"flex",height:36,borderRadius:10,overflow:"hidden",marginBottom:8,gap:2}}>
                    {curEasy.length>0&&<div style={{flex:curEasy.length,background:"#6BF17833",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:"#6BF178",fontFamily:"'JetBrains Mono',monospace"}}>{curEasy.length} facile{curEasy.length>1?"s":""}</div>}
                    {curHard.length>0&&<div style={{flex:curHard.length,background:"#FF6B6B33",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:"#FF6B6B",fontFamily:"'JetBrains Mono',monospace"}}>{curHard.length} intensi{curHard.length>1?"ves":"ve"}</div>}
                  </div>
                  <div style={{fontSize:10,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginBottom:12}}>
                    Cible : 1-2 séances intensives · {Math.round((1.5/Math.max(curWkRuns.length,4))*100)}–{Math.round((2/Math.max(curWkRuns.length,4))*100)}% du total
                  </div>
                </>) : <div style={{fontSize:11,color:"#444",fontFamily:"'JetBrains Mono',monospace",marginBottom:12}}>Pas encore de séances cette semaine</div>}
              </div>
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
              <div style={{marginBottom:20}}>
                <div style={{fontSize:10,color:"#555",letterSpacing:2,fontFamily:"'JetBrains Mono',monospace",marginBottom:10}}>INTENSITÉ PAR SEMAINE</div>
                <div style={{display:"flex",gap:8}}>
                  {weeks.map(w=>(
                    <div key={w.label} style={{flex:1,background:"#080A0E",borderRadius:10,padding:"12px 10px",border:"1px solid #1C1F27"}}>
                      <div style={{fontSize:9,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginBottom:8}}>{w.label}</div>
                      <div style={{marginBottom:6}}>
                        <div style={{display:"flex",justifyContent:"space-between",fontSize:10,fontFamily:"'JetBrains Mono',monospace",marginBottom:3}}><span style={{color:"#6BF178"}}>Facile</span><span style={{color:"#6BF178"}}>{w.easyKm}km</span></div>
                        <div style={{height:5,background:"#1C1F27",borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:`${(w.easyKm/Math.max(w.easyKm+w.hardKm,1))*100}%`,background:"#6BF17844",borderRadius:3}}/></div>
                      </div>
                      <div>
                        <div style={{display:"flex",justifyContent:"space-between",fontSize:10,fontFamily:"'JetBrains Mono',monospace",marginBottom:3}}><span style={{color:"#FF6B6B"}}>Intensif</span><span style={{color:"#FF6B6B"}}>{w.hardKm}km</span></div>
                        <div style={{height:5,background:"#1C1F27",borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:`${(w.hardKm/Math.max(w.easyKm+w.hardKm,1))*100}%`,background:"#FF6B6B44",borderRadius:3}}/></div>
                      </div>
                      <div style={{fontSize:9,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginTop:6}}>{w.runs} séances</div>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{padding:"14px 16px",background:"#080A0E",borderRadius:12,border:"1px solid #1C1F27",fontSize:11,color:"#666",fontFamily:"'JetBrains Mono',monospace",lineHeight:1.8}}>
                <span style={{color:"#E8E4DC"}}>Monotonie = répétition des mêmes stimuli.</span><br/>
                Un entraînement varié (mix EF, VMA, SL) stimule mieux les adaptations et réduit le risque de blessure par surcharge localisée.<br/><br/>
                <span style={{color:"#6BF178"}}>Idéal :</span> 1-2 séances intensives + 2-3 séances faciles/semaine. <span style={{color:"#FF9F43"}}>Attention</span> si 3+ séances intensives consécutives.
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

