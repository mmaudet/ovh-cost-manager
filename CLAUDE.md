# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ovh-bill is a Node.js CLI tool that downloads OVH invoices/bills using the OVH API. It authenticates via OVH API credentials and fetches bills for a specified date range, saving them as PDF or HTML files.

## Running the Tool

```bash
# Install dependencies
npm install

# Run with required --from date
node index.js --from=YYYY-MM-DD

# Full example with all options
node index.js --from=2022-01-01 --to=2022-06-30 --output=/path/to/bills --credentials=/path/to/credentials.json --format=pdf --verbose --json
```

### CLI Options
- `--from=YYYY-MM-DD` (required): Start of billing period
- `--to=YYYY-MM-DD`: End of billing period (defaults to today)
- `--output=/path`: Directory for downloaded bills (defaults to `$HOME/my-ovh-bills/YEAR`)
- `--credentials=/path`: Path to credentials.json (defaults to `$HOME/my-ovh-bills/credentials.json`)
- `--format=pdf|html`: Bill format (defaults to pdf)
- `--verbose`: Show bill metadata
- `--json`: Save bill metadata as JSON files
- `--help`: Show usage information

## Architecture

Single-file CLI application (`index.js`) with no build step:

1. **Credentials**: Reads OVH API credentials (appKey, appSecret, consumerKey) from JSON file
2. **API calls**: Uses `ovh` npm package to query `/me/bill` endpoint with date range filters
3. **Downloads**: Fetches each bill's PDF/HTML via HTTPS and saves to output directory
4. **History**: Maintains `.history.json` to remember previous query parameters

## OVH API Setup

Credentials require three values from the OVH API:
1. Generate `appKey` + `appSecret` at https://eu.api.ovh.com/createToken/
2. Request `consumerKey` via curl with GET access to `/me/*` path
3. Store all three in credentials.json
