#!/usr/bin/env node
/**
 * OVH Bills Data Import Script
 *
 * Imports billing data from OVH API into local SQLite database.
 *
 * Usage:
 *   node import.js --full                    # Full import (clears existing data)
 *   node import.js --from 2025-01-01 --to 2025-12-31  # Import specific period
 *   node import.js --diff                    # Differential import (since last import)
 *   node import.js --diff --since 2025-06-01 # Differential from specific date
 */

const path = require('path');
const Jsonfile = require('jsonfile');
const db = require('./db');

// Load configuration (credentials + settings)
const APP_DATA = path.resolve(process.env.HOME, 'my-ovh-bills');
const CONFIG_PATHS = [
  path.resolve(__dirname, '..', 'config.json'),      // Project root
  path.resolve(APP_DATA, 'config.json'),              // ~/my-ovh-bills/config.json
  path.resolve(APP_DATA, 'credentials.json')          // Legacy: ~/my-ovh-bills/credentials.json
];

let ovh;
let config = {};
let configLoaded = false;

for (const configPath of CONFIG_PATHS) {
  try {
    const loadedConfig = Jsonfile.readFileSync(configPath);
    // Handle both new format (with credentials key) and legacy format
    const cred = loadedConfig.credentials || loadedConfig;
    ovh = require('ovh')(cred);
    config = loadedConfig;
    configLoaded = true;
    break;
  } catch (e) {
    // Try next path
  }
}

if (!configLoaded) {
  console.error('Error: No valid configuration file found.');
  console.error('Searched paths:');
  CONFIG_PATHS.forEach(p => console.error(`  - ${p}`));
  console.error('\nPlease create config.json with valid OVH API credentials.');
  process.exit(1);
}

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const params = {
    full: false,
    diff: false,
    from: null,
    to: null,
    since: null
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--full') {
      params.full = true;
    } else if (args[i] === '--diff') {
      params.diff = true;
    } else if (args[i] === '--from' && args[i + 1]) {
      params.from = args[++i];
    } else if (args[i] === '--to' && args[i + 1]) {
      params.to = args[++i];
    } else if (args[i] === '--since' && args[i + 1]) {
      params.since = args[++i];
    }
  }

  return params;
}

// Classify service type from description
function classifyService(description) {
  const desc = (description || '').toLowerCase();

  if (desc.includes('instance') || desc.includes('compute') || desc.includes('vm') ||
      desc.includes('forfait mensuel') || desc.includes('consommation à l\'heure')) {
    // Check if it's AI/ML (GPU instances)
    if (desc.includes('gpu') || desc.includes('l40s') || desc.includes('l4-') ||
        desc.includes('a100') || desc.includes('v100') || desc.includes('t4')) {
      return 'AI/ML';
    }
    return 'Compute';
  }

  if (desc.includes('storage') || desc.includes('stockage') || desc.includes('bucket') ||
      desc.includes('swift') || desc.includes('object') || desc.includes('archive') ||
      desc.includes('snapshot') || desc.includes('backup') || desc.includes('disque')) {
    return 'Storage';
  }

  if (desc.includes('network') || desc.includes('loadbalancer') || desc.includes('floating ip') ||
      desc.includes('gateway') || desc.includes('bandwidth') || desc.includes('octavia') ||
      desc.includes('private network') || desc.includes('vrack')) {
    return 'Network';
  }

  if (desc.includes('database') || desc.includes('postgresql') || desc.includes('mysql') ||
      desc.includes('mongodb') || desc.includes('redis') || desc.includes('kafka') ||
      desc.includes('opensearch') || desc.includes('cassandra')) {
    return 'Database';
  }

  if (desc.includes('ai ') || desc.includes(' ml') || desc.includes('machine learning') ||
      desc.includes('notebook') || desc.includes('training')) {
    return 'AI/ML';
  }

  return 'Other';
}

// Fetch all cloud projects
async function fetchProjects() {
  console.log('Fetching cloud projects...');
  const projectIds = await ovh.requestPromised('GET', '/cloud/project');
  const projects = [];

  for (const id of projectIds) {
    try {
      const info = await ovh.requestPromised('GET', `/cloud/project/${id}`);
      projects.push({
        id,
        name: info.description || id,
        description: info.description,
        status: info.status,
        created_at: info.creationDate
      });
    } catch (err) {
      console.error(`  Error fetching project ${id}: ${err.message}`);
    }
  }

  console.log(`  Found ${projects.length} projects`);
  return projects;
}

// Fetch bills in date range
async function fetchBills(fromDate, toDate) {
  console.log(`Fetching bills from ${fromDate || 'beginning'} to ${toDate || 'now'}...`);

  const params = {};
  if (fromDate) params['date.from'] = fromDate;
  if (toDate) params['date.to'] = toDate;

  const billIds = await ovh.requestPromised('GET', '/me/bill', params);
  console.log(`  Found ${billIds.length} bills`);

  return billIds;
}

// Fetch bill details
async function fetchBillDetails(billId) {
  const bill = await ovh.requestPromised('GET', `/me/bill/${billId}`);
  const detailIds = await ovh.requestPromised('GET', `/me/bill/${billId}/details`);

  const details = [];
  for (const detailId of detailIds) {
    try {
      const detail = await ovh.requestPromised('GET', `/me/bill/${billId}/details/${detailId}`);
      details.push({
        id: `${billId}_${detailId}`,
        bill_id: billId,
        domain: detail.domain,
        description: detail.description,
        quantity: detail.quantity,
        unit_price: detail.unitPrice?.value || 0,
        total_price: detail.totalPrice?.value || 0
      });
    } catch (err) {
      console.error(`    Error fetching detail ${detailId}: ${err.message}`);
    }
  }

  return {
    bill: {
      id: bill.billId,
      date: bill.date?.split('T')[0],
      price_without_tax: bill.priceWithoutTax?.value || 0,
      price_with_tax: bill.priceWithTax?.value || 0,
      tax: bill.tax?.value || 0,
      currency: bill.priceWithoutTax?.currencyCode || 'EUR',
      pdf_url: bill.pdfUrl,
      html_url: bill.url
    },
    details
  };
}

// Main import function
async function runImport(params) {
  const stats = { bills: 0, details: 0, projects: 0 };

  // Determine import type and dates
  let importType = 'period';
  let fromDate = params.from;
  let toDate = params.to || new Date().toISOString().split('T')[0];

  if (params.full) {
    importType = 'full';
    fromDate = null;
    toDate = null;
    console.log('\n=== FULL IMPORT ===');
    console.log('This will clear all existing data and reimport everything.\n');
    db.clearAll();
  } else if (params.diff) {
    importType = 'differential';
    if (params.since) {
      fromDate = params.since;
    } else {
      const latestBillDate = db.bills.getLatestDate();
      if (latestBillDate) {
        fromDate = latestBillDate;
      } else {
        console.log('No existing data found. Running full import instead.');
        importType = 'full';
      }
    }
    console.log(`\n=== DIFFERENTIAL IMPORT ===`);
    console.log(`Importing bills since: ${fromDate || 'beginning'}\n`);
  } else if (params.from) {
    console.log(`\n=== PERIOD IMPORT ===`);
    console.log(`From: ${fromDate}`);
    console.log(`To: ${toDate}\n`);
  } else {
    console.error('Usage:');
    console.error('  node import.js --full');
    console.error('  node import.js --from 2025-01-01 --to 2025-12-31');
    console.error('  node import.js --diff');
    console.error('  node import.js --diff --since 2025-06-01');
    process.exit(1);
  }

  // Start import log
  const importId = db.importLog.start(importType, fromDate, toDate);

  try {
    // Fetch and store projects
    const projects = await fetchProjects();
    const projectMap = {};
    for (const project of projects) {
      db.projects.upsert(project);
      projectMap[project.id] = project.name;
      stats.projects++;
    }

    // Fetch bills
    const billIds = await fetchBills(fromDate, toDate);

    // Process each bill
    console.log('\nProcessing bills...');
    for (let i = 0; i < billIds.length; i++) {
      const billId = billIds[i];
      process.stdout.write(`  [${i + 1}/${billIds.length}] ${billId}...`);

      // Skip if already exists (for differential)
      if (importType === 'differential' && db.bills.exists(billId)) {
        console.log(' skipped (exists)');
        continue;
      }

      try {
        const { bill, details } = await fetchBillDetails(billId);

        // Store bill
        db.bills.upsert(bill);
        stats.bills++;

        // Delete existing details (for updates)
        db.details.deleteByBillId(billId);

        // Process and store details
        const processedDetails = details.map(d => ({
          ...d,
          project_id: projectMap[d.domain] ? d.domain : null,
          service_type: classifyService(d.description)
        }));

        db.details.insertMany(processedDetails);
        stats.details += processedDetails.length;

        console.log(` ${details.length} details`);
      } catch (err) {
        console.log(` ERROR: ${err.message}`);
      }
    }

    // Complete import log
    db.importLog.complete(importId, stats);

    console.log('\n=== IMPORT COMPLETE ===');
    console.log(`Projects: ${stats.projects}`);
    console.log(`Bills: ${stats.bills}`);
    console.log(`Details: ${stats.details}`);

  } catch (err) {
    db.importLog.fail(importId, err.message);
    console.error('\n=== IMPORT FAILED ===');
    console.error(err.message);
    process.exit(1);
  } finally {
    db.closeDb();
  }
}

// Run
const params = parseArgs();
runImport(params);
