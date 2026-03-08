import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB, Watchlist, ManagementGuidance } from './db';
import { getCredibilityScore, DEFAULT_MASTER_PROMPT } from './ai';

const MONGODB_URI = process.env.MONGODB_URI!;

const usage = () => {
  console.log(`
Usage: npm run manage-watchlist -- <command> [args]

Commands:
  list                              List all companies with their prompts
  seed <TICKER> "<Name>" "<prompt>" Add a new company (quote the prompt)
  set-prompt <TICKER> "<prompt>"    Update prompt for a company
  guidance <TICKER>                 Show all guidance history for a ticker
  score <TICKER>                    Show credibility score for a ticker
`);
  process.exit(0);
};

const padEnd = (s: string, n: number) => s.slice(0, n).padEnd(n);

// ── list ───────────────────────────────────────────────────────────────────
const listCommand = async () => {
  const companies = await Watchlist.find().sort({ ticker: 1 }).exec();
  if (companies.length === 0) {
    console.log('No companies in watchlist.');
    return;
  }
  console.log('\n' + '─'.repeat(100));
  console.log(`${padEnd('TICKER', 12)} ${padEnd('COMPANY', 30)} ${'ACTIVE'.padEnd(8)} PROMPT FOCUS`);
  console.log('─'.repeat(100));
  for (const c of companies) {
    const promptPreview = c.masterPrompt?.trim()
      ? c.masterPrompt.trim().replace(/\n/g, ' ').slice(0, 45) + (c.masterPrompt.length > 45 ? '…' : '')
      : '[using DEFAULT prompt]';
    console.log(`${padEnd(c.ticker, 12)} ${padEnd(c.companyName, 30)} ${(c.isActive ? 'YES' : 'NO').padEnd(8)} ${promptPreview}`);
  }
  console.log('─'.repeat(100));
  console.log(`Total: ${companies.length} company(ies)\n`);
};

// ── seed ───────────────────────────────────────────────────────────────────
const seedCommand = async (args: string[]) => {
  if (args.length < 3) {
    console.error('Usage: seed <TICKER> "<Company Name>" "<prompt>"');
    process.exit(1);
  }
  const [ticker, companyName, prompt] = args;
  const doc = await Watchlist.findOneAndUpdate(
    { ticker: ticker.toUpperCase() },
    {
      ticker: ticker.toUpperCase(),
      companyName,
      isActive: true,
      masterPrompt: prompt,
      mCapThreshold: 5000,
    },
    { upsert: true, new: true }
  );
  console.log(`\n✅ Seeded: ${doc.ticker} — "${doc.companyName}"`);
  console.log(`   Prompt: ${doc.masterPrompt.slice(0, 80)}…\n`);
};

// ── set-prompt ─────────────────────────────────────────────────────────────
const setPromptCommand = async (args: string[]) => {
  if (args.length < 2) {
    console.error('Usage: set-prompt <TICKER> "<new prompt>"');
    process.exit(1);
  }
  const [ticker, newPrompt] = args;
  const doc = await Watchlist.findOneAndUpdate(
    { ticker: ticker.toUpperCase() },
    { masterPrompt: newPrompt },
    { new: true }
  );
  if (!doc) {
    console.error(`❌ Ticker ${ticker.toUpperCase()} not found in watchlist.`);
    process.exit(1);
  }
  console.log(`\n✅ Updated prompt for ${doc.ticker}:`);
  console.log(`   ${newPrompt}\n`);
};

// ── guidance ───────────────────────────────────────────────────────────────
const guidanceCommand = async (args: string[]) => {
  if (args.length < 1) {
    console.error('Usage: guidance <TICKER>');
    process.exit(1);
  }
  const ticker = args[0].toUpperCase();
  const docs = await ManagementGuidance.find({ ticker }).sort({ createdAt: -1 }).exec();

  if (docs.length === 0) {
    console.log(`\nNo guidance records found for ${ticker}.\n`);
    return;
  }

  const statusEmoji: Record<string, string> = {
    pending: '⏳',
    kept: '✅',
    partial: '⚠️',
    broken: '❌',
  };

  console.log(`\n Management Guidance History: ${ticker}`);
  console.log('─'.repeat(90));
  for (const g of docs) {
    const emoji = statusEmoji[g.status] || '?';
    const target = g.targetValue !== null ? `${g.targetValue}${g.targetUnit}` : 'No target';
    console.log(`${emoji} [${g.quarter}] ${g.metric} → ${target} by ${g.timeframe || 'N/A'}`);
    console.log(`   "${g.guidanceText}"`);
    if (g.status !== 'pending') {
      console.log(`   Verified in: ${g.verifiedQuarter} | Actual: ${g.actualValue ?? 'N/A'} | Note: ${g.scoreNote}`);
    }
    console.log('');
  }
  console.log('─'.repeat(90));
};

// ── score ──────────────────────────────────────────────────────────────────
const scoreCommand = async (args: string[]) => {
  if (args.length < 1) {
    console.error('Usage: score <TICKER>');
    process.exit(1);
  }
  const ticker = args[0].toUpperCase();
  const s = await getCredibilityScore(ticker);

  if (s.total === 0) {
    console.log(`\n${ticker}: No verified guidance yet (all pending or no data).\n`);
  } else {
    const bar = '█'.repeat(Math.round(s.score / 10)) + '░'.repeat(10 - Math.round(s.score / 10));
    console.log(`\n Management Credibility Score: ${ticker}`);
    console.log(`  Score:   ${s.score}% [${bar}]`);
    console.log(`  ✅ Kept:   ${s.kept}`);
    console.log(`  ⚠️  Partial: ${s.partial}`);
    console.log(`  ❌ Broken: ${s.broken}`);
    console.log(`  Total verified: ${s.total}\n`);
  }
};

// ── show default prompt ────────────────────────────────────────────────────
const showDefaultCommand = async () => {
  console.log('\n DEFAULT_MASTER_PROMPT (used when no custom prompt is set):');
  console.log('─'.repeat(70));
  console.log(DEFAULT_MASTER_PROMPT);
  console.log('─'.repeat(70) + '\n');
};

// ── Main ───────────────────────────────────────────────────────────────────
const main = async () => {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === 'help') usage();

  if (!MONGODB_URI) {
    console.error('❌ MONGODB_URI not set in .env');
    process.exit(1);
  }

  await connectDB(MONGODB_URI);

  switch (command) {
    case 'list':        await listCommand(); break;
    case 'seed':        await seedCommand(args.slice(1)); break;
    case 'set-prompt':  await setPromptCommand(args.slice(1)); break;
    case 'guidance':    await guidanceCommand(args.slice(1)); break;
    case 'score':       await scoreCommand(args.slice(1)); break;
    case 'default':     await showDefaultCommand(); break;
    default:
      console.error(`❌ Unknown command: ${command}`);
      usage();
  }

  await mongoose.disconnect();
  process.exit(0);
};

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
