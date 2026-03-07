import mongoose, { Schema, Document } from 'mongoose';

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
  masterPrompt: { type: String, required: true },
  mCapThreshold: { type: Number, default: 5000 }
});

export const Watchlist = mongoose.model<IWatchlist>('Watchlist', WatchlistSchema);

export interface IQuarterlyState extends Document {
  ticker: string;
  quarter: string;
  keyMetrics: Map<string, string>;
  managementPromises: string[];
  unanswered: string[];
}

const QuarterlyStateSchema = new Schema<IQuarterlyState>({
  ticker: { type: String, required: true },
  quarter: { type: String, required: true },
  keyMetrics: { type: Map, of: String },
  managementPromises: [{ type: String }],
  unanswered: [{ type: String }]
});

// Compound index to ensure uniqueness per ticker per quarter
QuarterlyStateSchema.index({ ticker: 1, quarter: 1 }, { unique: true });

export const QuarterlyState = mongoose.model<IQuarterlyState>('QuarterlyState', QuarterlyStateSchema);

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

// Compound index to ensure uniqueness per ticker per quarter
ShareholdingSchema.index({ ticker: 1, quarter: 1 }, { unique: true });

export const Shareholding = mongoose.model<IShareholding>('Shareholding', ShareholdingSchema);

export const connectDB = async (uri: string) => {
  try {
    await mongoose.connect(uri);
    console.log('MongoDB connected successfully');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
};
