export default function CompareBar({ planned, done }) {
  const items = [
    {label:"Distance", target:planned.targetDist, actual:done.dist, unit:"km"},
    {label:"Durée",    target:planned.targetDur,  actual:done.dur,  unit:"min"},
    ...(planned.targetHR&&done.hr?[{label:"FC",target:planned.targetHR,actual:done.hr,unit:"bpm"}]:[]),
  ];
  return (
    <div style={{marginTop:14,display:"flex",flexDirection:"column",gap:8}}>
      {items.map(({label,target,actual,unit})=>{
        const diff=((actual-target)/target*100).toFixed(0);
        const ok=Math.abs(actual-target)/target<0.1;
        return (
          <div key={label}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:3,fontSize:11,fontFamily:"'Inter',sans-serif"}}>
              <span style={{color:"#555"}}>{label}</span>
              <span>
                <span style={{color:"#fff"}}>{actual}{unit}</span>
                <span style={{color:"#555"}}> / {target}{unit}</span>
                <span style={{color:ok?"#32D74B":Math.abs(+diff)<20?"#FFE66D":"#FF453A",marginLeft:6}}>{+diff>0?"+":""}{diff}%</span>
              </span>
            </div>
            <div style={{height:4,background:"#333",borderRadius:2}}>
              <div style={{height:4,width:`${Math.min(Math.abs(actual/target)*100,100)}%`,background:ok?"#32D74B":Math.abs(+diff)<20?"#FFE66D":"#FF453A",borderRadius:2}}/>
            </div>
          </div>
        );
      })}
    </div>
  );
}
