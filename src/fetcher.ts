import axios from 'axios';
import https from 'https';

const NSE_BASE = 'https://www.nseindia.com';

// Enhanced headers to perfectly mimic a real browser session
const defaultHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Cache-Control': 'max-age=0'
};

// Use a custom HTTPS agent to mimic browser TLS behavior
const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
  keepAlive: true,
});

// ── Shared: get NSE session cookies ───────────────────────────────────────
export async function getNSECookies(): Promise<string> {
  const initRes = await axios.get(NSE_BASE, {
    headers: defaultHeaders,
    httpsAgent,
    timeout: 15000
  });
  const rawCookies = initRes.headers['set-cookie'];
  const cookieString = rawCookies ? rawCookies.map((c: string) => c.split(';')[0]).join('; ') : '';
  if (!cookieString) throw new Error('Failed to extract session cookies from NSE.');
  return cookieString;
}

const apiHeaders = (cookieString: string) => ({
  ...defaultHeaders,
  'Accept': '*/*',
  'Cookie': cookieString,
  'X-Requested-With': 'XMLHttpRequest',
  'Referer': `${NSE_BASE}/`,
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin'
});

// ── Current announcements (used by worker.ts daily job) ───────────────────
export async function fetchAnnouncements() {
  try {
    console.log("Step 1: Pinging NSE base URL for cookies...");
    const cookieString = await getNSECookies();

    console.log("Step 2: Cookies secured. Waiting 3-5 seconds to bypass WAF...");
    const waitTime = Math.floor(Math.random() * 2000) + 3000;
    await new Promise(resolve => setTimeout(resolve, waitTime));

    console.log("Step 3: Fetching Corporate Announcements...");
    const apiRes = await axios.get(`${NSE_BASE}/api/corporate-announcements?index=equities`, {
      headers: apiHeaders(cookieString),
      httpsAgent,
      timeout: 15000
    });

    console.log(`✅ Successfully fetched ${apiRes.data.length} recent announcements.`);
    return apiRes.data;

  } catch (error: any) {
    console.error("❌ NSE Fetch failed:");
    console.error(error.message);
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error(`Headers:`, error.response.headers);
    }
    return [];
  }
}

// ── Historical ticker-specific announcements (used by ai-test.ts) ─────────
// Returns all filings for `symbol` between fromDate and toDate.
// Dates must be in "DD-MM-YYYY" format (as NSE expects).
export async function fetchTickerAnnouncements(
  symbol: string,
  fromDate: string,
  toDate: string
): Promise<any[]> {
  try {
    console.log(`  Pinging NSE for session cookies...`);
    const cookieString = await getNSECookies();

    const waitTime = Math.floor(Math.random() * 1000) + 2000;
    await new Promise(resolve => setTimeout(resolve, waitTime));

    // NSE corporate-announcements with symbol + date range filter
    const url = `${NSE_BASE}/api/corporate-announcements?index=equities&symbol=${symbol}&from_date=${fromDate}&to_date=${toDate}`;
    console.log(`  Querying: ${symbol} from ${fromDate} → ${toDate}`);

    const apiRes = await axios.get(url, {
      headers: apiHeaders(cookieString),
      httpsAgent,
      timeout: 15000
    });

    const data = Array.isArray(apiRes.data) ? apiRes.data : [];
    
    // Map relative attachment URLs to absolute nsearchives CDN URLs
    const processedData = data.map((ann: any) => {
      if (ann.attchmntFile && !ann.attchmntFile.startsWith('http')) {
        // e.g. "ANANTRAJ_23102024180016_OutcomeofBM.pdf" -> "https://nsearchives.nseindia.com/corporate/ANANTRAJ_23102024180016_OutcomeofBM.pdf"
        ann.attchmntFile = `https://nsearchives.nseindia.com/corporate/${ann.attchmntFile}`;
      }
      return ann;
    });

    console.log(`  NSE returned ${processedData.length} filing(s) for ${symbol}`);
    return processedData;

  } catch (error: any) {
    console.error(`  ❌ fetchTickerAnnouncements failed: ${error.message}`);
    return [];
  }
}
