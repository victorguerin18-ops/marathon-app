import { useState } from "react";
import { TYPE_META, STORE, TODAY_STR, TODAY, INTENSE_TYPES } from '../constants';
import { addDays, fmtDate, wkKey, parseDate, pace } from '../utils/dates';
import { calcReadiness, buildSmartInsight, getReadinessAdvice, scoreSession } from '../utils/scores';
import { saveMorningBrief } from '../db';
import CompareBar from '../components/CompareBar';

const FEELING_OPTIONS = [
  { score: 1, label: 'Épuisé',   color: '#FF453A' },
  { score: 2, label: 'Fatigué',  color: '#FF9F0A' },
  { score: 3, label: 'Correct',  color: '#888'    },
  { score: 4, label: 'Bien',     color: '#0A84FF' },
  { score: 5, label: 'Excellent',color: '#32D74B' },
];

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
  recentCheckins,
}) {
  const [checkInEditing,       setCheckInEditing]       = useState(false);
  const [showProtectionDetail, setShowProtectionDetail] = useState(false);
  const [showMonoDetail,       setShowMonoDetail]       = useState(false);
  const [briefLoading,         setBriefLoading]         = useState(false);

  /* ── Readiness ── */
  const ciHasData = checkIn.bevelRecovery || checkIn.hrv;
  const calcR = () => calcReadiness(
    parseFloat(checkIn.bevelRecovery)||0, parseFloat(checkIn.hrv)||0,
    parseFloat(checkIn.restingHR)||0, parseFloat(checkIn.sleepHours)||0,
    checkIn.feelingScore||3
  );
  const readiness = (checkInSaved && !checkInEditing)
    ? (checkIn.readiness ?? calcR())
    : ciHasData ? calcR() : null;

  const rc = readiness === null ? "#555"
    : readiness >= 85 ? "#32D74B" : readiness >= 65 ? "#0A84FF"
    : readiness >= 45 ? "#FF9F0A" : "#FF453A";
  const rl = readiness === null ? "—"
    : readiness >= 85 ? "EXCELLENT" : readiness >= 65 ? "BON"
    : readiness >= 45 ? "MODÉRÉ" : "FAIBLE";

  const insight = (checkInSaved && !checkInEditing && readiness !== null)
    ? buildSmartInsight({
        readiness,
        checkIn,
        recentCheckins: recentCheckins || [],
        todaySession: todayPlanned[0] || null,
        done,
        planned,
        protectionScore,
        acwr: protectionScore.acwr,
        planConfig: { targetWeeklyKm: weekCompare.targetKm },
      })
    : null;
  const isAlertInsight = readiness !== null && (
    readiness < 45 ||
    (protectionScore.acwr > 1.3 && INTENSE_TYPES.includes(todayPlanned[0]?.type))
  );

  /* ── Averages for brief context ── */
  const history = (recentCheckins || []).filter(c => c.date !== TODAY_STR);
  function metricAvg(key) {
    const vals = history.map(c => c[key]).filter(v => v !== null && v > 0);
    return vals.length >= 2 ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  }

  /* ── Save check-in ── */
  function saveCheckIn() {
    const r = calcReadiness(
      parseFloat(checkIn.bevelRecovery)||0, parseFloat(checkIn.hrv)||0,
      parseFloat(checkIn.restingHR)||0, parseFloat(checkIn.sleepHours)||0,
      checkIn.feelingScore||3
    );
    onSaveCheckIn({ ...checkIn, readiness: r });
    setCheckInEditing(false);
  }

  /* ── Morning Brief ── */
  async function generateMorningBrief() {
    setBriefLoading(true);
    const last2done = [...done].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 2);
    const fl = FEELING_OPTIONS.find(f => f.score === (checkIn.feelingScore||3))?.label || 'Correct';
    const avgHRV  = metricAvg('hrv')?.toFixed(0) || '—';
    const avgHR   = metricAvg('restingHR')?.toFixed(0) || '—';
    const context = `Score Bevel récup : ${checkIn.bevelRecovery||'—'}% · VFC : ${checkIn.hrv||'—'}ms (moy 7j : ${avgHRV}ms) · FC repos : ${checkIn.restingHR||'—'}bpm (moy 7j : ${avgHR}bpm) · Sommeil : ${checkIn.sleepHours||'—'}h · Sensation : ${fl}
Readiness : ${readiness||'—'}/100 (${rl})
Séance du jour : ${todayPlanned[0]?`${todayPlanned[0].type} ${todayPlanned[0].targetDist}km`:'repos'}
Protection blessure : ${protectionScore.total}/100 (${protectionScore.level.label})
Dernières séances : ${last2done.map(r=>`${r.type.split(' ')[0]} ${r.dist}km RPE${r.rpe||'?'}`).join(' · ')||'—'}`;
    try {
      const resp = await fetch('/api/coach', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: "Tu es le coach marathon de Victor. Réponds en exactement 3 points courts (2 phrases max chacun). Sois direct, pas d'intro.\n1. RÉCUP : interprète les données de cette nuit pour la performance marathon\n2. SÉANCE : conseil précis pour la séance du jour selon l'état\n3. ALERTE : uniquement si une donnée est hors norme, sinon omets ce point" },
            { role: 'user', content: context },
          ],
          max_tokens: 400,
        }),
      });
      const json = await resp.json();
      const brief = json.content?.[0]?.text || 'Erreur lors de la génération.';
      await saveMorningBrief(TODAY_STR, brief);
      setCheckIn(c => ({ ...c, morningBrief: brief, briefDate: TODAY_STR }));
    } catch(e) { console.error(e); }
    setBriefLoading(false);
  }

  function renderBrief(text) {
    return text.split('**').map((p, i) =>
      i % 2 === 1 ? <strong key={i} style={{ color: '#fff', fontWeight: 700 }}>{p}</strong> : <span key={i}>{p}</span>
    );
  }

  /* ── Metric cards for STATE B ── */
  const metricCards = [
    {
      label: 'SCORE RÉCUP', unit: '%',
      value: parseFloat(checkIn.bevelRecovery)||0,
      barPct: Math.min(100, parseFloat(checkIn.bevelRecovery)||0),
      getStatus: v => v<=0?null : v<60?{label:'Faible',color:'#FF453A'} : v<80?{label:'Normal',color:'#32D74B'} : {label:'Supérieur',color:'#0A84FF'},
    },
    {
      label: 'VFC', unit: 'ms',
      value: parseFloat(checkIn.hrv)||0,
      barPct: Math.min(100, Math.max(0, ((parseFloat(checkIn.hrv)||0)-30)/70*100)),
      getStatus: v => v<=0?null : v<63?{label:'Bas',color:'#FF9F0A'} : v<=98?{label:'Normal',color:'#32D74B'} : {label:'Supérieur',color:'#0A84FF'},
    },
    {
      label: 'FC REPOS', unit: 'bpm',
      value: parseFloat(checkIn.restingHR)||0,
      barPct: Math.min(100, Math.max(0, (90-(parseFloat(checkIn.restingHR)||0))/50*100)),
      getStatus: v => v<=0?null : v>65?{label:'Élevé',color:'#FF453A'} : v>=45?{label:'Normal',color:'#32D74B'} : {label:'Excellent',color:'#0A84FF'},
    },
    {
      label: 'SOMMEIL', unit: 'h',
      value: parseFloat(checkIn.sleepHours)||0,
      barPct: Math.min(100, Math.max(0, ((parseFloat(checkIn.sleepHours)||0)-4)/6*100)),
      getStatus: v => v<=0?null : v<6?{label:'Court',color:'#FF453A'} : v<7?{label:'Correct',color:'#FF9F0A'} : v<8?{label:'Normal',color:'#32D74B'} : {label:'Optimal',color:'#0A84FF'},
    },
  ];

  const feelingOpt = FEELING_OPTIONS.find(f => f.score === (checkIn.feelingScore||3));

  return (
    <div className="fade-up">

      {/* ── CHECK-IN ── */}
      {checkInSaved && !checkInEditing ? (

        /* STATE B — Dashboard récupération */
        <div className="card" style={{ padding: 20, marginBottom: 14 }}>

          {/* Score readiness */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
            <div style={{ flex: 1, paddingRight: 12 }}>
              <div style={{ fontSize: 10, color: '#32D74B', letterSpacing: 2, fontFamily: "'Inter',sans-serif", fontWeight: 600, marginBottom: 4 }}>🌅 FORME DU JOUR</div>
              {insight && (
                <div style={{ fontSize: 13, color: isAlertInsight ? '#FF9F0A' : '#ccc', fontFamily: "'Inter',sans-serif", lineHeight: 1.6 }}>
                  {isAlertInsight && <span style={{ marginRight: 4 }}>⚠</span>}
                  {insight}
                </div>
              )}
            </div>
            <div style={{ textAlign: 'center', flexShrink: 0 }}>
              <div style={{ fontSize: 44, fontWeight: 800, color: rc, letterSpacing: -2, lineHeight: 1 }}>{readiness}</div>
              <div style={{ fontSize: 9, color: rc, letterSpacing: 1, fontWeight: 700, marginTop: 2 }}>{rl}</div>
            </div>
          </div>

          {/* Grille 2x2 metric cards */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
            {metricCards.map(({ label, unit, value, barPct, getStatus }) => {
              const status = getStatus(value);
              const col = status ? status.color : (value > 0 ? '#fff' : '#555');
              return (
                <div key={label} style={{ background: '#2C2C2E', borderRadius: 14, padding: '12px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'stretch' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 9, color: '#666', letterSpacing: 1, fontFamily: "'Inter',sans-serif", fontWeight: 500, marginBottom: 8 }}>{label}</div>
                    <div style={{ fontSize: 26, fontWeight: 800, color: col, letterSpacing: -1, lineHeight: 1, marginBottom: 8 }}>
                      {value > 0 ? value : '—'}<span style={{ fontSize: 10, color: '#555', fontWeight: 400 }}> {unit}</span>
                    </div>
                    {status
                      ? <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <div style={{ width: 6, height: 6, borderRadius: '50%', background: status.color, flexShrink: 0 }} />
                          <span style={{ fontSize: 9, color: status.color, fontFamily: "'Inter',sans-serif", fontWeight: 600 }}>{status.label}</span>
                        </div>
                      : <div style={{ fontSize: 9, color: '#444', fontFamily: "'Inter',sans-serif" }}>{value > 0 ? '—' : 'non saisi'}</div>
                    }
                  </div>
                  {/* Barre verticale */}
                  <div style={{ width: 5, background: '#333', borderRadius: 3, marginLeft: 10, position: 'relative', alignSelf: 'stretch', minHeight: 52 }}>
                    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: `${barPct}%`, background: col, borderRadius: 3, transition: 'height 0.8s ease' }} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Feeling pill */}
          {feelingOpt && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: '#2C2C2E', borderRadius: 10, marginBottom: 10 }}>
              <div style={{ fontSize: 9, color: '#555', fontFamily: "'Inter',sans-serif", fontWeight: 500, letterSpacing: 1 }}>SENSATION</div>
              <div style={{ flex: 1, display: 'flex', gap: 3 }}>
                {[1,2,3,4,5].map(s => (
                  <div key={s} style={{ flex: 1, height: 4, borderRadius: 2, background: s <= feelingOpt.score ? feelingOpt.color : '#333' }} />
                ))}
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, color: feelingOpt.color, fontFamily: "'Inter',sans-serif" }}>{feelingOpt.label}</div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={() => setCheckInEditing(true)} className="btn-ghost" style={{ padding: '4px 14px', fontSize: 10 }}>✎ Modifier</button>
          </div>
        </div>

      ) : (

        /* STATE A — Formulaire de saisie */
        <div className="card" style={{ padding: 20, marginBottom: 14 }}>
          <div style={{ fontSize: 10, color: '#32D74B', letterSpacing: 2, fontFamily: "'Inter',sans-serif", fontWeight: 600, marginBottom: 2 }}>🌅 BILAN DE NUIT</div>
          <div style={{ fontSize: 12, color: '#888', fontFamily: "'Inter',sans-serif", marginBottom: 18 }}>
            {fmtDate(TODAY_STR, { weekday: 'long', day: 'numeric', month: 'long' })}
          </div>

          {readiness !== null && (
            <div style={{ textAlign: 'center', marginBottom: 16, padding: '12px', background: '#2C2C2E', borderRadius: 14 }}>
              <div style={{ fontSize: 40, fontWeight: 800, color: rc, lineHeight: 1, letterSpacing: -2 }}>{readiness}</div>
              <div style={{ fontSize: 9, color: rc, letterSpacing: 1, fontWeight: 700, marginTop: 4 }}>READINESS · {rl}</div>
            </div>
          )}

          {/* Grille 2x2 inputs */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
            {[
              { label: 'SCORE BEVEL', key: 'bevelRecovery', unit: '%',  placeholder: 'ex: 79' },
              { label: 'VFC',         key: 'hrv',           unit: 'ms', placeholder: 'ex: 71' },
              { label: 'FC REPOS',    key: 'restingHR',     unit: 'bpm',placeholder: 'ex: 50' },
              { label: 'SOMMEIL',     key: 'sleepHours',    unit: 'h',  placeholder: 'ex: 7.5'},
            ].map(({ label, key, unit, placeholder }) => (
              <div key={key} style={{ background: '#2C2C2E', borderRadius: 14, padding: '12px 12px 10px' }}>
                <div style={{ fontSize: 9, color: '#666', letterSpacing: 1, fontFamily: "'Inter',sans-serif", fontWeight: 500, marginBottom: 6 }}>{label}</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                  <input
                    type="number" step="any"
                    placeholder={placeholder}
                    value={checkIn[key] || ''}
                    onChange={e => setCheckIn(c => ({ ...c, [key]: e.target.value }))}
                    style={{ background: 'transparent', border: 'none', outline: 'none', color: '#fff', fontSize: 22, fontWeight: 800, width: '100%', fontFamily: "'Inter',sans-serif" }}
                  />
                  <span style={{ fontSize: 12, color: '#555', fontFamily: "'Inter',sans-serif", flexShrink: 0 }}>{unit}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Feeling pills */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 9, color: '#555', letterSpacing: 1, fontFamily: "'Inter',sans-serif", fontWeight: 500, marginBottom: 10 }}>SENSATION GÉNÉRALE</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {FEELING_OPTIONS.map(({ score, label, color }) => {
                const active = checkIn.feelingScore === score;
                return (
                  <button key={score}
                    onClick={() => setCheckIn(c => ({ ...c, feelingScore: score }))}
                    style={{ flex: 1, border: `2px solid ${active ? color : 'transparent'}`, background: active ? color + '22' : '#2C2C2E', borderRadius: 10, padding: '8px 2px', cursor: 'pointer', textAlign: 'center', fontFamily: "'Inter',sans-serif" }}>
                    <div style={{ fontSize: 9, color: active ? color : '#555', fontWeight: 600, lineHeight: 1.3 }}>{label}</div>
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            {checkInEditing && (
              <button onClick={() => setCheckInEditing(false)} className="btn-ghost" style={{ flex: 1, padding: '12px' }}>ANNULER</button>
            )}
            <button onClick={saveCheckIn}
              style={{ flex: 2, background: '#fff', color: '#000', border: 'none', borderRadius: 50, padding: '12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: "'Inter',sans-serif" }}>
              ENREGISTRER ✓
            </button>
          </div>
        </div>
      )}

      {/* STATE C — Morning Brief */}
      {checkInSaved && !checkInEditing && (
        <div className="card" style={{ padding: 20, marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: '#0A84FF22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>🤖</div>
            <div>
              <div style={{ fontSize: 11, color: '#0A84FF', letterSpacing: 1.5, fontFamily: "'Inter',sans-serif", fontWeight: 700 }}>MORNING BRIEF</div>
              <div style={{ fontSize: 10, color: '#555', fontFamily: "'Inter',sans-serif" }}>Analyse IA personnalisée</div>
            </div>
          </div>
          {checkIn.briefDate === TODAY_STR && checkIn.morningBrief ? (
            <>
              <div style={{ fontSize: 13, color: '#ccc', fontFamily: "'Inter',sans-serif", lineHeight: 1.8, marginBottom: 12 }}>
                {renderBrief(checkIn.morningBrief)}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button onClick={generateMorningBrief} disabled={briefLoading} className="btn-ghost" style={{ padding: '4px 12px', fontSize: 10 }}>
                  {briefLoading ? '⏳' : '↺ Régénérer'}
                </button>
              </div>
            </>
          ) : (
            <button onClick={generateMorningBrief} disabled={briefLoading}
              style={{ width: '100%', background: briefLoading ? '#333' : '#fff', color: briefLoading ? '#888' : '#000', border: 'none', borderRadius: 50, padding: '12px', fontSize: 12, fontWeight: 700, cursor: briefLoading ? 'default' : 'pointer', fontFamily: "'Inter',sans-serif" }}>
              {briefLoading ? '⏳ Génération en cours...' : '✨ Générer le brief'}
            </button>
          )}
        </div>
      )}

      {/* ── READINESS ADVISOR ── */}
      {(()=>{
        if (!checkInSaved) return null;
        const r = checkIn.readiness ?? calcReadiness(parseFloat(checkIn.bevelRecovery)||0, parseFloat(checkIn.hrv)||0, parseFloat(checkIn.restingHR)||0, parseFloat(checkIn.sleepHours)||0, checkIn.feelingScore||3);
        const curWk = wkKey(TODAY_STR);
        const weekPlanned = planned.filter(p => wkKey(p.date) === curWk);
        const todayUnlinked = todayPlanned.filter(p => !done.find(d => d.plannedId === p.id));
        if (todayUnlinked.length === 0) return null;
        const todaySession = todayUnlinked[0];
        const advice = readinessAction?.done ? null : getReadinessAdvice(r, todaySession, weekPlanned, done);
        if (!advice && !readinessAction?.done) return null;
        if (readinessAction?.done) return (
          <div className="card" style={{padding:"14px 18px",marginBottom:14,border:"1px solid #32D74B33",background:"#0d2b20"}}>
            <div style={{fontSize:12,color:"#32D74B",fontFamily:"'Inter',sans-serif"}}>{readinessAction.result || "✓ Action appliquée"}</div>
          </div>
        );
        return (
          <div className="card" style={{padding:20,marginBottom:14,border:`2px solid ${advice.color}44`,background:`${advice.color}08`}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
              <div style={{fontSize:24,flexShrink:0}}>{advice.icon}</div>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:800,color:advice.color}}>{advice.title}</div>
                <div style={{fontSize:10,color:"#555",fontFamily:"'Inter',sans-serif",fontWeight:500,marginTop:1}}>ADAPTATION SUGGÉRÉE</div>
              </div>
              <div style={{width:36,height:36,borderRadius:10,background:advice.level==="danger"?"#FF453A22":advice.level==="warning"?"#FF9F0A22":"#FFE66D22",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:800,color:advice.color}}>{r}</div>
            </div>
            <div style={{padding:"12px 14px",background:"#161618",borderRadius:10,marginBottom:14,fontSize:12,color:"#ccc",fontFamily:"'Inter',sans-serif",lineHeight:1.7,borderLeft:`3px solid ${advice.color}`}}>
              {advice.message}
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {advice.actions.map((action,i)=>(
                <button key={action.id+i}
                  onClick={()=>{ setReadinessAction({advice, action}); applyReadinessAction(action, todaySession); }}
                  style={{width:"100%",background:action.primary?advice.color:action.ghost?"transparent":advice.color+"22",color:action.primary?"#000":action.ghost?"#555":advice.color,border:action.ghost?"1px solid #333":`1px solid ${advice.color}44`,borderRadius:50,padding:"12px 14px",fontSize:11,fontWeight:action.ghost?400:700,cursor:"pointer",fontFamily:"'Inter',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
                  <span style={{fontSize:14}}>{action.icon}</span>{action.label}
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
          <div style={{fontSize:14,color:"#555",fontFamily:"'Inter',sans-serif"}}>Rien de planifié aujourd'hui</div>
          <button onClick={()=>logSession()} style={{marginTop:16,background:"#fff",color:"#000",border:"none",borderRadius:50,padding:"10px 20px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"'Inter',sans-serif"}}>Planifier une séance</button>
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
                <div style={{fontSize:12,color:"#555",fontFamily:"'Inter',sans-serif",marginTop:2}}>~{p.targetDur} min · {p.targetHR?`FC ${p.targetHR} bpm`:"FC libre"}</div>
                <div style={{fontSize:11,color:tm.color,fontFamily:"'Inter',sans-serif",marginTop:4,fontWeight:500}}>{tm.desc}</div>
              </div>
              {score!==null&&(
                <div style={{textAlign:"center"}}>
                  <svg width={56} height={56} viewBox="0 0 56 56">
                    <circle cx={28} cy={28} r={22} fill="none" stroke="#333" strokeWidth={4}/>
                    <circle cx={28} cy={28} r={22} fill="none" stroke={score>79?"#32D74B":score>59?"#FFE66D":"#FF453A"} strokeWidth={4} strokeLinecap="round" strokeDasharray={138.2} strokeDashoffset={138.2*(1-score/100)} transform="rotate(-90 28 28)" className="score-ring"/>
                    <text x={28} y={32} textAnchor="middle" fill="#fff" fontSize={13} fontWeight={700} fontFamily="Inter">{score}</text>
                  </svg>
                  <div style={{fontSize:9,color:"#555",fontFamily:"'Inter',sans-serif"}}>SCORE</div>
                </div>
              )}
            </div>
            {p.notes&&<div style={{fontSize:12,color:"#888",fontFamily:"'Inter',sans-serif",marginBottom:14,padding:"10px 12px",background:"#161618",borderRadius:8}}>{p.notes}</div>}
            {!linked
              ?<div>
                <div style={{padding:"12px 14px",background:"#161618",borderRadius:10,marginBottom:10,fontSize:11,color:"#555",fontFamily:"'Inter',sans-serif",lineHeight:1.7,textAlign:"center"}}>⏳ En attente de l'import Strava...</div>
                <button className="btn-ghost" onClick={()=>logSession(p)} style={{width:"100%",padding:"10px 0",fontSize:11}}>✎ Saisir manuellement</button>
              </div>
              :<div>
                <div style={{display:"flex",gap:12,marginBottom:10}}>
                  {[["DIST",`${linked.dist} km`,false],["DURÉE",`${linked.dur} min`,false],["ALLURE",pace(linked.dist,linked.dur),true]].map(([l,v,isMono])=>(
                    <div key={l} style={{flex:1,background:"#333",borderRadius:8,padding:"10px 8px",textAlign:"center"}}>
                      <div style={{fontSize:9,color:"#555",fontFamily:"'Inter',sans-serif",fontWeight:500,marginBottom:4}}>{l}</div>
                      <div style={{fontSize:15,fontWeight:700,fontFamily:isMono?"'JetBrains Mono',monospace":undefined}}>{v}</div>
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
        <div style={{fontSize:10,color:"#555",letterSpacing:2,fontFamily:"'Inter',sans-serif",fontWeight:500,marginBottom:14}}>SEMAINE EN COURS · PLAN VS RÉEL</div>
        <div style={{display:"flex",gap:10,marginBottom:14}}>
          <div style={{flex:1,background:"#333",borderRadius:10,padding:"12px",textAlign:"center"}}>
            <div style={{fontSize:9,color:"#555",fontFamily:"'Inter',sans-serif",fontWeight:500,marginBottom:4}}>PLANIFIÉ</div>
            <div style={{fontSize:22,fontWeight:800}}>{weekCompare.plannedKm.toFixed(0)}<span style={{fontSize:12,color:"#555"}}>km</span></div>
            <div style={{fontSize:10,color:"#555",fontFamily:"'Inter',sans-serif"}}>{weekCompare.planned.length} séances</div>
          </div>
          <div style={{flex:1,background:"#333",borderRadius:10,padding:"12px",textAlign:"center"}}>
            <div style={{fontSize:9,color:"#555",fontFamily:"'Inter',sans-serif",fontWeight:500,marginBottom:4}}>RÉALISÉ</div>
            <div style={{fontSize:22,fontWeight:800,color:weekCompare.completion>=90?"#32D74B":weekCompare.completion>=60?"#FFE66D":"#FF453A"}}>{weekCompare.doneKm.toFixed(0)}<span style={{fontSize:12,color:"#555"}}>km</span></div>
            <div style={{fontSize:10,color:"#555",fontFamily:"'Inter',sans-serif"}}>{weekCompare.done.length} séances</div>
          </div>
          {weekCompare.completion!==null&&(
            <div style={{width:64,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
              <svg width={56} height={56} viewBox="0 0 56 56">
                <circle cx={28} cy={28} r={22} fill="none" stroke="#333" strokeWidth={4}/>
                <circle cx={28} cy={28} r={22} fill="none"
                  stroke={weekCompare.completion>=90?"#32D74B":weekCompare.completion>=60?"#FFE66D":"#FF453A"}
                  strokeWidth={4} strokeLinecap="round"
                  strokeDasharray={138.2} strokeDashoffset={138.2*(1-Math.min(weekCompare.completion,100)/100)}
                  transform="rotate(-90 28 28)" className="score-ring"/>
                <text x={28} y={33} textAnchor="middle" fill="#fff" fontSize={12} fontWeight={700} fontFamily="Inter">{weekCompare.completion}%</text>
              </svg>
            </div>
          )}
        </div>
        {weekCompare.plannedKm>0&&(
          <div style={{height:5,background:"#333",borderRadius:3}}>
            <div style={{height:5,width:`${Math.min(weekCompare.doneKm/weekCompare.plannedKm*100,100)}%`,background:weekCompare.completion>=90?"#32D74B":weekCompare.completion>=60?"#FFE66D":"#FF453A",borderRadius:3,transition:"width .8s ease"}}/>
          </div>
        )}
      </div>

      {/* ── PROCHAINES SÉANCES ── */}
      {upcoming.slice(0,3).length>0&&(
        <div style={{marginTop:14}}>
          <div style={{fontSize:10,color:"#555",letterSpacing:2,fontFamily:"'Inter',sans-serif",fontWeight:500,marginBottom:10}}>PROCHAINES SÉANCES</div>
          {upcoming.slice(0,3).map(p=>{
            const tm=TYPE_META[p.type]||TYPE_META["Footing"];
            return (
              <div key={p.id} className="card" style={{padding:"14px 16px",marginBottom:8,display:"flex",alignItems:"center",gap:14}}>
                <div style={{width:40,height:40,borderRadius:10,background:tm.dark,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>{tm.icon}</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:11,color:"#555",fontFamily:"'Inter',sans-serif"}}>{fmtDate(p.date)}</div>
                  <div style={{fontSize:14,fontWeight:700,marginTop:2}}>{p.type} · {p.targetDist} km</div>
                </div>
                <div style={{fontSize:11,color:tm.color,fontFamily:"'Inter',sans-serif",fontWeight:600}}>{Math.ceil((parseDate(p.date)-TODAY)/86400000)}j →</div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── SEMAINE ADAPTIVE ── */}
      {weekCompare.hasAdjustments && !weekAdjustDismissed && (
        <div className="card" style={{padding:18,marginTop:14,border:`1px solid ${weekCompare.hasAlerts?"#FF9F0A44":"#0A84FF33"}`,background:weekCompare.hasAlerts?"#1a1200":"#001420"}}>
          <div style={{marginBottom:10}}>
            <div style={{fontSize:10,color:weekCompare.hasAlerts?"#FF9F0A":"#0A84FF",letterSpacing:2,fontFamily:"'Inter',sans-serif",fontWeight:600,marginBottom:4}}>
              {weekCompare.hasAlerts?"⚠ AJUSTEMENT SEMAINE":"◎ AJUSTEMENT SEMAINE"}
            </div>
            <div style={{fontSize:13,fontWeight:700,color:"#fff"}}>{weekCompare.doneKm.toFixed(1)}km faits · objectif {weekCompare.targetKm}km</div>
            <div style={{fontSize:11,color:"#888",fontFamily:"'Inter',sans-serif",marginTop:2}}>{weekCompare.remainingKm.toFixed(1)}km restants · qualité {weekCompare.qualRatio}% de la semaine</div>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:12}}>
            {weekCompare.adaptedSessions.filter(s=>s.needsAdjust).map(s=>{
              const color=s.isAlert?"#FF9F0A":"#0A84FF";
              return (
                <div key={s.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 12px",background:"#161618",borderRadius:8,border:`1px solid ${color}22`}}>
                  <div>
                    <div style={{fontSize:11,color:"#fff",fontFamily:"'Inter',sans-serif"}}>{s.type.split(' ')[0]} · {s.date}</div>
                    <div style={{fontSize:10,color:"#555",fontFamily:"'Inter',sans-serif",marginTop:2}}>prévu {s.targetDist}km → idéal {s.idealDist}km</div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:13,fontWeight:700,color}}>{s.delta>0?"+":""}{s.delta.toFixed(1)}km</div>
                    {s.isAlert&&<div style={{fontSize:9,color:"#FF9F0A",fontFamily:"'Inter',sans-serif"}}>⚠ +{Math.round(s.deltaPct)}%</div>}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{display:"flex",gap:8}}>
            <button onClick={()=>setWeekAdjustModal({sessions:weekCompare.adaptedSessions.filter(s=>s.needsAdjust)})}
              style={{flex:2,background:weekCompare.hasAlerts?"#FF9F0A":"#0A84FF",color:"#000",border:"none",borderRadius:50,padding:"10px",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"'Inter',sans-serif"}}>
              APPLIQUER LES AJUSTEMENTS
            </button>
            <button onClick={()=>{STORE.set('week_adjust_'+wkKey(TODAY_STR),true);setWeekAdjustDismissed(true);}}
              style={{flex:1,background:"#333",border:"none",color:"#aaa",borderRadius:50,padding:"10px",fontSize:11,cursor:"pointer",fontFamily:"'Inter',sans-serif"}}>
              IGNORER
            </button>
          </div>
        </div>
      )}

      {/* ── PROTECTION SCORE ── */}
      <div className="card" onClick={()=>setShowProtectionDetail(true)} style={{padding:20,marginTop:14,border:`1px solid ${protectionScore.level.color}33`,background:protectionScore.level.bg,cursor:"pointer"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div>
            <div style={{fontSize:10,color:protectionScore.level.color,letterSpacing:2,fontFamily:"'Inter',sans-serif",fontWeight:600,marginBottom:4}}>{protectionScore.level.icon} PROTECTION BLESSURE</div>
            <div style={{fontSize:22,fontWeight:800,color:protectionScore.level.color}}>{protectionScore.level.label}</div>
            <div style={{fontSize:10,color:protectionScore.level.color+"88",fontFamily:"'Inter',sans-serif",marginTop:4}}>Appuyer pour le détail →</div>
          </div>
          <div style={{textAlign:"center"}}>
            <div style={{fontSize:44,fontWeight:800,color:protectionScore.level.color,lineHeight:1,letterSpacing:-2}}>{protectionScore.total}</div>
            <div style={{fontSize:9,color:"#555",fontFamily:"'Inter',sans-serif",marginTop:2}}>/100</div>
          </div>
        </div>
        <div style={{height:6,background:"#333",borderRadius:3,marginBottom:16,overflow:"hidden"}}>
          <div style={{height:"100%",width:`${protectionScore.total}%`,background:`linear-gradient(90deg,${protectionScore.level.color}88,${protectionScore.level.color})`,borderRadius:3,transition:"width 1s ease"}}/>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {protectionScore.signals.map(sig=>(
            <div key={sig.key}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                <span style={{fontSize:10,color:"#888",fontFamily:"'Inter',sans-serif"}}>{sig.label}</span>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <span style={{fontSize:9,color:"#555",fontFamily:"'Inter',sans-serif"}}>{sig.value}</span>
                  <span style={{fontSize:10,fontWeight:700,color:sig.score>=75?"#32D74B":sig.score>=50?"#FF9F0A":"#FF453A",minWidth:28,textAlign:"right"}}>{sig.score}</span>
                </div>
              </div>
              <div style={{height:3,background:"#333",borderRadius:2,overflow:"hidden"}}>
                <div style={{height:"100%",width:`${sig.score}%`,background:sig.score>=75?"#32D74B":sig.score>=50?"#FF9F0A":"#FF453A",borderRadius:2,transition:"width 0.8s ease"}}/>
              </div>
            </div>
          ))}
        </div>
        {!checkInSaved&&(
          <div style={{marginTop:12,padding:"10px 12px",background:"#161618",borderRadius:8,fontSize:11,color:"#555",fontFamily:"'Inter',sans-serif",lineHeight:1.6}}>
            💡 Fais ton check-in matin pour affiner le score
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
        function SigColor(s) { return s>=75?"#32D74B":s>=50?"#FF9F0A":"#FF453A"; }
        const feelOpt = FEELING_OPTIONS.find(f => f.score === (checkIn.feelingScore||3));
        return (
          <div onClick={()=>setShowProtectionDetail(false)}
            style={{position:"fixed",inset:0,background:"rgba(0,0,0,.92)",zIndex:400,display:"flex",alignItems:"flex-end",justifyContent:"center",backdropFilter:"blur(10px)"}}>
            <div onClick={e=>e.stopPropagation()}
              style={{width:"100%",maxWidth:480,background:"#242426",borderRadius:"22px 22px 0 0",padding:"28px 24px",paddingBottom:"calc(28px + env(safe-area-inset-bottom,12px))",maxHeight:"90vh",overflowY:"auto"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:24}}>
                <div>
                  <div style={{fontSize:10,color:ps.level.color,letterSpacing:2,fontFamily:"'Inter',sans-serif",fontWeight:600,marginBottom:6}}>{ps.level.icon} PROTECTION BLESSURE</div>
                  <div style={{display:"flex",alignItems:"baseline",gap:10}}>
                    <span style={{fontSize:48,fontWeight:800,color:ps.level.color,letterSpacing:-3,lineHeight:1}}>{ps.total}</span>
                    <span style={{fontSize:14,color:"#555",fontFamily:"'Inter',sans-serif"}}>/100 · {ps.level.label}</span>
                  </div>
                </div>
                <button onClick={()=>setShowProtectionDetail(false)} style={{background:"#333",border:"none",color:"#888",fontSize:18,cursor:"pointer",borderRadius:10,width:36,height:36,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
              </div>
              <div style={{height:8,background:"#333",borderRadius:4,marginBottom:28,overflow:"hidden"}}>
                <div style={{height:"100%",width:`${ps.total}%`,background:`linear-gradient(90deg,${ps.level.color}66,${ps.level.color})`,borderRadius:4,transition:"width 1s ease"}}/>
              </div>

              {/* Readiness 45% */}
              <div style={{marginBottom:24,padding:"18px",background:SigColor(readySig?.score||0)+"0A",border:`1px solid ${SigColor(readySig?.score||0)}22`,borderRadius:16}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <div>
                    <div style={{fontSize:10,color:SigColor(readySig?.score||0),letterSpacing:1,fontFamily:"'Inter',sans-serif",fontWeight:600,marginBottom:3}}>READINESS · POIDS 45%</div>
                    <div style={{fontSize:16,fontWeight:800,color:SigColor(readySig?.score||0)}}>{readySig?.value||"—"}</div>
                  </div>
                  <div style={{fontSize:36,fontWeight:800,color:SigColor(readySig?.score||0),letterSpacing:-2}}>{readySig?.score||0}</div>
                </div>
                {checkInSaved ? (
                  <div style={{display:"flex",gap:8,marginBottom:10}}>
                    {[
                      {label:"BEVEL",value:checkIn.bevelRecovery?`${checkIn.bevelRecovery}%`:"—",target:"≥80%",ok:(parseInt(checkIn.bevelRecovery)||0)>=80},
                      {label:"VFC",value:checkIn.hrv?`${checkIn.hrv}ms`:"—",target:"≥63ms",ok:(parseFloat(checkIn.hrv)||0)>=63},
                      {label:"SENSATION",value:feelOpt?.label||"—",target:"Bien/Excellent",ok:(checkIn.feelingScore||3)>=4},
                    ].map(({label,value,target,ok})=>(
                      <div key={label} style={{flex:1,background:"#333",borderRadius:10,padding:"10px 8px",textAlign:"center",border:`1px solid ${ok?"#32D74B33":"#FF453A33"}`}}>
                        <div style={{fontSize:8,color:"#555",fontFamily:"'Inter',sans-serif",fontWeight:500,marginBottom:4,letterSpacing:1}}>{label}</div>
                        <div style={{fontSize:12,fontWeight:700,color:ok?"#32D74B":"#FF9F0A"}}>{value}</div>
                        <div style={{fontSize:8,color:"#444",fontFamily:"'Inter',sans-serif",marginTop:3}}>cible {target}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{padding:"10px 12px",background:"#333",borderRadius:8,fontSize:11,color:"#555",fontFamily:"'Inter',sans-serif",marginBottom:10}}>
                    💡 Fais ton check-in matin pour avoir des données précises
                  </div>
                )}
                <div style={{fontSize:10,color:"#555",fontFamily:"'Inter',sans-serif",lineHeight:1.6}}>
                  Signal principal — ton score Bevel récup et ta VFC reflètent la capacité de ton corps à encaisser la charge du jour.
                </div>
              </div>

              {/* ACWR 35% */}
              <div style={{marginBottom:24,padding:"18px",background:SigColor(acwrSig?.score||0)+"0A",border:`1px solid ${SigColor(acwrSig?.score||0)}22`,borderRadius:16}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <div>
                    <div style={{fontSize:10,color:SigColor(acwrSig?.score||0),letterSpacing:1,fontFamily:"'Inter',sans-serif",fontWeight:600,marginBottom:3}}>CHARGE AIGUË/CHRONIQUE · 35%</div>
                    <div style={{fontSize:16,fontWeight:800,color:SigColor(acwrSig?.score||0)}}>ACWR {acwrSig?.value||"—"}</div>
                  </div>
                  <div style={{fontSize:36,fontWeight:800,color:SigColor(acwrSig?.score||0),letterSpacing:-2}}>{acwrSig?.score||0}</div>
                </div>
                <div style={{marginBottom:12}}>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"#555",fontFamily:"'Inter',sans-serif",marginBottom:5}}>
                    <span>Sous-chargé</span><span style={{color:"#32D74B"}}>Zone optimale</span><span>Surcharge</span>
                  </div>
                  <div style={{height:10,background:"#333",borderRadius:5,position:"relative",overflow:"visible"}}>
                    <div style={{position:"absolute",left:"26.7%",width:"16.7%",height:"100%",background:"#32D74B22",borderRadius:2}}/>
                    <div style={{position:"absolute",top:-3,left:`${Math.min(Math.max(acwrRaw/2,0),1)*95}%`,width:16,height:16,borderRadius:"50%",background:SigColor(acwrSig?.score||0),border:"2px solid #161618",transform:"translateX(-50%)",transition:"left 0.8s ease",boxShadow:`0 0 8px ${SigColor(acwrSig?.score||0)}66`}}/>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"#555",fontFamily:"'JetBrains Mono',monospace",marginTop:4}}>
                    <span>0</span><span>0.8</span><span>1.0</span><span>1.3</span><span>1.5</span><span>2.0</span>
                  </div>
                </div>
                <div style={{display:"flex",gap:8,marginBottom:10}}>
                  {[
                    {label:"CHARGE 7J",value:Math.round(weeklyVol[0]?.load||0),color:"#fff"},
                    {label:"MOY. 28J",value:Math.round(weeklyVol.slice(0,4).reduce((s,w)=>s+(w?.load||0),0)/4),color:"#888"},
                    {label:"RATIO",value:acwrSig?.value,color:SigColor(acwrSig?.score||0)},
                  ].map(({label,value,color})=>(
                    <div key={label} style={{flex:1,background:"#333",borderRadius:8,padding:"8px 6px",textAlign:"center"}}>
                      <div style={{fontSize:8,color:"#555",fontFamily:"'Inter',sans-serif",fontWeight:500,marginBottom:3,letterSpacing:1}}>{label}</div>
                      <div style={{fontSize:13,fontWeight:700,color,fontFamily:"'JetBrains Mono',monospace"}}>{value}</div>
                    </div>
                  ))}
                </div>
                <div style={{fontSize:10,color:"#555",fontFamily:"'Inter',sans-serif",lineHeight:1.6}}>
                  Zone optimale : 0.8–1.3. Au-delà de 1.5, le risque de blessure augmente exponentiellement.
                </div>
              </div>

              {/* Monotonie 10% */}
              <div onClick={()=>{setShowProtectionDetail(false);setShowMonoDetail(true);}}
                style={{marginBottom:24,padding:"18px",background:SigColor(monoSig?.score||0)+"0A",border:`1px solid ${SigColor(monoSig?.score||0)}22`,borderRadius:16,cursor:"pointer"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <div>
                    <div style={{fontSize:10,color:SigColor(monoSig?.score||0),letterSpacing:1,fontFamily:"'Inter',sans-serif",fontWeight:600,marginBottom:3}}>MONOTONIE · 10%</div>
                    <div style={{fontSize:16,fontWeight:800,color:SigColor(monoSig?.score||0)}}>{monoSig?.value||"—"}</div>
                    <div style={{fontSize:10,color:SigColor(monoSig?.score||0)+"88",fontFamily:"'Inter',sans-serif",marginTop:3}}>Voir détail →</div>
                  </div>
                  <div style={{fontSize:36,fontWeight:800,color:SigColor(monoSig?.score||0),letterSpacing:-2}}>{monoSig?.score||0}</div>
                </div>
                {monoSig?.detail&&<div style={{fontSize:11,color:"#888",fontFamily:"'Inter',sans-serif",marginBottom:10}}>{monoSig.detail}</div>}
                {last7Runs.length > 0 ? (
                  <div style={{marginBottom:10}}>
                    <div style={{fontSize:9,color:"#555",fontFamily:"'Inter',sans-serif",fontWeight:500,marginBottom:6,letterSpacing:1}}>SÉANCES 14 DERNIERS JOURS</div>
                    {Object.entries(last7ByType).map(([type,data])=>{
                      const tm={"Endurance fondamentale":{color:"#32D74B",icon:"◈"},"Fractionné / VMA":{color:"#FF453A",icon:"▲▲"},"Tempo / Seuil":{color:"#FF9F0A",icon:"◇"},"Sortie longue":{color:"#BF5AF2",icon:"◈◈◈"},"Footing":{color:"#aaa",icon:"〜"}}[type]||{color:"#888",icon:"○"};
                      return (
                        <div key={type} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 10px",background:"#333",borderRadius:8,marginBottom:4,borderLeft:`3px solid ${tm.color}`}}>
                          <span style={{fontSize:11,color:tm.color,fontFamily:"'Inter',sans-serif",fontWeight:500}}>{tm.icon} {type}</span>
                          <span style={{fontSize:11,color:"#888",fontFamily:"'Inter',sans-serif"}}>{data.runs} × {data.km.toFixed(1)}km</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{padding:"10px",background:"#333",borderRadius:8,fontSize:11,color:"#555",fontFamily:"'Inter',sans-serif",marginBottom:10}}>Pas assez de données (14 jours)</div>
                )}
                <div style={{fontSize:10,color:"#555",fontFamily:"'Inter',sans-serif",lineHeight:1.6}}>
                  Trop de séances au même type = risque de surcharge localisée. Varie intensité et types.
                </div>
              </div>

              {/* Volume 10% */}
              <div style={{marginBottom:16,padding:"18px",background:SigColor(volSig?.score||0)+"0A",border:`1px solid ${SigColor(volSig?.score||0)}22`,borderRadius:16}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <div>
                    <div style={{fontSize:10,color:SigColor(volSig?.score||0),letterSpacing:1,fontFamily:"'Inter',sans-serif",fontWeight:600,marginBottom:3}}>PROGRESSION VOLUME · 10%</div>
                    <div style={{fontSize:16,fontWeight:800,color:SigColor(volSig?.score||0)}}>{volSig?.value||"0%"}</div>
                  </div>
                  <div style={{fontSize:36,fontWeight:800,color:SigColor(volSig?.score||0),letterSpacing:-2}}>{volSig?.score||0}</div>
                </div>
                <div style={{display:"flex",gap:8,marginBottom:10}}>
                  {[
                    {label:"SEMAINE PREC.",value:`${prevKmRaw.toFixed(1)} km`,color:"#888"},
                    {label:"CETTE SEMAINE",value:`${curKmRaw.toFixed(1)} km`,color:"#fff"},
                    {label:"ÉVOLUTION",value:volSig?.value||"0%",color:SigColor(volSig?.score||0)},
                  ].map(({label,value,color})=>(
                    <div key={label} style={{flex:1,background:"#333",borderRadius:8,padding:"8px 6px",textAlign:"center"}}>
                      <div style={{fontSize:8,color:"#555",fontFamily:"'Inter',sans-serif",fontWeight:500,marginBottom:3,letterSpacing:1}}>{label}</div>
                      <div style={{fontSize:13,fontWeight:700,color}}>{value}</div>
                    </div>
                  ))}
                </div>
                <div style={{marginBottom:10}}>
                  {[[prevKmRaw,"S-1","#555"],[curKmRaw,"Cette sem.",SigColor(volSig?.score||0)]].map(([km,label,color])=>{
                    const max=Math.max(prevKmRaw,curKmRaw,1);
                    return (
                      <div key={label} style={{marginBottom:6}}>
                        <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"#555",fontFamily:"'Inter',sans-serif",marginBottom:3}}>
                          <span>{label}</span><span style={{color}}>{km.toFixed(1)} km</span>
                        </div>
                        <div style={{height:5,background:"#333",borderRadius:3,overflow:"hidden"}}>
                          <div style={{height:"100%",width:`${(km/max)*100}%`,background:color,borderRadius:3,transition:"width 0.8s ease"}}/>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{fontSize:10,color:"#555",fontFamily:"'Inter',sans-serif",lineHeight:1.6}}>
                  Règle des 10% : ne pas augmenter le volume de plus de 10% par semaine.
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── MODAL MONOTONIE ── */}
      {showMonoDetail && (()=>{
        const HARD = ["Fractionné / VMA", "Tempo / Seuil", "Évaluation VMA"];
        const last14 = done.filter(r => r.date >= addDays(TODAY_STR, -14)).sort((a,b) => a.date.localeCompare(b.date));
        const monoSig = protectionScore.signals.find(s=>s.key==="MONO");
        const color = monoSig?.score>=75?"#32D74B":monoSig?.score>=50?"#FF9F0A":"#FF453A";
        const byType = {};
        last14.forEach(r => { if(!byType[r.type]) byType[r.type]={count:0,km:0}; byType[r.type].count++; byType[r.type].km+=r.dist; });
        const total = last14.length;
        const TMETA = {"Endurance fondamentale":{color:"#32D74B",icon:"◈"},"Fractionné / VMA":{color:"#FF453A",icon:"▲▲"},"Tempo / Seuil":{color:"#FF9F0A",icon:"◇"},"Sortie longue":{color:"#BF5AF2",icon:"◈◈◈"},"Footing":{color:"#aaa",icon:"〜"},"Évaluation VMA":{color:"#0A84FF",icon:"⚡"}};
        const weeks = [1,0].map(i => {
          const wkRuns = done.filter(r => r.date >= addDays(TODAY_STR, -(i+1)*7) && r.date < addDays(TODAY_STR, -i*7));
          const hard = wkRuns.filter(r=>HARD.includes(r.type));
          const easy = wkRuns.filter(r=>!HARD.includes(r.type));
          return { label:i===0?"S-1 (sem. passée)":"S-2", runs:wkRuns.length, hard:hard.length, easy:easy.length,
            hardKm:Math.round(hard.reduce((s,r)=>s+r.dist,0)*10)/10,
            easyKm:Math.round(easy.reduce((s,r)=>s+r.dist,0)*10)/10 };
        });
        const curWkRuns = done.filter(r => r.date >= addDays(TODAY_STR, -7));
        const curHard = curWkRuns.filter(r=>HARD.includes(r.type));
        const curEasy = curWkRuns.filter(r=>!HARD.includes(r.type));
        return (
          <div onClick={()=>setShowMonoDetail(false)}
            style={{position:"fixed",inset:0,background:"rgba(0,0,0,.92)",zIndex:500,display:"flex",alignItems:"flex-end",justifyContent:"center",backdropFilter:"blur(10px)"}}>
            <div onClick={e=>e.stopPropagation()}
              style={{width:"100%",maxWidth:480,background:"#242426",borderRadius:"22px 22px 0 0",padding:"28px 24px",paddingBottom:"calc(28px + env(safe-area-inset-bottom,12px))",maxHeight:"90vh",overflowY:"auto"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:24}}>
                <div>
                  <div style={{fontSize:10,color,letterSpacing:2,fontFamily:"'Inter',sans-serif",fontWeight:600,marginBottom:6}}>MONOTONIE DE L'ENTRAÎNEMENT</div>
                  <div style={{display:"flex",alignItems:"baseline",gap:10}}>
                    <span style={{fontSize:36,fontWeight:800,color,letterSpacing:-2,lineHeight:1}}>{monoSig?.score||0}</span>
                    <span style={{fontSize:16,color:"#555",fontFamily:"'Inter',sans-serif"}}>/100 · {monoSig?.value}</span>
                  </div>
                  {monoSig?.detail&&<div style={{fontSize:11,color:"#888",fontFamily:"'Inter',sans-serif",marginTop:4}}>{monoSig.detail}</div>}
                </div>
                <button onClick={()=>setShowMonoDetail(false)} style={{background:"#333",border:"none",color:"#888",fontSize:18,cursor:"pointer",borderRadius:10,width:36,height:36,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
              </div>
              <div style={{marginBottom:20}}>
                <div style={{fontSize:10,color:"#555",letterSpacing:1,fontFamily:"'Inter',sans-serif",fontWeight:500,marginBottom:10}}>CETTE SEMAINE</div>
                {curWkRuns.length > 0 ? (<>
                  <div style={{display:"flex",height:36,borderRadius:10,overflow:"hidden",marginBottom:8,gap:2}}>
                    {curEasy.length>0&&<div style={{flex:curEasy.length,background:"#32D74B33",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:"#32D74B",fontFamily:"'Inter',sans-serif"}}>{curEasy.length} facile{curEasy.length>1?"s":""}</div>}
                    {curHard.length>0&&<div style={{flex:curHard.length,background:"#FF453A33",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:"#FF453A",fontFamily:"'Inter',sans-serif"}}>{curHard.length} intensi{curHard.length>1?"ves":"ve"}</div>}
                  </div>
                  <div style={{fontSize:10,color:"#555",fontFamily:"'Inter',sans-serif",marginBottom:12}}>
                    Cible : 1-2 séances intensives par semaine
                  </div>
                </>) : <div style={{fontSize:11,color:"#555",fontFamily:"'Inter',sans-serif",marginBottom:12}}>Pas encore de séances cette semaine</div>}
              </div>
              <div style={{marginBottom:20}}>
                <div style={{fontSize:10,color:"#555",letterSpacing:1,fontFamily:"'Inter',sans-serif",fontWeight:500,marginBottom:10}}>RÉPARTITION 14 JOURS ({total} séances)</div>
                {total > 0 ? (
                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    {Object.entries(byType).sort(([,a],[,b])=>b.count-a.count).map(([type,data])=>{
                      const tm = TMETA[type]||{color:"#888",icon:"○"};
                      const pct = Math.round((data.count/total)*100);
                      return (
                        <div key={type}>
                          <div style={{display:"flex",justifyContent:"space-between",fontSize:10,fontFamily:"'Inter',sans-serif",marginBottom:4}}>
                            <span style={{color:tm.color,fontWeight:500}}>{tm.icon} {type}</span>
                            <span style={{color:"#888"}}>{data.count} séance{data.count>1?"s":""} · {data.km.toFixed(0)}km · {pct}%</span>
                          </div>
                          <div style={{height:6,background:"#333",borderRadius:3,overflow:"hidden"}}>
                            <div style={{height:"100%",width:`${pct}%`,background:tm.color,borderRadius:3,transition:"width 0.8s ease"}}/>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : <div style={{fontSize:11,color:"#555",fontFamily:"'Inter',sans-serif"}}>Pas assez de données</div>}
              </div>
              <div style={{marginBottom:20}}>
                <div style={{fontSize:10,color:"#555",letterSpacing:1,fontFamily:"'Inter',sans-serif",fontWeight:500,marginBottom:10}}>INTENSITÉ PAR SEMAINE</div>
                <div style={{display:"flex",gap:8}}>
                  {weeks.map(w=>(
                    <div key={w.label} style={{flex:1,background:"#333",borderRadius:10,padding:"12px 10px"}}>
                      <div style={{fontSize:9,color:"#555",fontFamily:"'Inter',sans-serif",marginBottom:8}}>{w.label}</div>
                      <div style={{marginBottom:6}}>
                        <div style={{display:"flex",justifyContent:"space-between",fontSize:10,fontFamily:"'Inter',sans-serif",marginBottom:3}}><span style={{color:"#32D74B"}}>Facile</span><span style={{color:"#32D74B"}}>{w.easyKm}km</span></div>
                        <div style={{height:5,background:"#242426",borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:`${(w.easyKm/Math.max(w.easyKm+w.hardKm,1))*100}%`,background:"#32D74B44",borderRadius:3}}/></div>
                      </div>
                      <div>
                        <div style={{display:"flex",justifyContent:"space-between",fontSize:10,fontFamily:"'Inter',sans-serif",marginBottom:3}}><span style={{color:"#FF453A"}}>Intensif</span><span style={{color:"#FF453A"}}>{w.hardKm}km</span></div>
                        <div style={{height:5,background:"#242426",borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:`${(w.hardKm/Math.max(w.easyKm+w.hardKm,1))*100}%`,background:"#FF453A44",borderRadius:3}}/></div>
                      </div>
                      <div style={{fontSize:9,color:"#555",fontFamily:"'Inter',sans-serif",marginTop:6}}>{w.runs} séances</div>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{padding:"14px 16px",background:"#333",borderRadius:12,fontSize:11,color:"#888",fontFamily:"'Inter',sans-serif",lineHeight:1.8}}>
                <span style={{color:"#fff"}}>Monotonie = répétition des mêmes stimuli.</span><br/>
                Un entraînement varié stimule mieux les adaptations et réduit le risque de blessure.<br/><br/>
                <span style={{color:"#32D74B"}}>Idéal :</span> 1-2 séances intensives + 2-3 séances faciles/semaine.
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
