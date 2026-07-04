#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.COCKPIT_MODEL || 'claude-sonnet-4-6';
const STATE_PATH = path.join(__dirname, '..', 'data', 'state.json');

if (!API_KEY) { console.error('Missing ANTHROPIC_API_KEY'); process.exit(1); }

const SCHEMA_HINT = `
Return ONLY a JSON object (no markdown, no backticks, no preamble) with EXACTLY these keys:
{
  "meta": { "generated_at": ISO8601 string (now, UTC), "generated_by": "auto (Anthropic API + web search)",
            "as_of_label": human string e.g. "24 June 2026, 06:00 GMT",
            "next_refresh_hint": "Cron runs every 6h",
            "data_confidence": "high"|"medium"|"low",
            "disclaimer": keep this exact string: "Open-source situational awareness. Analytical judgements, not market-implied probabilities. Transit counts vary by source (AIS-dark vessels, differing windows). Treat as directional. Not investment, legal, or operational advice." },
  "headline": { "status_line": one sentence, "war_status": short, "strait_status": short, "trade_posture": short (generic trade/shipping posture, NOT company-specific) },
  "scenarios": array of EXACTLY 4 objects each { "id":"A".."D", "name", "probability": integer (the four MUST sum to 100),
       "color": use "#2E7D52" (best), "#C8861A", "#C0562B", "#B0202A" (worst) in order,
       "pathway", "hormuz", "price", "trade" (generic trade/shipping implication, NOT company-specific) },
  "transit": { "unit":"commercial vessels/day through Strait of Hormuz", "prewar_baseline":100,
       "series": array of {date:"YYYY-MM-DD", count:int, source:string} for the last ~8 days (keep prior points, append newest),
       "note": one sentence on source discrepancies/trend },
  "gates": array of EXACTLY 4 { "n":1..4, "name":"Physical"/"Insurance (JWC)"/"Crew / Labour (ITF/IBF)"/"Commercial",
       "status":"red"|"amber"|"green", "detail", "eta" },
  "signals": array of { "label", "state":"not yet"|"active"|"first test"|"yes"|"no", "why" },
  "watchlist": array of 4-6 short strings,
  "prices": { "brent_usd":number, "wti_usd":number, "ttf_gas_eur":number,
       "war_risk_premium_multiple":string, "as_of":"YYYY-MM-DD" },
  "action_board": { "hold":[..], "do_now":[..], "stand_down":[..] }
}
Rules:
- The 4 scenario probabilities MUST be integers summing to exactly 100.
- Base everything on what you find via web search about the Strait of Hormuz / Iran-US deal status TODAY.
- Keep everything GENERIC and public-appropriate: this is an open situational-awareness site. Do NOT reference any specific company, person, or proprietary commercial position. Action-board items should be general trade/shipping/insurance guidance any Gulf-exposed operator could use.
- If a data point is genuinely unknown, carry forward the previous value rather than inventing one.
`;

async function main() {
  const prev = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));

  const body = {
    model: MODEL,
    max_tokens: 4000,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    messages: [{
      role: 'user',
      content:
        `You maintain a public, open-source situational-awareness cockpit on the Strait of Hormuz (SoH) ` +
        `and the Iran-US ceasefire, for a general audience of trade, shipping, and energy watchers.\n\n` +
        `Search the web for the LATEST status (today) of: the Iran-US deal / 60-day MoU window, ` +
        `Strait of Hormuz transit & de-mining, war-risk insurance (Joint War Committee / JWLA listings), ` +
        `major carrier routing, Lebanon ceasefire spillover, and Brent/WTI oil and TTF gas prices.\n\n` +
        `Then update the cockpit state. Here is the PREVIOUS state for continuity (carry forward transit history, ` +
        `append new days, keep structure identical):\n\n${JSON.stringify(prev)}\n\n${SCHEMA_HINT}`
    }]
  };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    console.error('API error', res.status, await res.text());
    process.exit(1);
  }
  const data = await res.json();

  const text = (data.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text).join('\n').trim();

  let jsonStr = text;
  const fence = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) jsonStr = fence[1].trim();
  const first = jsonStr.indexOf('{'), last = jsonStr.lastIndexOf('}');
  if (first === -1 || last === -1) { console.error('No JSON found in model output'); process.exit(1); }
  jsonStr = jsonStr.slice(first, last + 1);

  let next;
  try { next = JSON.parse(jsonStr); }
  catch (e) { console.error('JSON parse failed:', e.message); process.exit(1); }

  const errs = [];
  if (!next.scenarios || next.scenarios.length !== 4) errs.push('scenarios != 4');
  else {
    const sum = next.scenarios.reduce((a, s) => a + (Number(s.probability) || 0), 0);
    if (sum !== 100) errs.push('scenario probabilities sum to ' + sum + ' (need 100)');
  }
  if (!next.gates || next.gates.length !== 4) errs.push('gates != 4');
  if (!next.transit || !Array.isArray(next.transit.series) || next.transit.series.length < 3) errs.push('transit series too short');
  if (!next.headline || !next.headline.status_line) errs.push('missing headline');
  if (!next.prices) errs.push('missing prices');
  if (errs.length) { console.error('Validation failed:', errs.join('; ')); process.exit(1); }

  next.meta = next.meta || {};
  next.meta.generated_at = new Date().toISOString();
  next.meta.generated_by = 'auto (Anthropic API + web search)';

  fs.writeFileSync(STATE_PATH, JSON.stringify(next, null, 2) + '\n');
  console.log('state.json updated OK @', next.meta.generated_at);
}

main().catch(e => { console.error(e); process.exit(1); });
