import { useState, useMemo, useEffect } from "react";
import { stravaLogin, exchangeToken, fetchActivities } from './strava';
import { loadPlanned, loadDone, savePlanned, saveDone, saveManyDone } from './db';

const MARATHON = new Date("2026-10-25");
const TODAY = new Date("2026-03-11");
const DAYS_LEFT = Math.ceil((MARATHON - TODAY) / 86400000);
const WEEKS_LEFT = Math.floor(DAYS_LEFT / 7);

const TYPE_META = {
  "Récupération": { color: "#4ECDC4", dark: "#0d2b2a", icon: "○" },
  "Endurance":    { color: "#FFE66D", dark: "#2b2700", icon: "◈" },
  "Fractionné":   { color: "#FF6B6B", dark: "#2b0d0d", icon: "▲▲" },
  "Sortie longue":{ color: "#C77DFF", dark: "#1e0d2b", icon: "◈◈◈" },
  "Tempo":        { color: "#FF9F43", dark: "#2b1a00", icon: "◇" },
};

const FEELINGS = ["😣","😕","😐","🙂","😄"];

const STORE = {
  get: (k, def) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

function pace(dist, dur) {
  if (!dist || !dur) return "--'--\"";
  const s = (dur * 60) / dist;
  return `${Math.floor(s / 60)}'${String(Math.round(s % 60)).padStart(2,"0")}"`;
}

function wkKey(d) {
  const dt = new Date(d); const day = dt.getDay() || 7;
  const mon = new Date(dt); mon.setDate(dt.getDate() - day + 1);
  return mon.toISOString().slice(0,10);
}

function fmtDate(d, opts = { weekday:"short", day:"numeric", month:"short" }) {
  return new Date(d).toLocaleDateString("fr-FR", opts);
}

function isToday(d) { return d === TODAY.toISOString().slice(0,10); }
function isFuture(d) { return new Date(d) > TODAY; }
function isPast(d) { return new Date(d) < TODAY; }

function scoreSession(planned, done) {
  if (!planned || !done) return null;
  const distScore = Math.max(0, 100 - Math.abs(done.dist - planned.targetDist) / planned.targetDist * 100);
  const durScore  = Math.max(0, 100 - Math.abs(done.dur - planned.targetDur) / planned.targetDur * 100);
  const hrScore   = planned.targetHR && done.hr ? Math.max(0, 100 - Math.abs(done.hr - planned.targetHR) / planned.targetHR * 100) : 100;
  return Math.round((distScore * 0.4 + durScore * 0.3 + hrScore * 0.3));
}

export default function App() {
  const [planned, setPlanned] = useState([]);
  const [done,    setDone]    = useState([]);
  const [view,    setView]    = useState("today");
  const [modal,   setModal]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [stravaConnected, setStravaConnected] = useState(() => !!STORE.get("strava_token", null));
  const [stravaLoading, setStravaLoading] = useState(false);
  const [syncStatus, setSyncStatus] = useState("");
  const todayStr = TODAY.toISOString().slice(0,10);

  useEffect(() => {
    async function init() {
      setLoading(true);
      const [p, d] = await Promise.all([loadPlanned(), loadDone()]);
      setPlanned(p); setDone(d);
      setLoading(false);
    }
    init();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (!code) return;
    setStravaLoading(true); setSyncStatus("Connexion Strava...");
    exchangeToken(code).then(data => {
      STORE.set("strava_token", data.access_token);
      setStravaConnected(true);
      setSyncStatus("Import des séances...");
      fetchActivities(data.access_token).then(async activities => {
        const existingIds = new Set(done.map(r => r.id));
        const newOnes = activities.filter(a => !existingIds.has(a.id));
        if (newOnes.length > 0) { await saveManyDone(newOnes); setDone(prev => [...prev, ...newOnes]); }
        setSyncStatus(`✓ ${newOnes.length} séances importées !`);
        setTimeout(() => setSyncStatus(""), 4000);
        setStravaLoading(false);
      });
      window.history.replaceState({}, '', '/');
    }).catch(() => { setStravaLoading(false); setSyncStatus(""); });
  }, [done]);

  async function syncStrava() {
    const token = STORE.get("strava_token", null); if (!token) return;
    setStravaLoading(true); setSyncStatus("Synchronisation...");
    const activities = await fetchActivities(token);
    const existingIds = new Set(done.map(r => r.id));
    const newOnes = activities.filter(a => !existingIds.has(a.id));
    if (newOnes.length > 0) { await saveManyDone(newOnes); setDone(prev => [...prev, ...newOnes]); }
    setSyncStatus(`✓ ${newOnes.length} nouvelles séances`);
    setTimeout(() => setSyncStatus(""), 3000);
    setStravaLoading(false);
  }

  const weeklyVol = useMemo(() => {
    const weeks = {};
    done.forEach(r => {
      const wk = wkKey(r.date);
      if (!weeks[wk]) weeks[wk] = { dist:0, dur:0, runs:[], rpe:[] };
      weeks[wk].dist += r.dist; weeks[wk].dur += r.dur;
      weeks[wk].runs.push(r); weeks[wk].rpe.push(r.rpe || 5);
    });
    return Object.entries(weeks).sort(([a],[b]) => b.localeCompare(a)).slice(0,8)
      .map(([wk, d]) => ({ wk, ...d, load: d.dist * (d.rpe.reduce((s,v)=>s+v,0)/d.rpe.length) }));
  }, [done]);

  const curWeek  = weeklyVol[0] || { dist:0, dur:0, runs:[], load:0 };
  const prevWeek = weeklyVol[1] || { dist:0, dur:0, runs:[], load:0 };
  const acwr     = prevWeek.load ? (curWeek.load / prevWeek.load) : 1;
  const totalKm  = done.reduce((s,r) => s + r.dist, 0);

  const typeVariety = useMemo(() => {
    const last4wk = done.filter(r => { const d = new Date(r.date); const c = new Date(TODAY); c.setDate(c.getDate()-28); return d >= c; });
    const counts = {}; last4wk.forEach(r => { counts[r.type] = (counts[r.type]||0) + 1; }); return counts;
  }, [done]);

  const paceProgression = useMemo(() => {
    return [...done].filter(r => r.type === "Endurance" && r.dist > 5)
      .sort((a,b) => a.date.localeCompare(b.date))
      .map(r => ({ date: r.date, pace: (r.dur * 60) / r.dist }));
  }, [done]);

  const [planForm, setPlanForm] = useState({ date:todayStr, type:"Endurance", targetDist:"", targetDur:"", targetHR:"", notes:"" });
  const [logForm,  setLogForm]  = useState({ date:todayStr, plannedId:"", type:"Endurance", dist:"", dur:"", hr:"", rpe:"6", feeling:"3", notes:"" });

  async function addPlanned() {
    const p = { id:"p"+Date.now(), ...planForm, targetDist:+planForm.targetDist, targetDur:+planForm.targetDur, targetHR:planForm.targetHR?+planForm.targetHR:null };
    await savePlanned(p); setPlanned(prev => [...prev, p]); setModal(null);
  }

  function logSession(prefill = null) {
    setLogForm(prefill
      ? { date:prefill.date, plannedId:prefill.id, type:prefill.type, dist:String(prefill.targetDist), dur:String(prefill.targetDur), hr:prefill.targetHR?String(prefill.targetHR):"", rpe:"6", feeling:"3", notes:"" }
      : { date:todayStr, plannedId:"", type:"Endurance", dist:"", dur:"", hr:"", rpe:"6", feeling:"3", notes:"" });
    setModal({ type:"log" });
  }

  async function submitLog() {
    const r = { id:"d"+Date.now(), ...logForm, dist:+logForm.dist, dur:+logForm.dur, hr:logForm.hr?+logForm.hr:null, rpe:+logForm.rpe, feeling:+logForm.feeling };
    await saveDone(r); setDone(prev => [...prev, r]); setModal(null);
  }

  const acwrStatus = acwr > 1.3 ? { label:"RISQUE ÉLEVÉ", color:"#FF6B6B" } : acwr > 1.15 ? { label:"CHARGE MODÉRÉE", color:"#FF9F43" } : { label:"OPTIMAL", color:"#4ECDC4" };
  const varietyScore = Object.keys(typeVariety).length;
  const todayPlanned = planned.filter(p => p.date === todayStr);
  const upcoming = planned.filter(p => isFuture(p.date)).sort((a,b) => a.date.localeCompare(b.date));

  const css = `
    @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=JetBrains+Mono:wght@300;400;500&display=swap');
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{background:#080A0E}
    ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:#222}
    .card{background:#0F1117;border:1px solid #1C1F27;border-radius:14px}
    .card-hover{transition:all .2s;cursor:pointer}
    .card-hover:hover{background:#141720!important;border-color:#2a2d38!important;transform:translateY(-1px)}
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
    select option{background:#0F1117}
    @keyframes spin{to{transform:rotate(360deg)}}
    .spin{animation:spin 1s linear infinite;display:inline-block}
  `;

  if (loading) return (
    <div style={{ minHeight:"100vh", background:"#080A0E", display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:16 }}>
      <style>{css}</style>
      <div className="spin" style={{ fontSize:32, color:"#E8E4DC" }}>↻</div>
      <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:12, color:"#555", letterSpacing:2 }}>CHARGEMENT...</div>
    </div>
  );

  return (
    <div style={{ minHeight:"100vh", background:"#080A0E", fontFamily:"'Syne',sans-serif", color:"#E8E4DC", maxWidth:480, margin:"0 auto", paddingBottom:80 }}>
      <style>{css}</style>

      <div style={{ padding:"20px 20px 0", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div>
          <div style={{ fontSize:11, color:"#555", letterSpacing:3, fontFamily:"'JetBrains Mono',monospace" }}>MARATHON · OCT 2026</div>
          <div style={{ fontSize:28, fontWeight:800, letterSpacing:-1, marginTop:2 }}>
            {DAYS_LEFT}<span style={{ fontSize:14, color:"#555", fontWeight:400, marginLeft:4 }}>jours</span>
            {" · "}{WEEKS_LEFT}<span style={{ fontSize:14, color:"#555", fontWeight:400, marginLeft:4 }}>sem.</span>
          </div>
        </div>
        <div style={{ display:"flex", gap:8 }}>
          <button className="btn-ghost" onClick={() => setModal({type:"plan"})} style={{ borderRadius:10, padding:"8px 14px", fontSize:12, fontFamily:"'JetBrains Mono',monospace" }}>+ PLANIFIER</button>
          <button className="btn-primary" onClick={() => logSession()} style={{ background:"#E8E4DC", color:"#080A0E", borderRadius:10, padding:"8px 14px", fontSize:12, fontWeight:700, fontFamily:"'JetBrains Mono',monospace" }}>+ LOG</button>
        </div>
      </div>

      <div style={{ padding:"12px 20px 0" }}>
        <div style={{ height:3, background:"#1C1F27", borderRadius:2 }}>
          <div style={{ height:3, width:`${Math.round((32-WEEKS_LEFT)/32*100)}%`, background:"linear-gradient(90deg,#4ECDC4,#FFE66D)", borderRadius:2 }} />
        </div>
      </div>

      <div style={{ padding:"12px 20px 0" }}>
        {!stravaConnected ? (
          <button onClick={stravaLogin} style={{ width:"100%", background:"#FC4C02", border:"none", borderRadius:10, padding:"12px", color:"#fff", fontSize:13, fontWeight:700, fontFamily:"'JetBrains Mono',monospace", cursor:"pointer" }}>
            🔗 CONNECTER STRAVA
          </button>
        ) : (
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", background:"#0F1117", border:"1px solid #1C1F27", borderRadius:10, padding:"10px 14px" }}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <div style={{ width:8, height:8, borderRadius:"50%", background:"#FC4C02" }} />
              <span style={{ fontSize:11, color:"#888", fontFamily:"'JetBrains Mono',monospace" }}>{syncStatus || `STRAVA · ${done.filter(d=>d.fromStrava).length} séances`}</span>
            </div>
            <button onClick={syncStrava} className="btn-ghost" style={{ borderRadius:8, padding:"4px 10px", fontSize:11, fontFamily:"'JetBrains Mono',monospace" }}>
              {stravaLoading ? <span className="spin">↻</span> : "↻ SYNC"}
            </button>
          </div>
        )}
      </div>

      <div style={{ display:"flex", gap:4, padding:"16px 20px 0" }}>
        {[["today","AUJOURD'HUI"],["plan","PLAN"],["analyse","ANALYSE"],["journal","JOURNAL"]].map(([v,l]) => (
          <button key={v} className="nav-tab" onClick={() => setView(v)}
            style={{ flex:1, background:view===v?"#1C1F27":"transparent", color:view===v?"#E8E4DC":"#555", borderRadius:8, padding:"8px 0", fontSize:10, letterSpacing:1.5, fontFamily:"'JetBrains Mono',monospace" }}>
            {l}
          </button>
        ))}
      </div>

      <div style={{ padding:"20px 20px 0" }}>

        {view === "today" && (
          <div className="fade-up">
            {todayPlanned.length === 0 && (
              <div className="card" style={{ padding:28, textAlign:"center" }}>
                <div style={{ fontSize:40, marginBottom:12 }}>🏃</div>
                <div style={{ fontSize:14, color:"#555", fontFamily:"'JetBrains Mono',monospace" }}>Rien de planifié aujourd'hui</div>
                <button className="btn-primary" onClick={() => setModal({type:"plan"})} style={{ marginTop:16, background:"#E8E4DC", color:"#080A0E", borderRadius:10, padding:"10px 20px", fontSize:12, fontWeight:700 }}>Planifier une séance</button>
              </div>
            )}
            {todayPlanned.map(p => {
              const tm = TYPE_META[p.type] || TYPE_META["Endurance"];
              const linked = done.find(d => d.plannedId === p.id);
              const score = linked ? scoreSession(p, linked) : null;
              return (
                <div key={p.id} className="card" style={{ padding:22, marginBottom:14, borderLeft:`3px solid ${tm.color}` }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:14 }}>
                    <div>
                      <span className="pill" style={{ background:tm.dark, color:tm.color, marginBottom:8 }}>{tm.icon} {p.type}</span>
                      <div style={{ fontSize:22, fontWeight:800 }}>{p.targetDist} km</div>
                      <div style={{ fontSize:12, color:"#555", fontFamily:"'JetBrains Mono',monospace", marginTop:2 }}>~{p.targetDur} min · {p.targetHR ? `FC ${p.targetHR} bpm` : "FC libre"}</div>
                    </div>
                    {score !== null && (
                      <div style={{ textAlign:"center" }}>
                        <svg width={56} height={56} viewBox="0 0 56 56">
                          <circle cx={28} cy={28} r={22} fill="none" stroke="#1C1F27" strokeWidth={4}/>
                          <circle cx={28} cy={28} r={22} fill="none" stroke={score>79?"#4ECDC4":score>59?"#FFE66D":"#FF6B6B"} strokeWidth={4} strokeLinecap="round" strokeDasharray={138.2} strokeDashoffset={138.2*(1-score/100)} transform="rotate(-90 28 28)" className="score-ring"/>
                          <text x={28} y={32} textAnchor="middle" fill="#E8E4DC" fontSize={13} fontWeight={700} fontFamily="Syne">{score}</text>
                        </svg>
                        <div style={{ fontSize:9, color:"#555", fontFamily:"'JetBrains Mono',monospace" }}>SCORE</div>
                      </div>
                    )}
                  </div>
                  {p.notes && <div style={{ fontSize:12, color:"#888", fontFamily:"'JetBrains Mono',monospace", marginBottom:14, padding:"10px 12px", background:"#080A0E", borderRadius:8 }}>{p.notes}</div>}
                  {!linked
                    ? <button className="btn-primary" onClick={() => logSession(p)} style={{ background:tm.color, color:"#080A0E", borderRadius:10, padding:"10px 0", fontSize:12, fontWeight:700, width:"100%" }}>✓ ENREGISTRER LA SÉANCE</button>
                    : <div>
                        <div style={{ display:"flex", gap:12, marginBottom:10 }}>
                          {[["DIST",`${linked.dist} km`],["DURÉE",`${linked.dur} min`],["ALLURE",pace(linked.dist,linked.dur)]].map(([lbl,val]) => (
                            <div key={lbl} style={{ flex:1, background:"#080A0E", borderRadius:8, padding:"10px 8px", textAlign:"center" }}>
                              <div style={{ fontSize:9, color:"#555", fontFamily:"'JetBrains Mono',monospace", marginBottom:4 }}>{lbl}</div>
                              <div style={{ fontSize:15, fontWeight:700 }}>{val}</div>
                            </div>
                          ))}
                        </div>
                        <CompareBar planned={p} done={linked} />
                      </div>
                  }
                </div>
              );
            })}
            {upcoming.slice(0,3).length > 0 && (
              <div style={{ marginTop:8 }}>
                <div style={{ fontSize:10, color:"#555", letterSpacing:3, fontFamily:"'JetBrains Mono',monospace", marginBottom:10 }}>PROCHAINES SÉANCES</div>
                {upcoming.slice(0,3).map(p => {
                  const tm = TYPE_META[p.type] || TYPE_META["Endurance"];
                  return (
                    <div key={p.id} className="card card-hover" style={{ padding:"14px 16px", marginBottom:8, display:"flex", alignItems:"center", gap:14 }}>
                      <div style={{ width:40, height:40, borderRadius:10, background:tm.dark, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, flexShrink:0 }}>{tm.icon}</div>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:11, color:"#555", fontFamily:"'JetBrains Mono',monospace" }}>{fmtDate(p.date)}</div>
                        <div style={{ fontSize:14, fontWeight:700, marginTop:2 }}>{p.type} · {p.targetDist} km</div>
                      </div>
                      <div style={{ fontSize:11, color:tm.color, fontFamily:"'JetBrains Mono',monospace" }}>{Math.ceil((new Date(p.date)-TODAY)/86400000)}j →</div>
                    </div>
                  );
                })}
              </div>
            )}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginTop:16 }}>
              <div className="card" style={{ padding:16 }}>
                <div style={{ fontSize:9, color:"#555", letterSpacing:2, fontFamily:"'JetBrains Mono',monospace", marginBottom:8 }}>SEMAINE EN COURS</div>
                <div style={{ fontSize:28, fontWeight:800 }}>{curWeek.dist.toFixed(1)}<span style={{ fontSize:13, color:"#555", fontWeight:400 }}>km</span></div>
                <div style={{ fontSize:11, color:curWeek.dist>prevWeek.dist?"#4ECDC4":"#FF6B6B", fontFamily:"'JetBrains Mono',monospace", marginTop:4 }}>
                  {curWeek.dist>prevWeek.dist?"▲":"▼"} {Math.abs(curWeek.dist-prevWeek.dist).toFixed(1)} vs S-1
                </div>
              </div>
              <div className="card" style={{ padding:16, borderColor:acwr>1.3?"#FF6B6B33":acwr>1.15?"#FF9F4333":"#1C1F27" }}>
                <div style={{ fontSize:9, color:"#555", letterSpacing:2, fontFamily:"'JetBrains Mono',monospace", marginBottom:8 }}>RISQUE BLESSURE</div>
                <div style={{ fontSize:16, fontWeight:800, color:acwrStatus.color }}>{acwrStatus.label}</div>
                <div style={{ fontSize:10, color:"#555", fontFamily:"'JetBrains Mono',monospace", marginTop:4 }}>ACWR {acwr.toFixed(2)}</div>
              </div>
            </div>
          </div>
        )}

        {view === "plan" && (
          <div className="fade-up">
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
              <div style={{ fontSize:11, color:"#555", letterSpacing:3, fontFamily:"'JetBrains Mono',monospace" }}>PLANNING ({planned.length} SÉANCES)</div>
              <button className="btn-ghost" onClick={() => setModal({type:"plan"})} style={{ borderRadius:8, padding:"6px 12px", fontSize:11, fontFamily:"'JetBrains Mono',monospace" }}>+ AJOUTER</button>
            </div>
            {[...planned].sort((a,b) => a.date.localeCompare(b.date)).map(p => {
              const tm = TYPE_META[p.type] || TYPE_META["Endurance"];
              const linked = done.find(d => d.plannedId === p.id);
              const score = linked ? scoreSession(p,linked) : null;
              const past = isPast(p.date); const today = isToday(p.date);
              return (
                <div key={p.id} className="card" style={{ padding:"16px 18px", marginBottom:8, opacity:past&&!linked?0.5:1, borderLeft:`3px solid ${today?tm.color:linked?"#4ECDC4":"#1C1F27"}` }}>
                  <div style={{ display:"flex", gap:12, alignItems:"center" }}>
                    <div style={{ width:44, height:44, borderRadius:10, background:tm.dark, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}>{tm.icon}</div>
                    <div style={{ flex:1 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:3 }}>
                        <span style={{ fontSize:11, color:today?"#FFE66D":past?"#555":"#aaa", fontFamily:"'JetBrains Mono',monospace" }}>{today?"AUJOURD'HUI":fmtDate(p.date,{weekday:"short",day:"numeric",month:"short"})}</span>
                        {linked && <span style={{ fontSize:9, color:"#4ECDC4", fontFamily:"'JetBrains Mono',monospace" }}>✓ FAIT</span>}
                      </div>
                      <div style={{ fontSize:15, fontWeight:700 }}>{p.type} · {p.targetDist} km</div>
                      <div style={{ fontSize:11, color:"#555", fontFamily:"'JetBrains Mono',monospace" }}>~{p.targetDur} min{p.targetHR?` · FC ${p.targetHR}`:""}</div>
                    </div>
                    {score!==null
                      ? <div style={{ textAlign:"center" }}><div style={{ fontSize:22, fontWeight:800, color:score>79?"#4ECDC4":score>59?"#FFE66D":"#FF6B6B" }}>{score}</div><div style={{ fontSize:9, color:"#555", fontFamily:"'JetBrains Mono',monospace" }}>SCORE</div></div>
                      : !past && <button className="btn-ghost" onClick={() => logSession(p)} style={{ borderRadius:8, padding:"6px 12px", fontSize:11, fontFamily:"'JetBrains Mono',monospace" }}>LOG</button>
                    }
                  </div>
                  {p.notes && <div style={{ fontSize:11, color:"#555", fontFamily:"'JetBrains Mono',monospace", marginTop:10 }}>💬 {p.notes}</div>}
                  {linked && <CompareBar planned={p} done={linked} />}
                </div>
              );
            })}
          </div>
        )}

        {view === "analyse" && (
          <div className="fade-up">
            <div className="card" style={{ padding:22, marginBottom:14, borderColor:acwr>1.3?"#FF6B6B44":"#1C1F27" }}>
              <div style={{ fontSize:10, color:"#555", letterSpacing:3, fontFamily:"'JetBrains Mono',monospace", marginBottom:16 }}>CHARGE · ACWR</div>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end", marginBottom:14 }}>
                <div>
                  <div style={{ fontSize:42, fontWeight:800, color:acwrStatus.color, lineHeight:1 }}>{acwr.toFixed(2)}</div>
                  <div style={{ fontSize:13, color:acwrStatus.color, fontFamily:"'JetBrains Mono',monospace", marginTop:4 }}>{acwrStatus.label}</div>
                </div>
                <div style={{ textAlign:"right" }}>
                  <div style={{ fontSize:11, color:"#555", fontFamily:"'JetBrains Mono',monospace" }}>Zone optimale</div>
                  <div style={{ fontSize:13, color:"#4ECDC4", fontFamily:"'JetBrains Mono',monospace" }}>0.80 → 1.30</div>
                </div>
              </div>
              <div style={{ height:8, background:"#1C1F27", borderRadius:4, position:"relative" }}>
                <div style={{ position:"absolute", left:"40%", width:"45%", height:8, background:"#4ECDC433", borderRadius:4 }} />
                <div style={{ position:"absolute", left:`${Math.min(acwr/2*100,95)}%`, width:12, height:12, top:-2, borderRadius:"50%", background:acwrStatus.color, transform:"translateX(-50%)", border:"2px solid #080A0E" }} />
              </div>
              <div style={{ marginTop:14, padding:"12px", background:"#080A0E", borderRadius:8, fontSize:11, color:"#888", fontFamily:"'JetBrains Mono',monospace", lineHeight:1.7 }}>
                {acwr>1.3?"⚠ Risque de blessure élevé. Réduis la charge de 20-30%.":acwr>1.15?"△ Charge modérée. Surveille ta récupération.":"✓ Tu es dans la zone optimale. Continue !"}
              </div>
            </div>
            <div className="card" style={{ padding:22, marginBottom:14 }}>
              <div style={{ fontSize:10, color:"#555", letterSpacing:3, fontFamily:"'JetBrains Mono',monospace", marginBottom:16 }}>VOLUME HEBDOMADAIRE</div>
              <VolumeChart weeks={weeklyVol} />
            </div>
            <div className="card" style={{ padding:22, marginBottom:14 }}>
              <div style={{ fontSize:10, color:"#555", letterSpacing:3, fontFamily:"'JetBrains Mono',monospace", marginBottom:6 }}>PROGRESSION ALLURE</div>
              <PaceChart data={paceProgression} />
            </div>
            <div className="card" style={{ padding:22, marginBottom:14 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
                <div style={{ fontSize:10, color:"#555", letterSpacing:3, fontFamily:"'JetBrains Mono',monospace" }}>VARIÉTÉ (4 sem.)</div>
                <span style={{ fontSize:11, color:varietyScore>=4?"#4ECDC4":varietyScore>=3?"#FFE66D":"#FF6B6B", fontFamily:"'JetBrains Mono',monospace" }}>{varietyScore>=4?"EXCELLENTE":varietyScore>=3?"BONNE":"À AMÉLIORER"}</span>
              </div>
              {Object.entries(typeVariety).map(([type, count]) => {
                const tm = TYPE_META[type] || TYPE_META["Endurance"];
                const total = Object.values(typeVariety).reduce((s,v)=>s+v,0);
                return (
                  <div key={type} style={{ marginBottom:10 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4, fontSize:12 }}>
                      <span style={{ color:tm.color }}>{tm.icon} {type}</span>
                      <span style={{ color:"#555", fontFamily:"'JetBrains Mono',monospace" }}>{count} séances</span>
                    </div>
                    <div style={{ height:5, background:"#1C1F27", borderRadius:3 }}>
                      <div style={{ height:5, width:`${count/total*100}%`, background:tm.color, borderRadius:3 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {view === "journal" && (
          <div className="fade-up">
            <div style={{ fontSize:11, color:"#555", letterSpacing:3, fontFamily:"'JetBrains Mono',monospace", marginBottom:14 }}>
              {done.length} SÉANCES · {totalKm.toFixed(0)} KM TOTAL
              {done.filter(d=>d.fromStrava).length > 0 && <span style={{ color:"#FC4C02", marginLeft:8 }}>· {done.filter(d=>d.fromStrava).length} STRAVA</span>}
            </div>
            {[...done].sort((a,b) => b.date.localeCompare(a.date)).map(r => {
              const tm = TYPE_META[r.type] || TYPE_META["Endurance"];
              const linked = planned.find(p => p.id === r.plannedId);
              const score = linked ? scoreSession(linked, r) : null;
              return (
                <div key={r.id} className="card" style={{ padding:"16px 18px", marginBottom:8 }}>
                  <div style={{ display:"flex", gap:12, alignItems:"center" }}>
                    <div style={{ width:44, height:44, borderRadius:10, background:tm.dark, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, flexShrink:0 }}>{tm.icon}</div>
                    <div style={{ flex:1 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:2 }}>
                        <span style={{ fontSize:11, color:"#555", fontFamily:"'JetBrains Mono',monospace" }}>{fmtDate(r.date,{weekday:"long",day:"numeric",month:"long"})}</span>
                        {r.fromStrava && <span style={{ fontSize:9, color:"#FC4C02", fontFamily:"'JetBrains Mono',monospace" }}>STRAVA</span>}
                      </div>
                      <div style={{ fontSize:14, fontWeight:700 }}>{r.type}</div>
                      <div style={{ display:"flex", gap:12, marginTop:4, flexWrap:"wrap" }}>
                        {[`${r.dist} km`,`${r.dur} min`,pace(r.dist,r.dur)+"/km",r.hr?`${r.hr} bpm`:""].filter(Boolean).map(v => (
                          <span key={v} style={{ fontSize:11, color:"#888", fontFamily:"'JetBrains Mono',monospace" }}>{v}</span>
                        ))}
                      </div>
                    </div>
                    <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:4 }}>
                      <span style={{ fontSize:20 }}>{FEELINGS[(r.feeling||3)-1]}</span>
                      {score!==null && <div style={{ fontSize:13, fontWeight:700, color:score>79?"#4ECDC4":score>59?"#FFE66D":"#FF6B6B" }}>{score}/100</div>}
                    </div>
                  </div>
                  {r.notes && <div style={{ marginTop:10, fontSize:11, color:"#666", fontFamily:"'JetBrains Mono',monospace", borderTop:"1px solid #1C1F27", paddingTop:10 }}>💬 {r.notes}</div>}
                  <div style={{ marginTop:10, display:"flex", gap:3, alignItems:"center" }}>
                    <span style={{ fontSize:9, color:"#444", fontFamily:"'JetBrains Mono',monospace", marginRight:4 }}>RPE</span>
                    {Array.from({length:10}).map((_,i) => <div key={i} style={{ flex:1, height:6, borderRadius:1, background:i<(r.rpe||5)?tm.color:"#1C1F27" }} />)}
                    <span style={{ fontSize:9, color:"#444", fontFamily:"'JetBrains Mono',monospace", marginLeft:4 }}>{r.rpe||"?"}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)", width:480, maxWidth:"100vw", background:"#0F1117", borderTop:"1px solid #1C1F27", display:"flex", zIndex:50 }}>
        {[["today","⊙","AUJOURD'HUI"],["plan","◫","PLAN"],["analyse","◈","ANALYSE"],["journal","≡","JOURNAL"]].map(([v,ico,lbl]) => (
          <button key={v} className="nav-tab" onClick={() => setView(v)} style={{ flex:1, padding:"12px 0 8px", color:view===v?"#E8E4DC":"#444", background:"transparent", display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
            <span style={{ fontSize:18 }}>{ico}</span>
            <span style={{ fontSize:9, letterSpacing:1.5, fontFamily:"'JetBrains Mono',monospace" }}>{lbl}</span>
          </button>
        ))}
      </div>

      {modal && (
        <div onClick={() => setModal(null)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.85)", zIndex:200, display:"flex", alignItems:"flex-end", justifyContent:"center", backdropFilter:"blur(6px)" }}>
          <div onClick={e => e.stopPropagation()} className="pop" style={{ background:"#0F1117", border:"1px solid #1C1F27", borderRadius:"20px 20px 0 0", padding:28, width:"100%", maxWidth:480, maxHeight:"85vh", overflowY:"auto" }}>
            {modal.type === "plan" && (<>
              <div style={{ fontSize:22, fontWeight:800, marginBottom:24 }}>Planifier une séance</div>
              <FormGrid>
                <Field label="DATE"><input type="date" className="inp" value={planForm.date} onChange={e=>setPlanForm({...planForm,date:e.target.value})} /></Field>
                <Field label="TYPE"><select className="inp" value={planForm.type} onChange={e=>setPlanForm({...planForm,type:e.target.value})}>{Object.keys(TYPE_META).map(t=><option key={t}>{t}</option>)}</select></Field>
                <Field label="DISTANCE CIBLE (km)"><input type="number" className="inp" placeholder="10" value={planForm.targetDist} onChange={e=>setPlanForm({...planForm,targetDist:e.target.value})} /></Field>
                <Field label="DURÉE CIBLE (min)"><input type="number" className="inp" placeholder="65" value={planForm.targetDur} onChange={e=>setPlanForm({...planForm,targetDur:e.target.value})} /></Field>
                <Field label="FC CIBLE (bpm)"><input type="number" className="inp" placeholder="145" value={planForm.targetHR} onChange={e=>setPlanForm({...planForm,targetHR:e.target.value})} /></Field>
                <Field label="NOTES" full><textarea className="inp" rows={3} placeholder="Description..." value={planForm.notes} onChange={e=>setPlanForm({...planForm,notes:e.target.value})} style={{resize:"none"}} /></Field>
              </FormGrid>
              <div style={{ display:"flex", gap:10, marginTop:24 }}>
                <button className="btn-ghost" onClick={() => setModal(null)} style={{ flex:1, borderRadius:12, padding:14, fontFamily:"'JetBrains Mono',monospace", fontSize:12 }}>ANNULER</button>
                <button className="btn-primary" onClick={addPlanned} style={{ flex:2, background:"#E8E4DC", color:"#080A0E", borderRadius:12, padding:14, fontSize:13, fontWeight:700 }}>ENREGISTRER</button>
              </div>
            </>)}
            {modal.type === "log" && (<>
              <div style={{ fontSize:22, fontWeight:800, marginBottom:24 }}>Enregistrer une séance</div>
              <FormGrid>
                <Field label="DATE"><input type="date" className="inp" value={logForm.date} onChange={e=>setLogForm({...logForm,date:e.target.value})} /></Field>
                <Field label="TYPE"><select className="inp" value={logForm.type} onChange={e=>setLogForm({...logForm,type:e.target.value})}>{Object.keys(TYPE_META).map(t=><option key={t}>{t}</option>)}</select></Field>
                <Field label="DISTANCE (km)"><input type="number" className="inp" placeholder="10.5" value={logForm.dist} onChange={e=>setLogForm({...logForm,dist:e.target.value})} /></Field>
                <Field label="DURÉE (min)"><input type="number" className="inp" placeholder="68" value={logForm.dur} onChange={e=>setLogForm({...logForm,dur:e.target.value})} /></Field>
                <Field label="FC MOY (bpm)"><input type="number" className="inp" placeholder="145" value={logForm.hr} onChange={e=>setLogForm({...logForm,hr:e.target.value})} /></Field>
                <Field label={`RPE · ${logForm.rpe}/10`} full>
                  <input type="range" min="1" max="10" value={logForm.rpe} onChange={e=>setLogForm({...logForm,rpe:e.target.value})} style={{ width:"100%", accentColor:"#FFE66D" }} />
                  <div style={{ display:"flex", justifyContent:"space-between", fontSize:9, color:"#444", fontFamily:"'JetBrains Mono',monospace", marginTop:4 }}><span>LÉGER</span><span>MODÉRÉ</span><span>MAX</span></div>
                </Field>
                <Field label="RESSENTI" full>
                  <div style={{ display:"flex", gap:8, justifyContent:"center" }}>
                    {FEELINGS.map((f,i) => <button key={i} onClick={()=>setLogForm({...logForm,feeling:String(i+1)})} style={{ fontSize:28, background:"transparent", border:`2px solid ${+logForm.feeling===i+1?"#FFE66D":"transparent"}`, borderRadius:10, padding:"4px 8px", cursor:"pointer", transition:"all .2s" }}>{f}</button>)}
                  </div>
                </Field>
                <Field label="NOTES" full><textarea className="inp" rows={2} placeholder="Ressenti, conditions..." value={logForm.notes} onChange={e=>setLogForm({...logForm,notes:e.target.value})} style={{resize:"none"}} /></Field>
              </FormGrid>
              <div style={{ display:"flex", gap:10, marginTop:24 }}>
                <button className="btn-ghost" onClick={() => setModal(null)} style={{ flex:1, borderRadius:12, padding:14, fontFamily:"'JetBrains Mono',monospace", fontSize:12 }}>ANNULER</button>
                <button className="btn-primary" onClick={submitLog} style={{ flex:2, background:"#4ECDC4", color:"#080A0E", borderRadius:12, padding:14, fontSize:13, fontWeight:700 }}>ENREGISTRER ✓</button>
              </div>
            </>)}
          </div>
        </div>
      )}
    </div>
  );
}

function CompareBar({ planned, done }) {
  const items = [
    { label:"Distance", target:planned.targetDist, actual:done.dist, unit:"km" },
    { label:"Durée", target:planned.targetDur, actual:done.dur, unit:"min" },
    ...(planned.targetHR && done.hr ? [{ label:"FC", target:planned.targetHR, actual:done.hr, unit:"bpm" }] : []),
  ];
  return (
    <div style={{ marginTop:14, display:"flex", flexDirection:"column", gap:8 }}>
      {items.map(({ label, target, actual, unit }) => {
        const diff = ((actual-target)/target*100).toFixed(0);
        const ok = Math.abs(actual-target)/target < 0.1;
        return (
          <div key={label}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3, fontSize:11, fontFamily:"'JetBrains Mono',monospace" }}>
              <span style={{ color:"#555" }}>{label}</span>
              <span><span style={{ color:"#aaa" }}>{actual}{unit}</span><span style={{ color:"#444" }}> / {target}{unit}</span><span style={{ color:ok?"#4ECDC4":Math.abs(+diff)<20?"#FFE66D":"#FF6B6B", marginLeft:6 }}>{+diff>0?"+":""}{diff}%</span></span>
            </div>
            <div style={{ height:4, background:"#1C1F27", borderRadius:2 }}>
              <div style={{ height:4, width:`${Math.min(Math.abs(actual/target)*100,100)}%`, background:ok?"#4ECDC4":Math.abs(+diff)<20?"#FFE66D":"#FF6B6B", borderRadius:2 }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function VolumeChart({ weeks }) {
  if (!weeks.length) return null;
  const max = Math.max(...weeks.map(w => w.dist), 1);
  return (
    <div style={{ display:"flex", gap:6, alignItems:"flex-end", height:100 }}>
      {[...weeks].reverse().map((w, i) => {
        const h = Math.max((w.dist/max)*80, 4);
        const isLatest = i === weeks.length-1;
        return (
          <div key={w.wk} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
            <div style={{ fontSize:9, color:isLatest?"#E8E4DC":"#555", fontFamily:"'JetBrains Mono',monospace" }}>{w.dist.toFixed(0)}</div>
            <div style={{ width:"100%", height:h, background:isLatest?"#FFE66D":"#1C1F27", borderRadius:"3px 3px 0 0" }} />
            <div style={{ fontSize:8, color:"#333", fontFamily:"'JetBrains Mono',monospace" }}>{new Date(w.wk).toLocaleDateString("fr",{day:"numeric",month:"numeric"})}</div>
          </div>
        );
      })}
    </div>
  );
}

function PaceChart({ data }) {
  if (data.length < 2) return <div style={{ fontSize:11, color:"#555", fontFamily:"'JetBrains Mono',monospace", padding:"20px 0", textAlign:"center" }}>Pas assez de données</div>;
  const max = Math.max(...data.map(d=>d.pace));
  const min = Math.min(...data.map(d=>d.pace));
  const w = 400; const h = 80; const pad = 10;
  const pts = data.map((d,i) => { const x = pad+i/(data.length-1)*(w-2*pad); const y = pad+(1-(d.pace-min)/(max-min||1))*(h-2*pad); return `${x},${y}`; }).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width:"100%", height:h }}>
      <defs><linearGradient id="pg" x1="0" x2="1" y1="0" y2="0"><stop offset="0%" stopColor="#FF6B6B"/><stop offset="100%" stopColor="#4ECDC4"/></linearGradient></defs>
      <polyline points={pts} fill="none" stroke="url(#pg)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/>
      {data.map((d,i) => { const x = pad+i/(data.length-1)*(w-2*pad); const y = pad+(1-(d.pace-min)/(max-min||1))*(h-2*pad); return <circle key={i} cx={x} cy={y} r={3} fill={i===data.length-1?"#4ECDC4":"#1C1F27"} stroke={i===data.length-1?"#4ECDC4":"#555"} strokeWidth={1.5}/>; })}
    </svg>
  );
}

function FormGrid({ children }) { return <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>{children}</div>; }
function Field({ label, children, full }) {
  return (
    <div style={{ gridColumn:full?"span 2":"span 1" }}>
      <div style={{ fontSize:9, color:"#555", letterSpacing:2, fontFamily:"'JetBrains Mono',monospace", marginBottom:6 }}>{label}</div>
      {children}
    </div>
  );
}
