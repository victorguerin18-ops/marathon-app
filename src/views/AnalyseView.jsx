import { useState, useMemo } from "react";
import { TYPE_META, TODAY_STR, PERIODS, VARIETY_PERIODS, METRICS } from '../constants';
import { addDays, wkKey, parseDate, fmtDate } from '../utils/dates';
import Chart from '../components/Chart';

export default function AnalyseView({ done }) {
  const [volPeriod,  setVolPeriod]  = useState("4m");
  const [volMetric,  setVolMetric]  = useState("km");
  const [pacePeriod, setPacePeriod] = useState("all");
  const [varPeriod,  setVarPeriod]  = useState("4w");
  const [showACWRDetail, setShowACWRDetail] = useState(false);

  const acuteLoadMain = done
    .filter(r => r.date >= addDays(TODAY_STR, -7))
    .reduce((s, r) => s + r.dist * (r.rpe || 5), 0);
  const weeks4Main = [0,1,2,3].map(i =>
    done.filter(r => r.date >= addDays(TODAY_STR, -(i+1)*7) && r.date < addDays(TODAY_STR, -i*7))
        .reduce((s, r) => s + r.dist * (r.rpe || 5), 0)
  );
  const chronicLoadMain = weeks4Main.reduce((s, v) => s + v, 0) / 4;
  const acwr = chronicLoadMain > 0 ? acuteLoadMain / chronicLoadMain : 1;
  const acwrStatus = acwr>1.3?{label:"RISQUE ÉLEVÉ",color:"#FF453A"}:acwr>1.15?{label:"CHARGE MODÉRÉE",color:"#FF9F0A"}:{label:"OPTIMAL",color:"#32D74B"};

  const selVolMetric = METRICS.find(m=>m.key===volMetric);

  function fmtVol(v) {
    if(volMetric==='km') return `${v}km`;
    if(volMetric==='time') return `${Math.floor(v/60)}h${String(v%60).padStart(2,'0')}`;
    return `${v}`;
  }
  function fmtPaceVal(v) { const m=Math.floor(v/60),s=Math.round(v%60); return `${m}'${String(s).padStart(2,'0')}"`; }

  const volumeData = useMemo(()=>{
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

  const paceData = useMemo(()=>{
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

  const varietyData = useMemo(()=>{
    const sel=VARIETY_PERIODS.find(p=>p.key===varPeriod);
    const cutoff=sel?.days?addDays(TODAY_STR,-sel.days):null;
    const filtered=done.filter(r=>!cutoff||parseDate(r.date)>=parseDate(cutoff));
    const counts={};
    filtered.forEach(r=>{ if(!counts[r.type]) counts[r.type]={runs:0,km:0}; counts[r.type].runs++; counts[r.type].km+=r.dist; });
    return counts;
  },[done,varPeriod]);

  const varietyScore = Object.keys(varietyData).filter(t=>t!=="Footing").length;

  return (
    <div className="fade-up">

      {/* ── VOLUME ── */}
      <div className="card" style={{padding:20,marginBottom:14}}>
        <div style={{marginBottom:14}}>
          <div style={{fontSize:18,fontWeight:700,color:"#fff",letterSpacing:-0.3,marginBottom:2}}>Volume hebdomadaire</div>
          <div style={{fontSize:12,color:"#888",fontFamily:"'Inter',sans-serif"}}>{selVolMetric.desc}</div>
        </div>
        <div style={{display:"flex",gap:4,background:"#333",borderRadius:12,padding:3,marginBottom:10}}>
          {METRICS.map(m=>(
            <button key={m.key} className="seg-btn" onClick={()=>setVolMetric(m.key)}
              style={{flex:1,background:volMetric===m.key?"#242426":"transparent",color:volMetric===m.key?"#fff":"#555",borderRadius:10,fontWeight:volMetric===m.key?700:500}}>{m.label}</button>
          ))}
        </div>
        <div style={{display:"flex",gap:4,marginBottom:16}}>
          {PERIODS.map(p=>(
            <button key={p.key} className="seg-btn" onClick={()=>setVolPeriod(p.key)}
              style={{flex:1,background:volPeriod===p.key?"#32D74B":"#333",color:volPeriod===p.key?"#000":"#555",borderRadius:10,fontWeight:volPeriod===p.key?700:500}}>{p.label}</button>
          ))}
        </div>
        <Chart data={volumeData} color="#32D74B" formatY={fmtVol} smooth={false}/>
        {volumeData.length>0&&(()=>{
          const nz=volumeData.filter(d=>d.value>0);
          const avg=nz.length?Math.round(nz.reduce((s,d)=>s+d.value,0)/nz.length):0;
          const max=nz.length?Math.max(...nz.map(d=>d.value)):0;
          const last=volumeData[volumeData.length-1]?.value||0;
          return (
            <div style={{display:"flex",gap:8,marginTop:14}}>
              {[["CETTE SEM.",fmtVol(last)],["MOYENNE",fmtVol(avg)],["MAX",fmtVol(max)]].map(([l,v])=>(
                <div key={l} style={{flex:1,background:"#333",borderRadius:10,padding:"10px 8px",textAlign:"center"}}>
                  <div style={{fontSize:9,color:"#555",fontFamily:"'Inter',sans-serif",fontWeight:500,marginBottom:4}}>{l}</div>
                  <div style={{fontSize:14,fontWeight:700,color:"#fff"}}>{v}</div>
                </div>
              ))}
            </div>
          );
        })()}
      </div>

      {/* ── ACWR ── */}
      <div className="card" onClick={()=>setShowACWRDetail(true)} style={{padding:20,marginBottom:14,cursor:"pointer"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <div style={{fontSize:18,fontWeight:700,color:"#fff",letterSpacing:-0.3}}>Charge · ACWR</div>
          <div style={{fontSize:11,color:"#555",fontFamily:"'Inter',sans-serif"}}>Détail →</div>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:14}}>
          <div>
            <div style={{fontSize:42,fontWeight:800,color:acwrStatus.color,lineHeight:1,letterSpacing:-1}}>{acwr.toFixed(2)}</div>
            <div style={{fontSize:12,color:acwrStatus.color,fontFamily:"'Inter',sans-serif",fontWeight:600,marginTop:4}}>{acwrStatus.label}</div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:11,color:"#555",fontFamily:"'Inter',sans-serif"}}>Zone optimale · 4 sem.</div>
            <div style={{fontSize:13,color:"#32D74B",fontFamily:"'JetBrains Mono',monospace"}}>0.80 → 1.30</div>
          </div>
        </div>
        <div style={{display:"flex",gap:8,marginBottom:14}}>
          {[
            ["CHARGE 7J", Math.round(acuteLoadMain), "#fff"],
            ["MOY. 28J",  Math.round(chronicLoadMain), "#888"],
            ["RATIO",     acwr.toFixed(2), acwrStatus.color],
          ].map(([l,v,c])=>(
            <div key={l} style={{flex:1,background:"#333",borderRadius:10,padding:"8px 6px",textAlign:"center"}}>
              <div style={{fontSize:8,color:"#555",fontFamily:"'Inter',sans-serif",fontWeight:500,marginBottom:3}}>{l}</div>
              <div style={{fontSize:13,fontWeight:700,color:c}}>{v}</div>
            </div>
          ))}
        </div>
        <div style={{height:8,background:"#333",borderRadius:4,position:"relative"}}>
          <div style={{position:"absolute",left:"40%",width:"15%",height:8,background:"#32D74B33",borderRadius:4}}/>
          <div style={{position:"absolute",left:`${Math.min(acwr/2*100,95)}%`,width:12,height:12,top:-2,borderRadius:"50%",background:acwrStatus.color,transform:"translateX(-50%)",border:"2px solid #161618"}}/>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"#555",fontFamily:"'Inter',sans-serif",marginTop:5,marginBottom:10}}>
          <span>0</span><span>0.8</span><span>1.0</span><span>1.3</span><span>1.5</span><span>2.0</span>
        </div>
        <div style={{padding:"10px 12px",background:"#333",borderRadius:10,fontSize:11,color:"#888",fontFamily:"'Inter',sans-serif",lineHeight:1.7}}>
          {acwr>1.3?"⚠ Risque de blessure élevé. Réduis la charge de 20-30%.":acwr>1.15?"△ Charge modérée. Surveille ta récupération.":"✓ Tu es dans la zone optimale. Continue !"}
        </div>
      </div>

      {/* ── ALLURE ── */}
      <div className="card" style={{padding:20,marginBottom:14}}>
        <div style={{marginBottom:12}}>
          <div style={{fontSize:18,fontWeight:700,color:"#fff",letterSpacing:-0.3,marginBottom:2}}>Progression allure</div>
          <div style={{fontSize:12,color:"#888",fontFamily:"'Inter',sans-serif"}}>EF &gt;5km · bas = plus rapide 🏃</div>
        </div>
        <div style={{display:"flex",gap:4,marginBottom:16}}>
          {PERIODS.map(p=>(
            <button key={p.key} className="seg-btn" onClick={()=>setPacePeriod(p.key)}
              style={{flex:1,background:pacePeriod===p.key?"#FC4C02":"#333",color:pacePeriod===p.key?"#fff":"#555",borderRadius:10,fontWeight:pacePeriod===p.key?700:500}}>{p.label}</button>
          ))}
        </div>
        <Chart data={paceData} color="#FC4C02" formatY={fmtPaceVal} smooth={false}/>
        {paceData.length>=2&&(()=>{
          const first=paceData[0].value, last=paceData[paceData.length-1].value, diff=first-last;
          return (
            <div style={{marginTop:14,padding:"12px",background:"#333",borderRadius:10,fontSize:11,color:diff>0?"#32D74B":"#FF9F0A",fontFamily:"'Inter',sans-serif"}}>
              {diff>0?`✓ Gain de ${Math.floor(Math.abs(diff)/60)}'${String(Math.round(Math.abs(diff)%60)).padStart(2,'0')}" /km 🔥`:`△ Allure stable — continue à accumuler du volume en zone 2`}
            </div>
          );
        })()}
      </div>

      {/* ── VARIÉTÉ ── */}
      <div className="card" style={{padding:20,marginBottom:14}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <div>
            <div style={{fontSize:18,fontWeight:700,color:"#fff",letterSpacing:-0.3,marginBottom:2}}>Variété des séances</div>
            <div style={{fontSize:12,color:varietyScore>=4?"#32D74B":varietyScore>=3?"#FFE66D":"#FF453A",fontFamily:"'Inter',sans-serif",fontWeight:600}}>
              {varietyScore>=4?"EXCELLENTE":varietyScore>=3?"BONNE":"À AMÉLIORER"}
            </div>
          </div>
        </div>
        <div style={{display:"flex",gap:4,marginBottom:16}}>
          {VARIETY_PERIODS.map(p=>(
            <button key={p.key} className="seg-btn" onClick={()=>setVarPeriod(p.key)}
              style={{flex:1,background:varPeriod===p.key?"#BF5AF2":"#333",color:varPeriod===p.key?"#fff":"#555",borderRadius:10,fontWeight:varPeriod===p.key?700:500}}>{p.label}</button>
          ))}
        </div>
        {Object.entries(varietyData).sort((a,b)=>b[1].runs-a[1].runs).map(([type,data])=>{
          const tm=TYPE_META[type]||TYPE_META["Footing"];
          const total=Object.values(varietyData).reduce((s,v)=>s+v.runs,0);
          return (
            <div key={type} style={{marginBottom:12}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:5,fontSize:12}}>
                <span style={{color:tm.color,fontWeight:600}}>{tm.icon} {type}</span>
                <span style={{fontFamily:"'Inter',sans-serif",fontSize:11}}>
                  <span style={{color:"#888"}}>{data.runs} séance{data.runs>1?"s":""}</span>
                  <span style={{color:"#555",margin:"0 5px"}}>·</span>
                  <span style={{color:tm.color}}>{data.km.toFixed(1)}km</span>
                  <span style={{color:"#555",margin:"0 5px"}}>·</span>
                  <span style={{color:"#555"}}>{Math.round(data.runs/total*100)}%</span>
                </span>
              </div>
              <div style={{height:5,background:"#333",borderRadius:3}}>
                <div style={{height:5,width:`${data.runs/total*100}%`,background:tm.color,borderRadius:3}}/>
              </div>
            </div>
          );
        })}
        {(()=>{
          const missing=["Endurance fondamentale","Fractionné / VMA","Sortie longue"].filter(t=>!Object.keys(varietyData).includes(t));
          if(missing.length>0) return (
            <div style={{marginTop:12,padding:"10px 12px",background:"#FF9F0A11",borderRadius:10,fontSize:11,color:"#FF9F0A",fontFamily:"'Inter',sans-serif"}}>
              💡 Manque : {missing.join(", ")}
            </div>
          );
          return null;
        })()}
      </div>

      {/* ── MODAL ACWR ── */}
      {showACWRDetail && (()=>{
        const weeks4Detail = [0,1,2,3].map(i => {
          const runs = done.filter(r =>
            r.date >= addDays(TODAY_STR, -(i+1)*7) &&
            r.date < addDays(TODAY_STR, -i*7)
          );
          const load = runs.reduce((s,r) => s + r.dist*(r.rpe||5), 0);
          const dist = runs.reduce((s,r) => s + r.dist, 0);
          const wkStart = addDays(TODAY_STR, -(i+1)*7);
          const [,mm,dd] = wkStart.split('-');
          return { label: `S-${i+1} (${parseInt(dd)}/${parseInt(mm)})`, load: Math.round(load), dist: Math.round(dist*10)/10, runs: runs.length, isCurrent: i===0 };
        });
        const maxLoad = Math.max(...weeks4Detail.map(w=>w.load), 1);
        return (
          <div onClick={()=>setShowACWRDetail(false)}
            style={{position:"fixed",inset:0,background:"rgba(0,0,0,.92)",zIndex:400,display:"flex",alignItems:"flex-end",justifyContent:"center",backdropFilter:"blur(10px)"}}>
            <div onClick={e=>e.stopPropagation()}
              style={{width:"100%",maxWidth:480,background:"#242426",borderRadius:"22px 22px 0 0",padding:"28px 24px",paddingBottom:"calc(28px + env(safe-area-inset-bottom,12px))",maxHeight:"85vh",overflowY:"auto"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:24}}>
                <div>
                  <div style={{fontSize:11,color:acwrStatus.color,fontWeight:500,fontFamily:"'Inter',sans-serif",marginBottom:6}}>CHARGE AIGUË / CHRONIQUE</div>
                  <div style={{display:"flex",alignItems:"baseline",gap:10}}>
                    <span style={{fontSize:48,fontWeight:800,color:acwrStatus.color,letterSpacing:-3,lineHeight:1}}>{acwr.toFixed(2)}</span>
                    <span style={{fontSize:14,color:"#555",fontFamily:"'Inter',sans-serif"}}>{acwrStatus.label}</span>
                  </div>
                  <div style={{fontSize:11,color:"#555",fontFamily:"'Inter',sans-serif",marginTop:4}}>Zone optimale : 0.80 → 1.30</div>
                </div>
                <button onClick={()=>setShowACWRDetail(false)}
                  style={{background:"#333",border:"none",color:"#888",fontSize:18,cursor:"pointer",borderRadius:10,width:36,height:36,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
              </div>
              <div style={{marginBottom:24}}>
                <div style={{height:10,background:"#333",borderRadius:5,position:"relative",marginBottom:6}}>
                  <div style={{position:"absolute",left:"40%",width:"15%",height:"100%",background:"#32D74B33",borderRadius:3}}/>
                  <div style={{position:"absolute",top:-3,left:`${Math.min(acwr/2*100,95)}%`,width:16,height:16,borderRadius:"50%",background:acwrStatus.color,border:"2px solid #161618",transform:"translateX(-50%)",boxShadow:`0 0 8px ${acwrStatus.color}66`}}/>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"#555",fontFamily:"'Inter',sans-serif"}}>
                  <span>0</span><span style={{color:"#32D74B"}}>0.8</span><span style={{color:"#32D74B"}}>1.3</span><span>1.5</span><span>2.0</span>
                </div>
              </div>
              <div style={{display:"flex",gap:8,marginBottom:24}}>
                {[
                  ["CHARGE AIGUË (7j)", Math.round(acuteLoadMain), "#fff", "km×RPE cette semaine"],
                  ["CHARGE CHRONIQUE", Math.round(chronicLoadMain), "#888", "moyenne 4 semaines"],
                  ["RATIO ACWR", acwr.toFixed(2), acwrStatus.color, "aiguë ÷ chronique"],
                ].map(([l,v,c,sub])=>(
                  <div key={l} style={{flex:1,background:"#333",borderRadius:12,padding:"12px 8px",textAlign:"center"}}>
                    <div style={{fontSize:8,color:"#555",fontFamily:"'Inter',sans-serif",fontWeight:500,marginBottom:6,lineHeight:1.4}}>{l}</div>
                    <div style={{fontSize:18,fontWeight:800,color:c,marginBottom:4}}>{v}</div>
                    <div style={{fontSize:8,color:"#555",fontFamily:"'Inter',sans-serif"}}>{sub}</div>
                  </div>
                ))}
              </div>
              <div style={{fontSize:11,color:"#555",fontWeight:500,fontFamily:"'Inter',sans-serif",marginBottom:12}}>DÉTAIL PAR SEMAINE</div>
              <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:20}}>
                {weeks4Detail.map((w,i)=>(
                  <div key={i} style={{background:"#333",borderRadius:12,padding:"12px 14px"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <span style={{fontSize:11,fontFamily:"'Inter',sans-serif",color:w.isCurrent?"#FFE66D":"#888"}}>{w.label}</span>
                        {w.isCurrent && <span style={{fontSize:9,color:"#FFE66D",background:"#FFE66D22",borderRadius:4,padding:"1px 5px",fontFamily:"'Inter',sans-serif",fontWeight:600}}>EN COURS</span>}
                      </div>
                      <span style={{fontSize:13,fontWeight:700,color:w.isCurrent?"#FFE66D":"#888",fontFamily:"'Inter',sans-serif"}}>charge {w.load}</span>
                    </div>
                    <div style={{display:"flex",gap:12,fontSize:11,color:"#555",fontFamily:"'Inter',sans-serif",marginBottom:8}}>
                      <span>{w.dist} km</span><span>·</span><span>{w.runs} séance{w.runs>1?"s":""}</span>
                    </div>
                    <div style={{height:4,background:"#242426",borderRadius:2,overflow:"hidden"}}>
                      <div style={{height:"100%",width:`${(w.load/maxLoad)*100}%`,background:w.isCurrent?acwrStatus.color:"#555",borderRadius:2,transition:"width 0.8s ease"}}/>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{padding:"14px 16px",background:"#333",borderRadius:14,fontSize:11,color:"#666",fontFamily:"'Inter',sans-serif",lineHeight:1.8}}>
                <span style={{color:"#fff"}}>Charge = km × RPE</span> pour chaque séance.<br/>
                <span style={{color:"#fff"}}>ACWR = charge 7j ÷ moyenne des 4 semaines.</span><br/>
                Zone verte 0.8–1.3 : tu charges suffisamment sans risquer la surcharge. En dessous de 0.8, tu es sous-entraîné. Au-dessus de 1.5, risque de blessure élevé.
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
