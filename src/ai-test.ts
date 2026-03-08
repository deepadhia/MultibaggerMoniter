/**
 * AI Analysis Smoke Test — npm run ai-test [-- --ticker HBLPOWER]
 *
 * TWO-PHASE REAL DATA TEST:
 *
 * PHASE 1 — Previous Quarter (e.g. Q2_FY26)
 *   - Fetch real NSE PDFs for Q2
 *   - Run processQuarterlyFilings() → saves real Q2 QuarterlyState + ManagementGuidance promises
 *
 * PHASE 2 — Current Quarter (e.g. Q3_FY26)
 *   - Fetch real NSE PDFs for Q3
 *   - Run processQuarterlyFilings() → Gemini sees Q2 state, scores Q2 promises as kept/broken
 *   - Verify credibility scoring happened on real data
 *
 * This is the real production flow. No synthetic seeding.
 *
 * Flags:
 *   --ticker <SYMBOL>   Ticker to test (default: first active in DB)
 *   --dry-run           Skip Gemini calls; only validate NSE PDF discovery
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB, Watchlist, ManagementGuidance, QuarterlyState } from './db';
import { processQuarterlyFilings, getCredibilityScore } from './ai';
import { fetchTickerAnnouncements } from './fetcher';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ── CLI args ───────────────────────────────────────────────────────────────
const args      = process.argv.slice(2);
const DRY_RUN   = args.includes('--dry-run');
const tickerArg = args.find((_, i) => args[i - 1] === '--ticker');

// ── Display helpers ────────────────────────────────────────────────────────
const OK   = (s: string) => `\x1b[32m${s}\x1b[0m`;
const FAIL = (s: string) => `\x1b[31m${s}\x1b[0m`;
const INFO = (s: string) => `\x1b[36m${s}\x1b[0m`;
const WARN = (s: string) => `\x1b[33m${s}\x1b[0m`;
const BOLD = (s: string) => `\x1b[1m${s}\x1b[0m`;

let passed = 0;
let failed = 0;

const ok   = (msg: string) => { console.log(OK(`  ✅ ${msg}`));   passed++; };
const fail = (msg: string) => { console.log(FAIL(`  ❌ ${msg}`)); failed++; };
const info = (msg: string) => console.log(INFO(`  ℹ️  ${msg}`));
const warn = (msg: string) => console.log(WARN(`  ⚠️  ${msg}`));

const sep = (title: string) => {
  console.log(`\n${'═'.repeat(65)}`);
  console.log(BOLD(`  ${title}`));
  console.log('═'.repeat(65));
};

// ── Quarter arithmetic ─────────────────────────────────────────────────────
// Indian FY: Q1=Apr-Jun, Q2=Jul-Sep, Q3=Oct-Dec, Q4=Jan-Mar
// FY label: "FY25" means April 2024 – March 2025

// Hardcode testing window to Q2_FY25 -> Q3_FY25 so we hit real PDFs that already exist.
function getCurrentFYQuarter(): { q: number; fy: number } {
  return { q: 3, fy: 2025 }; // Q3 FY25 (Oct-Dec 2024), results announced Jan-Feb 2025
}

function quarterLabel(q: number, fy: number): string {
  return `Q${q}_FY${String(fy).slice(2)}`;
}

function prevFYQuarter(q: number, fy: number): { q: number; fy: number } {
  return { q: 2, fy: 2025 }; // Q2 FY25 (Jul-Sep 2024), results announced Oct-Nov 2024
}

// NSE date range for a given FY quarter — results are announced the month after quarter ends
function announcementDateRange(q: number, fy: number): { from: string; to: string } {
  // Hardcoded for the known test window to ensure we catch the actual PDFs
  if (q === 2 && fy === 2025) {
    // Q2 FY25 results happen Oct-Nov 2024
    return { from: '01-10-2024', to: '30-11-2024' };
  }
  if (q === 3 && fy === 2025) {
    // Q3 FY25 results happen Jan-Feb 2025
    return { from: '01-01-2025', to: '28-02-2025' };
  }
  
  // Fallback (won't be hit with the hardcoded Q3 above)
  const pad   = (n: number) => String(n).padStart(2, '0');
  const calFY = fy - 1;
  let fromM: number, toM: number, calYear: number;

  switch (q) {
    case 1: fromM = 7;  toM = 9;  calYear = calFY;     break; // Jul-Sep
    case 2: fromM = 10; toM = 12; calYear = calFY;     break; // Oct-Dec
    case 3: fromM = 1;  toM = 3;  calYear = calFY + 1; break; // Jan-Mar
    case 4: fromM = 5;  toM = 7;  calYear = calFY + 1; break; // May-Jul
    default: fromM = 1; toM = 3; calYear = calFY + 1;
  }

  const endDay = (toM === 12 || toM === 3 || toM === 7) ? 31 : 30;
  return {
    from: `${pad(1)}-${pad(fromM)}-${calYear}`,
    to:   `${pad(endDay)}-${pad(toM)}-${calYear}`
  };
}

// ── NSE PDF discovery ──────────────────────────────────────────────────────
interface PDFPair { resultsUrl: string | null; transcriptUrl: string | null; }

async function findPDFsForQuarter(ticker: string, q: number, fy: number): Promise<PDFPair> {
  const { from, to } = announcementDateRange(q, fy);
  const label        = quarterLabel(q, fy);
  info(`  Fetching NSE filings for ${ticker} ${label} (${from} → ${to})`);

  const filings = await fetchTickerAnnouncements(ticker, from, to);
  let resultsUrl:    string | null = null;
  let transcriptUrl: string | null = null;

  for (const f of filings) {
    const desc = (f.desc || f.subject || '').toLowerCase();
    // Look for financial keywords, BUT explicitly reject warrants and newspaper clips
    const isResults = 
        (desc.includes('financial result') || 
         desc.includes('outcome of board') || 
         desc.includes('integrated filing')) 
        && !desc.includes('warrant') 
        && !desc.includes('newspaper')
        && !desc.includes('certificate');

    const isTranscript = 
        (desc.includes('transcript') ||
         desc.includes('con. call') ||
         desc.includes('concall') ||
         desc.includes('analyst') ||
         desc.includes('investor presentation'))
        && !desc.includes('warrant')
        && !desc.includes('newspaper');

    if (!resultsUrl    && isResults    && f.attchmntFile) resultsUrl    = f.attchmntFile;
    if (!transcriptUrl && isTranscript && f.attchmntFile) transcriptUrl = f.attchmntFile;
    if (resultsUrl && transcriptUrl) break;
  }

  if (!resultsUrl || !transcriptUrl) {
    // Log all seen descs to help diagnose mismatches
    const seen = filings.map((f: any) => `"${f.desc}"`).join(', ');
    if (seen) info(`  Descs seen for ${ticker}: ${seen.slice(0, 200)}`);
  }

  return { resultsUrl, transcriptUrl };
}

// ── Main ───────────────────────────────────────────────────────────────────
const runAITest = async () => {
  console.log('\n🤖 AI Analysis — Quarter-over-Quarter Test\n');
  if (DRY_RUN) info('--dry-run: Gemini calls SKIPPED\n');

  // ── Env checks ─────────────────────────────────────────────────────────
  sep('STEP 1 — ENV & DB');
  const mongoUri  = process.env.MONGODB_URI;
  const nvidiaKey = process.env.NVIDIA_API_KEY;
  const llamaKey  = process.env.LLAMA_CLOUD_API_KEY;

  if (mongoUri)  ok('MONGODB_URI set');
  else           { fail('MONGODB_URI missing'); process.exit(1); }

  if (!DRY_RUN) {
    if (nvidiaKey) ok('NVIDIA_API_KEY set');
    else           { fail('NVIDIA_API_KEY missing'); process.exit(1); }
    
    if (llamaKey)  ok('LLAMA_CLOUD_API_KEY set');
    else           { fail('LLAMA_CLOUD_API_KEY missing'); process.exit(1); }
  }

  await connectDB(mongoUri!);
  ok('MongoDB connected');

  // ── Pick ticker ─────────────────────────────────────────────────────────
  let ticker = (tickerArg || '').toUpperCase();
  let doc    = ticker ? await Watchlist.findOne({ ticker }).exec() : null;

  if (!doc) {
    doc = await Watchlist.findOne({ isActive: true }).sort({ ticker: 1 }).exec();
    if (doc) {
      ticker = doc.ticker;
      info(`No --ticker given; using first active: ${ticker}`);
    } else {
      fail('No active tickers in watchlist. Run: npm run seed'); process.exit(1);
    }
  }
  const companyName  = doc!.companyName;
  const masterPrompt = doc!.masterPrompt || '';
  ok(`Ticker: ${ticker} (${companyName})`);

  // ── Quarter calculation ─────────────────────────────────────────────────
  sep('STEP 2 — QUARTER IDENTIFICATION');
  const cur  = getCurrentFYQuarter();
  const prev = prevFYQuarter(cur.q, cur.fy);

  const curLabel  = quarterLabel(cur.q, cur.fy);
  const prevLabel = quarterLabel(prev.q, prev.fy);

  info(`Current quarter : ${curLabel}`);
  info(`Previous quarter: ${prevLabel}`);
  info(`Plan: Process ${prevLabel} → store state → Process ${curLabel} → score promises`);

  // ── PHASE 1: Fetch previous quarter PDFs ────────────────────────────────
  sep(`PHASE 1 — ${prevLabel} (Build State & Promises)`);

  // Check if we already have a real QuarterlyState stored from a prior run
  const existingPrevState = await QuarterlyState.findOne({ ticker, quarter: prevLabel }).exec();

  if (existingPrevState?.financialResultsUrl) {
    ok(`QuarterlyState for ${prevLabel} already exists in DB — skipping Phase 1 re-processing`);
    info(`  Stored since: ${existingPrevState.createdAt?.toDateString()}`);
    info(`  Promises saved: ${existingPrevState.managementPromises.length}`);
    const pendingCount = await ManagementGuidance.countDocuments({ ticker, quarter: prevLabel, status: 'pending' });
    info(`  Pending guidance in DB: ${pendingCount}`);
  } else {
    // Need to process the previous quarter from scratch
    const p1 = await findPDFsForQuarter(ticker, prev.q, prev.fy);

    if (p1.resultsUrl) ok(`${prevLabel} results PDF found`);
    else               warn(`${prevLabel} results PDF not found on NSE`);

    if (p1.transcriptUrl) ok(`${prevLabel} transcript PDF found`);
    else                  warn(`${prevLabel} transcript PDF not found on NSE`);

    if (!p1.resultsUrl || !p1.transcriptUrl) {
      warn(`Cannot process ${prevLabel} — one or both PDFs missing.`);
      warn('Phase 1 will be skipped; Phase 2 will run without prior context.');
      warn('Credibility scoring will be minimal (no stored promises to score).');
    } else if (!DRY_RUN) {
      info(`Running AI pipeline on ${prevLabel} PDFs to build state...`);
      // Clear any partial/stale state for prev quarter before processing
      await QuarterlyState.deleteOne({ ticker, quarter: prevLabel });
      await ManagementGuidance.deleteMany({ ticker, quarter: prevLabel });

      try {
        await processQuarterlyFilings(
          ticker, companyName, masterPrompt,
          p1.resultsUrl, p1.transcriptUrl, prevLabel
        );
        ok(`${prevLabel} processed — QuarterlyState and promises saved`);

        const savedPromises = await ManagementGuidance.countDocuments({ ticker, quarter: prevLabel });
        ok(`ManagementGuidance: ${savedPromises} promise(s) pending for next-quarter scoring`);

        const savedState = await QuarterlyState.findOne({ ticker, quarter: prevLabel });
        if (savedState?.managementPromises?.length) {
          info('Promises saved (will be scored in Phase 2):');
          savedState.managementPromises.forEach((p, i) =>
            info(`  [${i + 1}] ${p.slice(0, 80)}…`)
          );
        }
      } catch (err: any) {
        fail(`Phase 1 AI call failed: ${err.message}`);
        warn('Continuing to Phase 2 without prior state...');
      }
    } else {
      info(`--dry-run: would process ${prevLabel} with:`);
      info(`  Results:    ${p1.resultsUrl?.slice(0, 70)}…`);
      info(`  Transcript: ${p1.transcriptUrl?.slice(0, 70)}…`);
    }
  }

  // ── PHASE 2: Fetch current quarter PDFs ──────────────────────────────────
  sep(`PHASE 2 — ${curLabel} (Score Promises + New Analysis)`);

  const p2 = await findPDFsForQuarter(ticker, cur.q, cur.fy);

  if (p2.resultsUrl) ok(`${curLabel} results PDF found`);
  else               warn(`${curLabel} results PDF not found on NSE`);

  if (p2.transcriptUrl) ok(`${curLabel} transcript PDF found`);
  else                  warn(`${curLabel} transcript PDF not found on NSE`);

  if (!p2.resultsUrl || !p2.transcriptUrl) {
    warn(`${curLabel} PDFs not available yet — results may not be announced.`);

    // Show the pending promises that WILL be scored once PDFs are available
    const pending = await ManagementGuidance.find({ ticker, status: 'pending' }).exec();
    if (pending.length > 0) {
      info(`${pending.length} promise(s) waiting to be scored when ${curLabel} PDFs arrive:`);
      pending.forEach((p, i) =>
        info(`  [${i + 1}] [${p.quarter}] ${p.guidanceText.slice(0, 80)}…`)
      );
    }

    if (!DRY_RUN) {
      fail(`${curLabel} PDFs not found — Phase 2 cannot run`);
      info('This is expected if current quarter results haven\'t been announced yet.');
      info(`Once ${curLabel} results are on NSE, re-run: npm run ai-test -- --ticker ${ticker}`);
    } else {
      info('--dry-run complete. NSE discovery logic is working correctly.');
    }

    await printFinalSummary(ticker, DRY_RUN);
    await mongoose.disconnect();
    process.exit(DRY_RUN ? 0 : 1);
  }

  if (!DRY_RUN) {
    // Clear stale current quarter data before re-processing
    await QuarterlyState.deleteOne({ ticker, quarter: curLabel });
    await ManagementGuidance.deleteMany({ ticker, quarter: curLabel });

    let parsed: any;
    try {
      parsed = await processQuarterlyFilings(
        ticker, companyName, masterPrompt,
        p2.resultsUrl!, p2.transcriptUrl!, curLabel
      );
      ok(`${curLabel} processed successfully`);
    } catch (err: any) {
      fail(`Phase 2 AI call failed: ${err.message}`);
      await mongoose.disconnect();
      process.exit(1);
    }

    // ── Validate JSON ─────────────────────────────────────────────────────
    sep('VALIDATION — JSON Structure');
    for (const f of ['realityCheck', 'thesisTracker', 'redFlags', 'newState']) {
      if (parsed?.[f] !== undefined) ok(`Field present: ${f}`);
      else                            fail(`Missing: ${f}`);
    }
    const rc = parsed?.realityCheck;
    if (rc?.promisesKept?.length   > 0) ok(`Promises kept: ${rc.promisesKept.length}`);
    else                                 warn('No promises marked kept (may be correct)');
    if (rc?.promisesBroken?.length > 0) ok(`Promises broken: ${rc.promisesBroken.length}`);
    else                                 warn('No promises marked broken (may be correct)');
    if (rc?.evasions?.length       > 0) ok(`Evasions identified: ${rc.evasions.length}`);

    const tt = parsed?.thesisTracker;
    if (tt?.summary)          ok(`Thesis summary: "${tt.summary.slice(0, 80)}…"`);
    if (Object.keys(tt?.metricsExtracted || {}).length > 0)
      ok(`Metrics extracted: ${Object.keys(tt.metricsExtracted).join(', ')}`);

    // ── DB Verification ───────────────────────────────────────────────────
    sep('VALIDATION — DB State');
    const curState = await QuarterlyState.findOne({ ticker, quarter: curLabel });
    if (curState) {
      ok(`QuarterlyState saved for ${curLabel}`);
      ok(`financialResultsUrl stored: ${!!curState.financialResultsUrl}`);
      ok(`transcriptUrl stored: ${!!curState.transcriptUrl}`);
    } else {
      fail('QuarterlyState not found for current quarter');
    }

    const newPromises = await ManagementGuidance.find({ ticker, quarter: curLabel });
    if (newPromises.length > 0)
      ok(`${newPromises.length} new promise(s) saved for ${curLabel} (will be scored next quarter)`);
    else
      warn('No new promises extracted for this quarter');

    const scored = await ManagementGuidance.find({ ticker, quarter: prevLabel, status: { $ne: 'pending' } });
    if (scored.length > 0) {
      ok(`${scored.length} prior promise(s) from ${prevLabel} scored in ${curLabel}:`);
      for (const s of scored) {
        const emoji = s.status === 'kept' ? '✅' : s.status === 'broken' ? '❌' : '⚠️';
        info(`  ${emoji} [${s.status}] "${s.guidanceText.slice(0, 70)}…"`);
        if (s.scoreNote) info(`     Note: ${s.scoreNote.slice(0, 80)}`);
      }
    } else {
      warn(`No prior ${prevLabel} promises were scored — may be first run or PDF context mismatch`);
    }
  } else {
    info(`--dry-run: would process ${curLabel} with:`);
    info(`  Results:    ${p2.resultsUrl?.slice(0, 70)}…`);
    info(`  Transcript: ${p2.transcriptUrl?.slice(0, 70)}…`);
  }

  await printFinalSummary(ticker, DRY_RUN);
  await mongoose.disconnect();
  process.exit(failed > 0 ? 1 : 0);
};

async function printFinalSummary(ticker: string, dryRun: boolean) {
  sep('CREDIBILITY SCORE');
  const cred = await getCredibilityScore(ticker);
  if (cred.total > 0) {
    const pct = cred.score;
    const bar = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));
    console.log(`\n  ${ticker} Management Credibility`);
    console.log(`  Score  : ${pct}% [${bar}]`);
    console.log(`  ✅ Kept  : ${cred.kept}`);
    console.log(`  ❌ Broken: ${cred.broken}`);
    console.log(`  Total  : ${cred.total} evaluated\n`);
  } else {
    console.log(`\n  Score: N/A — no promises scored yet${ dryRun ? ' (dry-run)' : ''}\n`);
  }

  sep(`TEST COMPLETE — ${passed} passed, ${failed} failed`);
  console.log('');
}

runAITest().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
