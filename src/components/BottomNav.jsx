export default function BottomNav({ view, setView }) {
  return (
    <div style={{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:480,maxWidth:"100vw",background:"#242426",borderRadius:"20px 20px 0 0",display:"flex",zIndex:50,padding:`8px 10px calc(8px + env(safe-area-inset-bottom, 12px))`}}>
      {[["today","⊙","AUJOURD'HUI"],["plan","◫","PLAN"],["coach","✦","COACH"],["analyse","◈","ANALYSE"],["journal","≡","JOURNAL"]].map(([v,ico,lbl])=>{
        const active = view===v;
        const accent = v==="coach"?"#32D74B":v==="today"?"#0A84FF":v==="plan"?"#FFE66D":v==="analyse"?"#BF5AF2":"#FC4C02";
        return (
          <button key={v} className="nav-tab" onClick={()=>setView(v)}
            style={{flex:1,padding:"8px 4px 6px",background:active?"#333":"transparent",borderRadius:12,color:active?accent:"#555",display:"flex",flexDirection:"column",alignItems:"center",gap:3,border:"none",transition:"all .2s"}}>
            <span style={{fontSize:18,lineHeight:1}}>{ico}</span>
            <span style={{fontSize:9,letterSpacing:0.5,fontFamily:"'Inter',sans-serif",fontWeight:active?700:500}}>{lbl}</span>
            {active&&<div style={{width:5,height:5,borderRadius:"50%",background:accent,marginTop:1}}/>}
          </button>
        );
      })}
    </div>
  );
}
