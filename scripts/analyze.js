#!/usr/bin/env node
// Refreshes the ANALYSIS layer via a cheap Haiku call with capped web search.
// Token-optimized: sends only minimal prior context, not the whole state file.
const fs = require('fs');
const path = require('path');
const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.COCKPIT_MODEL || 'claude-haiku-4-5';
const STATE = path.join(__dirname, '..', 'data', 'state.json');
if(!API_KEY){ console.error('Missing ANTHROPIC_API_KEY'); process.exit(1); }

const SCHEMA = `Return ONLY minified JSON (no prose, no backticks) with these keys:
{"status_line":str,"war_status":str,"strait_status":str,"trade_posture":str,
"scenarios":[4x{"id":"A".."D","name":str,"probability":int,"pathway":str,"hormuz":str,"price":str,"trade":str}],
"transit_note":str,"transit_new":[{"date":"YYYY-MM-DD","count":int,"source":str}],
"gates":[4x{"n":1..4,"name":"Physical"/"Insurance (JWC)"/"Crew / Labour (ITF/IBF)"/"Commercial","status":"red"/"amber"/"green","detail":str,"eta":str}],
"signals":[{"label":str,"state":"not yet"/"active"/"first test"/"yes"/"no","why":str}],
"watchlist":[4-6 str],"as_of_label":"D Mon YYYY, HH:MM GMT","confidence":"high"/"medium"/"low"}
Rules: 4 scenario probabilities are ints summing to EXACTLY 100. Keep generic/public (no company/person). Be terse.`;

(async () => {
  const s = JSON.parse(fs.readFileSync(STATE,'utf8'));
  // minimal prior context only (saves tokens): last 3 transit points + current scenario names
  const prior = {
    last_transit: s.transit.series.slice(-3),
    scenarios: s.scenarios.map(x=>({id:x.id,name:x.name,p:x.probability}))
  };

  const body = {
    model: MODEL,
    max_tokens: 1500,
    tools: [{ type:'web_search_20250305', name:'web_search', max_uses: 2 }],
    messages: [{ role:'user', content:
      `Update a public Strait of Hormuz situational cockpit. Do up to 2 web searches for TODAY's status of: `+
      `Iran-US deal / Hormuz transit & de-mining / war-risk insurance (JWC) / major-carrier routing / Lebanon. `+
      `Prior context (append newest transit day, don't repeat old): ${JSON.stringify(prior)}. ${SCHEMA}` }]
  };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method:'POST',
    headers:{'content-type':'application/json','x-api-key':API_KEY,'anthropic-version':'2023-06-01'},
    body: JSON.stringify(body)
  });
  if(!res.ok){ console.error('API error', res.status, await res.text()); process.exit(1); }
  const data = await res.json();
  let txt = (data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n').trim();
  const f = txt.match(/```(?:json)?\s*([\s\S]*?)```/); if(f) txt=f[1].trim();
  const i=txt.indexOf('{'), j=txt.lastIndexOf('}'); if(i<0||j<0){ console.error('No JSON'); process.exit(1); }
  let a; try{ a=JSON.parse(txt.slice(i,j+1)); }catch(e){ console.error('Parse fail:', e.message); process.exit(1); }

  // validate
  if(!a.scenarios || a.scenarios.length!==4){ console.error('scenarios!=4'); process.exit(1); }
  const sum=a.scenarios.reduce((t,x)=>t+(+x.probability||0),0);
  if(sum!==100){ console.error('probs sum '+sum); process.exit(1); }
  if(!a.gates || a.gates.length!==4){ console.error('gates!=4'); process.exit(1); }

  // merge into state
  const colors=['#2E7D52','#C8861A','#C0562B','#B0202A'];
  s.headline={ status_line:a.status_line, war_status:a.war_status, strait_status:a.strait_status, trade_posture:a.trade_posture };
  s.scenarios=a.scenarios.map((x,k)=>({...x, color:colors[k]}));
  s.gates=a.gates; s.signals=a.signals; s.watchlist=a.watchlist;
  if(Array.isArray(a.transit_new) && a.transit_new.length){
    const seen=new Set(s.transit.series.map(p=>p.date));
    a.transit_new.forEach(p=>{ if(!seen.has(p.date)) s.transit.series.push(p); });
    s.transit.series=s.transit.series.slice(-10); // keep last 10
  }
  if(a.transit_note) s.transit.note=a.transit_note;
  s.meta.as_of_label=a.as_of_label; s.meta.data_confidence=a.confidence;
  s.meta.generated_at=new Date().toISOString();
  s.meta.generated_by='analysis: Haiku + web search · prices: EIA (free)';

  fs.writeFileSync(STATE, JSON.stringify(s,null,2)+'\n');
  console.log('Analysis updated @', a.as_of_label);
})().catch(e=>{ console.error(e); process.exit(1); });
