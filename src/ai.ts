import { GoogleGenerativeAI, Part } from '@google/generative-ai';
import { QuarterlyState } from './db';
import { sendTelegramAlert } from './bot';
import axios from 'axios';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.warn('GEMINI_API_KEY is not set.');
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY || '');
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });

export const downloadPDFToBuffer = async (url: string): Promise<Buffer> => {
  const response = await axios.get(url, { responseType: 'arraybuffer' });
  return Buffer.from(response.data);
};

export const processQuarterlyFilings = async (
  ticker: string,
  masterPrompt: string,
  financialResultsUrl: string,
  transcriptUrl: string,
  currentQuarter: string
) => {
  try {
    console.log(`Processing quarterly filings for ${ticker} (${currentQuarter})...`);

    // 1. Download PDFs
    const resultsBuffer = await downloadPDFToBuffer(financialResultsUrl);
    const transcriptBuffer = await downloadPDFToBuffer(transcriptUrl);

    // 2. Fetch Previous State
    const previousState = await QuarterlyState.findOne({ ticker }).sort({ quarter: -1 }).exec();
    const previousStateJSON = previousState ? JSON.stringify(previousState.toObject()) : 'None';

    // 3. Construct Prompt
    const prompt = `
You are a Senior Financial Analyst. Analyze the following corporate filings.

**Master Prompt / Objectives:**
${masterPrompt}

**Previous Quarter State:**
${previousStateJSON}

**Current Task:**
Analyze the provided Financial Results and Earnings Transcript for ${ticker} in ${currentQuarter}.
Identify whether management kept or broke promises from previous quarters.
Extract key metrics and identify unanswered questions or concerns.

You MUST return your response as purely formatted JSON matching the following structure exactly (without Markdown code blocks):
{
  "realityCheck": "Detailed text comparing past promises to current reality.",
  "keyMetrics": { "Revenue": "...", "EBITDA": "..." },
  "managementPromises": ["New promise 1", "New promise 2"],
  "unanswered": ["Question 1", "Question 2"]
}
`;

    // 4. Call Gemini 1.5 Pro
    console.log(`Calling Gemini 1.5 Pro for analysis...`);
    const part1: Part = {
      inlineData: {
        data: resultsBuffer.toString('base64'),
        mimeType: 'application/pdf'
      }
    };
    const part2: Part = {
      inlineData: {
        data: transcriptBuffer.toString('base64'),
        mimeType: 'application/pdf'
      }
    };

    const result = await model.generateContent([prompt, part1, part2]);
    const responseText = result.response.text();
    const jsonMatch = responseText.replace(/```json\n|```/g, '');
    
    let parsedData;
    try {
      parsedData = JSON.parse(jsonMatch.trim());
    } catch (parseError) {
      console.error('Failed to parse Gemini response as JSON. Raw response:', responseText);
      throw new Error('Gemini response was not valid JSON');
    }

    // 5. Save New State to MongoDB
    await QuarterlyState.create({
      ticker,
      quarter: currentQuarter,
      keyMetrics: parsedData.keyMetrics || {},
      managementPromises: parsedData.managementPromises || [],
      unanswered: parsedData.unanswered || []
    });

    console.log(`Saved new state for ${ticker} (${currentQuarter}) to MongoDB.`);

    // 6. Send Alert via Telegram
    const alertMessage = 
      `🚨 *Quarterly Update: ${ticker} (${currentQuarter})* 🚨\n\n` +
      `*Reality Check:*\n${parsedData.realityCheck}\n\n` +
      `*New Promises:*\n${parsedData.managementPromises.map((p: string) => `- ${p}`).join('\n')}\n\n` +
      `*Unanswered Questions:*\n${parsedData.unanswered.map((u: string) => `- ${u}`).join('\n')}`;

    await sendTelegramAlert(alertMessage);
    
  } catch (error) {
    console.error(`Error processing filings for ${ticker}:`, error);
  }
};
