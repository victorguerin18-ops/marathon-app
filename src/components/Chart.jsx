function movingAvg(values, w) {
  const half = Math.floor(w / 2);
  return values.map((_, i) => {
    const s = Math.max(0, i - half), e = Math.min(values.length - 1, i + half);
    const sl = values.slice(s, e + 1);
    return sl.reduce((a, v) => a + v, 0) / sl.length;
  });
}

export default function Chart({ data, color, formatY, smooth, minVal: minValProp }) {
  if(!data||data.length<2) return (
    <div style={{fontSize:11,color:"#555",fontFamily:"'Inter',sans-serif",padding:"24px 0",textAlign:"center"}}>
      Pas assez de données
    </div>
  );
  const W=440,H=150,padL=46,padB=28,padT=16,padR=10;
  const iW=W-padL-padR, iH=H-padT-padB;
  const rawValues=data.map(d=>d.value);
  // Moving average window: ~35% of data, min 3 — gives a trend line that ignores spikes
  const trendValues=smooth?movingAvg(rawValues,Math.max(3,Math.round(rawValues.length*0.35))):rawValues;
  const maxVal=Math.max(...rawValues,1);
  const minVal=minValProp??0;
  const range=Math.max(maxVal-minVal,1);
  const toY=v=>padT+(1-(v-minVal)/range)*iH;
  // Line/area use trend values; dots stay at original positions
  const linePts=trendValues.map((v,i)=>({x:padL+(i/(data.length-1))*iW,y:toY(v)}));
  const pts=rawValues.map((v,i)=>({x:padL+(i/(data.length-1))*iW,y:toY(v),...data[i]}));
  function crPath(p_arr){
    let p=`M ${p_arr[0].x} ${p_arr[0].y}`;
    for(let i=0;i<p_arr.length-1;i++){
      const p0=p_arr[Math.max(i-1,0)],p1=p_arr[i],p2=p_arr[i+1],p3=p_arr[Math.min(i+2,p_arr.length-1)];
      p+=` C ${p1.x+(p2.x-p0.x)/6} ${p1.y+(p2.y-p0.y)/6}, ${p2.x-(p3.x-p1.x)/6} ${p2.y-(p3.y-p1.y)/6}, ${p2.x} ${p2.y}`;
    }
    return p;
  }
  function polyPath(p_arr){return p_arr.map((p,i)=>`${i===0?'M':'L'} ${p.x} ${p.y}`).join(' ');}
  // Trend line always uses Catmull-Rom for a fluid curve
  const linePath=smooth?crPath(linePts):polyPath(linePts);
  const base=padT+iH;
  const area=linePath+` L ${linePts[linePts.length-1].x} ${base} L ${linePts[0].x} ${base} Z`;
  const ticks=[0,.25,.5,.75,1].map(t=>({y:padT+(1-t)*iH,val:Math.round(minVal+t*range)}));
  const step=Math.max(1,Math.floor(data.length/5));
  const xLbls=data.map((d,i)=>({...d,i})).filter(({i})=>i%step===0||i===data.length-1);
  const last=pts[pts.length-1];
  const cid=color.replace('#','');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:H}}>
      <defs>
        <linearGradient id={`aG${cid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3"/>
          <stop offset="100%" stopColor={color} stopOpacity="0.02"/>
        </linearGradient>
        <linearGradient id={`lG${cid}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={color} stopOpacity="0.4"/>
          <stop offset="100%" stopColor={color} stopOpacity="1"/>
        </linearGradient>
      </defs>
      {ticks.map((t,i)=>(
        <g key={i}>
          <line x1={padL} y1={t.y} x2={W-padR} y2={t.y} stroke="#333" strokeWidth={1} strokeDasharray={i===0?"none":"3,5"}/>
          <text x={padL-5} y={t.y+4} textAnchor="end" fill="#555" fontSize={9} fontFamily="Inter">{formatY?formatY(t.val):t.val}</text>
        </g>
      ))}
      <path d={area} fill={`url(#aG${cid})`}/>
      <path d={linePath} fill="none" stroke={`url(#lG${cid})`} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"/>
      {pts.map((p,i)=>(
        <circle key={i} cx={p.x} cy={p.y} r={i===pts.length-1?5:3}
          fill={i===pts.length-1?color:"#161618"} stroke={color} strokeWidth={1.5} opacity={i===pts.length-1?1:0.55}/>
      ))}
      {xLbls.map(({label,i})=>(
        <text key={i} x={padL+(i/(data.length-1))*iW} y={H-6} textAnchor="middle" fill="#555" fontSize={9} fontFamily="Inter">{label}</text>
      ))}
      <rect x={last.x-24} y={last.y-22} width={48} height={16} rx={4} fill={color} opacity={0.18}/>
      <text x={last.x} y={last.y-10} textAnchor="middle" fill={color} fontSize={10} fontWeight="700" fontFamily="Inter">
        {formatY?formatY(last.value):last.value}
      </text>
    </svg>
  );
}
