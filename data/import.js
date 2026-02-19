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
    since: null,
    includeConsumption: false,
    includeAccount: false,
    includeInventory: false,
    includeCloudDetails: false,
    all: false
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
    } else if (args[i] === '--include-consumption') {
      params.includeConsumption = true;
    } else if (args[i] === '--include-account') {
      params.includeAccount = true;
    } else if (args[i] === '--include-inventory') {
      params.includeInventory = true;
    } else if (args[i] === '--include-cloud-details') {
      params.includeCloudDetails = true;
    } else if (args[i] === '--all') {
      params.all = true;
      params.includeConsumption = true;
      params.includeAccount = true;
      params.includeInventory = true;
      params.includeCloudDetails = true;
    }
  }

  return params;
}

// Classify service type from description
function classifyService(description) {
  const desc = (description || '').toLowerCase();

  // AI/ML - check first as GPU instances should be AI/ML not Compute
  if (desc.includes('gpu') || desc.includes('l40s') || desc.includes('l4-') ||
      desc.includes('a100') || desc.includes('v100') || desc.includes('t4') ||
      desc.includes('h100') || desc.includes('ai ') || desc.includes(' ml') ||
      desc.includes('machine learning') || desc.includes('notebook') || desc.includes('training') ||
      desc.includes('ai deploy') || desc.includes('ai training') || desc.includes('ai notebook')) {
    return 'AI/ML';
  }

  // Licenses - check early because "Windows Server" contains "server"
  if (desc.includes('license') || desc.includes('licence')) {
    return 'Licenses';
  }

  // Backup - Veeam and backup services
  if (desc.includes('veeam') || desc.includes('backup')) {
    return 'Backup';
  }

  // Support & Services - check early because "management fee" might conflict
  if (desc.includes('support') || desc.includes('management fee') ||
      desc.includes('professional service')) {
    return 'Support';
  }

  // Database - check before Storage because "Logs - Streams" contains "storage"
  if (desc.includes('database') || desc.includes('postgresql') || desc.includes('mysql') ||
      desc.includes('mongodb') || desc.includes('redis') || desc.includes('kafka') ||
      desc.includes('opensearch') || desc.includes('cassandra') || desc.includes('mariadb') ||
      desc.includes('m3db') || desc.includes('grafana') || desc.includes('logs data platform') ||
      desc.includes('elasticsearch') || desc.includes('timeseries') ||
      desc.includes('logs -') || desc.includes('streams -')) {
    return 'Database';
  }

  // Storage - S3, Object Storage, Swift, volumes, snapshots, datastores, backup
  // Check before Compute because "swift container" should be Storage not Compute
  if (desc.includes('storage') || desc.includes('stockage') || desc.includes('bucket') ||
      desc.includes('swift') || desc.includes('object') || desc.includes('archive') ||
      desc.includes('snapshot') || desc.includes('disque') ||
      desc.includes('volume') || desc.includes('disk') || desc.includes('s3') ||
      desc.includes('cold archive') || desc.includes('high perf') || desc.includes('classic') ||
      desc.includes('block storage') || desc.includes('additional disk') ||
      desc.includes('datastore') || desc.includes('zpool')) {
    return 'Storage';
  }

  // Compute - instances, VMs, Kubernetes, containers, hosts, bare metal
  if (desc.includes('instance') || desc.includes('compute') || desc.includes('vm') ||
      desc.includes('forfait mensuel') || desc.includes('consommation à l\'heure') ||
      desc.includes('kubernetes') || desc.includes('kube') || desc.includes('k8s') ||
      desc.includes('managed kubernetes') || desc.includes('container') ||
      desc.includes('registry') || desc.includes('worker node') || desc.includes('control plane') ||
      desc.includes('serveur') || desc.includes('server') || desc.includes('vcpu') ||
      desc.includes('ram ') || desc.includes('mémoire') ||
      // Private Cloud / vSphere hosts
      desc.includes('host ') || desc.includes('host rental') || desc.includes('esxi') ||
      desc.includes('vsphere') || desc.includes('vmware') || desc.includes('premier 384') ||
      desc.includes('premier 768') || desc.includes('premier rental') ||
      // Bare metal Scale servers
      desc.includes('scale-') || desc.includes('advance-') || desc.includes('infra-') ||
      desc.includes('hg-') || desc.includes('eg-') || desc.includes('mg-') ||
      // General dedicated
      desc.includes('rental for 1 month') && (desc.includes('scale') || desc.includes('advance'))) {
    return 'Compute';
  }

  // Network - load balancers, IPs, bandwidth, egress
  if (desc.includes('network') || desc.includes('loadbalancer') || desc.includes('load balancer') ||
      desc.includes('floating ip') || desc.includes('gateway') || desc.includes('bandwidth') ||
      desc.includes('octavia') || desc.includes('private network') || desc.includes('vrack') ||
      desc.includes('egress') || desc.includes('ingress') || desc.includes('traffic') ||
      desc.includes('trafic') || desc.includes('ip failover') || desc.includes('additional ip') ||
      desc.includes('public ip') || desc.includes('réseau') || desc.includes('outgoing') ||
      desc.includes('ip v4 block') || desc.includes('ip block') || desc.includes('/27') ||
      desc.includes('/28') || desc.includes('/29') || desc.includes('/30')) {
    return 'Network';
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

// --- Phase 1: Consumption data ---

async function fetchConsumptionCurrent() {
  console.log('Fetching current consumption...');
  try {
    const data = await ovh.requestPromised('GET', '/me/consumption/usage/current');
    return data;
  } catch (err) {
    console.error(`  Error fetching current consumption: ${err.message}`);
    return null;
  }
}

async function fetchConsumptionForecast() {
  console.log('Fetching consumption forecast...');
  try {
    const data = await ovh.requestPromised('GET', '/me/consumption/usage/forecast');
    return data;
  } catch (err) {
    console.error(`  Error fetching consumption forecast: ${err.message}`);
    return null;
  }
}

async function fetchConsumptionHistory() {
  console.log('Fetching consumption history...');
  try {
    const data = await ovh.requestPromised('GET', '/me/consumption/usage/history');
    return data;
  } catch (err) {
    console.error(`  Error fetching consumption history: ${err.message}`);
    return [];
  }
}

// Sum total price from an array of consumption entries
function sumConsumptionEntries(entries) {
  if (!Array.isArray(entries)) return 0;
  return entries.reduce((sum, e) => sum + (e?.price?.value || 0), 0);
}

async function importConsumption() {
  console.log('\n--- Importing consumption data ---');

  const currentEntries = await fetchConsumptionCurrent();
  const forecastEntries = await fetchConsumptionForecast();

  // API returns arrays of per-service consumption entries
  const currentTotal = sumConsumptionEntries(currentEntries);
  const forecastTotal = sumConsumptionEntries(forecastEntries);
  const firstCurrent = Array.isArray(currentEntries) ? currentEntries[0] : null;
  const firstForecast = Array.isArray(forecastEntries) ? forecastEntries[0] : null;
  const currency = firstCurrent?.price?.currencyCode || firstForecast?.price?.currencyCode || 'EUR';

  if (currentTotal > 0 || forecastTotal > 0 || (currentEntries && currentEntries.length > 0)) {
    db.consumption.insertSnapshot({
      period_start: firstCurrent?.beginDate?.split('T')[0] || new Date().toISOString().split('T')[0],
      period_end: firstCurrent?.endDate?.split('T')[0] || new Date().toISOString().split('T')[0],
      current_total: currentTotal,
      forecast_total: forecastTotal,
      currency,
      raw_data: JSON.stringify({ current: currentEntries, forecast: forecastEntries })
    });
    console.log(`  Current: ${currentTotal} ${currency}, Forecast: ${forecastTotal} ${currency} (${(currentEntries || []).length} services)`);
  }

  // History - requires beginDate/endDate params
  console.log('Fetching consumption history...');
  try {
    const now = new Date();
    const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), 1);
    const historyEntries = await ovh.requestPromised('GET', '/me/consumption/usage/history', {
      beginDate: oneYearAgo.toISOString(),
      endDate: now.toISOString()
    });

    if (Array.isArray(historyEntries) && historyEntries.length > 0) {
      db.consumption.clearHistory();
      // History entries are already full objects (not IDs to fetch individually)
      for (const entry of historyEntries) {
        const total = entry?.price?.value || 0;
        const entryCurrency = entry?.price?.currencyCode || 'EUR';
        db.consumption.insertHistory({
          period_start: entry?.beginDate?.split('T')[0] || '',
          period_end: entry?.endDate?.split('T')[0] || '',
          service_type: entry?.elements?.[0]?.planFamily || null,
          total,
          currency: entryCurrency,
          raw_data: JSON.stringify(entry)
        });
      }
      console.log(`  Imported ${historyEntries.length} history entries`);
    } else {
      console.log('  No history entries found');
    }
  } catch (err) {
    console.error(`  Error fetching consumption history: ${err.message}`);
  }
}

// --- Phase 2: Account balance, debts, credits ---

async function importAccountData() {
  console.log('\n--- Importing account data ---');

  let debtBalance = 0;
  let creditBalance = 0;
  let depositTotal = 0;

  // Fetch debt account
  try {
    const debt = await ovh.requestPromised('GET', '/me/debtAccount');
    debtBalance = debt?.todoAmount?.value || 0;
    console.log(`  Debt balance: ${debtBalance}`);
  } catch (err) {
    console.error(`  Error fetching debt account: ${err.message}`);
  }

  // Fetch credit balances
  try {
    const balanceIds = await ovh.requestPromised('GET', '/me/credit/balance');
    for (const balanceId of balanceIds) {
      try {
        const balance = await ovh.requestPromised('GET', `/me/credit/balance/${balanceId}`);
        creditBalance += balance?.amount?.value || 0;

        // Fetch movements for this balance
        const movementIds = await ovh.requestPromised('GET', `/me/credit/balance/${balanceId}/movement`);
        for (const movId of movementIds) {
          try {
            const mov = await ovh.requestPromised('GET', `/me/credit/balance/${balanceId}/movement/${movId}`);
            db.account.insertCreditMovement({
              id: `${balanceId}_${movId}`,
              balance_name: balanceId,
              amount: mov?.amount?.value || 0,
              date: mov?.creationDate || null,
              description: mov?.description || '',
              movement_type: mov?.type || ''
            });
          } catch (err) {
            console.error(`    Error fetching movement ${movId}: ${err.message}`);
          }
        }
      } catch (err) {
        console.error(`  Error fetching balance ${balanceId}: ${err.message}`);
      }
    }
    console.log(`  Credit balance: ${creditBalance}`);
  } catch (err) {
    console.error(`  Error fetching credit balances: ${err.message}`);
  }

  // Fetch deposits
  try {
    const depositIds = await ovh.requestPromised('GET', '/me/deposit');
    for (const depId of depositIds) {
      try {
        const dep = await ovh.requestPromised('GET', `/me/deposit/${depId}`);
        depositTotal += dep?.amount?.value || 0;
      } catch (err) {
        // silently skip individual deposit errors
      }
    }
    console.log(`  Deposits total: ${depositTotal}`);
  } catch (err) {
    console.error(`  Error fetching deposits: ${err.message}`);
  }

  db.account.insertBalance({
    debt_balance: debtBalance,
    credit_balance: creditBalance,
    deposit_total: depositTotal,
    currency: 'EUR'
  });
}

async function fetchBillPayment(billId) {
  try {
    const payment = await ovh.requestPromised('GET', `/me/bill/${billId}/payment`);
    return {
      type: payment?.paymentType || null,
      date: payment?.paymentDate?.split('T')[0] || null,
      status: payment?.paymentType ? 'paid' : 'pending'
    };
  } catch (err) {
    return null;
  }
}

// --- Phase 3: Inventory ---

async function importInventory(projectMap) {
  console.log('\n--- Importing service inventory ---');

  // Dedicated servers
  try {
    console.log('Fetching dedicated servers...');
    const serverNames = await ovh.requestPromised('GET', '/dedicated/server');
    for (const name of serverNames) {
      try {
        const info = await ovh.requestPromised('GET', `/dedicated/server/${name}`);
        let hwSpecs = {};
        try {
          hwSpecs = await ovh.requestPromised('GET', `/dedicated/server/${name}/specifications/hardware`);
        } catch (e) { /* optional */ }

        let serviceInfos = {};
        try {
          serviceInfos = await ovh.requestPromised('GET', `/dedicated/server/${name}/serviceInfos`);
        } catch (e) { /* optional */ }

        db.inventory.upsertServer({
          id: name,
          display_name: info.displayName || info.reverse || name,
          reverse: info.reverse || '',
          datacenter: info.datacenter || '',
          os: info.os || '',
          state: info.state || '',
          cpu: hwSpecs.cpu?.model || '',
          ram_size: hwSpecs.memory?.size || 0,
          disk_info: JSON.stringify(hwSpecs.disk || []),
          bandwidth: hwSpecs.bandwidth?.InternetToOvh?.value || 0,
          expiration_date: serviceInfos.expiration || null,
          renewal_type: serviceInfos.renew?.automatic ? 'automatic' : (serviceInfos.renew?.manualPayment ? 'manual' : '')
        });
      } catch (err) {
        console.error(`  Error fetching server ${name}: ${err.message}`);
      }
    }
    console.log(`  Found ${serverNames.length} dedicated servers`);
  } catch (err) {
    console.error(`  Error fetching server list: ${err.message}`);
  }

  // VPS
  try {
    console.log('Fetching VPS instances...');
    const vpsNames = await ovh.requestPromised('GET', '/vps');
    for (const name of vpsNames) {
      try {
        const info = await ovh.requestPromised('GET', `/vps/${name}`);
        let serviceInfos = {};
        try {
          serviceInfos = await ovh.requestPromised('GET', `/vps/${name}/serviceInfos`);
        } catch (e) { /* optional */ }

        let ips = [];
        try {
          ips = await ovh.requestPromised('GET', `/vps/${name}/ips`);
        } catch (e) { /* optional */ }

        db.inventory.upsertVps({
          id: name,
          display_name: info.displayName || info.name || name,
          model: info.model?.name || '',
          zone: info.zone || '',
          state: info.state || '',
          os: info.model?.disk || '',
          vcpus: info.model?.vcore || 0,
          ram_mb: info.model?.memory || 0,
          disk_gb: info.model?.disk || 0,
          expiration_date: serviceInfos.expiration || null,
          renewal_type: serviceInfos.renew?.automatic ? 'automatic' : (serviceInfos.renew?.manualPayment ? 'manual' : ''),
          ip_addresses: JSON.stringify(ips)
        });
      } catch (err) {
        console.error(`  Error fetching VPS ${name}: ${err.message}`);
      }
    }
    console.log(`  Found ${vpsNames.length} VPS instances`);
  } catch (err) {
    console.error(`  Error fetching VPS list: ${err.message}`);
  }

  // NetApp Storage
  try {
    console.log('Fetching storage services...');
    const storageIds = await ovh.requestPromised('GET', '/storage/netapp');
    for (const sid of storageIds) {
      try {
        const info = await ovh.requestPromised('GET', `/storage/netapp/${sid}`);
        let serviceInfos = {};
        try {
          serviceInfos = await ovh.requestPromised('GET', `/storage/netapp/${sid}/serviceInfos`);
        } catch (e) { /* optional */ }

        let shares = [];
        try {
          shares = await ovh.requestPromised('GET', `/storage/netapp/${sid}/share`);
        } catch (e) { /* optional */ }

        db.inventory.upsertStorage({
          id: sid,
          service_type: 'netapp',
          display_name: info.name || sid,
          region: info.region || '',
          total_size_gb: info.size || 0,
          used_size_gb: 0,
          share_count: Array.isArray(shares) ? shares.length : 0,
          expiration_date: serviceInfos.expiration || null
        });
      } catch (err) {
        console.error(`  Error fetching storage ${sid}: ${err.message}`);
      }
    }
    console.log(`  Found ${storageIds.length} storage services`);
  } catch (err) {
    console.error(`  Error fetching storage list: ${err.message}`);
  }

  // Build resource type mapping from inventory
  return buildResourceTypeMap(projectMap);
}

// Build mapping from domain to resource type
function buildResourceTypeMap(projectMap) {
  const map = {};

  // Cloud projects
  for (const id of Object.keys(projectMap)) {
    map[id] = 'cloud_project';
  }

  // Dedicated servers
  const servers = db.inventory.getAllServers();
  for (const s of servers) {
    map[s.id] = 'dedicated_server';
  }

  // VPS
  const vpsList = db.inventory.getAllVps();
  for (const v of vpsList) {
    map[v.id] = 'vps';
  }

  // Storage
  const storages = db.inventory.getAllStorage();
  for (const st of storages) {
    map[st.id] = 'storage';
  }

  return map;
}

// --- Phase 4: Cloud project details ---

async function importCloudDetails(projectIds) {
  console.log('\n--- Importing cloud project details ---');

  for (const projectId of projectIds) {
    console.log(`  Project ${projectId}...`);

    // Current usage (hourly + monthly)
    try {
      const usage = await ovh.requestPromised('GET', `/cloud/project/${projectId}/usage/current`);

      if (usage) {
        // Clear old data for this project
        db.cloudDetails.clearByProject(projectId);

        const now = new Date().toISOString().split('T')[0];
        const monthStart = now.substring(0, 8) + '01';

        // Process hourly usage
        if (usage.hourlyUsage) {
          const hourlyTypes = ['instance', 'volume', 'snapshot', 'objectStorage'];
          for (const rt of hourlyTypes) {
            const items = usage.hourlyUsage[rt] || [];
            for (const item of items) {
              for (const detail of (item.details || [])) {
                db.cloudDetails.insertConsumption({
                  project_id: projectId,
                  period_start: monthStart,
                  period_end: now,
                  resource_type: rt,
                  resource_id: detail.instanceId || detail.resourceId || detail.volumeId || '',
                  resource_name: item.reference || '',
                  quantity: detail.quantity?.value || 0,
                  unit: detail.quantity?.unit || '',
                  unit_price: 0,
                  total_price: detail.totalPrice || 0,
                  region: item.region || ''
                });
              }
            }
          }
        }

        // Process monthly usage
        if (usage.monthlyUsage) {
          const monthlyTypes = ['instance', 'volume', 'certification'];
          for (const rt of monthlyTypes) {
            const items = usage.monthlyUsage[rt] || [];
            for (const item of items) {
              for (const detail of (item.details || [])) {
                db.cloudDetails.insertConsumption({
                  project_id: projectId,
                  period_start: monthStart,
                  period_end: now,
                  resource_type: rt + '_monthly',
                  resource_id: detail.instanceId || detail.resourceId || '',
                  resource_name: item.reference || '',
                  quantity: detail.quantity?.value || 0,
                  unit: detail.quantity?.unit || '',
                  unit_price: 0,
                  total_price: detail.totalPrice || 0,
                  region: item.region || ''
                });
              }
            }
          }
        }
      }
    } catch (err) {
      console.error(`    Error fetching usage: ${err.message}`);
    }

    // Instances
    try {
      const instances = await ovh.requestPromised('GET', `/cloud/project/${projectId}/instance`);
      for (const inst of (instances || [])) {
        // OVH API returns flavor as object with id/name, plus planCode at root
        const flavorName = inst.flavor?.name || inst.flavorId || '';
        // planCode is the reliable identifier (e.g. "l4-90.consumption", "b2-7.monthly.postpaid")
        // Strip billing suffixes to get clean flavor name
        const planCode = (inst.planCode || '').replace(/\.(consumption|monthly\.postpaid)$/, '');
        db.cloudDetails.upsertInstance({
          id: inst.id,
          project_id: projectId,
          name: inst.name || '',
          flavor: flavorName,
          plan_code: planCode,
          region: inst.region || '',
          status: inst.status || '',
          created_at: inst.created || null,
          monthly_billing: inst.monthlyBilling ? 1 : 0
        });
      }
      console.log(`    ${(instances || []).length} instances`);
    } catch (err) {
      console.error(`    Error fetching instances: ${err.message}`);
    }

    // Quotas
    try {
      const quotas = await ovh.requestPromised('GET', `/cloud/project/${projectId}/quota`);
      for (const q of (quotas || [])) {
        const inst = q.instance || {};
        db.cloudDetails.insertQuota({
          project_id: projectId,
          region: q.region || '',
          max_cores: inst.maxCores || 0,
          max_instances: inst.maxInstances || 0,
          max_ram_mb: inst.maxRam || 0,
          used_cores: inst.usedCores || 0,
          used_instances: inst.usedInstances || 0,
          used_ram_mb: inst.usedRAM || 0
        });
      }
      console.log(`    ${(quotas || []).length} quota regions`);
    } catch (err) {
      console.error(`    Error fetching quotas: ${err.message}`);
    }
  }
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
    // Clear all data in a transaction for atomicity
    db.transaction(() => {
      db.clearAll();
    });
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
    console.error('');
    console.error('Additional data flags:');
    console.error('  --include-consumption   Import consumption data (current/forecast/history)');
    console.error('  --include-account       Import account balance, debts, credits');
    console.error('  --include-inventory     Import service inventory (servers, VPS, storage)');
    console.error('  --include-cloud-details Import cloud project instances, quotas, consumption');
    console.error('  --all                   Import all additional data');
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

    // Phase 3: Import inventory and build resource type map
    let resourceTypeMap = {};
    if (params.includeInventory) {
      resourceTypeMap = await importInventory(projectMap);
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

        // Fetch payment info if account import is enabled (Phase 2)
        let paymentInfo = null;
        if (params.includeAccount) {
          paymentInfo = await fetchBillPayment(billId);
        }

        // Process and store bill + details in a transaction
        // This ensures atomic write: either all data is written or none
        db.transaction(() => {
          // Store bill
          db.bills.upsert(bill);

          // Update payment info if available
          if (paymentInfo) {
            db.account.updateBillPayment(billId, paymentInfo);
          }

          // Delete existing details (for updates)
          db.details.deleteByBillId(billId);

          // Process and store details with project mapping
          // Note: d.domain from OVH API contains the project ID for cloud resources
          // For non-cloud resources (domains, web hosting), d.domain is a domain name
          const processedDetails = details.map(d => {
            // Check if domain is a known project ID
            const isCloudProject = projectMap.hasOwnProperty(d.domain);

            // Determine resource_type from inventory mapping (Phase 3)
            let resource_type = 'other';
            if (isCloudProject) {
              resource_type = 'cloud_project';
            } else if (resourceTypeMap && resourceTypeMap[d.domain]) {
              resource_type = resourceTypeMap[d.domain];
            }

            return {
              ...d,
              project_id: isCloudProject ? d.domain : null,
              service_type: classifyService(d.description),
              resource_type
            };
          });

          db.details.insertMany(processedDetails);
        });

        stats.bills++;
        stats.details += details.length;

        console.log(` ${details.length} details`);
      } catch (err) {
        console.log(` ERROR: ${err.message}`);
      }
    }

    // Phase 1: Import consumption data
    if (params.includeConsumption) {
      await importConsumption();
    }

    // Phase 2: Import account data
    if (params.includeAccount) {
      await importAccountData();
    }

    // Phase 4: Import cloud project details
    if (params.includeCloudDetails) {
      await importCloudDetails(Object.keys(projectMap));
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
