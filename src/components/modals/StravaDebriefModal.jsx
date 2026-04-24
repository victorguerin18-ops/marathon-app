import { FEELINGS } from '../../constants';
import { pace } from '../../utils/dates';

export default function StravaDebriefModal({ stravaDebriefModal, debriefForm, setDebriefForm, onClose, onSubmit }) {
  return (
    <div onClick={onClose}
      style={{position:"fixed",inset:0,background:"rgba(0,0,0,.88)",zIndex:300,display:"flex",alignItems:"flex-end",justifyContent:"center",backdropFilter:"blur(8px)"}}>
      <div onClick={e=>e.stopPropagation()} className="pop"
        style={{background:"#242426",borderRadius:"20px 20px 0 0",padding:28,width:"100%",maxWidth:480,paddingBottom:`calc(28px + env(safe-area-inset-bottom, 12px))`}}>

        <div style={{marginBottom:20}}>
          <div style={{fontSize:11,color:"#FC4C02",fontWeight:500,fontFamily:"'Inter',sans-serif",marginBottom:6}}>🏃 SÉANCE DÉTECTÉE VIA STRAVA</div>
          <div style={{fontSize:20,fontWeight:800,color:"#fff"}}>{stravaDebriefModal.stravaSession.type}</div>
          <div style={{fontSize:11,color:"#555",fontFamily:"'Inter',sans-serif",marginTop:2}}>Comment s'est passée cette sortie ?</div>
        </div>

        <div style={{display:"flex",gap:8,marginBottom:20}}>
          {[
            ["DISTANCE", `${stravaDebriefModal.stravaSession.dist} km`],
            ["DURÉE",    `${stravaDebriefModal.stravaSession.dur} min`],
            ["ALLURE",   pace(stravaDebriefModal.stravaSession.dist, stravaDebriefModal.stravaSession.dur)],
            ...(stravaDebriefModal.stravaSession.hr ? [["FC MOY", `${stravaDebriefModal.stravaSession.hr} bpm`]] : []),
          ].map(([l,v])=>(
            <div key={l} style={{flex:1,background:"#333",borderRadius:10,padding:"10px 6px",textAlign:"center"}}>
              <div style={{fontSize:8,color:"#FC4C02",fontFamily:"'Inter',sans-serif",fontWeight:600,marginBottom:4,letterSpacing:0.5}}>{l}</div>
              <div style={{fontSize:13,fontWeight:700,color:"#fff"}}>{v}</div>
            </div>
          ))}
        </div>

        <div style={{marginBottom:16}}>
          <div style={{fontSize:11,color:"#555",fontWeight:500,fontFamily:"'Inter',sans-serif",marginBottom:8}}>EFFORT PERÇU · {debriefForm.rpe}/10</div>
          <input type="range" min="1" max="10" value={debriefForm.rpe}
            onChange={e=>setDebriefForm(f=>({...f,rpe:e.target.value}))}
            style={{width:"100%",accentColor:"#FFE66D"}}/>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"#555",fontFamily:"'Inter',sans-serif",marginTop:4}}>
            <span>LÉGER</span><span>MODÉRÉ</span><span>MAX</span>
          </div>
        </div>

        <div style={{marginBottom:16}}>
          <div style={{fontSize:11,color:"#555",fontWeight:500,fontFamily:"'Inter',sans-serif",marginBottom:8}}>RESSENTI</div>
          <div style={{display:"flex",gap:8,justifyContent:"center"}}>
            {FEELINGS.map((f,i)=>(
              <button key={i} onClick={()=>setDebriefForm(df=>({...df,feeling:String(i+1)}))}
                style={{fontSize:28,background:"transparent",border:`2px solid ${+debriefForm.feeling===i+1?"#FFE66D":"transparent"}`,borderRadius:10,padding:"4px 8px",cursor:"pointer"}}>
                {f}
              </button>
            ))}
          </div>
        </div>

        <div style={{marginBottom:20}}>
          <div style={{fontSize:11,color:"#555",fontWeight:500,fontFamily:"'Inter',sans-serif",marginBottom:6}}>NOTES (optionnel)</div>
          <textarea className="inp" rows={2} placeholder="Conditions, sensations, douleurs..."
            value={debriefForm.notes}
            onChange={e=>setDebriefForm(f=>({...f,notes:e.target.value}))}
            style={{resize:"none"}}/>
        </div>

        <div style={{display:"flex",gap:10}}>
          <button className="btn-ghost" onClick={onClose} style={{flex:1,borderRadius:50,padding:14,fontSize:11}}>
            PLUS TARD
          </button>
          <button onClick={onSubmit}
            style={{flex:2,background:"#32D74B",color:"#000",border:"none",borderRadius:50,padding:14,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"'Inter',sans-serif"}}>
            ENREGISTRER ✓
          </button>
        </div>
      </div>
    </div>
  );
}
