# ovh-bill

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-green.svg)](https://nodejs.org/)

OVH bills downloader, cost analyzer, and interactive dashboard for OVHcloud.

## Features

- **CLI Tools**: Download OVH invoices in PDF or HTML format
- **Cost Analysis**: Split bills by Cloud Project with JSON/Markdown output
- **Data Import**: Import billing data from OVH API into local SQLite database
- **Dashboard**: Interactive React dashboard with charts and comparisons

## Quick Start

```bash
# Clone and install
git clone https://github.com/mmaudet/ovh-bill.git
cd ovh-bill
npm install

# Import data from OVH API
npm run import:full

# Start the dashboard
npm run dev
```

Open http://localhost:5173 to view the dashboard.

## Project Structure

```
ovh-bill/
├── cli/                 # Command-line tools
│   ├── index.js        # Invoice downloader
│   └── split-by-project.js  # Cost analyzer
├── data/               # Data layer
│   ├── import.js       # OVH API → SQLite import script
│   ├── db.js           # Database connection and queries
│   ├── schema.sql      # SQLite schema
│   └── ovh-bills.db    # Local database (gitignored)
├── server/             # Backend API
│   └── index.js        # Express server
└── dashboard/          # Frontend
    └── src/            # React application
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

### 3. Create Credentials File

Create `$HOME/my-ovh-bills/credentials.json`:

```json
{
  "appKey": "YOUR_APP_KEY",
  "appSecret": "YOUR_APP_SECRET",
  "consumerKey": "YOUR_CONSUMER_KEY",
  "endpoint": "ovh-eu"
}
```

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

# Split by project (JSON)
npm run split -- --from 2025-12-01 --to 2025-12-31

# Split by project (Markdown)
npm run split -- --from 2025-12-01 --to 2025-12-31 --format md
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

## Dashboard Features

- **KPI Cards**: Total cost, cloud total, daily average, active projects
- **Budget Progress**: Visual budget consumption tracker
- **Service Breakdown**: Pie chart by service type (Compute, Storage, Network, Database, AI/ML)
- **Project Ranking**: Bar chart of top consuming projects
- **Daily Trend**: Area chart of daily costs
- **Month Comparison**: Compare two months side by side
- **Historical Trends**: 6-month line chart with growth metrics

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT License - see [LICENSE.txt](LICENSE.txt)

## Author

**Somanos Sar** - [somanos@drumee.com](mailto:somanos@drumee.com)
