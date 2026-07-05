#!/usr/bin/env node
// Refreshes the ANALYSIS layer via a cheap Haiku call with capped web search.
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
  const prior = {
    last_transit: s.transit.series.slice(-3),
    scenarios: s.scenarios.map(x=>({id:x.id,name:x.name,p:x.probability}))
  };

  const body = {
    model: MODEL,
    max_tokens: 1500,
    tools: [{ type:'web_search_20250305', name:'web_search', max_uses: 2 }],
    messages: [
      { role:'user', content:
