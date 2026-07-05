#!/usr/bin/env node
// Updates ONLY the price block from the free keyless EIA oil dataset. No API key, no cost.
const fs = require('fs');
const path = require('path');
const STATE = path.join(__dirname, '..', 'data', 'state.json');
const BRENT = 'https://raw.githubusercontent.com/datasets/oil-prices/main/data/brent-daily.csv';
const WTI   = 'https://raw.githubusercontent.com/datasets/oil-prices/main/data/wti-daily.csv';

async function last(url){
  const r = await fetch(url);
  if(!r.ok) throw new Error(url+' -> '+r.status);
  const rows = (await r.text()).trim().split('\n');
  const c = rows[rows.length-1].split(',');
  return { date: c[0].trim(), price: parseFloat(c[1]) };
}

(async () => {
  const s = JSON.parse(fs.readFileSync(STATE,'utf8'));
  try {
    const b = await last(BRENT), w = await last(WTI);
    if(!isNaN(b.price)) s.prices.brent_usd = b.price;
    if(!isNaN(w.price)) s.prices.wti_usd   = w.price;
    s.prices.as_of = b.date || w.date || s.prices.as_of;
    s.meta.prices_updated_at = new Date().toISOString();
    console.log('Prices:', s.prices.brent_usd, s.prices.wti_usd, '@', s.prices.as_of);
    fs.writeFileSync(STATE, JSON.stringify(s,null,2)+'\n');
  } catch(e){
    console.error('Price fetch failed, keeping old values:', e.message);
    process.exit(0); // never fail the run over prices
  }
})();
