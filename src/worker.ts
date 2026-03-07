import 'dotenv/config';
import { connectDB, Watchlist, IWatchlist } from './db';
import { fetchAnnouncements } from './fetcher';
import { sendTelegramAlert } from './bot';
import { processQuarterlyFilings } from './ai';

// These are the REAL field names from the NSE API (verified via smoke test)
interface NSEAnnouncement {
  symbol: string;
  desc: string;           // announcement subject/description
  dt: string;             // date
  attchmntFile: string;   // PDF attachment URL
  sm_name: string;        // company name
  sm_isin: string;
  an_dt: string;
  sort_date: string;
  seq_id: string;
  smIndustry: string;
  orgid: string;
  attchmntText: string;
  exchdisstime: string;
}

// Subjects we care about — matched against the `desc` field
const IMPORTANT_SUBJECTS = [
  'Financial Results',
  'Earnings Call Transcript',
  'Shareholding Pattern',
  'Updates',
  'General Updates',
];

const isImportantSubject = (desc: string): boolean => {
  return IMPORTANT_SUBJECTS.some(s => desc?.toLowerCase().includes(s.toLowerCase()));
};

const processAnnouncements = async (watchlistDocs: IWatchlist[]) => {
  try {
    // NSE returns a flat array — NOT { data: [...] }
    const announcements: NSEAnnouncement[] = await fetchAnnouncements();

    if (!Array.isArray(announcements) || announcements.length === 0) {
      console.log('No announcements found.');
      return;
    }

    console.log(`Fetched ${announcements.length} total announcements from NSE.`);

    const watchlistTickers = watchlistDocs.map(d => d.ticker);

    // Filter: only our watchlist stocks + important subjects (using `desc` field)
    const relevant = announcements.filter(ann =>
      watchlistTickers.includes(ann.symbol) && isImportantSubject(ann.desc)
    );

    console.log(`${relevant.length} relevant announcements for our watchlist.`);

    // Group relevant announcements by ticker
    const byTicker: Record<string, NSEAnnouncement[]> = {};
    for (const ann of relevant) {
      if (!byTicker[ann.symbol]) byTicker[ann.symbol] = [];
      byTicker[ann.symbol].push(ann);
    }

    for (const doc of watchlistDocs) {
      const { ticker, masterPrompt } = doc;
      const tickerAnns = byTicker[ticker];
      if (!tickerAnns) continue;

      let financialResultsUrl: string | null = null;
      let transcriptUrl: string | null = null;

      for (const ann of tickerAnns) {
        const desc = ann.desc || '';

        // ── Insider Trades / Block Deals (hide in "Updates") ──
        if (desc.toLowerCase().includes('updates')) {
          const detail = (ann.attchmntText || '').toLowerCase();
          if (detail.includes('sast') || detail.includes('bulk deal') || detail.includes('insider') || detail.includes('block deal')) {
            const alertMsg =
              `🔥 *Insider/Block Deal Alert: ${ticker}* 🔥\n\n` +
              `*Subject:* ${desc}\n` +
              `*Company:* ${ann.sm_name}\n` +
              `[📎 Attachment](${ann.attchmntFile})`;
            await sendTelegramAlert(alertMsg);
          }
        }

        // ── Shareholding Pattern ──
        if (desc.toLowerCase().includes('shareholding pattern')) {
          const alertMsg =
            `📊 *Shareholding Update: ${ticker}*\n\n` +
            `*Company:* ${ann.sm_name}\n` +
            `[📎 View Pattern](${ann.attchmntFile})`;
          await sendTelegramAlert(alertMsg);
        }

        // ── Financial Results & Transcript (for Gemini analysis) ──
        if (desc.toLowerCase().includes('financial results')) {
          financialResultsUrl = ann.attchmntFile;
        }
        if (desc.toLowerCase().includes('transcript')) {
          transcriptUrl = ann.attchmntFile;
        }
      }

      // If BOTH Financial Results and Transcript are available → trigger AI engine
      if (financialResultsUrl && transcriptUrl) {
        const now = new Date();
        const quarterStr = `Q${Math.ceil((now.getMonth() + 1) / 3)}_${now.getFullYear()}`;
        console.log(`Triggering AI analysis for ${ticker} (${quarterStr})...`);
        await processQuarterlyFilings(ticker, masterPrompt, financialResultsUrl, transcriptUrl, quarterStr);
      }
    }
  } catch (error) {
    console.error('Error processing announcements:', error);
  }
};

const main = async () => {
  console.log('🚀 Starting The Daily Watchdog...');

  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('MONGODB_URI is not set. Exiting...');
    process.exit(1);
  }

  await connectDB(mongoUri);

  // Enforce The Golden Rule: M-Cap >= ₹5,000 Crore
  const activeWatchlist = await Watchlist.find({ isActive: true, mCapThreshold: { $gte: 5000 } }).exec();

  if (activeWatchlist.length === 0) {
    console.log('No active tickers meeting the ₹5,000 Cr M-Cap rule. Exiting...');
    process.exit(0);
  }

  console.log(`Found ${activeWatchlist.length} active ticker(s): ${activeWatchlist.map(w => w.ticker).join(', ')}`);
  await processAnnouncements(activeWatchlist);

  console.log('✅ Daily Watchdog complete.');
  process.exit(0);
};

main().catch(error => {
  console.error('Fatal error in worker:', error);
  process.exit(1);
});
