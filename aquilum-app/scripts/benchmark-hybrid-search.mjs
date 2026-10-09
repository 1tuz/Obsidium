const docs = [
  { id: 'car', text: 'automobile engine maintenance service oil filter', v: [1,0,0,0] },
  { id: 'travel', text: 'flight hotel itinerary vacation trip', v: [0,1,0,0] },
  { id: 'db', text: 'postgres database backup restore replication', v: [0,0,1,0] },
  { id: 'health', text: 'sleep exercise recovery wellness', v: [0,0,0,1] },
  { id: 'noise1', text: 'carpet cleaning home interior', v: [0.3,0.1,0,0] },
  { id: 'noise2', text: 'postgres conference schedule travel', v: [0,0.5,0.4,0] },
];
const queries = [
  { q: 'vehicle repair', target: 'car', v: [1,0,0,0] },
  { q: 'journey accommodation', target: 'travel', v: [0,1,0,0] },
  { q: 'sql disaster recovery', target: 'db', v: [0,0,1,0] },
  { q: 'rest fitness', target: 'health', v: [0,0,0,1] },
  { q: 'automobile oil', target: 'car', v: [1,0,0,0] },
  { q: 'hotel flight', target: 'travel', v: [0,1,0,0] },
  { q: 'postgres backup', target: 'db', v: [0,0,1,0] },
  { q: 'sleep recovery', target: 'health', v: [0,0,0,1] },
];
const tok = s => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const N = docs.length;
const df = new Map();
for (const d of docs) for (const t of new Set(tok(d.text))) df.set(t,(df.get(t)||0)+1);
function bm25(q,d){
  const dt=tok(d.text), f=new Map(); for(const t of dt) f.set(t,(f.get(t)||0)+1);
  let s=0; for(const t of tok(q)) { const n=df.get(t)||0; const idf=Math.log(1+(N-n+0.5)/(n+0.5)); const tf=f.get(t)||0; s += idf * (tf*2.2)/(tf+1.2*(0.25+0.75*dt.length/6)); } return s;
}
function cos(a,b){let d=0,aa=0,bb=0; for(let i=0;i<a.length;i++){d+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i]} return d/(Math.sqrt(aa*bb)||1)}
function ranks(q){
 const lex=[...docs].map(d=>[d,bm25(q.q,d)]).filter(([,s])=>s>0).sort((a,b)=>b[1]-a[1]).map(([d])=>d);
 const sem=[...docs].sort((a,b)=>cos(q.v,b.v)-cos(q.v,a.v));
 const scores=new Map();
 lex.forEach((d,i)=>scores.set(d.id,0.40/(61+i)));
 sem.forEach((d,i)=>scores.set(d.id,(scores.get(d.id)||0)+0.60/(61+i)+(lex.some(x=>x.id===d.id)?0.002:0)));
 const hy=[...new Set([...lex,...sem])].sort((a,b)=>scores.get(b.id)-scores.get(a.id));
 const rank = list => { const i=list.findIndex(d=>d.id===q.target); return i<0 ? Infinity : i+1; };
 return [rank(lex),rank(sem),rank(hy)];
}
const all=queries.map(ranks);
function mrr(i){return all.reduce((s,r)=>s+(Number.isFinite(r[i])?1/r[i]:0),0)/all.length}
console.log(JSON.stringify({queries:queries.length,bm25MRR:mrr(0),semanticMRR:mrr(1),hybridMRR:mrr(2),ranks:all},null,2));
