import { useMemo } from "react";
import { computeVMA } from '../../utils/scores';

export default function VMAModal({ done, currentVMA, onClose }) {
  const result = useMemo(() => computeVMA(done), [done]);
  const finalVMA = result?.finalVMA ?? currentVMA;
  const diff = (finalVMA - currentVMA).toFixed(2);
  const diffPositive = finalVMA > currentVMA;
  const isFromTest  = result?.source === "test";
  const isFromSeuil = result?.source === "seuil";

  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.92)",zIndex:400,display:"flex",alignItems:"flex-end",justifyContent:"center",backdropFilter:"blur(10px)"}}>
      <div onClick={e=>e.stopPropagation()} style={{width:"100%",maxWidth:480,background:"#242426",borderRadius:"22px 22px 0 0",padding:"28px 24px",paddingBottom:"calc(28px + env(safe-area-inset-bottom,12px))",maxHeight:"88vh",overflowY:"auto",animation:"popUp .28s cubic-bezier(.22,1,.36,1) forwards"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20}}>
          <div>
            <div style={{fontSize:11,color:"#0A84FF",fontWeight:500,fontFamily:"'Inter',sans-serif",marginBottom:6}}>⚡ VMA</div>
            <div style={{display:"flex",alignItems:"baseline",gap:8}}>
              <span style={{fontSize:44,fontWeight:800,letterSpacing:-2,color:"#fff"}}>{finalVMA.toFixed(2)}</span>
              <span style={{fontSize:16,color:"#555",fontFamily:"'JetBrains Mono',monospace"}}>km/h</span>
            </div>
            {result && (
              <div style={{fontSize:11,fontFamily:"'Inter',sans-serif",marginTop:4}}>
                <span style={{color:diffPositive?"#32D74B":"#FF9F0A"}}>{diffPositive?"▲":"▼"} {Math.abs(+diff)} km/h</span>
                <span style={{color:"#555",marginLeft:6}}>vs config ({currentVMA} km/h)</span>
              </div>
            )}
            {!result && <div style={{fontSize:11,color:"#555",fontFamily:"'Inter',sans-serif",marginTop:4}}>Pas de données · affiche ta config</div>}
          </div>
          <button onClick={onClose} style={{background:"#333",border:"none",color:"#888",fontSize:18,cursor:"pointer",borderRadius:10,width:36,height:36,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
        </div>

        <div style={{marginBottom:20,padding:"12px 14px",background:"#333",borderRadius:12}}>
          {isFromTest && (
            <div style={{fontSize:11,color:"#0A84FF",fontFamily:"'Inter',sans-serif",lineHeight:1.7}}>
              <span style={{fontWeight:700}}>⚡ Basé sur ton dernier test Évaluation VMA</span><br/>
              <span style={{color:"#555"}}>Test du {result.latestTest?.date} · {result.latestTest?.dist}km en {result.latestTest?.dur}min · méthode la plus fiable</span>
            </div>
          )}
          {isFromSeuil && (
            <div style={{fontSize:11,color:"#FF9F0A",fontFamily:"'Inter',sans-serif",lineHeight:1.7}}>
              <span style={{fontWeight:700}}>△ Estimé depuis tes séances Seuil</span><br/>
              <span style={{color:"#555"}}>Pas de test Évaluation VMA · estimation depuis ta meilleure allure Seuil ({result.breakdown?.seuilSessions} séances sur 8 semaines)</span>
            </div>
          )}
          {!result && (
            <div style={{fontSize:11,color:"#555",fontFamily:"'Inter',sans-serif",lineHeight:1.7}}>
              Aucune donnée. Fais un test Évaluation VMA ou ajoute des séances Seuil pour une estimation.
            </div>
          )}
        </div>

        {isFromTest && result.testHistory?.length > 0 && (
          <div style={{marginBottom:20}}>
            <div style={{fontSize:11,color:"#555",fontWeight:500,fontFamily:"'Inter',sans-serif",marginBottom:10}}>HISTORIQUE DES TESTS</div>
            {result.testHistory.map((t,i)=>(
              <div key={t.date} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 14px",background:"#333",borderRadius:10,marginBottom:6}}>
                <div>
                  <div style={{fontSize:11,color:i===0?"#0A84FF":"#888",fontFamily:"'Inter',sans-serif"}}>{t.date}{i===0?" · DERNIER":""}</div>
                  <div style={{fontSize:10,color:"#555",fontFamily:"'Inter',sans-serif",marginTop:2}}>{t.dist}km en {t.dur}min</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:18,fontWeight:800,color:i===0?"#fff":"#666"}}>{t.vma.toFixed(2)}</div>
                  <div style={{fontSize:9,color:"#555",fontFamily:"'JetBrains Mono',monospace"}}>km/h</div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{padding:"14px 16px",background:"#333",borderRadius:12,marginBottom:16}}>
          <div style={{fontSize:11,color:"#555",fontWeight:500,fontFamily:"'Inter',sans-serif",marginBottom:8}}>COMMENT CALCULER TA VMA</div>
          <div style={{fontSize:11,color:"#888",fontFamily:"'Inter',sans-serif",lineHeight:1.8}}>
            <span style={{color:"#0A84FF",fontWeight:700}}>✓ Test 6 min (recommandé)</span><br/>
            Sur piste ou GPS précis, cours à fond 6 minutes, note la distance. Ajoute une séance <span style={{color:"#0A84FF"}}>Évaluation VMA</span> dans le journal avec la distance couverte → calcul automatique.<br/><br/>
            <span style={{color:"#FF9F0A"}}>Fallback : Seuil</span><br/>
            Sans test, l'app utilise ta meilleure allure Seuil (÷0.87). Moins précis, sensible aux conditions.
          </div>
        </div>

        {result && Math.abs(+diff) >= 0.2 && (
          <div style={{padding:"14px 16px",background:diffPositive?"#32D74B11":"#FF9F0A11",borderRadius:12,fontSize:11,color:diffPositive?"#32D74B":"#FF9F0A",fontFamily:"'Inter',sans-serif",lineHeight:1.7}}>
            {diffPositive
              ? `✓ VMA calculée (${finalVMA} km/h) > config (${currentVMA} km/h). Recalibre dans les réglages !`
              : `△ VMA calculée (${finalVMA} km/h) < config (${currentVMA} km/h). Allures cibles peut-être trop ambitieuses.`
            }
          </div>
        )}
      </div>
    </div>
  );
}
