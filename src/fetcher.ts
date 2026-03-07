import axios from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';

const jar = new CookieJar();
const client = wrapper(axios.create({ jar }));

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const fetchCorporateAnnouncements = async (index: string = 'equities') => {
  try {
    // Step 1: Hit base URL to bypass WAF and grab session cookies
    console.log('Fetching session cookies from NSE...');
    await client.get('https://www.nseindia.com', {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      }
    });

    // Step 2: Implement a randomized 2 to 5-second delay
    const waitTime = Math.floor(Math.random() * 3000) + 2000;
    console.log(`Waiting for ${waitTime}ms to simulate human behavior...`);
    await delay(waitTime);

    // Step 3: Fetch the corporate announcements API with the cookies
    console.log('Fetching corporate announcements...');
    const response = await client.get('https://www.nseindia.com/api/corporate-announcements', {
      params: { index },
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.5',
        'Referer': 'https://www.nseindia.com/'
      }
    });

    return response.data;
  } catch (error) {
    console.error('Error fetching data from NSE API:', error);
    throw error;
  }
};
