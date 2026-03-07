import 'dotenv/config';
import { connectDB, Watchlist } from './db';
import { fetchAnnouncements } from './fetcher';
import { sendTelegramAlert } from './bot';
import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI;

const smokeTest = async () => {
  if (!MONGODB_URI) {
    console.error('❌ MONGODB_URI not set in .env');
    process.exit(1);
  }

  let passed = 0;
  let failed = 0;

  // ── Test 1: MongoDB Connection & Seed ──────────────────────
  console.log('\n═══════════════════════════════════════');
  console.log('  TEST 1: MongoDB Connection & Seed');
  console.log('═══════════════════════════════════════');
  try {
    await connectDB(MONGODB_URI);
    console.log('✅ MongoDB connected\n');

    const sample = await Watchlist.findOneAndUpdate(
      { ticker: 'RELIANCE' },
      {
        ticker: 'RELIANCE',
        companyName: 'Reliance Industries Limited',
        isActive: true,
        masterPrompt: 'Track Jio growth, retail EBITDA margins, and O2C segment performance.',
        mCapThreshold: 5000
      },
      { upsert: true, new: true }
    );
    console.log(`✅ Seeded watchlist: ${sample.ticker} (${sample.companyName})`);

    const count = await Watchlist.countDocuments();
    console.log(`✅ Watchlist has ${count} ticker(s)\n`);
    passed++;
  } catch (err) {
    console.error('❌ MongoDB test failed:', err);
    failed++;
  }

  // ── Test 2: NSE Fetcher (WAF Bypass) ───────────────────────
  console.log('═══════════════════════════════════════');
  console.log('  TEST 2: NSE Fetcher (WAF Bypass)');
  console.log('═══════════════════════════════════════');
  try {
    // NSE returns a flat array, NOT { data: [...] }
    const announcements = await fetchAnnouncements();
    const count = Array.isArray(announcements) ? announcements.length : 0;
    console.log(`✅ Fetched ${count} corporate announcements from NSE`);

    if (count > 0) {
      const first = announcements[0];
      console.log(`   Sample keys: ${Object.keys(first).join(', ')}`);
      console.log(`   Sample: [${first.symbol}] ${first.subject || first.desc || first.sub || JSON.stringify(first).substring(0, 100)}`);
    }
    console.log('');
    passed++;
  } catch (err: any) {
    if (err.response?.status === 403) {
      console.error('❌ NSE returned 403 Forbidden — WAF blocked the request');
    } else {
      console.error('❌ NSE fetch failed:', err.message);
    }
    console.log('   (This can happen outside market hours or from certain IPs)\n');
    failed++;
  }

  // ── Test 3: Telegram Bot ───────────────────────────────────
  console.log('═══════════════════════════════════════');
  console.log('  TEST 3: Telegram Bot Alert');
  console.log('═══════════════════════════════════════');
  try {
    await sendTelegramAlert('🧪 *Smoke Test* — The Multibagger Monitor v2.0 is alive and connected!');
    console.log('✅ Telegram message sent — check your chat!\n');
    passed++;
  } catch (err) {
    console.error('❌ Telegram test failed:', err);
    console.log('   Check TELEGRAM_TOKEN and TELEGRAM_CHAT_ID in .env\n');
    failed++;
  }

  // ── Summary ────────────────────────────────────────────────
  console.log('═══════════════════════════════════════');
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════\n');

  await mongoose.disconnect();
  process.exit(failed > 0 ? 1 : 0);
};

smokeTest().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
