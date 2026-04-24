export function FormGrid({ children }) {
  return <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>{children}</div>;
}
export function Field({ label, children, full }) {
  return (
    <div style={{gridColumn:full?"span 2":"span 1"}}>
      <div style={{fontSize:11,color:"#555",fontWeight:500,fontFamily:"'Inter',sans-serif",marginBottom:6}}>{label}</div>
      {children}
    </div>
  );
}
