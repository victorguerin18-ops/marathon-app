import { TYPE_META, FEELINGS } from '../constants';
import { fmtDate, pace } from '../utils/dates';
import { scoreSession } from '../utils/scores';

export default function JournalView({
  done, planned,
  stravaConnected, stravaLoading, syncStatus,
  syncStrava, stravaLogin,
  setModal,
  openEdit,
  deleteJournalEntry,
}) {
  const totalKm = done.reduce((s,r)=>s+r.dist,0);

  return (
    <div className="fade-up">
      {!stravaConnected?(
        <button onClick={stravaLogin} style={{width:"100%",background:"#FC4C02",border:"none",borderRadius:50,padding:"12px",color:"#fff",fontSize:13,fontWeight:700,fontFamily:"'Inter',sans-serif",cursor:"pointer",marginBottom:14}}>
          🔗 CONNECTER STRAVA
        </button>
      ):(
        <div className="card" style={{padding:"10px 14px",marginBottom:14,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{width:8,height:8,borderRadius:"50%",background:"#FC4C02"}}/>
            <span style={{fontSize:11,color:"#888",fontFamily:"'Inter',sans-serif"}}>{syncStatus||`Strava · ${done.filter(d=>d.fromStrava).length} séances`}</span>
          </div>
          <button onClick={syncStrava} className="btn-ghost" style={{borderRadius:50,padding:"4px 12px",fontSize:11}}>
            {stravaLoading?<span className="spin">↻</span>:"↻ SYNC"}
          </button>
        </div>
      )}
      <div style={{fontSize:11,color:"#555",fontFamily:"'Inter',sans-serif",fontWeight:500,marginBottom:14}}>
        {done.length} séances · {totalKm.toFixed(0)} km total
        {done.filter(d=>d.fromStrava).length>0&&<span style={{color:"#FC4C02",marginLeft:8}}>· {done.filter(d=>d.fromStrava).length} Strava</span>}
      </div>
      <button className="btn-ghost" onClick={()=>setModal({type:"log"})} style={{width:"100%",borderRadius:14,padding:"10px",fontSize:12,fontFamily:"'Inter',sans-serif",marginBottom:14}}>
        + Enregistrer une séance
      </button>
      {[...done].sort((a,b)=>b.date.localeCompare(a.date)).map(r=>{
        const tm=TYPE_META[r.type]||TYPE_META["Footing"];
        const linked=planned.find(p=>p.id===r.plannedId);
        const score=linked?scoreSession(linked,r):null;
        return (
          <div key={r.id} className="card" style={{padding:"16px 18px",marginBottom:8}}>
            <div style={{display:"flex",gap:12,alignItems:"center"}}>
              <div style={{width:44,height:44,borderRadius:12,background:tm.dark,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>{tm.icon}</div>
              <div style={{flex:1}}>
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                  <span style={{fontSize:11,color:"#555",fontFamily:"'Inter',sans-serif"}}>{fmtDate(r.date,{weekday:"long",day:"numeric",month:"long"})}</span>
                  {r.fromStrava&&<span style={{fontSize:9,color:"#FC4C02",fontFamily:"'Inter',sans-serif",fontWeight:600}}>STRAVA</span>}
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
                {score!==null&&<div style={{fontSize:13,fontWeight:700,color:score>79?"#32D74B":score>59?"#FFE66D":"#FF453A"}}>{score}/100</div>}
                <button className="btn-ghost" onClick={()=>openEdit(r)} style={{borderRadius:50,padding:"4px 10px",fontSize:10}}>✏ Modifier</button>
                <button onClick={()=>deleteJournalEntry(r)} style={{background:"#FF453A18",border:"none",color:"#FF453A88",cursor:"pointer",fontSize:10,padding:"4px 8px",borderRadius:20,fontFamily:"'Inter',sans-serif",lineHeight:1}}>🗑 Suppr.</button>
              </div>
            </div>
            {r.notes&&<div style={{marginTop:10,fontSize:11,color:"#555",fontFamily:"'Inter',sans-serif",borderTop:"1px solid #333",paddingTop:10}}>💬 {r.notes}</div>}
            <div style={{marginTop:10,display:"flex",gap:3,alignItems:"center"}}>
              <span style={{fontSize:9,color:"#555",fontFamily:"'Inter',sans-serif",marginRight:4}}>RPE</span>
              {Array.from({length:10}).map((_,i)=><div key={i} style={{flex:1,height:4,borderRadius:1,background:i<(r.rpe||5)?tm.color:"#333"}}/>)}
              <span style={{fontSize:9,color:"#555",fontFamily:"'Inter',sans-serif",marginLeft:4}}>{r.rpe||"?"}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
