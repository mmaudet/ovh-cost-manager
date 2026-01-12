# OVH Cost Manager

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-green.svg)](https://nodejs.org/)

Interactive dashboard for OVHcloud billing analysis with cost tracking, monthly comparisons, service breakdowns, and trend analysis.

## Screenshots

### Overview
![Overview - Service breakdown and top projects](docs/screenshots/overview.png)

### Month Comparison
![Compare - Side by side month comparison](docs/screenshots/compare.png)

### Historical Trends
![Trends - 12-month cost evolution](docs/screenshots/trends.png)

## Features

- **Interactive Dashboard**: React-based dashboard with charts and visualizations
- **Multi-language Support**: French and English interface (i18n)
- **Cost Analysis**: Breakdown by service type (Compute, Storage, Network, Database, AI/ML)
- **Month Comparison**: Compare costs between two months side by side
- **Trend Analysis**: Historical trends with configurable period (3-36 months)
- **Budget Tracking**: Visual budget consumption with configurable targets
- **Sortable Tables**: Click column headers to sort by name, amount, or variation
- **Export**: PDF and Markdown report generation
- **CLI Tools**: Download invoices, split by project, extract bills per project
- **Data Import**: Import billing data from OVH API into local SQLite database

## Quick Start

```bash
# Clone and install
git clone https://github.com/mmaudet/ovh-cost-manager.git
cd ovh-cost-manager
npm install

# Configure OVH API credentials (see Configuration section below)
cp config.example.json config.json
# Edit config.json with your OVH API credentials

# Import data from OVH API
npm run import:full

# Start the dashboard
npm run dev
```

Open http://localhost:5173 to view the dashboard.

> **Note**: The import requires valid OVH API credentials. See [Configuration](#configuration) for setup instructions.

## Project Structure

```
ovh-cost-manager/
├── cli/                      # Command-line tools
│   ├── index.js              # Invoice downloader
│   ├── split-by-project.js   # Cost analyzer (via OVH API)
│   └── bills-by-project.js   # Bills extractor (via local DB)
├── data/                     # Data layer
│   ├── import.js             # OVH API → SQLite import script
│   ├── db.js                 # Database connection and queries
│   ├── schema.sql            # SQLite schema
│   └── ovh-bills.db          # Local database (gitignored)
├── server/                   # Backend API
│   └── index.js              # Express server (port 3001)
├── dashboard/                # Frontend (Vite + React)
│   └── src/
│       ├── components/       # React components (Logo)
│       ├── hooks/            # Custom hooks (useLanguage)
│       ├── i18n/             # Translations (FR/EN)
│       ├── pages/            # Dashboard page
│       └── services/         # API client
└── config.example.json       # Configuration template
```

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18.0.0
- OVH API credentials (see [Configuration](#configuration))

## Configuration

### 1. Generate OVH API Credentials

1. Go to [OVH API Token Creation](https://eu.api.ovh.com/createToken/)
2. Log in and note your **Application Key** and **Application Secret**

### 2. Generate Consumer Key

```bash
curl -X POST \
  -H "Content-type: application/json" \
  -H "X-Ovh-Application: YOUR_APP_KEY" \
  -d '{"accessRules": [{"method": "GET", "path": "/me/*"}, {"method": "GET", "path": "/cloud/*"}]}' \
  https://eu.api.ovh.com/1.0/auth/credential
```

Visit the `validationUrl` in the response to authorize the application.

### 3. Create Configuration File

Create `config.json` at project root or `$HOME/my-ovh-bills/config.json`:

```json
{
  "credentials": {
    "appKey": "YOUR_APP_KEY",
    "appSecret": "YOUR_APP_SECRET",
    "consumerKey": "YOUR_CONSUMER_KEY",
    "endpoint": "ovh-eu"
  },
  "dashboard": {
    "budget": 50000,
    "currency": "EUR",
    "language": "fr"
  }
}
```

> **Language options**: `"fr"` (French) or `"en"` (English). Can also be changed via the UI.

> **Note**: Legacy format (`credentials.json` with flat structure) is still supported.

## Usage

### Import Data

```bash
# Full import (all historical data)
npm run import:full

# Import specific period
npm run import -- --from 2025-01-01 --to 2025-12-31

# Differential import (new data since last import)
npm run import:diff
```

### Start Dashboard

```bash
# Development (server + frontend)
npm run dev

# Or separately:
npm run dev:server    # Backend on :3001
npm run dev:dashboard # Frontend on :5173
```

### CLI Tools

```bash
# Download invoices
npm run cli -- --from=2025-01-01 --to=2025-12-31

# Generate markdown summary
npm run cli -- --from=2025-01-01 --summary

# Split by project via OVH API (JSON)
npm run split -- --from 2025-12-01 --to 2025-12-31

# Split by project via OVH API (Markdown)
npm run split -- --from 2025-12-01 --to 2025-12-31 --format md

# Extract bills from local DB
npm run bills -- --list                              # List all projects
npm run bills -- --project "AI"                      # All bills for project
npm run bills -- --project "AI" --from 2025-01-01 --to 2025-12-31
npm run bills -- --project "AI" --format md          # Markdown output
npm run bills -- --month 2025-12                     # All bills for a month
npm run bills -- --month 2025-12 --format md         # Markdown output
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/projects` | List all Cloud projects |
| `GET /api/bills?from=&to=` | List bills in date range |
| `GET /api/analysis/by-project?from=&to=` | Costs grouped by project |
| `GET /api/analysis/by-service?from=&to=` | Costs grouped by service type |
| `GET /api/analysis/daily-trend?from=&to=` | Daily cost trend |
| `GET /api/analysis/monthly-trend?months=6` | Monthly cost trend |
| `GET /api/summary?from=&to=` | Summary with totals |
| `GET /api/months` | Available months for selection |
| `GET /api/import/status` | Import history and status |
| `GET /api/config` | Dashboard configuration (budget) |

## Dashboard Features

- **Multi-language**: French and English interface with language selector
- **KPI Cards**: Total cost, cloud total, daily average, active projects
- **Budget Progress**: Visual budget consumption tracker (configurable budget)
- **Service Breakdown**: Pie chart by service type (Compute, Storage, Network, Database, AI/ML)
- **Project Breakdown**: Sortable table with cost per project and percentages
- **Project Ranking**: Bar chart of top consuming projects
- **Month Comparison**: Compare two months side by side with sortable variation table
- **Historical Trends**: Configurable period (3, 6, 12, 24, or 36 months) with growth metrics
- **Export**: PDF (print) and Markdown report generation

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT License - see [LICENSE.txt](LICENSE.txt)

## Author

**Michel-Marie MAUDET** - [mmaudet@linagora.com](mailto:mmaudet@linagora.com)

*This project was inspired by the work of [Somanos Sar](https://github.com/somanos/ovh-bill).*
