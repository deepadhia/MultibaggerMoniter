# 🚀 The Multibagger Monitor v2.0

A completely **headless, zero-click** financial tracking pipeline. No frontend — pure backend intelligence.

It runs autonomously on **GitHub Actions**, stores state in **MongoDB Atlas**, analyzes corporate filings using **Gemini 1.5 Pro**, and delivers strict, high-signal alerts exclusively via a **Telegram Bot**.

---

## 🏗️ Architecture

```
GitHub Actions (Cron: 18:00 IST, Mon-Fri)
    │
    ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  worker.ts   │────▶│  fetcher.ts  │────▶│   NSE API    │
│ (Orchestrator)│     │ (WAF Bypass) │     │  (Cookies)   │
└──────┬───────┘     └──────────────┘     └──────────────┘
       │
       ├── SAST / Bulk Deal detected ──▶ 📲 Telegram Alert
       │
       ├── Financial Results + Transcript found
       │         │
       │         ▼
       │   ┌──────────────┐     ┌──────────────┐
       │   │    ai.ts     │────▶│ Gemini 1.5   │
       │   │ (PDF Analysis)│     │    Pro       │
       │   └──────┬───────┘     └──────────────┘
       │          │
       │          ▼
       │   ┌──────────────┐
       │   │  MongoDB     │  (Save new QuarterlyState)
       │   │  Atlas       │
       │   └──────────────┘
       │          │
       │          ▼
       └────── 📲 Telegram Alert (Full AI Analysis)
```

---

## 📂 Project Structure

```
MultibaggerMoniter/
├── .github/
│   └── workflows/
│       └── daily-alpha.yml    # Cron: 12:30 UTC (18:00 IST) Mon-Fri
├── src/
│   ├── db.ts                  # Mongoose schemas (Watchlist, QuarterlyState, Shareholding)
│   ├── fetcher.ts             # NSE API fetcher with WAF bypass (cookie-jar + delay)
│   ├── bot.ts                 # Telegram bot (Telegraf)
│   ├── ai.ts                  # Gemini 1.5 Pro PDF analysis engine
│   └── worker.ts              # Main orchestration / daily watchdog
├── .env.example               # Template for environment variables
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

---

## ⚙️ Tech Stack

| Layer          | Technology                                        |
|----------------|---------------------------------------------------|
| Runtime        | Node.js v20+, TypeScript                          |
| HTTP Client    | Axios + `axios-cookiejar-support` + `tough-cookie` |
| Database       | MongoDB Atlas via Mongoose                        |
| AI / LLM       | Google Gemini 1.5 Pro (`@google/generative-ai`)   |
| Notifications  | Telegram Bot via Telegraf                         |
| CI/CD          | GitHub Actions (serverless cron)                  |

---

## 🔒 The Golden Rule

> **No equity under ₹5,000 Crore Market Cap is ever processed.**
>
> Hardcoded as `mCapThreshold: 5000` (default) in the `Watchlist` schema. The worker enforces `{ mCapThreshold: { $gte: 5000 } }` on every run.

---

## 🚀 Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/deepadhia/MultibaggerMoniter.git
cd MultibaggerMoniter
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Copy the example and fill in your credentials:

```bash
cp .env.example .env
```

| Variable          | Description                                      |
|-------------------|--------------------------------------------------|
| `MONGODB_URI`     | MongoDB Atlas connection string                  |
| `TELEGRAM_TOKEN`  | Telegram Bot token from [@BotFather](https://t.me/BotFather) |
| `TELEGRAM_CHAT_ID`| Your Telegram chat/group ID                      |
| `GEMINI_API_KEY`  | Google AI Studio API key                         |

### 4. Build & Run

```bash
npm run build    # Compile TypeScript → dist/
npm start        # Run the daily watchdog
```

For development:

```bash
npm run dev      # Run directly via ts-node
```

---

## 🤖 GitHub Actions (CI/CD)

The pipeline runs automatically every weekday at **18:00 IST** (post-market close).

### Required GitHub Secrets

Go to **Settings → Secrets and variables → Actions** and add:

- `MONGODB_URI`
- `TELEGRAM_TOKEN`
- `TELEGRAM_CHAT_ID`
- `GEMINI_API_KEY`

You can also trigger the workflow manually via the **Actions** tab → **Run workflow**.

---

## 📡 How It Works

### Daily Watchdog (`worker.ts`)
1. Connects to MongoDB and fetches all active watchlist tickers (M-Cap ≥ ₹5,000 Cr).
2. Calls the NSE corporate announcements API (with WAF bypass).
3. Scans for **SAST (Insider Trades)** and **Bulk Deals** → sends instant Telegram alerts.
4. Detects **Financial Results + Earnings Transcripts** → triggers the AI engine.

### NSE Fetcher (`fetcher.ts`)
- Hits `https://www.nseindia.com` to grab session cookies.
- Waits a randomized **2–5 seconds** to simulate human behavior.
- Calls `/api/corporate-announcements` with cookies and a Chrome User-Agent.

### Stateful AI Engine (`ai.ts`)
- Downloads Financial Results and Transcript PDFs into memory buffers.
- Retrieves the **previous quarter's state** from MongoDB.
- Constructs a rich prompt with: Master Prompt + Previous State JSON + PDF buffers.
- Forces **Gemini 1.5 Pro** to return structured JSON (reality check, new promises, unanswered questions).
- Saves the new `QuarterlyState` to MongoDB and sends the full analysis to Telegram.

---

## 📊 Database Schemas

### `Watchlist`
| Field           | Type    | Description                                |
|-----------------|---------|--------------------------------------------|
| `ticker`        | String  | NSE ticker symbol (unique)                 |
| `companyName`   | String  | Full company name                          |
| `isActive`      | Boolean | Whether this ticker is actively monitored  |
| `masterPrompt`  | String  | Custom AI analysis directive               |
| `mCapThreshold` | Number  | Minimum M-Cap in ₹ Crore (default: 5000)  |

### `QuarterlyState`
| Field                | Type       | Description                          |
|----------------------|------------|--------------------------------------|
| `ticker`             | String     | NSE ticker symbol                    |
| `quarter`            | String     | e.g., `Q3_2026`                      |
| `keyMetrics`         | Map        | Extracted financial metrics          |
| `managementPromises` | [String]   | Promises made in earnings call       |
| `unanswered`         | [String]   | Open questions / red flags           |

### `Shareholding`
| Field     | Type   | Description                    |
|-----------|--------|--------------------------------|
| `ticker`  | String | NSE ticker symbol              |
| `quarter` | String | e.g., `Q3_2026`                |
| `fii`     | Number | Foreign Institutional %        |
| `dii`     | Number | Domestic Institutional %       |
| `promoter`| Number | Promoter holding %             |

---

## 📜 License

MIT
