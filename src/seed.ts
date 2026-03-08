/**
 * src/seed.ts — One-time database seeder
 * 
 * Seeds the Watchlist collection with all tracked stocks and their
 * company-specific master prompts.
 *
 * Run: npm run seed
 *
 * WARNING: This CLEARS and REPLACES the entire Watchlist collection.
 * ManagementGuidance and QuarterlyState are untouched.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB, Watchlist, QuarterlyState, ManagementGuidance } from './db';

const seedData = [
  // ── ACTIVE PORTFOLIO ──────────────────────────────────────────────────────
  {
    ticker: 'HBLPOWER',
    companyName: 'HBL Power Systems Ltd',
    isActive: true,
    mCapThreshold: 5000,
    masterPrompt: `Analyze the execution run-rate and revenue realization of the Railway Kavach and defence electronics segments. Extract specific Q-o-Q EBITDA margins for these divisions. Cross-reference management's current order book execution against the timeline promises made in the previous quarter. Red Flags to extract: Evasion on Kavach deployment delays, raw material margin compression, or unexplained promoter selling.`
  },
  {
    ticker: 'LUMAXTECH',
    companyName: 'Lumax Auto Technologies Ltd',
    isActive: true,
    mCapThreshold: 5000,
    masterPrompt: `Focus strictly on the auto premiumisation thesis. Extract the Q-o-Q revenue share and growth of LED lighting, sensors, and telematics versus legacy halogen products. Calculate the blended EBITDA margin expansion. Verify if management delivered on their localized manufacturing CAPEX timelines from last quarter. Red Flags to extract: Stalling operating leverage, margin dilution from joint ventures, or loss of key OEM market share.`
  },
  {
    ticker: 'TIMETECHNO',
    companyName: 'Time Technoplast Ltd',
    isActive: true,
    mCapThreshold: 5000,
    masterPrompt: `Isolate the composite cylinder division's performance. Extract exact management commentary on the revenue share of Value-Added Products (VAP) vs. legacy products, and the specific EBITDA margin for VAP. Verify if the commercial production and revenue realization of Type-4 cylinders hit the promised timeline. Red Flags to extract: Missed debt reduction targets, or management dodging analyst questions on CAPEX.`
  },
  {
    ticker: 'INOXINDIA',
    companyName: 'INOX India Ltd',
    isActive: true,
    mCapThreshold: 5000,
    masterPrompt: `Focus exclusively on the execution of LNG and hydrogen infrastructure projects. Extract the exact current order book value and the Q-o-Q EBITDA realization margins. Cross-check management's previous guidance on export revenue share against actual numbers. Red Flags to extract: Slowdown in industrial gas CAPEX cycles, delays in new facility commissioning, or unexplained insider selling.`
  },
  {
    ticker: 'QPOWER',
    companyName: 'Quality Power Electrical Equipments',
    isActive: true,
    mCapThreshold: 5000,
    masterPrompt: `Isolate data regarding grid expansion and HVDC/FACTS power CAPEX execution. Extract the exact order inflow for energy transition equipment and Q-o-Q operating margins. Verify management's claims from last quarter regarding capacity utilization improvements. Red Flags to extract: Ballooning debtor days or working capital cycles, or execution bottlenecks.`
  },
  {
    ticker: 'CCL',
    companyName: 'CCL Products (India) Ltd',
    isActive: true,
    mCapThreshold: 5000,
    masterPrompt: `Analyze the coffee export compounder thesis. Extract the exact capacity utilization rates for the new Vietnam and India facilities. Track the Q-o-Q EBITDA per kg realization. Cross-reference whether management successfully passed raw coffee bean price inflation to clients as promised last quarter. Red Flags to extract: EBITDA/kg compression, or delayed CAPEX commercialization.`
  },
  {
    ticker: 'ANANTRAJ',
    companyName: 'Anant Raj Limited',
    isActive: true,
    mCapThreshold: 5000,
    masterPrompt: `Focus strictly on NCR real estate realization and data center CAPEX execution. Extract exact pre-sales volume, realization per square foot, and debt reduction numbers. For data centers, extract the exact MW capacity operationalized versus the promised timeline. Red Flags to extract: Evasion on debt repayment timelines, stalled data center rollouts, or flat rental yields.`
  },
  {
    ticker: 'ASTRAMICRO',
    companyName: 'Astra Microwave Products Ltd',
    isActive: true,
    mCapThreshold: 5000,
    masterPrompt: `Track the execution of defence radar systems and export orders. Extract the exact order book split between domestic defence, space, and exports. Track the gross margin expansion resulting from higher-margin export/space execution. Verify if management hit their promised book-to-bill ratios. Red Flags to extract: Delays in government defence procurement timelines, or margin compression.`
  },
  {
    ticker: 'GRAVITA',
    companyName: 'Gravita India Ltd',
    isActive: true,
    mCapThreshold: 5000,
    masterPrompt: `Analyze the metal recycling and battery ecosystem margins. Extract the exact volume growth in lead, aluminum, and plastic recycling. Calculate the EBITDA per metric ton and compare it to management's prior quarter guidance. Check for concrete updates on the battery recycling capacity expansion. Red Flags to extract: Regulatory headwinds, or shrinking EBITDA/MT margins.`
  },

  // ── WATCHLIST (Tracking, not actively allocated) ──────────────────────────
  {
    ticker: 'JYOTICNC',
    companyName: 'Jyoti CNC Automation Ltd',
    isActive: false,
    mCapThreshold: 5000,
    masterPrompt: `Focus on the aerospace/defence sector exposure and CNC machining order book. Extract the exact backlog execution rate and EBITDA margin expansion resulting from operating leverage. Cross-reference management's promises on debt reduction post-IPO. Red Flags to extract: Slowdown in order inflows, execution bottlenecks, or dodging margin questions.`
  },
  {
    ticker: 'ELECON',
    companyName: 'Elecon Engineering Company Ltd',
    isActive: false,
    mCapThreshold: 5000,
    masterPrompt: `Track the industrial gear segment's domestic vs. export revenue split. Extract the Q-o-Q EBITDA margin expansion and exact order inflow. Verify if management is delivering on their overseas market penetration targets and promised revenue guidance from prior quarters. Red Flags to extract: Weakness in domestic industrial CAPEX, or raw material cost spikes eating margins.`
  },
  {
    ticker: 'SJS',
    companyName: 'SJS Enterprises Ltd',
    isActive: false,
    mCapThreshold: 5000,
    masterPrompt: `Analyze the decorative aesthetics premiumisation play. Extract the revenue growth in premium products (IML, 3D appliques, chrome). Track the consolidated EBITDA margins and operating leverage. Verify management's prior guidance on the Walter Pack integration and cross-selling synergies. Red Flags to extract: Margin dilution, or auto sector volume slowdown impacts.`
  }
];

const runSeed = async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('❌ MONGODB_URI is not set in .env');
    process.exit(1);
  }

  try {
    await connectDB(uri);

    console.log('🗑️  Clearing all existing collections (Watchlist, QuarterlyState, ManagementGuidance)...');
    await Watchlist.deleteMany({});
    await QuarterlyState.deleteMany({});
    await ManagementGuidance.deleteMany({});

    console.log(`📥 Inserting ${seedData.length} tracked stocks...`);
    await Watchlist.insertMany(seedData);

    console.log('\n✅ Database seeded successfully!\n');

    // Print summary
    const active   = seedData.filter(s => s.isActive).length;
    const watchlist = seedData.filter(s => !s.isActive).length;
    console.log(`   Active Portfolio : ${active} stocks`);
    console.log(`   Watchlist        : ${watchlist} stocks`);
    console.log(`   Total            : ${seedData.length} stocks\n`);

  } catch (error) {
    console.error('❌ Seed failed:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB.');
  }
};

runSeed();
