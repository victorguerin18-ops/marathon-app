export const MARATHON_DATE = "2026-10-25";
export const MARATHON      = new Date(MARATHON_DATE);
export const TODAY         = new Date();
export const TODAY_STR     = `${TODAY.getFullYear()}-${String(TODAY.getMonth()+1).padStart(2,'0')}-${String(TODAY.getDate()).padStart(2,'0')}`;
export const DAYS_LEFT     = Math.ceil((MARATHON - TODAY) / 86400000);
export const WEEKS_LEFT    = Math.floor(DAYS_LEFT / 7);

export const VMA_DEFAULT = 15.24;

export const TYPE_META = {
  "Footing":               { color:"#A8DADC", dark:"#0d1f20", icon:"〜",   desc:"Run libre, pas structuré" },
  "Endurance fondamentale":{ color:"#6BF178", dark:"#0d2b0f", icon:"◈",   desc:"Zone 2 · allure EF" },
  "Tempo / Seuil":         { color:"#FF9F43", dark:"#2b1a00", icon:"◇",   desc:"Seuil lactique" },
  "Fractionné / VMA":      { color:"#FF6B6B", dark:"#2b0d0d", icon:"▲▲",  desc:"Intervalles intenses" },
  "Sortie longue":         { color:"#C77DFF", dark:"#1e0d2b", icon:"◈◈◈", desc:"Endurance longue distance" },
  "Course":                { color:"#FFD700", dark:"#2b2200", icon:"🏅",  desc:"Compétition chronométrée" },
  "Évaluation VMA":        { color:"#00D2FF", dark:"#001f2b", icon:"⚡",  desc:"Test 6 min · Recalibrage VMA" },
};

export const FEELINGS = ["😣","😕","😐","🙂","😄"];

export const STORE = {
  get: (k, def) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } },
  set: (k, v)   => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

export const INTENSE_TYPES = ["Fractionné / VMA", "Tempo / Seuil", "Évaluation VMA"];
export const EASY_TYPES    = ["Endurance fondamentale", "Footing"];

export const PERIODS = [
  {key:"1m",label:"1 mois",days:30},{key:"2m",label:"2 mois",days:61},
  {key:"4m",label:"4 mois",days:122},{key:"1y",label:"1 an",days:365},{key:"all",label:"Tout",days:null},
];
export const VARIETY_PERIODS = [
  {key:"4w",label:"4 sem.",days:28},{key:"2m",label:"2 mois",days:61},
  {key:"6m",label:"6 mois",days:183},{key:"all",label:"Tout",days:null},
];
export const METRICS = [
  {key:"km",label:"KM",desc:"Kilomètres / semaine"},
  {key:"time",label:"TEMPS",desc:"Minutes de course / semaine"},
  {key:"load",label:"CHARGE",desc:"Charge = km × RPE moyen"},
];
