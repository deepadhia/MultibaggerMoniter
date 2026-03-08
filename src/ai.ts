import { QuarterlyState, ManagementGuidance, IManagementGuidance } from './db';
import { sendTelegramAlert } from './bot';
import { getNSECookies } from './fetcher';
import axios from 'axios';
import https from 'https';
import { LlamaParseReader } from "@llamaindex/cloud/reader";

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
if (!NVIDIA_API_KEY) {
  console.warn('⚠️ NVIDIA_API_KEY is not set. AI analysis will fail.');
}

const LLAMA_CLOUD_API_KEY = process.env.LLAMA_CLOUD_API_KEY;
if (!LLAMA_CLOUD_API_KEY) {
  console.warn('⚠️ LLAMA_CLOUD_API_KEY is not set. PDF extraction via LlamaParse will fail.');
}

// ── Generic fallback prompt ────────────────────────────────────────────────
// Used when a company has no custom masterPrompt configured
export const DEFAULT_MASTER_PROMPT = `
Focus on the core financial thesis: revenue growth trajectory, EBITDA margin expansion, 
debt reduction, and operating leverage. Extract any specific numeric guidance management 
gives for the next quarter (margins, growth targets, capex plans, order book execution).
Red Flags to extract: Working capital deterioration, unexplained promoter selling, 
management evasion on key analyst questions, or missed guidance from prior quarters.
`;

// ── Global System Wrapper ──────────────────────────────────────────────────
// Takes the company-specific masterPrompt from MongoDB and wraps it with
// strict JSON-enforcing instructions. This is what gets sent to Gemini —
// never the raw masterPrompt alone.
function buildPrompt(
  companyName: string,
  masterPrompt: string,
  previousStateJson: string,
  pendingGuidanceJson: string
): string {
  const effectivePrompt = (masterPrompt && masterPrompt.trim().length > 0)
    ? masterPrompt
    : DEFAULT_MASTER_PROMPT;

  return `
You are a ruthless, highly critical equity analyst.
You are analyzing the latest Quarterly Results and Concall Transcript for ${companyName}.

COMPANY-SPECIFIC FOCUS (CRITICAL):
${effectivePrompt}

PREVIOUS QUARTER'S STATE & PROMISES:
${previousStateJson}

PENDING MANAGEMENT GUIDANCE TO VERIFY (score each one):
${pendingGuidanceJson}

INSTRUCTIONS:
5. You MUST return your analysis strictly as a valid JSON object matching the exact schema 
   below. Do not wrap it in markdown backticks (e.g., no \`\`\`json). Return ONLY the raw 
   JSON object starting with { and ending with }.

EXPECTED JSON SCHEMA:
{
  "realityCheck": {
    "promisesKept": ["List kept promises. If none found, return an empty array []"],
    "promisesBroken": ["List broken promises. If none found, return an empty array []"],
    "evasions": ["List dodged questions. If none found, return an empty array []"]
  },
  "thesisTracker": {
    "summary": "Brutally honest 2-sentence summary of the quarter.",
    "metricsExtracted": { 
      "Metric_Name": {
        "value": "The exact number or 'Not Found'",
        "sourceQuote": "Copy-paste the exact sentence from the text where you found this number. If not found, write 'N/A'."
      }
    }
  },
  "redFlags": ["List red flags. If none, return an empty array []"],
  "newState": {
    "managementPromises": ["List NEW promises. If none, return an empty array []"],
    "unanswered": ["List NEW unanswered questions. If none, return an empty array []"],
    "keyMetrics": { 
      "Metric_Name": {
        "value": "The exact number or 'Not Found'",
        "sourceQuote": "Copy-paste the exact sentence from the text where you found this number."
      }
    }
  }
}

Rules:
- metricsExtracted: use dynamic keys relevant to the COMPANY-SPECIFIC FOCUS (e.g., "Jio_ARPU", "GRM", "VAP_EBITDA")
- promisesKept / promisesBroken: evaluate promises found in PREVIOUS STATE + PENDING GUIDANCE
- redFlags: extract ONLY red flags explicitly mentioned or requested in the focus prompt
`;
}

// ── Download helper ────────────────────────────────────────────────────────
export const downloadPDFToBuffer = async (url: string): Promise<Buffer> => {
  const httpsAgent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    headers: {
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
    },
    httpsAgent,
    timeout: 30000,
  });
  return Buffer.from(response.data);
};

// ── Credibility score ──────────────────────────────────────────────────────
export const getCredibilityScore = async (ticker: string) => {
  const docs = await ManagementGuidance.find({
    ticker,
    status: { $in: ['kept', 'partial', 'broken'] }
  }).exec();

  const kept = docs.filter(d => d.status === 'kept').length;
  const partial = docs.filter(d => d.status === 'partial').length;
  const broken = docs.filter(d => d.status === 'broken').length;
  const total = docs.length;
  const score = total > 0 ? Math.round(((kept + 0.5 * partial) / total) * 100) : -1;

  return { score, kept, partial, broken, total };
};

// ── Main AI processing ─────────────────────────────────────────────────────
export const processQuarterlyFilings = async (
  ticker: string,
  companyName: string,
  masterPrompt: string,
  financialResultsUrl: string,
  transcriptUrl: string,
  currentQuarter: string
) => {
  try {
    console.log(`\nProcessing filings for ${ticker} (${currentQuarter})...`);

    const usingDefault = !masterPrompt || masterPrompt.trim().length === 0;
    if (usingDefault) {
      console.log(`  ℹ️  No custom prompt for ${ticker} — using DEFAULT_MASTER_PROMPT`);
    }

    // 1. Download PDFs
    console.log(`  Downloading PDFs...`);
    const resultsBuffer = await downloadPDFToBuffer(financialResultsUrl);
    console.log(`  ✅ Results PDF: ${(resultsBuffer.length / 1024).toFixed(0)} KB`);
    const transcriptBuffer = await downloadPDFToBuffer(transcriptUrl);
    console.log(`  ✅ Transcript PDF: ${(transcriptBuffer.length / 1024).toFixed(0)} KB`);

    // 2. Fetch previous QuarterlyState
    const previousState = await QuarterlyState.findOne({ ticker }).sort({ createdAt: -1 }).exec();
    const previousStateJson = previousState
      ? JSON.stringify(previousState.toObject(), null, 2)
      : 'No previous state on record.';

    // 3. Fetch pending management guidance (promises from prior quarters)
    console.log(`  🔍 Fetching previous quarter's promises from database...`);
    const pendingGuidance = await ManagementGuidance.find({ ticker, status: 'pending' }).exec();
    const pendingGuidanceJson = pendingGuidance.length > 0
      ? JSON.stringify(pendingGuidance.map(g => g.toObject()), null, 2)
      : 'No pending guidance on record.';

    console.log(`  📋 Injecting ${pendingGuidance.length} prior promises into LLM prompt for Phase 2 credibility scoring.`);

    // 4. Build base prompt using Global System Wrapper
    const systemPrompt = buildPrompt(companyName, masterPrompt, previousStateJson, pendingGuidanceJson);

    // 5. Parse PDFs using LlamaParse Vision OCR
    console.log(`  👁️  Running LlamaParse OCR on PDFs... (takes a moment)`);
    let resultsText = "";
    let transcriptText = "";
    
    try {
      // Initialize the parser to return structured Markdown tables
      const reader = new LlamaParseReader({ resultType: "markdown" });
      
      console.log(`    Parsing Results PDF...`);
      const resDocs = await reader.loadDataAsContent(new Uint8Array(resultsBuffer));
      resultsText = resDocs.map((doc: any) => doc.text).join('\n\n');
      
      console.log(`    Parsing Transcript PDF...`);
      const transDocs = await reader.loadDataAsContent(new Uint8Array(transcriptBuffer));
      transcriptText = transDocs.map((doc: any) => doc.text).join('\n\n');
    } catch (err: any) {
      console.error('❌ Failed to extract PDF text via LlamaParse:', err.message);
      throw new Error('LlamaParse parsing failed');
    }

    // REMOVE the .substring() limits. Let the full text pass through.
    // Llama 3.3 70B on Nvidia NIM can handle 128k tokens natively.
    const payloadText = `\n--- FINANCIAL RESULTS ---\n${resultsText}\n\n--- TRANSCRIPT ---\n${transcriptText}`;

    // 6. Call Nvidia NIM
    console.log(`  🧠 Sending FULL payload (${resultsText.length + transcriptText.length} chars) to Nvidia NIM (deepseek-ai/deepseek-v3.2)...`);
    
    const maxRetries = 3;
    let cleaned = '';
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await axios.post(
          'https://integrate.api.nvidia.com/v1/chat/completions',
          {
            model: "deepseek-ai/deepseek-v3.2",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: payloadText }
            ],
            temperature: 0.0,
            max_tokens: 4096,
            response_format: { type: "json_object" }
          },
          {
            headers: {
              'Authorization': `Bearer ${NVIDIA_API_KEY}`,
              'Content-Type': 'application/json'
            },
            timeout: 600000 // INCREASE TIMEOUT TO 10 MINUTES (600,000 ms)
          }
        );

        const responseText = response.data.choices[0].message.content;
        cleaned = responseText.replace(/```json\n?|```/g, '').trim();
        break; // Success
      } catch (err: any) {
        if (attempt === maxRetries) {
          console.error(`❌ Nvidia NIM API call failed after ${maxRetries} attempts:`, err.response?.data || err.message);
          throw new Error('Nvidia API failed');
        }
        console.warn(`  ⚠️ Nvidia NIM attempt ${attempt} failed, retrying... (${err.response?.status} - ${typeof err.response?.data === 'object' ? JSON.stringify(err.response?.data) : err.message})`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    let parsed: {
      realityCheck: { promisesKept: string[]; promisesBroken: string[]; evasions: string[] };
      thesisTracker: { summary: string; metricsExtracted: Record<string, any> };
      redFlags: string[];
      newState: { managementPromises: string[]; unanswered: string[]; keyMetrics: Record<string, any> };
    };

    try {
      parsed = JSON.parse(cleaned);
      console.log('--- RAW AI OUTPUT ---');
      console.log(JSON.stringify(parsed, null, 2));
      console.log('---------------------');
    } catch {
      console.error('❌ Failed to parse AI response:', cleaned.substring(0, 400));
      throw new Error('AI response was not valid JSON');
    }

    // (Sanitization logic removed since JSON schema now strictly asks for empty arrays)

    console.log(`  ✅ AI responded. Promises kept: ${parsed.realityCheck?.promisesKept?.length ?? 0}, broken: ${parsed.realityCheck?.promisesBroken?.length ?? 0}`);

    // Extract simply string values from forced chain-of-thought object for backwards compatibility
    const safeMetrics: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed.newState?.keyMetrics || {})) {
      safeMetrics[k] = (v && typeof v === 'object' && v.value) ? String(v.value) : String(v);
    }

    // 7. Save QuarterlyState (with PDF URLs for history + replay)
    await QuarterlyState.findOneAndUpdate(
      { ticker, quarter: currentQuarter },
      {
        ticker,
        quarter: currentQuarter,
        keyMetrics: safeMetrics,
        managementPromises: parsed.newState?.managementPromises || [],
        unanswered: parsed.newState?.unanswered || [],
        financialResultsUrl,
        transcriptUrl,
        createdAt: new Date(),
      },
      { upsert: true, new: true }
    );
    console.log(`  ✅ QuarterlyState saved`);

    // 7. Save new management promises as ManagementGuidance (status: pending)
    const newPromises = parsed.newState?.managementPromises || [];
    if (newPromises.length > 0) {
      const docs = newPromises.map((p: string) => ({
        ticker,
        quarter: currentQuarter,
        metric: 'Promise',
        guidanceText: p,
        targetValue: null,
        targetUnit: '',
        timeframe: 'Next Quarter',
        status: 'pending' as const,
        actualValue: null,
        verifiedQuarter: null,
        scoreNote: null,
        createdAt: new Date(),
      }));
      await ManagementGuidance.insertMany(docs);
      console.log(`  ✅ Saved ${docs.length} new promise(s) to ManagementGuidance`);
    }

    // 8. Score pending guidance using realityCheck
    //    Mark promises broken or kept based on Gemini's verdict
    const kept = parsed.realityCheck?.promisesKept || [];
    const broken = parsed.realityCheck?.promisesBroken || [];

    // Bulk-mark oldest pending promises as kept/broken (best-effort fuzzy match by order)
    for (let i = 0; i < kept.length; i++) {
      await ManagementGuidance.findOneAndUpdate(
        { ticker, status: 'pending' },
        { status: 'kept', verifiedQuarter: currentQuarter, scoreNote: kept[i] },
        { sort: { createdAt: 1 } }
      );
    }
    for (let i = 0; i < broken.length; i++) {
      await ManagementGuidance.findOneAndUpdate(
        { ticker, status: 'pending' },
        { status: 'broken', verifiedQuarter: currentQuarter, scoreNote: broken[i] },
        { sort: { createdAt: 1 } }
      );
    }
    if (kept.length + broken.length > 0) {
      console.log(`  ✅ Scored guidance: ${kept.length} kept, ${broken.length} broken`);
    }

    // 9. Credibility score
    const cred = await getCredibilityScore(ticker);
    const credLine = cred.total > 0
      ? `📊 *Credibility Score: ${cred.score}%* (✅ ${cred.kept} kept | ⚠️ ${cred.partial} partial | ❌ ${cred.broken} broken)`
      : `📊 *Credibility Score: N/A* — first quarter on record`;

    // 10. Send Telegram alert
    const fmt = (arr: string[]) => arr.map(s => `• ${s}`).join('\n') || '• None identified';

    const alertMessage =
      `📈 *${ticker} — ${currentQuarter}*\n\n` +

      `*🟢 Promises Kept:*\n${fmt(parsed.realityCheck?.promisesKept)}\n\n` +
      `*🔴 Promises Broken:*\n${fmt(parsed.realityCheck?.promisesBroken)}\n\n` +
      `*🤔 Evasions:*\n${fmt(parsed.realityCheck?.evasions)}\n\n` +

      `*📊 Thesis Tracker:*\n${parsed.thesisTracker?.summary || 'N/A'}\n\n` +

      `*🚨 Red Flags:*\n${fmt(parsed.redFlags)}\n\n` +

      `*📝 New Promises (tracking next quarter):*\n${fmt(parsed.newState?.managementPromises)}\n\n` +

      credLine;

    await sendTelegramAlert(alertMessage);
    console.log(`  ✅ Telegram alert sent`);

    return parsed;

  } catch (error) {
    console.error(`Error processing filings for ${ticker}:`, error);
    throw error;
  }
};
