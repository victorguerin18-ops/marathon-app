export default function WeekAdjustModal({ weekAdjustModal, weekCompare, onClose, onApply }) {
  const typeMeta = {
    "Sortie longue":"◈◈◈","Endurance fondamentale":"◈",
    "Fractionné / VMA":"▲▲","Tempo / Seuil":"◇","Footing":"〜",
  };

  function applyMaxSafe() {
    const capped = weekAdjustModal.sessions.map(s => ({
      ...s,
      idealDist: s.isAlert ? Math.round(s.targetDist * 1.20 * 10) / 10 : s.idealDist,
    }));
    onApply(capped);
  }

  return (
    <div onClick={onClose}
      style={{position:"fixed",inset:0,background:"rgba(0,0,0,.92)",zIndex:400,display:"flex",alignItems:"flex-end",justifyContent:"center",backdropFilter:"blur(10px)"}}>
      <div onClick={e=>e.stopPropagation()}
        style={{width:"100%",maxWidth:480,background:"#242426",borderRadius:"22px 22px 0 0",padding:"28px 24px",paddingBottom:"calc(28px + env(safe-area-inset-bottom,12px))"}}>

        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
          <div>
            <div style={{fontSize:11,color:"#0A84FF",fontWeight:500,fontFamily:"'Inter',sans-serif",marginBottom:4}}>◎ AJUSTEMENT ADAPTATIF</div>
            <div style={{fontSize:20,fontWeight:700,color:"#fff",letterSpacing:-0.3}}>Optimiser la semaine</div>
          </div>
          <button onClick={onClose} style={{background:"#333",border:"none",color:"#888",fontSize:18,cursor:"pointer",borderRadius:10,width:36,height:36,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
        </div>

        <div style={{fontSize:11,color:"#888",fontFamily:"'Inter',sans-serif",lineHeight:1.7,marginBottom:16,padding:"10px 14px",background:"#333",borderRadius:10}}>
          Objectif semaine : <span style={{color:"#fff"}}>{weekCompare.targetKm}km</span> · Déjà fait : <span style={{color:"#32D74B"}}>{weekCompare.doneKm.toFixed(1)}km</span> · Qualité : <span style={{color:"#FF9F0A"}}>{weekCompare.qualRatio}%</span> du volume
        </div>

        <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:20}}>
          {weekAdjustModal.sessions.map(s=>{
            const color = s.isAlert?"#FF9F0A":"#0A84FF";
            return (
              <div key={s.id} style={{padding:"14px",background:"#333",borderRadius:14}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                  <span style={{fontSize:12,fontWeight:700,color}}>{typeMeta[s.type]||"○"} {s.type}</span>
                  <span style={{fontSize:11,color:"#555",fontFamily:"'Inter',sans-serif"}}>{s.date}</span>
                </div>
                <div style={{display:"flex",gap:8}}>
                  {[["PRÉVU",`${s.targetDist}km`,"#555"],["IDÉAL",`${s.idealDist}km`,color],["ÉCART",`${s.delta>0?"+":""}${s.delta.toFixed(1)}km`,color]].map(([l,v,c])=>(
                    <div key={l} style={{flex:1,background:"#242426",borderRadius:8,padding:"8px",textAlign:"center"}}>
                      <div style={{fontSize:8,color:"#555",fontFamily:"'Inter',sans-serif",fontWeight:500,marginBottom:3}}>{l}</div>
                      <div style={{fontSize:13,fontWeight:700,color:c}}>{v}</div>
                    </div>
                  ))}
                </div>
                {s.isAlert && (
                  <div style={{marginTop:8,fontSize:10,color:"#FF9F0A",fontFamily:"'Inter',sans-serif",lineHeight:1.5}}>
                    ⚠ Augmentation de +{Math.round(s.deltaPct)}% — surveille ta récupération après cette séance.
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div style={{display:"flex",gap:10}}>
          <button onClick={applyMaxSafe}
            style={{flex:1,background:"#333",color:"#aaa",border:"none",borderRadius:50,padding:14,fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"'Inter',sans-serif"}}>
            MAX SAFE<br/><span style={{fontWeight:400,fontSize:9}}>plafonné +20%</span>
          </button>
          <button onClick={()=>onApply(weekAdjustModal.sessions)}
            style={{flex:2,background:"#fff",color:"#000",border:"none",borderRadius:50,padding:14,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"'Inter',sans-serif"}}>
            APPLIQUER TOUT ✓
          </button>
        </div>
      </div>
    </div>
  );
}
