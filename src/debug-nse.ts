import 'dotenv/config';
import { fetchTickerAnnouncements } from './fetcher';

const ticker = process.argv[2] || 'HBLPOWER';
const today  = new Date();
const past   = new Date(today);
past.setDate(today.getDate() - 120);
const pad    = (n: number) => String(n).padStart(2, '0');
const from   = `${pad(past.getDate())}-${pad(past.getMonth() + 1)}-${past.getFullYear()}`;
const to     = `${pad(today.getDate())}-${pad(today.getMonth() + 1)}-${today.getFullYear()}`;

(async () => {
  console.log(`\nFetching NSE filings for ${ticker} (last 120 days: ${from} → ${to})\n`);
  const filings = await fetchTickerAnnouncements(ticker, from, to);
  console.log(`Total: ${filings.length} filings\n`);
  filings.forEach((f: any, i: number) => {
    console.log(`[${i + 1}] desc: "${f.desc}" | hasFile: ${!!f.attchmntFile}`);
  });
})();
