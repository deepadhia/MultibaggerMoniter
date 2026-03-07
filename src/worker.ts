import { connectDB, Watchlist, IWatchlist } from './db';
import { fetchCorporateAnnouncements } from './fetcher';
import { sendTelegramAlert } from './bot';
import { processQuarterlyFilings } from './ai';

const processAnnouncements = async (watchlistDocs: IWatchlist[]) => {
  try {
    const data = await fetchCorporateAnnouncements();
    const announcements = data?.data || [];
    
    // Group announcements by ticker
    const announcementsByTicker: Record<string, any[]> = {};
    for (const ann of announcements) {
      if (ann.symbol) {
        if (!announcementsByTicker[ann.symbol]) announcementsByTicker[ann.symbol] = [];
        announcementsByTicker[ann.symbol].push(ann);
      }
    }

    for (const doc of watchlistDocs) {
      const { ticker, masterPrompt, mCapThreshold } = doc;
      const tickerAnnouncements = announcementsByTicker[ticker];
      if (!tickerAnnouncements || tickerAnnouncements.length === 0) continue;

      let financialResultsUrl: string | null = null;
      let transcriptUrl: string | null = null;

      for (const ann of tickerAnnouncements) {
        const subject = ann.subject?.toLowerCase() || '';
        const attachmentUrl = ann.attachment ? `https://www.nseindia.com${ann.attachment}` : null;

        // Condition 1: SAST or Bulk Deal
        if (subject.includes('sast') || subject.includes('bulk deal') || subject.includes('insider')) {
          const alertMessage = `🔥 *High Signal Alert: ${ticker}* 🔥\n\n*Subject:* ${ann.subject}\n*Details:* ${ann.details || 'N/A'}\n[Attachment](${attachmentUrl})`;
          await sendTelegramAlert(alertMessage);
        }

        // Condition 2: Financial Results & Transcripts
        if (subject.includes('financial result')) {
          financialResultsUrl = attachmentUrl;
        } else if (subject.includes('transcript') || subject.includes('earnings call')) {
          transcriptUrl = attachmentUrl;
        }
      }

      // If we found both Financial Results and Earnings Transcript today
      if (financialResultsUrl && transcriptUrl) {
        // Construct a quarter string for right now (e.g. Q4_2026) -> A generic timestamp based quarter
        const currentDate = new Date();
        const quarterStr = `Q${Math.floor((currentDate.getMonth() + 3) / 3)}_${currentDate.getFullYear()}`;
        
        await processQuarterlyFilings(ticker, masterPrompt, financialResultsUrl, transcriptUrl, quarterStr);
      }
    }
  } catch (error) {
    console.error('Error processing announcements:', error);
  }
};

const main = async () => {
  console.log('Starting Daily Watchdog...');

  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('MONGODB_URI is not set. Exiting...');
    process.exit(1);
  }

  await connectDB(mongoUri);

  // Grab active tickers with market cap threshold >= 5000 (enforce Golden Rule)
  const activeWatchlist = await Watchlist.find({ isActive: true, mCapThreshold: { $gte: 5000 } }).exec();
  
  if (activeWatchlist.length === 0) {
    console.log('No active tickers in watchlist meeting the >= 5000 M-Cap rule. Exiting...');
    process.exit(0);
  }

  console.log(`Found ${activeWatchlist.length} active tickers. Checking announcements...`);
  await processAnnouncements(activeWatchlist);

  console.log('Daily Watchdog loop completed.');
  process.exit(0);
};

main().catch(error => {
  console.error('Fatal error in worker:', error);
  process.exit(1);
});
