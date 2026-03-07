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

export async function fetchAnnouncements() {
  try {
    console.log("Step 1: Pinging NSE base URL for cookies...");
    
    const initRes = await axios.get(NSE_BASE, { 
        headers: defaultHeaders,
        httpsAgent,
        timeout: 15000 
    });
    
    // Extract the raw cookie string directly from the headers
    const rawCookies = initRes.headers['set-cookie'];
    const cookieString = rawCookies ? rawCookies.map((c: string) => c.split(';')[0]).join('; ') : '';
    
    if (!cookieString) {
        throw new Error("Failed to extract session cookies from NSE.");
    }

    console.log("Step 2: Cookies secured. Waiting 3-5 seconds to bypass WAF...");
    const waitTime = Math.floor(Math.random() * 2000) + 3000;
    await new Promise(resolve => setTimeout(resolve, waitTime));

    console.log("Step 3: Fetching Corporate Announcements...");
    const apiRes = await axios.get(`${NSE_BASE}/api/corporate-announcements?index=equities`, {
      headers: {
        ...defaultHeaders,
        'Accept': '*/*',
        'Cookie': cookieString,
        'X-Requested-With': 'XMLHttpRequest', // Crucial for NSE API
        'Referer': `${NSE_BASE}/`,
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin'
      },
      httpsAgent,
      timeout: 15000
    });

    console.log(`✅ Successfully fetched ${apiRes.data.length} recent announcements.`);
    
    // Return the raw array for your worker.ts to filter
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
