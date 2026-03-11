import { useState, useMemo, useEffect } from "react";

/* ─── STORAGE ─── */
const STORE = {
  get: (k, def) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

/* ─── SEED DATA ─── */
const SEED_PLANNED = [
  { id: "p1", date: "2026-03-09", type: "Récupération", targetDist: 5, targetDur: 35, targetHR: 130, notes: "Footing très léger, respiration nasale" },
  { id: "p2", date: "2026-03-11", type: "Endurance", targetDist: 10, targetDur: 65, targetHR: 145, notes: "Allure confortable, peut tenir une conversation" },
  { id: "p3", date: "2026-03-13", type: "Fractionné", targetDist: 8, targetDur: 52, targetHR: 168, notes: "6×800m rec 90s, allure 5K" },
  { id: "p4", date: "2026-03-15", type: "Sortie longue", targetDist: 20, targetDur: 130, targetHR: 148, notes: "Long run progressif, finir fort les 5 derniers km" },
  { id: "p5", date: "2026-03-18", type: "Endurance", targetDist: 9, targetDur: 60, targetHR: 143, notes: "Endurance fondamentale" },
  { id: "p6", date: "2026-03-20", type: "Tempo", targetDist: 10, targetDur: 55, targetHR: 160, notes: "3km échauffement + 5km tempo + 2km retour" },
  { id: "p7", date: "2026-03-22", type: "Récupération", targetDist: 5, targetDur: 34, targetHR: 128, notes: "Récup active" },
  { id: "p8", date: "2026-03-22", type: "Sortie longue", targetDist: 22, targetDur: 145, targetHR: 150, notes: "Plus longue sortie du cycle" },
];

const SEED_DONE = [
  { id: "d1", plannedId: null, date: "2026-03-02", type: "Endurance", dist: 10.5, dur: 68, hr: 142, rpe: 6, notes: "Bonne sortie matinale", feeling: 4 },
  { id: "d2", plannedId: null, date: "2026-03-04", type: "Fractionné", dist: 7.2, dur: 48, hr: 165, rpe: 8, notes: "8×400m récup 90s", feeling: 3 },
  { id: "d3", plannedId: null, date: "2026-03-06", type: "Récupération", dist: 5.0, dur: 38, hr: 128, rpe: 4, notes: "Footing léger", feeling: 5 },
  { id: "d4", plannedId: "p1", date: "2026-03-09", type: "Récupération", dist: 4.8, dur: 36, hr: 131, rpe: 3, notes: "Un peu court mais bien", feeling: 5 },
  { id: "d5", plannedId: null, date: "2026-02-23", type: "Endurance", dist: 9.8, dur: 64, hr: 140, rpe: 6, notes: "", feeling: 4 },
  { id: "d6", plannedId: null, date: "2026-02-25", type: "Fractionné", dist: 6.5, dur: 44, hr: 168, rpe: 8, notes: "6×800m", feeling: 3 },
  { id: "d7", plannedId: null, date: "2026-02-27", type: "Récupération", dist: 4.5, dur: 34, hr: 125, rpe: 3, notes: "", feeling: 4 },
  { id: "d8", plannedId: null, date: "2026-03-01", type: "Sortie longue", dist: 16.0, dur: 108, hr: 143, rpe: 7, notes: "", feeling: 4 },
];

/* ─── CONSTANTS ─── */
const MARATHON = new Date("2026-10-25");
const TODAY = new Date("2026-03-11");
const DAYS_LEFT = Math.ceil((MARATHON - TODAY) / 86400000);
const WEEKS_LEFT = Math.floor(DAYS_LEFT / 7);

const TYPE_META = {
  "Récupération": { color: "#4ECDC4", dark: "#0d2b2a", icon: "○", desc: "Allure très légère" },
  "Endurance":    { color: "#FFE66D", dark: "#2b2700", icon: "◈", desc: "Allure fondamentale" },
  "Fractionné":   { color: "#FF6B6B", dark: "#2b0d0d", icon: "▲▲", desc: "Intervalles intenses" },
  "Sortie longue":{ color: "#C77DFF", dark: "#1e0d2b", icon: "◈◈◈", desc: "Distance maximale" },
  "Tempo":        { color: "#FF9F43", dark: "#2b1a00", icon: "◇", desc: "Allure seuil" },
};

const FEELINGS = ["😣","😕","😐","🙂","😄"];

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

/* ─── SCORE COMPARISON ─── */
function scoreSession(planned, done) {
  if (!planned || !done) return null;
  const distScore = Math.max(0, 100 - Math.abs(done.dist - planned.targetDist) / planned.targetDist * 100);
  const durScore  = Math.max(0, 100 - Math.abs(done.dur - planned.targetDur) / planned.targetDur * 100);
  const hrScore   = planned.targetHR && done.hr
    ? Math.max(0, 100 - Math.abs(done.hr - planned.targetHR) / planned.targetHR * 100)
    : 100;
  return Math.round((distScore * 0.4 + durScore * 0.3 + hrScore * 0.3));
}

/* ─── MAIN APP ─── */
export default function App() {
  const [planned, setPlanned] = useState(() => STORE.get("planned", SEED_PLANNED));
  const [done,    setDone]    = useState(() => STORE.get("done",    SEED_DONE));
  const [view,    setView]    = useState("today");
  const [modal,   setModal]   = useState(null); // { type: "plan"|"log"|"compare", data }

  useEffect(() => { STORE.set("planned", planned); }, [planned]);
  useEffect(() => { STORE.set("done", done); }, [done]);

  /* derived */
  const todayStr = TODAY.toISOString().slice(0,10);
  const todayPlanned = planned.filter(p => p.date === todayStr);
  const todayDone    = done.filter(d => d.date === todayStr);
  const upcoming     = planned.filter(p => isFuture(p.date)).sort((a,b) => a.date.localeCompare(b.date));
  const recentDone   = [...done].sort((a,b) => b.date.localeCompare(a.date));

  const weeklyVol = useMemo(() => {
    const weeks = {};
    done.forEach(r => {
      const wk = wkKey(r.date);
      if (!weeks[wk]) weeks[wk] = { dist:0, dur:0, runs:[], rpe:[] };
      weeks[wk].dist += r.dist; weeks[wk].dur += r.dur;
      weeks[wk].runs.push(r); weeks[wk].rpe.push(r.rpe);
    });
    return Object.entries(weeks).sort(([a],[b]) => b.localeCompare(a)).slice(0,8)
      .map(([wk, d]) => ({ wk, ...d, load: d.dist * (d.rpe.reduce((s,v)=>s+v,0)/d.rpe.length) }));
  }, [done]);

  const curWeek  = weeklyVol[0] || { dist:0, dur:0, runs:[], load:0 };
  const prevWeek = weeklyVol[1] || { dist:0, dur:0, runs:[], load:0 };
  const acwr     = prevWeek.load ? (curWeek.load / prevWeek.load) : 1;
  const totalKm  = done.reduce((s,r) => s + r.dist, 0);

  const typeVariety = useMemo(() => {
    const last4wk = done.filter(r => {
      const d = new Date(r.date); const cutoff = new Date(TODAY); cutoff.setDate(cutoff.getDate()-28);
      return d >= cutoff;
    });
    const counts = {};
    last4wk.forEach(r => { counts[r.type] = (counts[r.type]||0) + 1; });
    return counts;
  }, [done]);

  const paceProgression = useMemo(() => {
    return [...done].filter(r => r.type === "Endurance" && r.dist > 5)
      .sort((a,b) => a.date.localeCompare(b.date))
      .map(r => ({ date: r.date, pace: (r.dur * 60) / r.dist }));
  }, [done]);

  /* ─── FORMS STATE ─── */
  const [planForm, setPlanForm] = useState({ date: todayStr, type:"Endurance", targetDist:"", targetDur:"", targetHR:"", notes:"" });
  const [logForm,  setLogForm]  = useState({ date:todayStr, plannedId:"", type:"Endurance", dist:"", dur:"", hr:"", rpe:"6", feeling:"3", notes:"" });

  function addPlanned() {
    const p = { id:"p"+Date.now(), ...planForm, targetDist:+planForm.targetDist, targetDur:+planForm.targetDur, targetHR:planForm.targetHR?+planForm.targetHR:null };
    setPlanned(prev => [...prev, p]);
    setModal(null);
  }

  function logSession(prefill = null) {
    const base = prefill
      ? { date: prefill.date, plannedId: prefill.id, type: prefill.type, dist: String(prefill.targetDist), dur: String(prefill.targetDur), hr: prefill.targetHR ? String(prefill.targetHR) : "", rpe:"6", feeling:"3", notes:"" }
      : { date: todayStr, plannedId:"", type:"Endurance", dist:"", dur:"", hr:"", rpe:"6", feeling:"3", notes:"" };
    setLogForm(base);
    setModal({ type:"log" });
  }

  function submitLog() {
    const r = { id:"d"+Date.now(), ...logForm, dist:+logForm.dist, dur:+logForm.dur, hr:logForm.hr?+logForm.hr:null, rpe:+logForm.rpe, feeling:+logForm.feeling };
    setDone(prev => [...prev, r]);
    setModal(null);
  }

  /* ─── STYLES ─── */
  const css = `
    @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=JetBrains+Mono:wght@300;400;500&display=swap');
    *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }
    body { background:#080A0E; }
    ::-webkit-scrollbar { width:3px; } ::-webkit-scrollbar-thumb { background:#222; }
    .card { background:#0F1117; border:1px solid #1C1F27; border-radius:14px; }
    .card-hover { transition:all .2s; cursor:pointer; }
    .card-hover:hover { background:#141720 !important; border-color:#2a2d38 !important; transform:translateY(-1px); }
    .nav-tab { transition:all .2s; border:none; cursor:pointer; font-family:inherit; }
    .nav-tab:hover { color:#fff !important; }
    .btn-primary { transition:all .2s; border:none; cursor:pointer; font-family:inherit; }
    .btn-primary:hover { opacity:.85; transform:scale(.98); }
    .btn-ghost { transition:all .2s; background:transparent; border:1px solid #222; cursor:pointer; font-family:inherit; color:#888; }
    .btn-ghost:hover { border-color:#444; color:#ccc; }
    .inp { background:#080A0E; border:1px solid #1C1F27; color:#E8E4DC; border-radius:8px; padding:10px 12px; font-size:13px; font-family:'JetBrains Mono',monospace; width:100%; outline:none; transition:border .2s; }
    .inp:focus { border-color:#444; }
    @keyframes fadeUp { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
    .fade-up { animation:fadeUp .35s ease forwards; }
    @keyframes pop { 0%{transform:scale(.95);opacity:0} 100%{transform:scale(1);opacity:1} }
    .pop { animation:pop .2s ease forwards; }
    .pill { display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:20px;font-size:11px;font-family:'JetBrains Mono',monospace; }
    .score-ring { transition:stroke-dashoffset 1s ease; }
    select option { background:#0F1117; }
  `;

  const acwrStatus = acwr > 1.3 ? { label:"RISQUE ÉLEVÉ", color:"#FF6B6B" }
    : acwr > 1.15 ? { label:"CHARGE MODÉRÉE", color:"#FF9F43" }
    : { label:"OPTIMAL", color:"#4ECDC4" };

  const varietyScore = Object.keys(typeVariety).length;
  const varietyStatus = varietyScore >= 4 ? { label:"EXCELLENTE", color:"#4ECDC4" }
    : varietyScore >= 3 ? { label:"BONNE", color:"#FFE66D" }
    : { label:"À AMÉLIORER", color:"#FF6B6B" };

  /* ─── RENDER ─── */
  return (
    <div style={{ minHeight:"100vh", background:"#080A0E", fontFamily:"'Syne',sans-serif", color:"#E8E4DC", maxWidth:480, margin:"0 auto", paddingBottom:80 }}>
      <style>{css}</style>

      {/* TOP BAR */}
      <div style={{ padding:"20px 20px 0", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div>
          <div style={{ fontSize:11, color:"#555", letterSpacing:3, fontFamily:"'JetBrains Mono',monospace" }}>MARATHON · OCT 2026</div>
          <div style={{ fontSize:28, fontWeight:800, letterSpacing:-1, marginTop:2 }}>
            {DAYS_LEFT}<span style={{ fontSize:14, color:"#555", fontWeight:400, marginLeft:4 }}>jours</span>
            {" · "}{WEEKS_LEFT}<span style={{ fontSize:14, color:"#555", fontWeight:400, marginLeft:4 }}>sem.</span>
          </div>
        </div>
        <div style={{ display:"flex", gap:8 }}>
          <button className="btn-ghost" onClick={() => setModal({type:"plan"})}
            style={{ borderRadius:10, padding:"8px 14px", fontSize:12, fontFamily:"'JetBrains Mono',monospace" }}>+ PLANIFIER</button>
          <button className="btn-primary" onClick={() => logSession()}
            style={{ background:"#E8E4DC", color:"#080A0E", borderRadius:10, padding:"8px 14px", fontSize:12, fontWeight:700, fontFamily:"'JetBrains Mono',monospace" }}>+ LOG</button>
        </div>
      </div>

      {/* PROGRESS BAR */}
      <div style={{ padding:"12px 20px 0" }}>
        <div style={{ height:3, background:"#1C1F27", borderRadius:2 }}>
          <div style={{ height:3, width:`${Math.round((32-WEEKS_LEFT)/32*100)}%`, background:"linear-gradient(90deg,#4ECDC4,#FFE66D)", borderRadius:2 }} />
        </div>
      </div>

      {/* NAV */}
      <div style={{ display:"flex", gap:4, padding:"16px 20px 0" }}>
        {[["today","AUJOURD'HUI"],["plan","PLAN"],["analyse","ANALYSE"],["journal","JOURNAL"]].map(([v,l]) => (
          <button key={v} className="nav-tab" onClick={() => setView(v)}
            style={{ flex:1, background: view===v ? "#1C1F27" : "transparent", color: view===v ? "#E8E4DC" : "#555",
              borderRadius:8, padding:"8px 0", fontSize:10, letterSpacing:1.5, fontFamily:"'JetBrains Mono',monospace" }}>
            {l}
          </button>
        ))}
      </div>

      <div style={{ padding:"20px 20px 0" }}>

        {/* ─── TODAY ─── */}
        {view === "today" && (
          <div className="fade-up">
            {/* Today's sessions */}
            {todayPlanned.length === 0 && todayDone.length === 0 && (
              <div className="card" style={{ padding:28, textAlign:"center" }}>
                <div style={{ fontSize:40, marginBottom:12 }}>🏃</div>
                <div style={{ fontSize:14, color:"#555", fontFamily:"'JetBrains Mono',monospace" }}>Rien de planifié aujourd'hui</div>
                <button className="btn-primary" onClick={() => setModal({type:"plan"})}
                  style={{ marginTop:16, background:"#E8E4DC", color:"#080A0E", borderRadius:10, padding:"10px 20px", fontSize:12, fontWeight:700 }}>
                  Planifier une séance
                </button>
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
                      <div style={{ fontSize:12, color:"#555", fontFamily:"'JetBrains Mono',monospace", marginTop:2 }}>
                        ~{p.targetDur} min · {p.targetHR ? `FC cible ${p.targetHR} bpm` : "FC libre"}
                      </div>
                    </div>
                    {score !== null && (
                      <div style={{ textAlign:"center" }}>
                        <svg width={56} height={56} viewBox="0 0 56 56">
                          <circle cx={28} cy={28} r={22} fill="none" stroke="#1C1F27" strokeWidth={4}/>
                          <circle cx={28} cy={28} r={22} fill="none" stroke={score>79?"#4ECDC4":score>59?"#FFE66D":"#FF6B6B"}
                            strokeWidth={4} strokeLinecap="round" strokeDasharray={138.2}
                            strokeDashoffset={138.2*(1-score/100)} transform="rotate(-90 28 28)" className="score-ring"/>
                          <text x={28} y={32} textAnchor="middle" fill="#E8E4DC" fontSize={13} fontWeight={700} fontFamily="Syne">{score}</text>
                        </svg>
                        <div style={{ fontSize:9, color:"#555", fontFamily:"'JetBrains Mono',monospace" }}>SCORE</div>
                      </div>
                    )}
                  </div>
                  {p.notes && <div style={{ fontSize:12, color:"#888", fontFamily:"'JetBrains Mono',monospace", marginBottom:14, padding:"10px 12px", background:"#080A0E", borderRadius:8 }}>{p.notes}</div>}
                  {!linked
                    ? <button className="btn-primary" onClick={() => logSession(p)}
                        style={{ background:tm.color, color:"#080A0E", borderRadius:10, padding:"10px 0", fontSize:12, fontWeight:700, width:"100%" }}>
                        ✓ ENREGISTRER LA SÉANCE
                      </button>
                    : <div>
                        <div style={{ display:"flex", gap:12, marginBottom:10 }}>
                          {[["DIST",`${linked.dist} km`,p.targetDist===linked.dist],["DURÉE",`${linked.dur} min`,null],["ALLURE",pace(linked.dist,linked.dur),null]].map(([lbl,val]) => (
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

            {/* Next upcoming */}
            {upcoming.slice(0,3).length > 0 && (
              <div style={{ marginTop:8 }}>
                <div style={{ fontSize:10, color:"#555", letterSpacing:3, fontFamily:"'JetBrains Mono',monospace", marginBottom:10 }}>PROCHAINES SÉANCES</div>
                {upcoming.slice(0,3).map(p => {
                  const tm = TYPE_META[p.type] || TYPE_META["Endurance"];
                  return (
                    <div key={p.id} className="card card-hover" style={{ padding:"14px 16px", marginBottom:8, display:"flex", alignItems:"center", gap:14 }}
                      onClick={() => setModal({type:"plan_detail", data:p})}>
                      <div style={{ width:40, height:40, borderRadius:10, background:tm.dark, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, flexShrink:0 }}>{tm.icon}</div>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:11, color:"#555", fontFamily:"'JetBrains Mono',monospace" }}>{fmtDate(p.date)}</div>
                        <div style={{ fontSize:14, fontWeight:700, marginTop:2 }}>{p.type} · {p.targetDist} km</div>
                      </div>
                      <div style={{ fontSize:11, color:tm.color, fontFamily:"'JetBrains Mono',monospace" }}>
                        {Math.ceil((new Date(p.date)-TODAY)/86400000)}j →
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Quick stats */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginTop:16 }}>
              <div className="card" style={{ padding:16 }}>
                <div style={{ fontSize:9, color:"#555", letterSpacing:2, fontFamily:"'JetBrains Mono',monospace", marginBottom:8 }}>SEMAINE EN COURS</div>
                <div style={{ fontSize:28, fontWeight:800 }}>{curWeek.dist.toFixed(1)}<span style={{ fontSize:13, color:"#555", fontWeight:400 }}>km</span></div>
                <div style={{ fontSize:11, color: curWeek.dist > prevWeek.dist ? "#4ECDC4" : "#FF6B6B", fontFamily:"'JetBrains Mono',monospace", marginTop:4 }}>
                  {curWeek.dist > prevWeek.dist ? "▲" : "▼"} {Math.abs(curWeek.dist - prevWeek.dist).toFixed(1)} vs S-1
                </div>
              </div>
              <div className="card" style={{ padding:16, borderColor: acwr>1.3?"#FF6B6B33":acwr>1.15?"#FF9F4333":"#1C1F27" }}>
                <div style={{ fontSize:9, color:"#555", letterSpacing:2, fontFamily:"'JetBrains Mono',monospace", marginBottom:8 }}>RISQUE BLESSURE</div>
                <div style={{ fontSize:16, fontWeight:800, color:acwrStatus.color }}>{acwrStatus.label}</div>
                <div style={{ fontSize:10, color:"#555", fontFamily:"'JetBrains Mono',monospace", marginTop:4 }}>ACWR {acwr.toFixed(2)}</div>
              </div>
            </div>
          </div>
        )}

        {/* ─── PLAN ─── */}
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
              const past = isPast(p.date);
              const today = isToday(p.date);
              return (
                <div key={p.id} className="card" style={{ padding:"16px 18px", marginBottom:8, opacity: past && !linked ? 0.5 : 1,
                  borderLeft:`3px solid ${today ? tm.color : linked ? "#4ECDC4" : "#1C1F27"}` }}>
                  <div style={{ display:"flex", gap:12, alignItems:"center" }}>
                    <div style={{ width:44, height:44, borderRadius:10, background:tm.dark, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}>{tm.icon}</div>
                    <div style={{ flex:1 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:3 }}>
                        <span style={{ fontSize:11, color:today?"#FFE66D":past?"#555":"#aaa", fontFamily:"'JetBrains Mono',monospace" }}>
                          {today ? "AUJOURD'HUI" : fmtDate(p.date, { weekday:"short", day:"numeric", month:"short" })}
                        </span>
                        {linked && <span style={{ fontSize:9, color:"#4ECDC4", fontFamily:"'JetBrains Mono',monospace" }}>✓ FAIT</span>}
                      </div>
                      <div style={{ fontSize:15, fontWeight:700 }}>{p.type} · {p.targetDist} km</div>
                      <div style={{ fontSize:11, color:"#555", fontFamily:"'JetBrains Mono',monospace" }}>~{p.targetDur} min{p.targetHR ? ` · FC ${p.targetHR}` : ""}</div>
                    </div>
                    {score !== null
                      ? <div style={{ textAlign:"center" }}>
                          <div style={{ fontSize:22, fontWeight:800, color:score>79?"#4ECDC4":score>59?"#FFE66D":"#FF6B6B" }}>{score}</div>
                          <div style={{ fontSize:9, color:"#555", fontFamily:"'JetBrains Mono',monospace" }}>SCORE</div>
                        </div>
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

        {/* ─── ANALYSE ─── */}
        {view === "analyse" && (
          <div className="fade-up">
            {/* ACWR Card */}
            <div className="card" style={{ padding:22, marginBottom:14, borderColor: acwr>1.3?"#FF6B6B44":"#1C1F27" }}>
              <div style={{ fontSize:10, color:"#555", letterSpacing:3, fontFamily:"'JetBrains Mono',monospace", marginBottom:16 }}>CHARGE · ACWR (ratio acute/chronic)</div>
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
                <div style={{ position:"absolute", left:`${Math.min(acwr/2*100, 95)}%`, width:12, height:12, top:-2, borderRadius:"50%", background:acwrStatus.color, transform:"translateX(-50%)", border:"2px solid #080A0E" }} />
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:9, color:"#444", fontFamily:"'JetBrains Mono',monospace", marginTop:6 }}>
                <span>0</span><span>SOUS-CHARGÉ</span><span>OPTIMAL</span><span>SURCHARGE</span><span>2.0</span>
              </div>
              <div style={{ marginTop:14, padding:"12px", background:"#080A0E", borderRadius:8, fontSize:11, color:"#888", fontFamily:"'JetBrains Mono',monospace", lineHeight:1.7 }}>
                {acwr > 1.3 ? "⚠ Risque de blessure élevé. Réduis la charge cette semaine de 20-30%."
                  : acwr > 1.15 ? "△ Charge modérée. Surveille ta récupération."
                  : "✓ Tu es dans la zone optimale. Continue comme ça."}
              </div>
            </div>

            {/* Volume chart */}
            <div className="card" style={{ padding:22, marginBottom:14 }}>
              <div style={{ fontSize:10, color:"#555", letterSpacing:3, fontFamily:"'JetBrains Mono',monospace", marginBottom:16 }}>VOLUME HEBDOMADAIRE</div>
              <VolumeChart weeks={weeklyVol} />
            </div>

            {/* Pace progression */}
            <div className="card" style={{ padding:22, marginBottom:14 }}>
              <div style={{ fontSize:10, color:"#555", letterSpacing:3, fontFamily:"'JetBrains Mono',monospace", marginBottom:6 }}>PROGRESSION ALLURE (endurance)</div>
              {paceProgression.length > 1 && (
                <div style={{ fontSize:11, color:"#4ECDC4", fontFamily:"'JetBrains Mono',monospace", marginBottom:14 }}>
                  {paceProgression[0].pace > paceProgression[paceProgression.length-1].pace
                    ? `▲ +${((paceProgression[0].pace - paceProgression[paceProgression.length-1].pace)/paceProgression[0].pace*100).toFixed(1)}% d'amélioration`
                    : "↔ Allure stable"}
                </div>
              )}
              <PaceChart data={paceProgression} />
            </div>

            {/* Variety */}
            <div className="card" style={{ padding:22, marginBottom:14 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
                <div style={{ fontSize:10, color:"#555", letterSpacing:3, fontFamily:"'JetBrains Mono',monospace" }}>VARIÉTÉ (4 dernières semaines)</div>
                <span style={{ fontSize:11, color:varietyStatus.color, fontFamily:"'JetBrains Mono',monospace" }}>{varietyStatus.label}</span>
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
              {varietyScore < 3 && (
                <div style={{ marginTop:12, padding:"10px 12px", background:"#2b1a0033", border:"1px solid #FF9F4333", borderRadius:8, fontSize:11, color:"#FF9F43", fontFamily:"'JetBrains Mono',monospace" }}>
                  💡 Ajoute du {Object.keys(TYPE_META).find(t => !typeVariety[t])} pour diversifier ton entraînement
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─── JOURNAL ─── */}
        {view === "journal" && (
          <div className="fade-up">
            <div style={{ fontSize:11, color:"#555", letterSpacing:3, fontFamily:"'JetBrains Mono',monospace", marginBottom:14 }}>
              {done.length} SÉANCES · {totalKm.toFixed(0)} KM TOTAL
            </div>
            {recentDone.map(r => {
              const tm = TYPE_META[r.type] || TYPE_META["Endurance"];
              const linked = planned.find(p => p.id === r.plannedId);
              const score = linked ? scoreSession(linked, r) : null;
              return (
                <div key={r.id} className="card" style={{ padding:"16px 18px", marginBottom:8 }}>
                  <div style={{ display:"flex", gap:12, alignItems:"center" }}>
                    <div style={{ width:44, height:44, borderRadius:10, background:tm.dark, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, flexShrink:0 }}>{tm.icon}</div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:11, color:"#555", fontFamily:"'JetBrains Mono',monospace", marginBottom:2 }}>{fmtDate(r.date, { weekday:"long", day:"numeric", month:"long" })}</div>
                      <div style={{ fontSize:14, fontWeight:700 }}>{r.type}</div>
                      <div style={{ display:"flex", gap:12, marginTop:4 }}>
                        {[`${r.dist} km`, `${r.dur} min`, pace(r.dist, r.dur)+"/km", r.hr?`${r.hr} bpm`:""].filter(Boolean).map(v => (
                          <span key={v} style={{ fontSize:11, color:"#888", fontFamily:"'JetBrains Mono',monospace" }}>{v}</span>
                        ))}
                      </div>
                    </div>
                    <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:4 }}>
                      <span style={{ fontSize:20 }}>{FEELINGS[r.feeling-1]}</span>
                      {score !== null && <div style={{ fontSize:13, fontWeight:700, color:score>79?"#4ECDC4":score>59?"#FFE66D":"#FF6B6B" }}>{score}/100</div>}
                    </div>
                  </div>
                  {r.notes && <div style={{ marginTop:10, fontSize:11, color:"#666", fontFamily:"'JetBrains Mono',monospace", borderTop:"1px solid #1C1F27", paddingTop:10 }}>💬 {r.notes}</div>}
                  {/* RPE bar */}
                  <div style={{ marginTop:10, display:"flex", gap:3, alignItems:"center" }}>
                    <span style={{ fontSize:9, color:"#444", fontFamily:"'JetBrains Mono',monospace", marginRight:4 }}>RPE</span>
                    {Array.from({length:10}).map((_,i) => (
                      <div key={i} style={{ flex:1, height:6, borderRadius:1, background: i<r.rpe ? tm.color : "#1C1F27" }} />
                    ))}
                    <span style={{ fontSize:9, color:"#444", fontFamily:"'JetBrains Mono',monospace", marginLeft:4 }}>{r.rpe}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* BOTTOM NAV MOBILE */}
      <div style={{ position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)", width:480, maxWidth:"100vw",
        background:"#0F1117", borderTop:"1px solid #1C1F27", display:"flex", zIndex:50 }}>
        {[["today","⊙","AUJOURD'HUI"],["plan","◫","PLAN"],["analyse","◈","ANALYSE"],["journal","≡","JOURNAL"]].map(([v,ico,lbl]) => (
          <button key={v} className="nav-tab" onClick={() => setView(v)}
            style={{ flex:1, padding:"12px 0 8px", color: view===v ? "#E8E4DC" : "#444",
              background:"transparent", display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
            <span style={{ fontSize:18 }}>{ico}</span>
            <span style={{ fontSize:9, letterSpacing:1.5, fontFamily:"'JetBrains Mono',monospace" }}>{lbl}</span>
          </button>
        ))}
      </div>

      {/* ─── MODALS ─── */}
      {modal && (
        <div onClick={() => setModal(null)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.85)", zIndex:200, display:"flex", alignItems:"flex-end", justifyContent:"center", backdropFilter:"blur(6px)" }}>
          <div onClick={e => e.stopPropagation()} className="pop" style={{ background:"#0F1117", border:"1px solid #1C1F27", borderRadius:"20px 20px 0 0", padding:28, width:"100%", maxWidth:480, maxHeight:"85vh", overflowY:"auto" }}>

            {/* PLAN FORM */}
            {modal.type === "plan" && (
              <>
                <div style={{ fontSize:22, fontWeight:800, marginBottom:24 }}>Planifier une séance</div>
                <FormGrid>
                  <Field label="DATE"><input type="date" className="inp" value={planForm.date} onChange={e=>setPlanForm({...planForm,date:e.target.value})} /></Field>
                  <Field label="TYPE">
                    <select className="inp" value={planForm.type} onChange={e=>setPlanForm({...planForm,type:e.target.value})}>
                      {Object.keys(TYPE_META).map(t => <option key={t}>{t}</option>)}
                    </select>
                  </Field>
                  <Field label="DISTANCE CIBLE (km)"><input type="number" className="inp" placeholder="10" value={planForm.targetDist} onChange={e=>setPlanForm({...planForm,targetDist:e.target.value})} /></Field>
                  <Field label="DURÉE CIBLE (min)"><input type="number" className="inp" placeholder="65" value={planForm.targetDur} onChange={e=>setPlanForm({...planForm,targetDur:e.target.value})} /></Field>
                  <Field label="FC CIBLE (bpm)"><input type="number" className="inp" placeholder="145" value={planForm.targetHR} onChange={e=>setPlanForm({...planForm,targetHR:e.target.value})} /></Field>
                  <Field label="NOTES" full><textarea className="inp" rows={3} placeholder="Description de la séance, objectifs..." value={planForm.notes} onChange={e=>setPlanForm({...planForm,notes:e.target.value})} style={{resize:"none"}} /></Field>
                </FormGrid>
                <div style={{ display:"flex", gap:10, marginTop:24 }}>
                  <button className="btn-ghost" onClick={() => setModal(null)} style={{ flex:1, borderRadius:12, padding:14, fontFamily:"'JetBrains Mono',monospace", fontSize:12 }}>ANNULER</button>
                  <button className="btn-primary" onClick={addPlanned} style={{ flex:2, background:"#E8E4DC", color:"#080A0E", borderRadius:12, padding:14, fontSize:13, fontWeight:700 }}>ENREGISTRER</button>
                </div>
              </>
            )}

            {/* LOG FORM */}
            {modal.type === "log" && (
              <>
                <div style={{ fontSize:22, fontWeight:800, marginBottom:24 }}>Enregistrer une séance</div>
                <FormGrid>
                  <Field label="DATE"><input type="date" className="inp" value={logForm.date} onChange={e=>setLogForm({...logForm,date:e.target.value})} /></Field>
                  <Field label="TYPE">
                    <select className="inp" value={logForm.type} onChange={e=>setLogForm({...logForm,type:e.target.value})}>
                      {Object.keys(TYPE_META).map(t => <option key={t}>{t}</option>)}
                    </select>
                  </Field>
                  <Field label="DISTANCE (km)"><input type="number" className="inp" placeholder="10.5" value={logForm.dist} onChange={e=>setLogForm({...logForm,dist:e.target.value})} /></Field>
                  <Field label="DURÉE (min)"><input type="number" className="inp" placeholder="68" value={logForm.dur} onChange={e=>setLogForm({...logForm,dur:e.target.value})} /></Field>
                  <Field label="FC MOY (bpm)"><input type="number" className="inp" placeholder="145" value={logForm.hr} onChange={e=>setLogForm({...logForm,hr:e.target.value})} /></Field>
                  <Field label={`RPE · ${logForm.rpe}/10`} full>
                    <input type="range" min="1" max="10" value={logForm.rpe} onChange={e=>setLogForm({...logForm,rpe:e.target.value})} style={{ width:"100%", accentColor:"#FFE66D" }} />
                    <div style={{ display:"flex", justifyContent:"space-between", fontSize:9, color:"#444", fontFamily:"'JetBrains Mono',monospace", marginTop:4 }}><span>LÉGER</span><span>MODÉRÉ</span><span>MAX</span></div>
                  </Field>
                  <Field label="RESSENTI" full>
                    <div style={{ display:"flex", gap:8, justifyContent:"center" }}>
                      {FEELINGS.map((f,i) => (
                        <button key={i} onClick={()=>setLogForm({...logForm,feeling:String(i+1)})} style={{ fontSize:28, background:"transparent", border:`2px solid ${+logForm.feeling===i+1?"#FFE66D":"transparent"}`, borderRadius:10, padding:"4px 8px", cursor:"pointer", transition:"all .2s" }}>{f}</button>
                      ))}
                    </div>
                  </Field>
                  <Field label="NOTES" full><textarea className="inp" rows={2} placeholder="Ressenti, conditions..." value={logForm.notes} onChange={e=>setLogForm({...logForm,notes:e.target.value})} style={{resize:"none"}} /></Field>
                </FormGrid>
                <div style={{ display:"flex", gap:10, marginTop:24 }}>
                  <button className="btn-ghost" onClick={() => setModal(null)} style={{ flex:1, borderRadius:12, padding:14, fontFamily:"'JetBrains Mono',monospace", fontSize:12 }}>ANNULER</button>
                  <button className="btn-primary" onClick={submitLog} style={{ flex:2, background:"#4ECDC4", color:"#080A0E", borderRadius:12, padding:14, fontSize:13, fontWeight:700 }}>ENREGISTRER ✓</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── SUB COMPONENTS ─── */
function CompareBar({ planned, done }) {
  const items = [
    { label:"Distance", target:planned.targetDist, actual:done.dist, unit:"km" },
    { label:"Durée", target:planned.targetDur, actual:done.dur, unit:"min" },
    ...(planned.targetHR && done.hr ? [{ label:"FC", target:planned.targetHR, actual:done.hr, unit:"bpm" }] : []),
  ];
  return (
    <div style={{ marginTop:14, display:"flex", flexDirection:"column", gap:8 }}>
      {items.map(({ label, target, actual, unit }) => {
        const pct = Math.min(actual/target, 1.5);
        const diff = ((actual-target)/target*100).toFixed(0);
        const ok = Math.abs(actual-target)/target < 0.1;
        return (
          <div key={label}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3, fontSize:11, fontFamily:"'JetBrains Mono',monospace" }}>
              <span style={{ color:"#555" }}>{label}</span>
              <span>
                <span style={{ color:"#aaa" }}>{actual}{unit}</span>
                <span style={{ color:"#444" }}> / {target}{unit}</span>
                <span style={{ color: ok ? "#4ECDC4" : Math.abs(+diff) < 20 ? "#FFE66D" : "#FF6B6B", marginLeft:6 }}>
                  {+diff > 0 ? "+" : ""}{diff}%
                </span>
              </span>
            </div>
            <div style={{ height:4, background:"#1C1F27", borderRadius:2, position:"relative" }}>
              <div style={{ height:4, width:`${Math.min(pct/1.5*100,100)}%`, background: ok?"#4ECDC4": Math.abs(pct-1)<0.2?"#FFE66D":"#FF6B6B", borderRadius:2 }} />
              <div style={{ position:"absolute", left:`${1/1.5*100}%`, top:-3, width:2, height:10, background:"#E8E4DC", borderRadius:1 }} />
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
            <div style={{ fontSize:9, color: isLatest?"#E8E4DC":"#555", fontFamily:"'JetBrains Mono',monospace" }}>{w.dist.toFixed(0)}</div>
            <div style={{ width:"100%", height:h, background: isLatest?"#FFE66D":"#1C1F27", borderRadius:"3px 3px 0 0", position:"relative" }}>
              {isLatest && <div style={{ position:"absolute", inset:0, background:"linear-gradient(180deg,rgba(255,230,109,.2) 0%,transparent 100%)", borderRadius:"3px 3px 0 0" }} />}
            </div>
            <div style={{ fontSize:8, color:"#333", fontFamily:"'JetBrains Mono',monospace" }}>
              {new Date(w.wk).toLocaleDateString("fr",{day:"numeric",month:"numeric"})}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PaceChart({ data }) {
  if (data.length < 2) return <div style={{ fontSize:11, color:"#555", fontFamily:"'JetBrains Mono',monospace", padding:"20px 0", textAlign:"center" }}>Pas assez de données (min. 2 séances endurance)</div>;
  const max = Math.max(...data.map(d=>d.pace));
  const min = Math.min(...data.map(d=>d.pace));
  const w = 400; const h = 80; const pad = 10;
  const pts = data.map((d,i) => {
    const x = pad + i/(data.length-1)*(w-2*pad);
    const y = pad + (1-(d.pace-min)/(max-min||1))*(h-2*pad);
    return `${x},${y}`;
  }).join(" ");
  function fmt(s) { return `${Math.floor(s/60)}'${String(Math.round(s%60)).padStart(2,"0")}"`; }
  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:"#555", fontFamily:"'JetBrains Mono',monospace", marginBottom:6 }}>
        <span>PLUS LENT {fmt(max)}</span><span>PLUS RAPIDE {fmt(min)}</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width:"100%", height:h }}>
        <defs>
          <linearGradient id="pg" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#FF6B6B"/>
            <stop offset="100%" stopColor="#4ECDC4"/>
          </linearGradient>
        </defs>
        <polyline points={pts} fill="none" stroke="url(#pg)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/>
        {data.map((d,i) => {
          const x = pad + i/(data.length-1)*(w-2*pad);
          const y = pad + (1-(d.pace-min)/(max-min||1))*(h-2*pad);
          return <circle key={i} cx={x} cy={y} r={3} fill={i===data.length-1?"#4ECDC4":"#1C1F27"} stroke={i===data.length-1?"#4ECDC4":"#555"} strokeWidth={1.5}/>;
        })}
      </svg>
    </div>
  );
}

function FormGrid({ children }) {
  return <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>{children}</div>;
}

function Field({ label, children, full }) {
  return (
    <div style={{ gridColumn: full ? "span 2" : "span 1" }}>
      <div style={{ fontSize:9, color:"#555", letterSpacing:2, fontFamily:"'JetBrains Mono',monospace", marginBottom:6 }}>{label}</div>
      {children}
    </div>
  );
}
