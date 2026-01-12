# ovh-bill

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D14.0.0-green.svg)](https://nodejs.org/)

Automatically download your OVH invoices (PDF or HTML) using the OVH API.

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [Options](#options)
- [Contributing](#contributing)
- [License](#license)
- [Author](#author)

## Features

- Download OVH invoices in PDF or HTML format
- Filter by date range
- Export invoice metadata to JSON
- Customizable output directory
- Support for custom credentials file location

## Prerequisites

- [Node.js](https://nodejs.org/) >= 14.0.0
- An OVH account with API access
- OVH API credentials (see [Configuration](#configuration))

## Installation

```bash
git clone https://github.com/somanos/ovh-bill.git
cd ovh-bill
npm install
```

## Configuration

### Step 1: Generate Application Credentials

1. Go to [OVH API Token Creation](https://eu.api.ovh.com/createToken/)
2. Log in with your OVH account
3. Note your **Application Key** and **Application Secret**

### Step 2: Generate Consumer Key

Run the following command, replacing `YOUR_APP_KEY` with your Application Key:

```bash
curl -X POST \
  -H "Content-type: application/json" \
  -H "X-Ovh-Application: YOUR_APP_KEY" \
  -d '{"accessRules": [{"method": "GET", "path": "/me/*"}]}' \
  https://eu.api.ovh.com/1.0/auth/credential
```

This will return a JSON response with:
- `consumerKey`: Your consumer key
- `validationUrl`: URL to validate the token

3. Visit the `validationUrl` to authorize the application
4. Note the `consumerKey` from the response

### Step 3: Create Credentials File

Create the file `$HOME/my-ovh-bills/credentials.json`:

```json
{
  "appKey": "YOUR_APP_KEY",
  "appSecret": "YOUR_APP_SECRET",
  "consumerKey": "YOUR_CONSUMER_KEY",
  "endpoint": "ovh-eu"
}
```

> **Security Warning:** Keep your `credentials.json` file secret and never commit it to version control.

## Usage

### Basic Usage

Download all invoices from a specific date:

```bash
node index.js --from=2024-01-01
```

### Download Invoices for a Date Range

```bash
node index.js --from=2024-01-01 --to=2024-06-30
```

### Custom Output Directory and Credentials

```bash
node index.js --from=2024-01-01 --to=2024-06-30 \
  --output=/path/to/invoices \
  --credentials=/path/to/credentials.json
```

### Export with Metadata

```bash
node index.js --from=2024-01-01 --json --verbose
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--from=YYYY-MM-DD` | Start date of billing period | **Required** |
| `--to=YYYY-MM-DD` | End date of billing period | Today |
| `--format=pdf\|html` | Invoice format | `pdf` |
| `--output=/path` | Output directory | `$HOME/my-ovh-bills` |
| `--credentials=/path` | Credentials file path | `$HOME/my-ovh-bills/credentials.json` |
| `--json` | Save invoice metadata as JSON | `false` |
| `--verbose` | Show invoice metadata in console | `false` |

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE.txt](LICENSE.txt) file for details.

## Author

**Somanos Sar** - [somanos@drumee.com](mailto:somanos@drumee.com)

---

If you find this project useful, please consider giving it a star on GitHub!
