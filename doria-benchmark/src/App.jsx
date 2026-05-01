import { useState, useRef, useEffect } from "react";
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, LineChart, Line } from "recharts";

// ─── PALETTE ────────────────────────────────────────────────
const BG = "#0D1B2A";
const BG2 = "#152236";
const BG3 = "#1A2D42";
const GOLD = "#E8A020";
const TEXT = "#C5D4E3";
const MUTED = "#6A86A4";

const BRAND_COLORS = ["#3B82F6", "#22C55E", "#A855F7", "#F97316", "#F43F5E", "#14B8A6"];
const NOTE_COLOR = n => +n >= 4 ? "#22C55E" : +n >= 3.5 ? "#E8A020" : "#E05C5C";

// ─── CONFIG IA ──────────────────────────────────────────────
// Si aucune clé API n'est fournie via VITE_ANTHROPIC_API_KEY, l'appli passe en
// "MOCK_AI": l'onglet Analyse IA et le chat utilisent des réponses simulées.
const API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY || "";
const MOCK_AI = !API_KEY;

// ─── UTILS ──────────────────────────────────────────────────
function parseJSON(t) {
  try { const c=t.replace(/```json|```/g,"").trim(); const s=c.indexOf("{"),e=c.lastIndexOf("}"); if(s>=0&&e>s) return JSON.parse(c.slice(s,e+1)); } catch{}
  return null;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Réponse IA simulée pour l'analyse comparative
function mockAnalysis(brands) {
  const sorted = [...brands].sort((a,b)=>(b.avgNote||0)-(a.avgNote||0));
  const leader = sorted[0] || {name:"–"};
  return {
    leader: {
      name: leader.name,
      reason: `Meilleure note moyenne (${leader.avgNote}/5) avec ${leader.posRate}% de sentiment positif. Force particulière sur ${(leader.strengths||[])[0] || "plusieurs dimensions clés"}.`
    },
    commonPainPoint: "La tarification et les temps d'attente ressortent comme des points de friction quasi systématiques sur l'ensemble des marques comparées.",
    differentiators: brands.slice(0,3).map(b => ({
      brand: b.name,
      key: (b.strengths||[])[0] || `Note moyenne ${b.avgNote}/5`
    })),
    opportunities: [
      {theme:"Digital & self-service", detail:"File d'attente virtuelle et commande en ligne récurrent dans les suggestions — levier de friction #1."},
      {theme:"Restauration premium", detail:"Les marques avec la restauration la mieux notée captent 8-12 pts de satisfaction supplémentaires."},
      {theme:"Expérience VR / immersive", detail:"Différenciation technologique portée par Futuroscope — opportunité pour les challengers."},
    ],
    risks: brands.slice(0,2).map(b => ({
      brand: b.name,
      risk: (b.weaknesses||[])[0] || "Pression tarifaire croissante sur le segment famille"
    })),
  };
}

// Réponse de chat simulée
function mockChatReply(question, brands) {
  const q = question.toLowerCase();
  const top = [...brands].sort((a,b)=>(b.avgNote||0)-(a.avgNote||0))[0];
  if (q.includes("famille") || q.includes("enfant")) {
    const byFam = brands.map(b => {
      const fam = (b.socioProfiles||[]).find(p => /famille/i.test(p.name));
      return { name:b.name, pct: fam?.pct||0 };
    }).sort((a,b)=>b.pct-a.pct);
    return `D'après les profils corpus (référentiel comparable), ${byFam[0].name} concentre le plus de visites en famille avec ${byFam[0].pct}% de son corpus, devant ${byFam[1]?.name||"–"} (${byFam[1]?.pct||0}%). À combiner avec la note attractions et ambiance pour évaluer l'adéquation réelle.`;
  }
  if (q.includes("prix") || q.includes("tarif")) {
    return `Les "Prix & Tarifs" sont la catégorie la plus mal notée sur l'ensemble du benchmark (autour de 2,6–3,4/5). C'est un point de douleur commun : aucune marque ne le convertit en force. Priorité : justifier la valeur plutôt que baisser les prix.`;
  }
  if (q.includes("leader") || q.includes("meilleur")) {
    return `${top.name} tire son épingle du jeu avec ${top.avgNote}/5 et ${top.posRate}% de sentiment positif. Ses forces : ${(top.strengths||[]).slice(0,2).join(", ")||"–"}. À surveiller : ${(top.weaknesses||[])[0]||"la pression concurrentielle"}.`;
  }
  if (q.includes("innovation")) {
    const themes = new Set(brands.flatMap(b => (b.innovations||[]).map(i => i.theme)));
    return `Les thèmes d'innovation qui reviennent : ${[...themes].slice(0,4).join(", ")}. Le digital (file d'attente virtuelle, réservation mobile) est le convergent le plus fort — si tu n'y es pas encore, c'est le rattrapage prioritaire.`;
  }
  return `Question : "${question}". En mode démo (sans clé API), je ne peux donner qu'une réponse simulée. Sur la base des ${brands.length} marques comparées, ${top.name} domine le benchmark (${top.avgNote}/5). Pour une analyse libre, ajoute VITE_ANTHROPIC_API_KEY dans un fichier .env.local et relance npm run dev.`;
}

async function callClaude(prompt, maxTokens=2000) {
  if (MOCK_AI) {
    await sleep(600);
    return "[MOCK] Analyse simulée (pas de clé API).";
  }
  const res = await fetch("https://api.anthropic.com/v1/messages",{
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:maxTokens,messages:[{role:"user",content:prompt}]})
  });
  const d = await res.json();
  return (d.content||[]).map(b=>b.text||"").join("");
}

// ─── UI ATOMS ───────────────────────────────────────────────
function Logo() {
  return <div style={{display:"flex",alignItems:"center",gap:8}}>
    <svg width="26" height="26" viewBox="0 0 32 32" fill="none">
      <circle cx="16" cy="16" r="14" stroke={GOLD} strokeWidth="1.5"/>
      <circle cx="16" cy="16" r="8" fill={GOLD} opacity="0.15"/>
      <path d="M10 16 Q16 8 22 16 Q16 24 10 16Z" fill={GOLD} opacity="0.9"/>
      <circle cx="16" cy="16" r="2.5" fill={GOLD}/>
    </svg>
    <span style={{fontSize:17,fontWeight:500,letterSpacing:"0.12em",color:"#fff"}}>D<span style={{color:GOLD}}>O</span>RIA</span>
    <span style={{fontSize:12,color:MUTED,letterSpacing:"0.08em",marginLeft:2}}>BENCHMARK</span>
  </div>;
}

function Panel({children,style={}}) {
  return <div style={{background:BG2,border:"1px solid rgba(255,255,255,0.07)",borderRadius:12,padding:"16px",...style}}>{children}</div>;
}

function Btn({children,onClick,disabled,variant="primary",style={}}) {
  const base={padding:"7px 16px",borderRadius:8,fontSize:13,fontWeight:500,cursor:disabled?"not-allowed":"pointer",border:"none",opacity:disabled?0.4:1,...style};
  const vars={primary:{background:GOLD,color:"#0D1B2A"},secondary:{background:BG2,color:TEXT,border:"1px solid rgba(255,255,255,0.1)"},ghost:{background:"transparent",color:MUTED,border:"1px solid rgba(255,255,255,0.08)"},danger:{background:"rgba(224,92,92,0.15)",color:"#E05C5C",border:"1px solid rgba(224,92,92,0.3)"}};
  return <button onClick={disabled?undefined:onClick} style={{...base,...vars[variant]}}>{children}</button>;
}

function ProgressBar({value,color=GOLD,height=5}) {
  return <div style={{height,background:BG,borderRadius:3,overflow:"hidden"}}>
    <div style={{height:"100%",width:`${Math.min(100,Math.max(0,value))}%`,background:color,borderRadius:3,transition:"width .4s"}}/>
  </div>;
}

function NoteChip({note}) {
  const c = NOTE_COLOR(note);
  return <span style={{fontSize:12,fontWeight:500,color:c,background:c+"18",padding:"2px 8px",borderRadius:20,border:`1px solid ${c}33`}}>{note}/5</span>;
}

function SentimentBar({pos,neg,height=8}) {
  const neu = Math.max(0, 100-pos-neg);
  return <div style={{display:"flex",height,borderRadius:4,overflow:"hidden",gap:1}}>
    <div style={{flex:pos,background:"#22C55E",minWidth:pos?2:0}}/>
    <div style={{flex:neu,background:"#E8A020",minWidth:neu?1:0}}/>
    <div style={{flex:neg,background:"#E05C5C",minWidth:neg?2:0}}/>
  </div>;
}

// ─── TOOLTIP CUSTOM ─────────────────────────────────────────
const CustomTooltip = ({active, payload, label}) => {
  if (!active || !payload?.length) return null;
  return <div style={{background:BG3,border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,padding:"8px 12px",fontSize:12,color:TEXT}}>
    <div style={{fontWeight:500,marginBottom:4,color:"#fff"}}>{label}</div>
    {payload.map((p,i) => <div key={i} style={{color:p.color||TEXT}}>{p.name}: {typeof p.value==="number"?p.value.toFixed(1):p.value}</div>)}
  </div>;
};

// ─── IMPORT PANEL ───────────────────────────────────────────
function BrandImportCard({idx, brand, color, onChange, onRemove}) {
  return <Panel style={{padding:"14px",border:`1px solid ${color}33`,position:"relative"}}>
    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
      <div style={{width:10,height:10,borderRadius:3,background:color}}/>
      <span style={{fontSize:13,fontWeight:500,color:"#fff"}}>Marque {idx+1}</span>
      {idx >= 2 && <button onClick={onRemove} style={{marginLeft:"auto",background:"none",border:"none",color:"#E05C5C",cursor:"pointer",fontSize:16,lineHeight:1}}>×</button>}
    </div>
    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      <input
        value={brand.name}
        onChange={e => onChange({...brand, name:e.target.value})}
        placeholder="Nom de la marque (ex: Disneyland Paris)"
        style={{padding:"6px 10px",borderRadius:8,border:`1px solid ${color}44`,background:BG,color:TEXT,fontSize:12,outline:"none"}}
      />
      <textarea
        value={brand.json}
        onChange={e => onChange({...brand, json:e.target.value})}
        placeholder={`Collez ici le JSON exporté depuis DORIA Verbatim pour "${brand.name||"cette marque"}"...`}
        rows={5}
        style={{padding:"8px 10px",borderRadius:8,border:`1px solid rgba(255,255,255,0.1)`,background:BG,color:TEXT,fontSize:11,resize:"vertical",fontFamily:"monospace",outline:"none"}}
      />
      <div style={{fontSize:10,color:MUTED}}>
        Le JSON doit contenir : verbatims analysés, catégories, notes, profils, innovations, concurrence.
      </div>
    </div>
  </Panel>;
}

// ─── DONNÉES DÉMO ───────────────────────────────────────────
const DEMO_BRANDS = [
  {
    name: "Disneyland Paris",
    color: BRAND_COLORS[0],
    verbatims: 2847, avgNote: 3.8, posRate: 64, mentions: 9420,
    categories: [
      {name:"Attractions",mentions:2180,pct:23,note:4.1,pos:72,neg:28},
      {name:"Restauration",mentions:1890,pct:20,note:3.2,pos:48,neg:52},
      {name:"Ambiance & Magie",mentions:1650,pct:18,note:4.4,pos:81,neg:19},
      {name:"Personnel",mentions:1410,pct:15,note:4.0,pos:68,neg:32},
      {name:"Hébergement",mentions:940,pct:10,note:3.5,pos:55,neg:45},
      {name:"Prix & Tarifs",mentions:850,pct:9,note:2.6,pos:22,neg:78},
      {name:"Logistique",mentions:500,pct:5,note:3.1,pos:41,neg:59},
    ],
    socioProfiles: [{name:"En famille",pct:52},{name:"En couple",pct:24},{name:"Entre amis / groupe",pct:14},{name:"Solo",pct:10}],
    psychoProfiles: [{name:"Nostalgiques émotionnels",pct:38},{name:"Hédonistes exigeants",pct:27},{name:"Familles organisées",pct:22},{name:"Explorateurs curieux",pct:13}],
    innovations: [{theme:"Application mobile",suggestion:"File d'attente virtuelle généralisée"},{theme:"Restauration",suggestion:"Menu végétarien permanent"},{theme:"Accessibilité",suggestion:"Expériences PMR améliorées"}],
    timeline: [{period:"Oct 24",note:3.9,sentPct:65},{period:"Nov 24",note:3.7,sentPct:62},{period:"Déc 24",note:4.1,sentPct:72},{period:"Jan 25",note:3.5,sentPct:58},{period:"Fév 25",note:3.8,sentPct:64},{period:"Mar 25",note:3.9,sentPct:66}],
    strengths:["Magie et ambiance unique","Diversité des attractions","Expérience émotionnelle"],
    weaknesses:["Tarification excessive","Temps d'attente","Restauration décevante"],
  },
  {
    name: "Parc Astérix",
    color: BRAND_COLORS[1],
    verbatims: 1523, avgNote: 4.1, posRate: 71, mentions: 4890,
    categories: [
      {name:"Attractions",mentions:1320,pct:27,note:4.3,pos:78,neg:22},
      {name:"Restauration",mentions:980,pct:20,note:3.8,pos:61,neg:39},
      {name:"Ambiance & Magie",mentions:880,pct:18,note:4.2,pos:75,neg:25},
      {name:"Personnel",mentions:680,pct:14,note:4.4,pos:82,neg:18},
      {name:"Hébergement",mentions:200,pct:4,note:3.9,pos:64,neg:36},
      {name:"Prix & Tarifs",mentions:490,pct:10,note:3.4,pos:45,neg:55},
      {name:"Logistique",mentions:340,pct:7,note:3.6,pos:52,neg:48},
    ],
    socioProfiles: [{name:"En famille",pct:61},{name:"Entre amis / groupe",pct:18},{name:"En couple",pct:13},{name:"Solo",pct:8}],
    psychoProfiles: [{name:"Familles ludiques",pct:44},{name:"Hédonistes décontractés",pct:26},{name:"Nostalgiques culturels",pct:19},{name:"Explorateurs aventuriers",pct:11}],
    innovations: [{theme:"Univers thématique",suggestion:"Zone immersive Égypte antique"},{theme:"Application",suggestion:"Réservation repas smartphone"},{theme:"Accessibilité",suggestion:"Traductions multi-langues spectacles"}],
    timeline: [{period:"Oct 24",note:4.0,sentPct:68},{period:"Nov 24",note:4.2,sentPct:73},{period:"Déc 24",note:4.1,sentPct:70},{period:"Jan 25",note:3.9,sentPct:67},{period:"Fév 25",note:4.3,sentPct:75},{period:"Mar 25",note:4.2,sentPct:72}],
    strengths:["Personnel très apprécié","Ambiance humoristique unique","Rapport qualité/prix"],
    weaknesses:["Moins d'attractions premium","Hébergement limité","Notoriété faible"],
  },
  {
    name: "Futuroscope",
    color: BRAND_COLORS[2],
    verbatims: 1089, avgNote: 4.0, posRate: 68, mentions: 3210,
    categories: [
      {name:"Attractions",mentions:980,pct:31,note:4.2,pos:74,neg:26},
      {name:"Restauration",mentions:480,pct:15,note:3.5,pos:52,neg:48},
      {name:"Ambiance & Magie",mentions:320,pct:10,note:4.0,pos:69,neg:31},
      {name:"Personnel",mentions:430,pct:13,note:4.0,pos:70,neg:30},
      {name:"Hébergement",mentions:170,pct:5,note:3.7,pos:58,neg:42},
      {name:"Prix & Tarifs",mentions:350,pct:11,note:3.2,pos:38,neg:62},
      {name:"Logistique",mentions:250,pct:8,note:3.7,pos:58,neg:42},
    ],
    socioProfiles: [{name:"En famille",pct:44},{name:"Entre amis / groupe",pct:22},{name:"En couple",pct:18},{name:"Solo",pct:16}],
    psychoProfiles: [{name:"Passionnés tech",pct:35},{name:"Explorateurs curieux",pct:30},{name:"Familles stimulées",pct:24},{name:"Hédonistes connectés",pct:11}],
    innovations: [{theme:"VR",suggestion:"Expériences VR multi-joueurs collaboratives"},{theme:"IA",suggestion:"Guide personnalisé par IA"},{theme:"Restauration",suggestion:"Restaurant cuisine scientifique"}],
    timeline: [{period:"Oct 24",note:4.1,sentPct:69},{period:"Nov 24",note:3.9,sentPct:66},{period:"Déc 24",note:4.0,sentPct:68},{period:"Jan 25",note:3.8,sentPct:64},{period:"Fév 25",note:4.2,sentPct:71},{period:"Mar 25",note:4.1,sentPct:70}],
    strengths:["Innovation technologique leader","Renouvellement régulier","Expériences exclusives"],
    weaknesses:["Moins familial","Restauration en retrait","Prix critiqués"],
  },
];

// ─── PHASE IMPORT ───────────────────────────────────────────
function PhaseImport({onDone}) {
  const [brands, setBrands] = useState([
    {name:"", json:"", color:BRAND_COLORS[0]},
    {name:"", json:"", color:BRAND_COLORS[1]},
  ]);
  const [demoMode, setDemoMode] = useState(true); // activé par défaut pour le test

  const addBrand = () => {
    if (brands.length < 6) setBrands(b => [...b, {name:"",json:"",color:BRAND_COLORS[b.length]}]);
  };

  const valid = demoMode || brands.filter(b => b.name.trim()).length >= 2;

  const handleLaunch = () => {
    if (demoMode) {
      onDone(DEMO_BRANDS);
      return;
    }
    const parsed = brands.filter(b=>b.name.trim()).map((b, i) => {
      let data = {name:b.name, color:b.color||BRAND_COLORS[i], verbatims:0, avgNote:0, posRate:0, mentions:0, categories:[], socioProfiles:[], psychoProfiles:[], innovations:[], timeline:[], strengths:[], weaknesses:[]};
      if (b.json.trim()) {
        const obj = parseJSON(b.json);
        if (obj) Object.assign(data, {
          verbatims: obj.verbatims||0,
          avgNote: obj.avgNote||obj.avg_note||0,
          posRate: obj.posRate||obj.pos_rate||0,
          mentions: obj.mentions||0,
          categories: obj.categories||obj.cats||[],
          socioProfiles: obj.socioProfiles||obj.socio_profiles||[],
          psychoProfiles: obj.psychoProfiles||obj.psycho_profiles||obj.profils_psycho||[],
          innovations: obj.innovations||[],
          timeline: obj.timeline||[],
          strengths: obj.strengths||[],
          weaknesses: obj.weaknesses||[],
        });
      }
      return data;
    });
    onDone(parsed);
  };

  return <div style={{display:"flex",flexDirection:"column",gap:16}}>
    <Panel style={{padding:"20px",border:"1px solid rgba(232,160,32,0.2)"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12}}>
        <div>
          <h2 style={{fontSize:16,fontWeight:500,color:"#fff",margin:"0 0 6px"}}>Configurez votre benchmark</h2>
          <p style={{fontSize:12,color:MUTED,margin:0}}>Importez les données exportées depuis DORIA Verbatim pour 2 à 6 marques.</p>
        </div>
        <Btn variant={demoMode?"primary":"secondary"} onClick={()=>setDemoMode(v=>!v)}>
          {demoMode ? "✓ Mode démo actif" : "🎭 Mode démo"}
        </Btn>
      </div>
      {MOCK_AI && (
        <div style={{marginTop:12,padding:"8px 12px",background:BG,borderRadius:8,fontSize:11,color:MUTED,border:"1px solid rgba(192,132,252,0.2)"}}>
          ⓘ Aucune clé API Anthropic détectée — l'onglet "Analyse IA" et le chat utilisent des réponses simulées.
          Pour activer Claude, créez un fichier <code style={{background:BG2,padding:"1px 5px",borderRadius:4}}>.env.local</code> avec <code style={{background:BG2,padding:"1px 5px",borderRadius:4}}>VITE_ANTHROPIC_API_KEY=sk-ant-...</code>
        </div>
      )}
    </Panel>

    {demoMode ? (
      <Panel style={{padding:"20px",textAlign:"center",border:"1px solid rgba(34,197,94,0.2)"}}>
        <div style={{fontSize:28,marginBottom:8}}>🎡</div>
        <div style={{fontSize:14,fontWeight:500,color:"#fff",marginBottom:4}}>Mode démo — Parcs d'attractions France 2025</div>
        <div style={{fontSize:12,color:MUTED,marginBottom:12}}>Benchmark préconstruit : Disneyland Paris · Parc Astérix · Futuroscope</div>
        <div style={{display:"flex",justifyContent:"center",gap:16,marginBottom:16,flexWrap:"wrap"}}>
          {DEMO_BRANDS.map(b=>(
            <div key={b.name} style={{display:"flex",alignItems:"center",gap:6}}>
              <div style={{width:10,height:10,borderRadius:3,background:b.color}}/>
              <span style={{fontSize:12,color:TEXT}}>{b.name}</span>
            </div>
          ))}
        </div>
      </Panel>
    ) : (
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {brands.map((b,i) => (
          <BrandImportCard key={i} idx={i} brand={b} color={BRAND_COLORS[i]}
            onChange={nb => setBrands(bs => bs.map((x,j)=>j===i?nb:x))}
            onRemove={() => setBrands(bs => bs.filter((_,j)=>j!==i))}
          />
        ))}
        {brands.length < 6 && (
          <button onClick={addBrand} style={{padding:"10px",borderRadius:10,border:"1px dashed rgba(255,255,255,0.15)",background:"transparent",color:MUTED,cursor:"pointer",fontSize:13}}>
            + Ajouter une marque ({brands.length}/6)
          </button>
        )}
      </div>
    )}

    <Btn onClick={handleLaunch} disabled={!valid} style={{alignSelf:"flex-start",padding:"10px 24px",fontSize:14}}>
      Lancer le benchmark →
    </Btn>
  </div>;
}

// ─── VUE D'ENSEMBLE ─────────────────────────────────────────
function OverviewTab({brands}) {
  const radarData = (() => {
    const allCats = [...new Set(brands.flatMap(b => b.categories.map(c=>c.name)))];
    return allCats.slice(0,8).map(cat => {
      const row = {cat: cat.length>14?cat.slice(0,14)+"…":cat};
      brands.forEach(b => {
        const c = b.categories.find(x=>x.name===cat);
        row[b.name] = c ? c.note : null;
      });
      return row;
    });
  })();

  return <div style={{display:"flex",flexDirection:"column",gap:12}}>
    <div style={{display:"grid",gridTemplateColumns:`repeat(${brands.length},1fr)`,gap:10}}>
      {brands.map((b) => (
        <Panel key={b.name} style={{padding:"14px",border:`1px solid ${b.color}33`}}>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:10}}>
            <div style={{width:9,height:9,borderRadius:3,background:b.color}}/>
            <span style={{fontSize:12,fontWeight:500,color:"#fff"}}>{b.name}</span>
          </div>
          {[
            {l:"Verbatims",v:b.verbatims?.toLocaleString("fr")||"–",c:b.color},
            {l:"Note moy.",v:b.avgNote?`${b.avgNote}/5`:"–",c:NOTE_COLOR(b.avgNote)},
            {l:"% Positif",v:b.posRate?`${b.posRate}%`:"–",c:b.posRate>=70?"#22C55E":b.posRate>=60?"#E8A020":"#E05C5C"},
            {l:"Mentions",v:b.mentions?.toLocaleString("fr")||"–",c:TEXT},
          ].map(({l,v,c}) => (
            <div key={l} style={{marginBottom:8}}>
              <div style={{fontSize:10,color:MUTED,marginBottom:1}}>{l}</div>
              <div style={{fontSize:15,fontWeight:500,color:c}}>{v}</div>
            </div>
          ))}
          {b.avgNote > 0 && <ProgressBar value={b.avgNote*20} color={NOTE_COLOR(b.avgNote)}/>}
        </Panel>
      ))}
    </div>

    <Panel>
      <div style={{fontSize:12,fontWeight:500,color:"#fff",marginBottom:12}}>Radar — Notes par catégorie</div>
      <ResponsiveContainer width="100%" height={280}>
        <RadarChart data={radarData}>
          <PolarGrid stroke="#1A2D42"/>
          <PolarAngleAxis dataKey="cat" tick={{fill:MUTED,fontSize:10}}/>
          {brands.map((b) => (
            <Radar key={b.name} name={b.name} dataKey={b.name} stroke={b.color} fill={b.color} fillOpacity={0.12}/>
          ))}
          <Legend wrapperStyle={{fontSize:11,color:TEXT}}/>
        </RadarChart>
      </ResponsiveContainer>
    </Panel>

    <Panel>
      <div style={{fontSize:12,fontWeight:500,color:"#fff",marginBottom:12}}>Note moyenne globale</div>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={brands.map(b=>({name:b.name,note:b.avgNote,fill:b.color}))} margin={{top:5,right:10,left:-20,bottom:5}}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1A2D42"/>
          <XAxis dataKey="name" tick={{fill:MUTED,fontSize:10}} axisLine={false}/>
          <YAxis domain={[0,5]} tick={{fill:MUTED,fontSize:10}} axisLine={false}/>
          <Tooltip content={<CustomTooltip/>}/>
          <Bar dataKey="note" name="Note" radius={[4,4,0,0]}>
            {brands.map((b,i) => <Cell key={i} fill={b.color}/>)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Panel>
  </div>;
}

// ─── CATÉGORIES ─────────────────────────────────────────────
function CategoriesTab({brands}) {
  const allCats = [...new Set(brands.flatMap(b => b.categories.map(c=>c.name)))];
  const [selCat, setSelCat] = useState("Toutes");

  const cats = selCat === "Toutes" ? allCats : [selCat];

  const chartData = cats.map(cat => {
    const row = {cat: cat.length>16?cat.slice(0,16)+"…":cat};
    brands.forEach(b => {
      const c = b.categories.find(x=>x.name===cat);
      row[`${b.name}_note`] = c?.note||null;
      row[`${b.name}_pos`] = c?.pos||null;
    });
    return row;
  });

  return <div style={{display:"flex",flexDirection:"column",gap:12}}>
    <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
      {["Toutes",...allCats].map(c => (
        <button key={c} onClick={()=>setSelCat(c)} style={{padding:"4px 12px",borderRadius:20,fontSize:11,border:"none",cursor:"pointer",
          background:selCat===c?GOLD:BG2,color:selCat===c?"#0D1B2A":MUTED}}>
          {c}
        </button>
      ))}
    </div>

    <Panel>
      <div style={{fontSize:12,fontWeight:500,color:"#fff",marginBottom:12}}>Notes par catégorie — comparaison</div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chartData} margin={{top:5,right:10,left:-20,bottom:40}}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1A2D42"/>
          <XAxis dataKey="cat" tick={{fill:MUTED,fontSize:9}} angle={-25} textAnchor="end" axisLine={false}/>
          <YAxis domain={[0,5]} tick={{fill:MUTED,fontSize:10}} axisLine={false}/>
          <Tooltip content={<CustomTooltip/>}/>
          <Legend wrapperStyle={{fontSize:10,color:TEXT,marginTop:8}}/>
          {brands.map(b => (
            <Bar key={b.name} dataKey={`${b.name}_note`} name={b.name} fill={b.color} radius={[3,3,0,0]}/>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </Panel>

    {cats.map(cat => (
      <Panel key={cat}>
        <div style={{fontSize:13,fontWeight:500,color:"#fff",marginBottom:10}}>{cat}</div>
        <div style={{display:"grid",gridTemplateColumns:`repeat(${brands.length},1fr)`,gap:8}}>
          {brands.map(b => {
            const c = b.categories.find(x=>x.name===cat);
            if (!c) return <div key={b.name} style={{padding:"8px",background:BG,borderRadius:8,opacity:.4}}>
              <div style={{fontSize:10,color:MUTED}}>{b.name}</div>
              <div style={{fontSize:11,color:MUTED,marginTop:4}}>Non disponible</div>
            </div>;
            return <div key={b.name} style={{padding:"10px",background:BG,borderRadius:8,border:`1px solid ${b.color}22`}}>
              <div style={{fontSize:10,color:b.color,fontWeight:500,marginBottom:6}}>{b.name}</div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                <NoteChip note={c.note}/>
                <span style={{fontSize:10,color:MUTED}}>{c.mentions} men.</span>
              </div>
              <SentimentBar pos={c.pos} neg={c.neg}/>
              <div style={{display:"flex",justifyContent:"space-between",marginTop:4}}>
                <span style={{fontSize:9,color:"#22C55E"}}>+{c.pos}%</span>
                <span style={{fontSize:9,color:"#E05C5C"}}>−{c.neg}%</span>
              </div>
            </div>;
          })}
        </div>
      </Panel>
    ))}
  </div>;
}

// ─── ÉVOLUTION TEMPORELLE ───────────────────────────────────
function TimelineTab({brands}) {
  const hasTL = brands.some(b=>b.timeline?.length>0);
  if (!hasTL) return <Panel><p style={{color:MUTED,fontSize:13}}>Aucune donnée temporelle disponible. Assurez-vous que les verbatims importés contiennent des dates.</p></Panel>;

  const periods = [...new Set(brands.flatMap(b=>(b.timeline||[]).map(t=>t.period)))];
  const noteData = periods.map(p => {
    const row = {period:p};
    brands.forEach(b => {
      const t = (b.timeline||[]).find(x=>x.period===p);
      if (t) row[b.name] = t.note;
    });
    return row;
  });
  const sentData = periods.map(p => {
    const row = {period:p};
    brands.forEach(b => {
      const t = (b.timeline||[]).find(x=>x.period===p);
      if (t) row[b.name] = t.sentPct;
    });
    return row;
  });

  return <div style={{display:"flex",flexDirection:"column",gap:12}}>
    <Panel>
      <div style={{fontSize:12,fontWeight:500,color:"#fff",marginBottom:12}}>Évolution de la note moyenne</div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={noteData} margin={{top:5,right:10,left:-20,bottom:5}}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1A2D42"/>
          <XAxis dataKey="period" tick={{fill:MUTED,fontSize:10}} axisLine={false}/>
          <YAxis domain={[1,5]} tick={{fill:MUTED,fontSize:10}} axisLine={false}/>
          <Tooltip content={<CustomTooltip/>}/>
          <Legend wrapperStyle={{fontSize:10,color:TEXT}}/>
          {brands.map(b => (
            <Line key={b.name} type="monotone" dataKey={b.name} stroke={b.color} strokeWidth={2} dot={{fill:b.color,r:4}} activeDot={{r:6}}/>
          ))}
        </LineChart>
      </ResponsiveContainer>
    </Panel>
    <Panel>
      <div style={{fontSize:12,fontWeight:500,color:"#fff",marginBottom:12}}>Évolution du sentiment positif (%)</div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={sentData} margin={{top:5,right:10,left:-20,bottom:5}}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1A2D42"/>
          <XAxis dataKey="period" tick={{fill:MUTED,fontSize:10}} axisLine={false}/>
          <YAxis domain={[0,100]} tick={{fill:MUTED,fontSize:10}} axisLine={false}/>
          <Tooltip content={<CustomTooltip/>}/>
          <Legend wrapperStyle={{fontSize:10,color:TEXT}}/>
          {brands.map(b => (
            <Line key={b.name} type="monotone" dataKey={b.name} stroke={b.color} strokeWidth={2} strokeDasharray="5 3" dot={{fill:b.color,r:3}}/>
          ))}
        </LineChart>
      </ResponsiveContainer>
    </Panel>
  </div>;
}

// ─── PROFILS ─────────────────────────────────────────────────
function ProfilesTab({brands}) {
  const [referentiel, setReferentiel] = useState("socio");

  const socioKeys = [...new Set(brands.flatMap(b => (b.socioProfiles||[]).map(p => p.name)))];

  return <div style={{display:"flex",flexDirection:"column",gap:12}}>
    <Panel style={{padding:"12px 16px",border:"1px solid rgba(232,160,32,0.2)"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
        <div style={{display:"flex",gap:6}}>
          <button onClick={()=>setReferentiel("socio")} style={{padding:"5px 14px",borderRadius:7,fontSize:12,border:"none",cursor:"pointer",
            background:referentiel==="socio"?GOLD:"transparent",color:referentiel==="socio"?"#0D1B2A":MUTED,fontWeight:referentiel==="socio"?500:400}}>
            Référentiel 1 — Corpus
          </button>
          <button onClick={()=>setReferentiel("psycho")} style={{padding:"5px 14px",borderRadius:7,fontSize:12,border:"none",cursor:"pointer",
            background:referentiel==="psycho"?"#c084fc":"transparent",color:referentiel==="psycho"?"#0D1B2A":MUTED,fontWeight:referentiel==="psycho"?500:400}}>
            Référentiel 2 — Psychographique IA
          </button>
        </div>
        <span style={{fontSize:10,color:MUTED,fontStyle:"italic"}}>
          {referentiel==="socio"
            ? "Contexte de visite déclaré — comparable directement entre marques"
            : "Profils inférés par l'IA — libellés propres à chaque marque, structures comparables"}
        </span>
      </div>
    </Panel>

    {referentiel === "socio" && <>
      <div style={{background:"#0D1B2A",borderRadius:8,padding:"8px 14px",border:"1px solid rgba(59,130,246,0.2)",fontSize:11,color:"#60a5fa"}}>
        <strong>Source :</strong> champ <code style={{background:"#152236",padding:"1px 5px",borderRadius:4}}>profil</code> du CSV importé dans DORIA Verbatim — données déclaratives. Ces libellés sont identiques entre marques : la comparaison directe est valide.
      </div>

      <div style={{display:"grid",gridTemplateColumns:`repeat(${Math.min(brands.length,3)},1fr)`,gap:10}}>
        {brands.map(b => {
          const profiles = b.socioProfiles||[];
          return <Panel key={b.name} style={{border:`1px solid ${b.color}22`}}>
            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:12}}>
              <div style={{width:8,height:8,borderRadius:2,background:b.color}}/>
              <span style={{fontSize:12,fontWeight:500,color:"#fff"}}>{b.name}</span>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:7}}>
              {profiles.length > 0 ? profiles.map(p => (
                <div key={p.name}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                    <span style={{fontSize:11,color:TEXT}}>{p.name}</span>
                    <span style={{fontSize:11,color:b.color,fontWeight:500}}>{p.pct}%</span>
                  </div>
                  <ProgressBar value={p.pct} color={b.color}/>
                </div>
              )) : <span style={{fontSize:11,color:MUTED,fontStyle:"italic"}}>Non renseigné</span>}
            </div>
          </Panel>;
        })}
      </div>

      {socioKeys.length > 0 && (
        <Panel>
          <div style={{fontSize:12,fontWeight:500,color:"#fff",marginBottom:4}}>Comparaison directe par contexte de visite</div>
          <div style={{fontSize:10,color:MUTED,marginBottom:12,fontStyle:"italic"}}>
            Seul ce référentiel permet une comparaison directe — les libellés sont communs à toutes les marques.
          </div>
          {socioKeys.map(key => (
            <div key={key} style={{marginBottom:12}}>
              <div style={{fontSize:11,fontWeight:500,color:TEXT,marginBottom:6}}>{key}</div>
              {brands.map(b => {
                const p = (b.socioProfiles||[]).find(x => x.name === key);
                if (!p) return null;
                return <div key={b.name} style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                  <div style={{width:8,height:8,borderRadius:2,background:b.color,flexShrink:0}}/>
                  <span style={{fontSize:10,color:MUTED,width:130,flexShrink:0}}>{b.name}</span>
                  <div style={{flex:1}}><ProgressBar value={p.pct} color={b.color} height={6}/></div>
                  <span style={{fontSize:10,color:b.color,fontWeight:500,width:32,textAlign:"right"}}>{p.pct}%</span>
                </div>;
              })}
            </div>
          ))}
        </Panel>
      )}
    </>}

    {referentiel === "psycho" && <>
      <div style={{background:"#0D1B2A",borderRadius:8,padding:"8px 14px",border:"1px solid rgba(192,132,252,0.25)",fontSize:11,color:"#c084fc"}}>
        <strong>Source :</strong> analyse psychographique DORIA — profils <em>inférés par l'IA</em>. Les libellés sont générés pour chaque marque indépendamment et ne sont <strong>pas directement comparables</strong>. Seules les <strong>structures</strong> sont interprétables.
      </div>

      <div style={{display:"grid",gridTemplateColumns:`repeat(${Math.min(brands.length,3)},1fr)`,gap:10}}>
        {brands.map(b => {
          const profiles = b.psychoProfiles||[];
          return <Panel key={b.name} style={{border:"1px solid rgba(192,132,252,0.15)"}}>
            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
              <div style={{width:8,height:8,borderRadius:2,background:b.color}}/>
              <span style={{fontSize:12,fontWeight:500,color:"#fff"}}>{b.name}</span>
            </div>
            <div style={{fontSize:10,color:"#c084fc",marginBottom:10,fontStyle:"italic"}}>Profils propres à cette marque</div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {profiles.length > 0 ? profiles.map((p) => (
                <div key={p.name} style={{background:BG,borderRadius:7,padding:"7px 10px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                    <span style={{fontSize:11,color:"#c084fc",fontWeight:500}}>{p.name}</span>
                    <span style={{fontSize:11,color:b.color,fontWeight:500}}>{p.pct}%</span>
                  </div>
                  <ProgressBar value={p.pct} color={b.color} height={5}/>
                </div>
              )) : <span style={{fontSize:11,color:MUTED,fontStyle:"italic"}}>Analyse psycho non disponible</span>}
            </div>
          </Panel>;
        })}
      </div>

      <Panel>
        <div style={{fontSize:12,fontWeight:500,color:"#fff",marginBottom:4}}>Comparaison structurelle — ce qui est interprétable</div>
        <div style={{fontSize:10,color:MUTED,marginBottom:12,fontStyle:"italic"}}>
          Concentration du profil dominant (plus c'est élevé, plus la clientèle est homogène)
        </div>
        {brands.map(b => {
          const profiles = b.psychoProfiles||[];
          if (!profiles.length) return null;
          const top = [...profiles].sort((a,b) => b.pct - a.pct)[0];
          const entropy = profiles.length;
          return <div key={b.name} style={{marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:3,alignItems:"baseline"}}>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <div style={{width:8,height:8,borderRadius:2,background:b.color}}/>
                <span style={{fontSize:11,color:TEXT}}>{b.name}</span>
              </div>
              <span style={{fontSize:10,color:MUTED}}>Profil dominant : <strong style={{color:"#c084fc"}}>{top.name}</strong> ({top.pct}%) · {entropy} profils</span>
            </div>
            <ProgressBar value={top.pct} color={b.color} height={7}/>
          </div>;
        })}
        <div style={{marginTop:12,padding:"8px 10px",background:BG,borderRadius:8,fontSize:10,color:MUTED,fontStyle:"italic",borderLeft:"3px solid #c084fc"}}>
          ⚠️ Ne pas additionner ou moyenner des profils psycho entre marques. Chaque libellé est contextuel.
        </div>
      </Panel>
    </>}
  </div>;
}

// ─── INNOVATIONS ─────────────────────────────────────────────
function InnovationsTab({brands}) {
  return <div style={{display:"flex",flexDirection:"column",gap:12}}>
    <div style={{display:"grid",gridTemplateColumns:`repeat(${Math.min(brands.length,3)},1fr)`,gap:10}}>
      {brands.map(b => (
        <Panel key={b.name} style={{border:`1px solid #A855F733`}}>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:12}}>
            <div style={{width:8,height:8,borderRadius:2,background:b.color}}/>
            <span style={{fontSize:12,fontWeight:500,color:"#fff"}}>{b.name}</span>
            <span style={{marginLeft:"auto",fontSize:11,color:"#A855F7",background:"rgba(168,85,247,0.12)",padding:"1px 8px",borderRadius:20}}>
              {(b.innovations||[]).length} idées
            </span>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:7}}>
            {(b.innovations||[]).map((inn,i) => (
              <div key={i} style={{background:BG,borderRadius:8,padding:"8px 10px",border:"1px solid rgba(168,85,247,0.1)"}}>
                <div style={{fontSize:10,color:"#A855F7",fontWeight:500,marginBottom:3}}>💡 {inn.theme}</div>
                <div style={{fontSize:10,color:TEXT}}>{inn.suggestion}</div>
              </div>
            ))}
            {(!b.innovations||b.innovations.length===0) && <span style={{fontSize:11,color:MUTED,fontStyle:"italic"}}>Aucune innovation détectée</span>}
          </div>
        </Panel>
      ))}
    </div>

    <Panel>
      <div style={{fontSize:12,fontWeight:500,color:"#fff",marginBottom:10}}>Thèmes d'innovation convergents</div>
      {(() => {
        const themes = {};
        brands.forEach(b => {
          (b.innovations||[]).forEach(inn => {
            const t = inn.theme;
            if (!themes[t]) themes[t] = [];
            themes[t].push(b.name);
          });
        });
        const shared = Object.entries(themes).filter(([,bs])=>bs.length>1);
        if (!shared.length) return <span style={{fontSize:11,color:MUTED,fontStyle:"italic"}}>Aucun thème commun détecté.</span>;
        return shared.map(([theme, bnames]) => (
          <div key={theme} style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
            <span style={{fontSize:11,color:"#A855F7",fontWeight:500,minWidth:120}}>{theme}</span>
            <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
              {bnames.map(bn => {
                const b = brands.find(x=>x.name===bn);
                return <span key={bn} style={{fontSize:10,padding:"2px 8px",borderRadius:20,background:`${b?.color||GOLD}18`,color:b?.color||GOLD,border:`1px solid ${b?.color||GOLD}33`}}>{bn}</span>;
              })}
            </div>
          </div>
        ));
      })()}
    </Panel>
  </div>;
}

// ─── ANALYSE IA ──────────────────────────────────────────────
function AIAnalysisTab({brands}) {
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);
  const endRef = useRef();

  useEffect(() => { endRef.current?.scrollIntoView({behavior:"smooth"}); }, [messages]);

  const buildContext = () => {
    return `Tu es expert en analyse CX et benchmark concurrentiel.
Voici les données de benchmark DORIA pour ${brands.length} marques.

${brands.map(b => `
=== ${b.name} ===
Verbatims: ${b.verbatims} | Note moy: ${b.avgNote}/5 | % Positif: ${b.posRate}%
Top catégories: ${(b.categories||[]).slice(0,4).map(c=>`${c.name} (${c.note}/5, ${c.pos}% pos)`).join(", ")}
Forces: ${(b.strengths||[]).join(", ")||"non renseignées"}
Faiblesses: ${(b.weaknesses||[]).join(", ")||"non renseignées"}
`).join("")}
Réponds en français, de façon synthétique et actionnable.`;
  };

  const generateAnalysis = async () => {
    setLoading(true);
    try {
      if (MOCK_AI) {
        await sleep(800);
        setAnalysis(mockAnalysis(brands));
      } else {
        const prompt = buildContext() + `\n\nGénère une analyse comparative structurée en JSON avec exactement ce format:
{"leader":{"name":"...","reason":"..."},"commonPainPoint":"...","differentiators":[{"brand":"...","key":"..."}],"opportunities":[{"theme":"...","detail":"..."}],"risks":[{"brand":"...","risk":"..."}]}`;
        const raw = await callClaude(prompt, 1200);
        const obj = parseJSON(raw);
        setAnalysis(obj || mockAnalysis(brands));
      }
    } catch { setAnalysis(mockAnalysis(brands)); }
    setLoading(false);
  };

  const sendChat = async () => {
    const q = question.trim();
    if (!q || chatLoading) return;
    setQuestion("");
    const newMsgs = [...messages, {role:"user",content:q}];
    setMessages(newMsgs);
    setChatLoading(true);
    try {
      if (MOCK_AI) {
        await sleep(500);
        setMessages(m=>[...m,{role:"assistant",content: mockChatReply(q, brands)}]);
      } else {
        const res = await fetch("https://api.anthropic.com/v1/messages",{
          method:"POST",
          headers:{
            "Content-Type":"application/json",
            "x-api-key": API_KEY,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true",
          },
          body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:800,system:buildContext(),messages:newMsgs.map(m=>({role:m.role,content:m.content}))})
        });
        const d = await res.json();
        const reply = (d.content||[]).map(b=>b.text||"").join("");
        setMessages(m=>[...m,{role:"assistant",content:reply}]);
      }
    } catch(e) { setMessages(m=>[...m,{role:"assistant",content:`Erreur : ${e.message}`}]); }
    setChatLoading(false);
  };

  return <div style={{display:"flex",flexDirection:"column",gap:12}}>
    {MOCK_AI && (
      <div style={{background:BG2,borderRadius:8,padding:"8px 12px",fontSize:11,color:"#c084fc",border:"1px solid rgba(192,132,252,0.25)"}}>
        🧪 Mode simulation activé — réponses générées localement, pas d'appel à Claude.
      </div>
    )}

    {!analysis && (
      <Panel style={{textAlign:"center",padding:"24px"}}>
        <div style={{fontSize:24,marginBottom:8}}>🤖</div>
        <div style={{fontSize:13,color:"#fff",marginBottom:4}}>Analyse comparative IA</div>
        <div style={{fontSize:11,color:MUTED,marginBottom:16}}>
          {MOCK_AI ? "Génère une analyse simulée à partir des données mockées." : "Claude analyse les données de toutes les marques et identifie les insights clés."}
        </div>
        <Btn onClick={generateAnalysis} disabled={loading}>
          {loading ? "Analyse en cours…" : "Générer l'analyse"}
        </Btn>
      </Panel>
    )}

    {analysis && (
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {analysis.leader && <Panel style={{border:"1px solid rgba(232,160,32,0.3)"}}>
          <div style={{fontSize:11,color:GOLD,fontWeight:500,marginBottom:4}}>🏆 LEADER DU BENCHMARK</div>
          <div style={{fontSize:14,fontWeight:500,color:"#fff"}}>{analysis.leader.name}</div>
          <div style={{fontSize:12,color:TEXT,marginTop:4}}>{analysis.leader.reason}</div>
        </Panel>}

        {analysis.commonPainPoint && <Panel style={{border:"1px solid rgba(224,92,92,0.2)"}}>
          <div style={{fontSize:11,color:"#E05C5C",fontWeight:500,marginBottom:4}}>⚠️ POINT DE DOULEUR COMMUN</div>
          <div style={{fontSize:12,color:TEXT}}>{analysis.commonPainPoint}</div>
        </Panel>}

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          {analysis.differentiators?.length > 0 && <Panel>
            <div style={{fontSize:11,color:"#22C55E",fontWeight:500,marginBottom:8}}>✦ DIFFÉRENCIATEURS CLÉS</div>
            {analysis.differentiators.map((d,i) => (
              <div key={i} style={{marginBottom:6}}>
                <span style={{fontSize:10,color:brands.find(b=>b.name===d.brand)?.color||GOLD,fontWeight:500}}>{d.brand}: </span>
                <span style={{fontSize:10,color:TEXT}}>{d.key}</span>
              </div>
            ))}
          </Panel>}

          {analysis.risks?.length > 0 && <Panel>
            <div style={{fontSize:11,color:"#F97316",fontWeight:500,marginBottom:8}}>🚨 RISQUES IDENTIFIÉS</div>
            {analysis.risks.map((r,i) => (
              <div key={i} style={{marginBottom:6}}>
                <span style={{fontSize:10,color:TEXT,fontWeight:500}}>{r.brand}: </span>
                <span style={{fontSize:10,color:MUTED}}>{r.risk}</span>
              </div>
            ))}
          </Panel>}
        </div>

        {analysis.opportunities?.length > 0 && <Panel>
          <div style={{fontSize:11,color:"#A855F7",fontWeight:500,marginBottom:8}}>💡 OPPORTUNITÉS DÉTECTÉES</div>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {analysis.opportunities.map((o,i) => (
              <div key={i} style={{background:BG,borderRadius:8,padding:"8px 10px"}}>
                <div style={{fontSize:10,color:"#A855F7",fontWeight:500,marginBottom:2}}>{o.theme}</div>
                <div style={{fontSize:10,color:TEXT}}>{o.detail}</div>
              </div>
            ))}
          </div>
        </Panel>}

        <Btn variant="ghost" onClick={()=>setAnalysis(null)} style={{alignSelf:"flex-start",fontSize:11}}>Regénérer</Btn>
      </div>
    )}

    <Panel style={{padding:0,overflow:"hidden"}}>
      <div style={{padding:"10px 14px",borderBottom:"1px solid rgba(255,255,255,0.07)",display:"flex",alignItems:"center",gap:8}}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <span style={{fontSize:12,fontWeight:500,color:TEXT}}>Questions sur le benchmark</span>
      </div>
      {messages.length > 0 && (
        <div style={{maxHeight:260,overflowY:"auto",padding:"10px 14px",display:"flex",flexDirection:"column",gap:8}}>
          {messages.map((m,i) => (
            <div key={i} style={{display:"flex",justifyContent:m.role==="user"?"flex-end":"flex-start"}}>
              <div style={{maxWidth:"85%",padding:"7px 12px",borderRadius:m.role==="user"?"10px 10px 2px 10px":"10px 10px 10px 2px",
                background:m.role==="user"?GOLD:BG3,color:m.role==="user"?"#0D1B2A":TEXT,fontSize:12,lineHeight:1.6,whiteSpace:"pre-wrap"}}>{m.content}</div>
            </div>
          ))}
          {chatLoading && <div style={{display:"flex"}}><div style={{padding:"8px 12px",borderRadius:"10px 10px 10px 2px",background:BG3,fontSize:12,color:MUTED}}>…</div></div>}
          <div ref={endRef}/>
        </div>
      )}
      <div style={{padding:"10px 14px",display:"flex",gap:8}}>
        <input value={question} onChange={e=>setQuestion(e.target.value)}
          onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendChat();}}}
          placeholder='Ex: "Quelle marque capitalise le mieux sur les familles ?"'
          style={{flex:1,padding:"7px 12px",borderRadius:8,border:"1px solid rgba(255,255,255,0.1)",background:BG2,color:TEXT,fontSize:12,outline:"none"}}
          disabled={chatLoading}
        />
        <button onClick={sendChat} disabled={!question.trim()||chatLoading}
          style={{padding:"7px 14px",borderRadius:8,background:question.trim()&&!chatLoading?GOLD:BG2,color:question.trim()&&!chatLoading?"#0D1B2A":MUTED,border:"none",fontSize:12,fontWeight:500,cursor:question.trim()&&!chatLoading?"pointer":"default"}}>
          Envoyer
        </button>
        {messages.length>0&&<button onClick={()=>setMessages([])} style={{padding:"7px 10px",borderRadius:8,background:"transparent",color:MUTED,border:"1px solid rgba(255,255,255,0.08)",fontSize:11,cursor:"pointer"}}>✕</button>}
      </div>
    </Panel>
  </div>;
}

// ─── RÉSULTATS PRINCIPAUX ────────────────────────────────────
function BenchmarkResults({brands, onReset}) {
  const [tab, setTab] = useState("overview");

  const tabs = [
    ["overview","Vue d'ensemble"],
    ["categories","Catégories"],
    ["timeline","Évolution"],
    ["profiles","Profils"],
    ["innovations","Innovations"],
    ["ai","Analyse IA"],
  ];

  const tabStyle = active => ({
    padding:"6px 14px", fontSize:12, fontWeight:active?500:400,
    cursor:"pointer", border:"none", borderRadius:6,
    background:active?GOLD:"transparent",
    color:active?"#0D1B2A":MUTED,
    transition:"all .15s",
  });

  const totalVerbatims = brands.reduce((a,b)=>a+(b.verbatims||0),0);

  return <div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
      <div>
        <h2 style={{fontSize:15,fontWeight:500,color:"#fff",margin:"0 0 3px"}}>Benchmark — {brands.length} marques</h2>
        <p style={{fontSize:12,color:MUTED,margin:0}}>
          {totalVerbatims.toLocaleString("fr")} verbatims · {brands.map(b=>`${b.name} (${b.avgNote}/5)`).join(" · ")}
        </p>
      </div>
      <Btn variant="ghost" onClick={onReset} style={{fontSize:12}}>Reset</Btn>
    </div>

    <div style={{display:"flex",gap:10,marginBottom:12,flexWrap:"wrap"}}>
      {brands.map(b => (
        <div key={b.name} style={{display:"flex",alignItems:"center",gap:5,padding:"4px 10px",borderRadius:20,background:BG2,border:`1px solid ${b.color}44`}}>
          <div style={{width:8,height:8,borderRadius:2,background:b.color}}/>
          <span style={{fontSize:11,color:TEXT}}>{b.name}</span>
          <span style={{fontSize:11,color:b.color,fontWeight:500}}>{b.avgNote}/5</span>
        </div>
      ))}
    </div>

    <div style={{display:"flex",gap:4,marginBottom:12,flexWrap:"wrap"}}>
      {tabs.map(([k,l]) => <button key={k} style={tabStyle(tab===k)} onClick={()=>setTab(k)}>{l}</button>)}
    </div>

    {tab==="overview" && <OverviewTab brands={brands}/>}
    {tab==="categories" && <CategoriesTab brands={brands}/>}
    {tab==="timeline" && <TimelineTab brands={brands}/>}
    {tab==="profiles" && <ProfilesTab brands={brands}/>}
    {tab==="innovations" && <InnovationsTab brands={brands}/>}
    {tab==="ai" && <AIAnalysisTab brands={brands}/>}
  </div>;
}

// ─── APP ─────────────────────────────────────────────────────
export default function App() {
  const [phase, setPhase] = useState("import");
  const [brands, setBrands] = useState([]);

  return <div style={{background:BG,borderRadius:16,padding:"22px 26px",fontFamily:"'Trebuchet MS', sans-serif",color:TEXT,minHeight:400}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
      <Logo/>
      <div style={{fontSize:11,color:MUTED}}>
        {phase==="import" ? "Configuration" : `${brands.length} marques comparées`}
      </div>
    </div>

    {phase==="import" && (
      <PhaseImport onDone={data => { setBrands(data); setPhase("results"); }}/>
    )}
    {phase==="results" && brands.length > 0 && (
      <BenchmarkResults brands={brands} onReset={()=>{ setBrands([]); setPhase("import"); }}/>
    )}
  </div>;
}
