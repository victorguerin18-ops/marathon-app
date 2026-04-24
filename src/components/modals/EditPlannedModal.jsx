import { useState } from "react";
import { savePlanned } from '../../db';
import { TYPE_META } from '../../constants';
import { fmtDate } from '../../utils/dates';
import { FormGrid, Field } from '../FormGrid';

export default function EditPlannedModal({ session, onSave, onClose }) {
  const [form, setForm] = useState({
    id: session.id,
    date: session.date,
    generated: session.generated,
    type: session.type,
    targetDist: String(session.targetDist),
    targetDur: String(session.targetDur),
    targetHR: session.targetHR ? String(session.targetHR) : "",
    notes: session.notes || "",
  });

  async function submit() {
    const updated = {
      ...form,
      targetDist: parseFloat(form.targetDist) || 0,
      targetDur: parseInt(form.targetDur) || 0,
      targetHR: form.targetHR ? parseInt(form.targetHR) : null,
    };
    await savePlanned(updated);
    onSave(updated);
    onClose();
  }

  return (
    <>
      <div style={{fontSize:22,fontWeight:800,color:"#fff",marginBottom:6}}>Modifier la séance</div>
      <div style={{fontSize:11,color:"#555",fontFamily:"'Inter',sans-serif",marginBottom:20}}>
        {fmtDate(form.date,{weekday:"long",day:"numeric",month:"long"})}
      </div>
      <div style={{marginBottom:16}}>
        <div style={{fontSize:11,color:"#555",fontWeight:500,fontFamily:"'Inter',sans-serif",marginBottom:10}}>TYPE</div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {Object.entries(TYPE_META).map(([type,tmeta])=>(
            <button key={type} className="type-btn" onClick={()=>setForm(f=>({...f,type}))}
              style={{borderColor:form.type===type?tmeta.color:"transparent",color:form.type===type?tmeta.color:"#555",background:form.type===type?tmeta.dark:"transparent",minWidth:70}}>
              <div style={{fontSize:16,marginBottom:3}}>{tmeta.icon}</div>
              <div>{type.split(' ')[0]}</div>
            </button>
          ))}
        </div>
      </div>
      <FormGrid>
        <Field label="DISTANCE CIBLE (km)">
          <input type="number" className="inp" value={form.targetDist} onChange={e=>setForm(f=>({...f,targetDist:e.target.value}))}/>
        </Field>
        <Field label="DURÉE CIBLE (min)">
          <input type="number" className="inp" value={form.targetDur} onChange={e=>setForm(f=>({...f,targetDur:e.target.value}))}/>
        </Field>
        <Field label="FC CIBLE (bpm)">
          <input type="number" className="inp" placeholder="optionnel" value={form.targetHR} onChange={e=>setForm(f=>({...f,targetHR:e.target.value}))}/>
        </Field>
        <Field label="NOTES" full>
          <textarea className="inp" rows={2} value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} style={{resize:"none"}}/>
        </Field>
      </FormGrid>
      <div style={{display:"flex",gap:10,marginTop:24}}>
        <button className="btn-ghost" onClick={onClose} style={{flex:1,borderRadius:50,padding:14,fontSize:11}}>ANNULER</button>
        <button onClick={submit}
          style={{flex:2,background:TYPE_META[form.type]?.color||"#fff",color:"#000",borderRadius:50,padding:14,fontSize:13,fontWeight:700,border:"none",cursor:"pointer",fontFamily:"'Inter',sans-serif"}}>
          SAUVEGARDER ✓
        </button>
      </div>
    </>
  );
}
