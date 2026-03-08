import mongoose, { Schema, Document } from 'mongoose';

// ── Watchlist ──────────────────────────────────────────────────────────────
export interface IWatchlist extends Document {
  ticker: string;
  companyName: string;
  isActive: boolean;
  masterPrompt: string;
  mCapThreshold: number;
}

const WatchlistSchema = new Schema<IWatchlist>({
  ticker: { type: String, required: true, unique: true },
  companyName: { type: String, required: true },
  isActive: { type: Boolean, default: true },
  masterPrompt: { type: String, default: '' },  // empty = use DEFAULT_MASTER_PROMPT
  mCapThreshold: { type: Number, default: 5000 }
});

export const Watchlist = mongoose.model<IWatchlist>('Watchlist', WatchlistSchema);

// ── QuarterlyState ─────────────────────────────────────────────────────────
export interface IQuarterlyState extends Document {
  ticker: string;
  quarter: string;
  keyMetrics: Map<string, string>;
  managementPromises: string[];
  unanswered: string[];
  financialResultsUrl: string;  // PDF URL for results (for history + replay)
  transcriptUrl: string;        // PDF URL for concall transcript
  createdAt: Date;
}

const QuarterlyStateSchema = new Schema<IQuarterlyState>({
  ticker: { type: String, required: true },
  quarter: { type: String, required: true },
  keyMetrics: { type: Map, of: String },
  managementPromises: [{ type: String }],
  unanswered: [{ type: String }],
  financialResultsUrl: { type: String, default: '' },
  transcriptUrl: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});

// Compound index: unique per ticker per quarter
QuarterlyStateSchema.index({ ticker: 1, quarter: 1 }, { unique: true });

export const QuarterlyState = mongoose.model<IQuarterlyState>('QuarterlyState', QuarterlyStateSchema);

// ── ManagementGuidance ─────────────────────────────────────────────────────
// Stores specific numeric promises management made; scored in subsequent quarters
export interface IManagementGuidance extends Document {
  ticker: string;
  quarter: string;           // quarter in which the promise was MADE e.g. "Q3_FY25"
  metric: string;            // e.g. "EBITDA Margin", "Revenue", "Net Debt"
  guidanceText: string;      // raw management quote extracted by AI
  targetValue: number | null; // numeric target e.g. 18
  targetUnit: string;        // e.g. "%", "Cr", "x"
  timeframe: string;         // e.g. "Q4_FY25", "FY26", "next quarter"
  // Populated when verified in a subsequent quarter:
  status: 'pending' | 'kept' | 'partial' | 'broken';
  actualValue: number | null;
  verifiedQuarter: string | null;
  scoreNote: string | null;
  createdAt: Date;
}

const ManagementGuidanceSchema = new Schema<IManagementGuidance>({
  ticker: { type: String, required: true },
  quarter: { type: String, required: true },
  metric: { type: String, required: true },
  guidanceText: { type: String, required: true },
  targetValue: { type: Number, default: null },
  targetUnit: { type: String, default: '' },
  timeframe: { type: String, default: '' },
  status: { type: String, enum: ['pending', 'kept', 'partial', 'broken'], default: 'pending' },
  actualValue: { type: Number, default: null },
  verifiedQuarter: { type: String, default: null },
  scoreNote: { type: String, default: null },
  createdAt: { type: Date, default: Date.now }
});

ManagementGuidanceSchema.index({ ticker: 1, quarter: 1, metric: 1 });

export const ManagementGuidance = mongoose.model<IManagementGuidance>('ManagementGuidance', ManagementGuidanceSchema);

// ── Shareholding ───────────────────────────────────────────────────────────
export interface IShareholding extends Document {
  ticker: string;
  quarter: string;
  fii: number;
  dii: number;
  promoter: number;
}

const ShareholdingSchema = new Schema<IShareholding>({
  ticker: { type: String, required: true },
  quarter: { type: String, required: true },
  fii: { type: Number, required: true },
  dii: { type: Number, required: true },
  promoter: { type: Number, required: true }
});

ShareholdingSchema.index({ ticker: 1, quarter: 1 }, { unique: true });

export const Shareholding = mongoose.model<IShareholding>('Shareholding', ShareholdingSchema);

// ── DB Connection ──────────────────────────────────────────────────────────
export const connectDB = async (uri: string) => {
  try {
    await mongoose.connect(uri);
    console.log('MongoDB connected successfully');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
};
