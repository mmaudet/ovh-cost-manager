#!/usr/bin/env node
/**
 * OVH Bills Data Import Script
 *
 * Imports billing data from OVH API into local SQLite database, for each account that the
 * configuration gives, one after the other (#113).
 *
 * Usage:
 *   node import.js --full                    # Full import (clears existing data)
 *   node import.js --from 2025-01-01 --to 2025-12-31  # Import specific period
 *   node import.js --diff                    # Differential import (since last import)
 *   node import.js --diff --since 2025-06-01 # Differential from specific date
 *   node import.js --diff --account xx1111-ovh  # The account of this NIC handle only
 *   node import.js --full --account xx1111-ovh  # Clears that account only, and reimports it
 */

const path = require('path');
const os = require('os');
const util = require('util');
const Jsonfile = require('jsonfile');
const db = require('./db');
const { readAccounts } = require('./accounts-config');
const { errorStatus, describeError, isNotGranted } = require('./ovh-errors');
const {
  reasonOf, joinWithAnd, describeAccount, throwIfSameAccount, markOtherCurrencies, findAccount,
  failureMessage,
} = require('./account-attempts');
const { classifyService, classifyResourceTypeFromDomain } = require('./classify');
const { footprintMonths, readFootprintFile } = require('./carbon-footprint');
const { monthBounds } = require('./months');
const { storageClassLabel } = require('./storage-classes');

// Skip this run if another import (cron or manual resync) is in progress.
// Checked first, before --full clears the database.
if (db.importLog.isRunning()) {
  console.log('Another import is already running. Skipping this run.');
  process.exit(0);
}

// The places of the configuration (credentials + settings), in the order the import reads
// them
const APP_DATA = path.resolve(os.homedir(), 'my-ovh-bills');
const CONFIG_PATHS = [
  path.resolve(__dirname, '..', 'config.json'),      // Project root
  path.resolve(APP_DATA, 'config.json'),              // ~/my-ovh-bills/config.json
  path.resolve(APP_DATA, 'credentials.json')          // Legacy: ~/my-ovh-bills/credentials.json
];

/**
 * Reads the accounts to import, as strictly as the server reads its settings
 * (data/accounts-config.js), from the first configuration file that gives any: as before
 * #113, a file of other settings leaves them to the next place.
 * @returns {{source: string, accounts: object[]}} The file, and its accounts in its order,
 *   as readAccounts() gives them
 * @throws {Error} naming a file that exists but cannot be read, or the setting and the file
 *   of a value that the accounts do not take; or when no file gives an account
 */
function loadAccounts() {
  for (const file of CONFIG_PATHS) {
    let config;
    try {
      config = Jsonfile.readFileSync(file);
    } catch (err) {
      if (err.code === 'ENOENT') continue;
      // jsonfile starts the message of a parse error with the file
      throw new Error(`${file} cannot be read: ${String(err.message).replace(`${file}: `, '')}`);
    }
    if (typeof config !== 'object' || config === null || Array.isArray(config)) {
      throw new Error(`${file} must hold a JSON object`);
    }
    const accounts = readAccounts(config, file);
    if (accounts.length > 0) return { source: file, accounts };
  }
  throw new Error([
    'No valid configuration file found.',
    'Searched paths:',
    ...CONFIG_PATHS.map(file => `  - ${file}`),
    '',
    'Please create config.json with valid OVH API credentials.',
  ].join('\n'));
}

// A client of the OVH API for these credentials. Each function that calls the API takes the
// client of the account it reads first, `ovh`. The client is loaded when first used, as
// before: the tests of the lock run this script with it disabled.
function createClient(credentials) {
  // A copy: the client writes the settings of its endpoint in what it is given
  return require('ovh')({ ...credentials });
}

// Parallel batch size for API calls (keep reasonable to avoid OVH rate-limiting)
const BATCH_SIZE = 20;
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

// Helper to chunk array into batches
function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

// Retry a single async operation with exponential backoff
async function withRetry(fn, retries = MAX_RETRIES, backoff = INITIAL_BACKOFF_MS) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = errorStatus(err);
      const isRateLimited = status === 429;
      const isRetryable = isRateLimited || status >= 500;
      if (attempt < retries && isRetryable) {
        const delay = isRateLimited ? backoff * 2 : backoff;
        const reason = describeError(err);
        console.warn(`  [retry ${attempt + 1}/${retries}] ${reason} — waiting ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
        backoff *= 2;
      } else {
        throw err;
      }
    }
  }
}

// The items that the import skipped after an error, for its summary: bills, among others, and
// the carbon footprint of an account (#151)
let failedItemCount = 0;

// Helper to run promises in parallel batches with retry and error logging
async function runInBatches(items, asyncFn, batchSize = BATCH_SIZE) {
  const results = [];
  const chunks = chunkArray(items, batchSize);
  for (const chunk of chunks) {
    const batchResults = await Promise.all(chunk.map(item =>
      withRetry(() => asyncFn(item)).catch(err => {
        failedItemCount += 1;
        const label = JSON.stringify(item).substring(0, 80);
        console.error(`  [batch] Error processing item ${label}: ${describeError(err)}`);
        return { error: err };
      })
    ));
    results.push(...batchResults);
  }
  return results;
}

/**
 * Reads the options of the command line.
 * @param {string[]} [args] - Its arguments, those of the script's by default
 * @returns {object} The options, as runImport() takes them
 */
function parseArgs(args = process.argv.slice(2)) {
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
    includeCarbon: false,
    all: false,
    account: null
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--full') {
      params.full = true;
    } else if (args[i] === '--diff') {
      params.diff = true;
    } else if (args[i] === '--account') {
      // The NIC handle of the account, or '' when none follows, which runImport() refuses
      params.account = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : '';
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
    } else if (args[i] === '--include-carbon') {
      params.includeCarbon = true;
    } else if (args[i] === '--all') {
      params.all = true;
      params.includeConsumption = true;
      params.includeAccount = true;
      params.includeInventory = true;
      params.includeCloudDetails = true;
      params.includeCarbon = true;
    }
  }

  return params;
}

/**
 * Reads the account that the API key gives access to, from GET /me: the import needs its
 * NIC handle before it writes anything, as every row it writes carries it.
 * @param {object} ovh - The OVH API client of the key's credentials
 * @returns {Promise<{nic: string, currency: ?string}>} Its NIC handle, and the code of the
 *   currency it bills in
 * @throws {Error} When GET /me fails. A key created before the import needed GET /me may
 *   not be granted it: OVH then answers 403 "This call has not been granted", and the
 *   error names the right that the key lacks.
 */
async function readAccount(ovh) {
  let me;
  try {
    me = await withRetry(() => ovh.requestPromised('GET', '/me'));
  } catch (err) {
    if (isNotGranted(err)) {
      throw new Error('The API key lacks the right GET /me, which tells the import the account '
        + 'it imports: request a consumer key granted GET /me');
    }
    throw err;
  }
  if (typeof me?.nichandle !== 'string' || me.nichandle === '') {
    throw new Error('GET /me answered no NIC handle, which tells the import the account it '
      + 'imports');
  }
  return { nic: me.nichandle, currency: me.currency?.code ?? null };
}

// --- The accounts of a run ---

/**
 * Attempts the account of each entry of the configuration: reads, one after the other, the
 * account that GET /me names, each through a client of its own credentials, or else, when
 * GET /me fails, the account that the entry's name was recorded with. Nothing is written
 * yet: two entries of one account must fail the run before it imports anything.
 * @param {object[]} entries - The accounts of the configuration, in its order
 * @param {boolean} several - Whether the configuration has several accounts, which the log
 *   names each of
 * @returns {Promise<AccountAttempt[]>} An attempt for each entry, in their order, as
 *   data/account-attempts.js describes them
 */
async function readEveryAccount(entries, several) {
  const attempts = [];
  for (const entry of entries) {
    try {
      const client = createClient(entry.credentials);
      const { nic, currency } = await readAccount(client);
      attempts.push({ entry, nic, currency, client });
      console.log(several ? `Account ${entry.label}: ${nic}` : `Account: ${nic}`);
    } catch (err) {
      // A call that rejects with nothing fails the attempt all the same
      const error = err || new Error(describeError(err));
      // The account that an import last recorded with the entry's name, if it has one, is
      // the one that the entry last led to
      const lastNic = entry.name === null ? undefined : db.accounts.getByName(entry.name)?.nic;
      attempts.push({ entry, error, lastNic });
      // A single account's error ends the run's output
      if (several) console.error(`Account ${entry.label}: ${reasonOf(error)}`);
    }
  }
  return attempts;
}

// Fetch all cloud projects
async function fetchProjects(ovh) {
  console.log('Fetching cloud projects...');
  const projectIds = await ovh.requestPromised('GET', '/cloud/project');
  
  const results = await runInBatches(projectIds, async (id) => {
    const info = await ovh.requestPromised('GET', `/cloud/project/${id}`);
    return {
      id,
      name: info.description || id,
      description: info.description,
      status: info.status,
      created_at: info.creationDate
    };
  });

  const projects = results.filter(r => !r.error);
  console.log(`  Found ${projects.length} projects`);
  return projects;
}

// Claims for the account, `nic`, the bills stored before the accounts that its API lists:
// those of its full bill list, without dates, as the differential import starts from the
// account's latest bill, and skips those stored (#114)
async function claimBillsOfBefore(ovh, nic) {
  console.log('Claiming the bills stored before the accounts...');
  const billIds = await ovh.requestPromised('GET', '/me/bill');
  if (!Array.isArray(billIds)) {
    throw new Error(`the bill list is ${util.inspect(billIds)}, not an array`);
  }
  console.log(`  Claimed ${db.accounts.claimBills(nic, billIds)} of them`);
}

// Fetch bills in date range
async function fetchBills(ovh, fromDate, toDate) {
  console.log(`Fetching bills from ${fromDate || 'beginning'} to ${toDate || 'now'}...`);

  const params = {};
  if (fromDate) params['date.from'] = fromDate;
  if (toDate) params['date.to'] = toDate;

  const billIds = await ovh.requestPromised('GET', '/me/bill', params);
  console.log(`  Found ${billIds.length} bills`);

  return billIds;
}

// Fetch bill details
async function fetchBillDetails(ovh, billId) {
  // Retried as the calls of the other items are
  const bill = await withRetry(() => ovh.requestPromised('GET', `/me/bill/${billId}`));
  const detailIds = await withRetry(
    () => ovh.requestPromised('GET', `/me/bill/${billId}/details`),
  );

  // Fetch details in parallel batches
  const detailResults = await runInBatches(detailIds, async (detailId) => {
    const detail = await ovh.requestPromised('GET', `/me/bill/${billId}/details/${detailId}`);
    return {
      id: `${billId}_${detailId}`,
      bill_id: billId,
      domain: detail.domain,
      description: detail.description,
      quantity: detail.quantity,
      unit_price: detail.unitPrice?.value || 0,
      total_price: detail.totalPrice?.value || 0
    };
  });

  const details = detailResults.filter(r => !r.error);

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

async function fetchConsumptionCurrent(ovh) {
  console.log('Fetching current consumption...');
  try {
    const data = await ovh.requestPromised('GET', '/me/consumption/usage/current');
    return data;
  } catch (err) {
    console.error(`  Error fetching current consumption: ${err.message}`);
    return null;
  }
}

async function fetchConsumptionForecast(ovh) {
  console.log('Fetching consumption forecast...');
  try {
    const data = await ovh.requestPromised('GET', '/me/consumption/usage/forecast');
    return data;
  } catch (err) {
    console.error(`  Error fetching consumption forecast: ${err.message}`);
    return null;
  }
}

async function fetchConsumptionHistory(ovh) {
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

/**
 * Imports the consumption of the account: the month's usage so far and its forecast, as a
 * snapshot, and the history of the past year.
 * @param {object} ovh - The OVH API client of the account
 * @param {string} nic - The NIC handle of the account, which every row it stores carries
 */
async function importConsumption(ovh, nic) {
  console.log('\n--- Importing consumption data ---');

  const currentEntries = await fetchConsumptionCurrent(ovh);
  const forecastEntries = await fetchConsumptionForecast(ovh);

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
      raw_data: JSON.stringify({ current: currentEntries, forecast: forecastEntries }),
      account: nic
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
      // The account's history replaced whole, and its own only (#114)
      db.transaction(() => {
        db.consumption.clearHistory(nic);
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
            raw_data: JSON.stringify(entry),
            account: nic
          });
        }
      });
      console.log(`  Imported ${historyEntries.length} history entries`);
    } else {
      console.log('  No history entries found');
    }
  } catch (err) {
    console.error(`  Error fetching consumption history: ${err.message}`);
  }
}

// --- Phase 2: Account balance, debts, credits ---

/**
 * Imports the balance of the account: its debt, credits and deposits, as a snapshot, and
 * the movements of its credits.
 * @param {object} ovh - The OVH API client of the account
 * @param {string} nic - The NIC handle of the account, which every row it stores carries
 */
async function importAccountData(ovh, nic) {
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
            const movement = {
              id: `${balanceId}_${movId}`,
              balance_name: balanceId,
              amount: mov?.amount?.value || 0,
              date: mov?.creationDate || null,
              description: mov?.description || '',
              movement_type: mov?.type || '',
              account: nic
            };
            // The very movement, stored before the accounts, is the account's: it replaces it
            // rather than adds a copy (#114)
            db.transaction(() => {
              if (db.accounts.claimCreditMovement(movement)) {
                console.log(`    Claimed the movement ${movement.id} stored before`);
              }
              db.balance.insertCreditMovement(movement);
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

  db.balance.insertBalance({
    debt_balance: debtBalance,
    credit_balance: creditBalance,
    deposit_total: depositTotal,
    currency: 'EUR',
    account: nic
  });
}

async function fetchBillPayment(ovh, billId) {
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

// Removes the services of a kind that the answer of its inventory list call, all those that
// exist now, no longer names: those cancelled since an import stored them, which only a full
// import removed before (#74). Only the services of the account, `nic`, whose API answered:
// another account's services are not in its list (#114). Anything but a list, such as the
// null that the ovh client answers for an empty body, fails like the call, and the import
// keeps every service of that kind. Returns the names of the list.
function removeUnlistedServices(answer, deleteNotIn, kind, nic) {
  if (!Array.isArray(answer)) {
    throw new Error(`the list is ${util.inspect(answer)}, not an array`);
  }
  const removed = deleteNotIn(answer, nic);
  // An empty list is OVH's answer once none is left, which removes them all: a warning, for a
  // list that would be empty by mistake
  if (answer.length === 0 && removed > 0) {
    console.warn(`  OVH lists no ${kind} any more: removed all ${removed} of them`);
  } else if (removed > 0) {
    console.log(`  Removed ${removed} ${kind} that OVH no longer lists`);
  }
  return answer;
}

/**
 * Imports the inventories of the dedicated servers, VPS and NetApp storage services, and
 * removes the account's services that its API no longer lists.
 * @param {object} ovh - The OVH API client of the account
 * @param {Object<string, string>} projectMap - The name of each Public Cloud project, by id
 * @param {string} nic - The NIC handle of the account, which every service it stores
 *   carries, but one that another account holds (#114): without it, each service fails to be
 *   stored, as a failed item
 * @returns {Promise<{resourceTypes: Object<string, string>,
 *   listed: Object<string, Array<string|number>>}>} The resource type of each project and
 *   service, by the id that a bill line names it with, in its domain; and the services that
 *   the account's API lists, by the table that stores them, for each kind whose list it gave
 */
async function importInventory(ovh, projectMap, nic) {
  const listed = {};
    // Private Cloud Hosts
    if (ovh.requestPromised && db.inventory.upsertPrivateCloudHost) {
      try {
        console.log('Fetching Private Cloud hosts...');
        const pccServices = await ovh.requestPromised('GET', '/dedicatedCloud');
        for (const pccId of pccServices) {
          const hosts = await ovh.requestPromised('GET', `/dedicatedCloud/${pccId}/dedicatedHost`);
          for (const hostId of hosts) {
            const host = await ovh.requestPromised('GET', `/dedicatedCloud/${pccId}/dedicatedHost/${hostId}`);
            db.inventory.upsertPrivateCloudHost({
              id: hostId,
              pcc_id: pccId,
              name: host.name || hostId,
              state: host.state || '',
              cpu: host.cpuDescription || '',
              ram_gb: host.ram || 0,
              billing_type: host.billingType || '',
              datacenter: host.datacenterId || '',
              expiration_date: host.expiration || null
            });
          }
        }
        console.log('  Private Cloud hosts import done.');
      } catch (err) {
        console.error('  Error fetching Private Cloud hosts:', err.message);
      }
    }

    // Private Cloud Datastores
    if (ovh.requestPromised && db.inventory.upsertPrivateCloudDatastore) {
      try {
        console.log('Fetching Private Cloud datastores...');
        const pccServices = await ovh.requestPromised('GET', '/dedicatedCloud');
        for (const pccId of pccServices) {
          const datastores = await ovh.requestPromised('GET', `/dedicatedCloud/${pccId}/datastore`);
          for (const dsId of datastores) {
            const ds = await ovh.requestPromised('GET', `/dedicatedCloud/${pccId}/datastore/${dsId}`);
            db.inventory.upsertPrivateCloudDatastore({
              id: dsId,
              pcc_id: pccId,
              name: ds.name || dsId,
              size_gb: ds.size || 0,
              state: ds.state || '',
              datacenter: ds.datacenterId || '',
              expiration_date: ds.expiration || null
            });
          }
        }
        console.log('  Private Cloud datastores import done.');
      } catch (err) {
        console.error('  Error fetching Private Cloud datastores:', err.message);
      }
    }

    // IP Services
    if (ovh.requestPromised && db.inventory.upsertIpService) {
      try {
        console.log('Fetching IP services...');
        const ipBlocks = await ovh.requestPromised('GET', '/ip');
        for (const ip of ipBlocks) {
          const ipInfo = await ovh.requestPromised('GET', `/ip/${encodeURIComponent(ip)}`);
          db.inventory.upsertIpService({
            id: ip,
            routedTo: ipInfo.routedTo?.serviceName || '',
            type: ipInfo.type || '',
            country: ipInfo.country || '',
            description: ipInfo.description || ''
          });
        }
        console.log('  IP services import done.');
      } catch (err) {
        console.error('  Error fetching IP services:', err.message);
      }
    }

    // Load Balancers
    if (ovh.requestPromised && db.inventory.upsertLoadBalancer) {
      try {
        console.log('Fetching Load Balancers...');
        const lbs = await ovh.requestPromised('GET', '/ipLoadbalancing');
        for (const lbId of lbs) {
          const lb = await ovh.requestPromised('GET', `/ipLoadbalancing/${lbId}`);
          db.inventory.upsertLoadBalancer({
            id: lbId,
            name: lb.displayName || lbId,
            state: lb.status || '',
            zone: lb.zone || '',
            offer: lb.offerType || '',
            expiration_date: lb.expiration || null
          });
        }
        console.log('  Load Balancers import done.');
      } catch (err) {
        console.error('  Error fetching Load Balancers:', err.message);
      }
    }
  console.log('\n--- Importing service inventory ---');

  // Dedicated servers - parallel fetch
  try {
    console.log('Fetching dedicated servers...');
    const serverNames = removeUnlistedServices(
      await ovh.requestPromised('GET', '/dedicated/server'),
      db.inventory.deleteServersNotIn, 'dedicated servers', nic,
    );
    listed.dedicated_servers = serverNames;

    await runInBatches(serverNames, async (name) => {
      const info = await ovh.requestPromised('GET', `/dedicated/server/${name}`);
      let hwSpecs = {};
      try {
        hwSpecs = await ovh.requestPromised('GET', `/dedicated/server/${name}/specifications/hardware`);
      } catch (e) { /* optional */ }

      let serviceInfos = {};
      try {
        serviceInfos = await ovh.requestPromised('GET', `/dedicated/server/${name}/serviceInfos`);
      } catch (e) { /* optional */ }

      // Adaptation pour nouvelle structure OVH (bare metal)
      let cpuModel = hwSpecs.cpu?.model || hwSpecs.processorName || hwSpecs.description || '';
      let ramSize = hwSpecs.memory?.size || hwSpecs.memorySize?.value || 0;
      // Log si vide pour debug
      if (!cpuModel || !ramSize) {
        console.warn(`[import] CPU/RAM manquant pour ${name} :`, JSON.stringify(hwSpecs));
      }
      db.inventory.upsertServer({
        id: name,
        display_name: info.displayName || info.reverse || name,
        reverse: info.reverse || '',
        datacenter: info.datacenter || '',
        os: info.os || '',
        state: info.state || '',
        cpu: cpuModel,
        ram_size: ramSize,
        disk_info: JSON.stringify(hwSpecs.disk || hwSpecs.diskGroups || []),
        bandwidth: hwSpecs.bandwidth?.InternetToOvh?.value || 0,
        expiration_date: serviceInfos.expiration || null,
        renewal_type: serviceInfos.renew?.automatic ? 'automatic' : (serviceInfos.renew?.manualPayment ? 'manual' : ''),
        account: nic
      });
    });
    console.log(`  Found ${serverNames.length} dedicated servers`);
  } catch (err) {
    console.error(`  Error fetching server list: ${err.message}`);
  }

  // VPS - parallel fetch
  try {
    console.log('Fetching VPS instances...');
    const vpsNames = removeUnlistedServices(
      await ovh.requestPromised('GET', '/vps'), db.inventory.deleteVpsNotIn, 'VPS instances',
      nic,
    );
    listed.vps_instances = vpsNames;

    await runInBatches(vpsNames, async (name) => {
      const info = await ovh.requestPromised('GET', `/vps/${name}`);
      let serviceInfos = {};
      try {
        serviceInfos = await ovh.requestPromised('GET', `/vps/${name}/serviceInfos`);
      } catch (e) { /* optional */ }

      let ips = [];
      try {
        ips = await ovh.requestPromised('GET', `/vps/${name}/ips`);
      } catch (e) { /* optional */ }

      // The operating system: the name of the image installed on the VPS
      // (images/current, in beta), or else that of its distribution. The OVH API schema
      // marks the distribution route deprecated, and removes it on 2026-10-15.
      let osName = '';
      try {
        const image = await ovh.requestPromised('GET', `/vps/${name}/images/current`);
        osName = image?.name || '';
      } catch (e) { /* optional */ }
      if (!osName) {
        try {
          const distribution = await ovh.requestPromised('GET', `/vps/${name}/distribution`);
          osName = distribution?.name || distribution?.distribution || '';
        } catch (e) { /* optional */ }
      }

      db.inventory.upsertVps({
        id: name,
        display_name: info.displayName || info.name || name,
        model: info.model?.name || '',
        zone: info.zone || '',
        state: info.state || '',
        os: osName,
        vcpus: info.model?.vcore || 0,
        ram_mb: info.model?.memory || 0,
        disk_gb: info.model?.disk || 0,
        expiration_date: serviceInfos.expiration || null,
        renewal_type: serviceInfos.renew?.automatic ? 'automatic' : (serviceInfos.renew?.manualPayment ? 'manual' : ''),
        ip_addresses: JSON.stringify(ips),
        account: nic
      });
    });
    console.log(`  Found ${vpsNames.length} VPS instances`);
  } catch (err) {
    console.error(`  Error fetching VPS list: ${err.message}`);
  }

  // NetApp Storage - parallel fetch
  try {
    console.log('Fetching storage services...');
    const storageIds = removeUnlistedServices(
      await ovh.requestPromised('GET', '/storage/netapp'),
      db.inventory.deleteStorageNotIn, 'NetApp storage services', nic,
    );
    listed.storage_services = storageIds;

    await runInBatches(storageIds, async (sid) => {
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
        expiration_date: serviceInfos.expiration || null,
        account: nic
      });
    });
    console.log(`  Found ${storageIds.length} storage services`);
  } catch (err) {
    console.error(`  Error fetching storage list: ${err.message}`);
  }

  // Build resource type mapping from inventory
  return { resourceTypes: buildResourceTypeMap(projectMap), listed };
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

  // Private Cloud Hosts
  if (db.inventory.getAllPrivateCloudHosts) {
    const pccHosts = db.inventory.getAllPrivateCloudHosts();
    for (const h of pccHosts) {
      map[h.id] = 'private_cloud_host';
    }
  }

  // Private Cloud Datastores
  if (db.inventory.getAllPrivateCloudDatastores) {
    const pccDatastores = db.inventory.getAllPrivateCloudDatastores();
    for (const d of pccDatastores) {
      map[d.id] = 'private_cloud_datastore';
    }
  }

  // IP Services
  if (db.inventory.getAllIpServices) {
    const ipServices = db.inventory.getAllIpServices();
    for (const ip of ipServices) {
      map[ip.id] = 'ip_service';
    }
  }

  // Load Balancers
  if (db.inventory.getAllLoadBalancers) {
    const lbs = db.inventory.getAllLoadBalancers();
    for (const lb of lbs) {
      map[lb.id] = 'load_balancer';
    }
  }

  return map;
}

// --- Phase 4: Cloud project details ---

// OVH reports the storage class per object, never per bucket. The class is
// picked at bucket creation and applies to everything written to it, so
// sampling a single object identifies the bucket's class; an empty bucket has
// none (data/storage-classes.js names them).

async function detectStorageClass(ovh, projectId, regionName, bucketName) {
  try {
    const objects = await withRetry(() => ovh.requestPromised(
      'GET',
      `/cloud/project/${projectId}/region/${regionName}/storage/${encodeURIComponent(bucketName)}/object`,
      { limit: 1 }
    ));
    const raw = objects?.[0]?.storageClass;
    return raw ? storageClassLabel(raw) : null;
  } catch (err) {
    return null; // empty bucket or listing not permitted: leave the class unknown
  }
}

/**
 * Fetch every object storage bucket of a project.
 *
 * Buckets live on two distinct routes depending on the region's services:
 *   storage-s3-standard / storage-s3-high-perf -> /region/{r}/storage
 *   storage-s3-coldarchive                     -> /region/{r}/coldArchive
 * The legacy Swift containers (/cloud/project/{id}/storage) are a different
 * product and are not covered here.
 *
 * Throws when a call still fails after its retries, so that a partial list
 * never replaces the stored inventory.
 */
async function fetchObjectStorageBuckets(ovh, projectId) {
  const regions = await withRetry(() => ovh.requestPromised('GET', `/cloud/project/${projectId}/region`));
  const buckets = [];

  const regionResults = await runInBatches(regions || [], async (regionName) => {
    // Legacy region aliases (GRA1, SBG5, ...) are listed but have no detail route
    let region;
    try {
      region = await withRetry(() => ovh.requestPromised('GET', `/cloud/project/${projectId}/region/${regionName}`));
    } catch (err) {
      if (err.error === 404) return;
      throw err;
    }
    const services = (region?.services || [])
      .filter(s => s.status === 'UP')
      .map(s => s.name);

    const hasS3 = services.some(n => n.startsWith('storage-s3-') && n !== 'storage-s3-coldarchive');
    const hasColdArchive = services.includes('storage-s3-coldarchive');

    if (hasS3) {
      const list = await withRetry(() => ovh.requestPromised('GET', `/cloud/project/${projectId}/region/${regionName}/storage`));
      for (const b of (list || [])) {
        buckets.push({
          id: `${projectId}:${regionName}:${b.name}`,
          project_id: projectId,
          name: b.name,
          region: b.region || regionName,
          storage_class: await detectStorageClass(ovh, projectId, regionName, b.name),
          status: null,
          objects_count: b.objectsCount ?? null,
          objects_size: b.objectsSize ?? null,
          created_at: b.createdAt || null
        });
      }
    }

    if (hasColdArchive) {
      const list = await withRetry(() => ovh.requestPromised('GET', `/cloud/project/${projectId}/region/${regionName}/coldArchive`));
      for (const b of (list || [])) {
        buckets.push({
          id: `${projectId}:${regionName}:${b.name}`,
          project_id: projectId,
          name: b.name,
          region: regionName,
          storage_class: 'Cold Archive',
          status: b.status || null,
          objects_count: b.objectsCount ?? null,
          objects_size: b.objectsSize ?? null,
          created_at: b.createdAt || null
        });
      }
    }
  });

  // runInBatches logs and swallows the error of each failed item. A region left
  // out would have its buckets deleted from the stored inventory, so fail the
  // whole fetch instead.
  const regionFailure = regionResults.find(r => r?.error);
  if (regionFailure) throw regionFailure.error;

  // Swift containers (Public Cloud Archive and plain object storage). Different
  // product, different route, and the list endpoint leaves `archive` null: only
  // the detail call tells a cold archive container from a regular one.
  const containers = await withRetry(() => ovh.requestPromised('GET', `/cloud/project/${projectId}/storage`));
  const containerResults = await runInBatches(containers || [], async (container) => {
    const detail = await withRetry(() => ovh.requestPromised('GET', `/cloud/project/${projectId}/storage/${container.id}`));
    const isArchive = (detail?.archive ?? container.archive) === true;
    buckets.push({
      id: `${projectId}:${container.region}:swift:${container.name}`,
      project_id: projectId,
      name: container.name,
      region: container.region || '',
      storage_class: isArchive ? 'Public Cloud Archive' : 'Swift',
      status: null,
      objects_count: container.storedObjects ?? null,
      objects_size: container.storedBytes ?? null,
      created_at: null
    });
  });
  // Same as the regions: a container without its detail cannot be classified
  const containerFailure = containerResults.find(r => r?.error);
  if (containerFailure) throw containerFailure.error;
  console.log(`    ${(containers || []).length} swift containers`);

  return buckets;
}

// The month that a project's usage covers, as its first day and the day the usage runs to,
// YYYY-MM-DD. OVH gives the period with its own UTC offset: its dates are read from their
// digits, as those of the bills are. Through the UTC clock, the first hours of a month in
// Paris would replace the consumption of the previous month (#54). Without a period, the
// month of the UTC clock.
function usagePeriod(usage) {
  const from = usage.period?.from?.split('T')[0];
  if (!from) {
    const today = new Date().toISOString().split('T')[0];
    return { start: `${today.substring(0, 8)}01`, end: today };
  }
  const month = monthBounds(from.substring(0, 7));
  // Within the month: the period may end on the first day of the next one
  const to = usage.period.to?.split('T')[0];
  return { start: month.from, end: to && to < month.to ? to : month.to };
}

/**
 * Imports the resources and the consumption of each Public Cloud project of the account, and
 * records the month of its current consumption for the account (#114).
 * @param {object} ovh - The OVH API client of the account
 * @param {string[]} projectIds - Its projects, which its API lists
 * @param {string} nic - The NIC handle of the account
 * @param {function()} [heartbeat] - Keeps the lock of the run, if any, before each project:
 *   an account can have many, and each takes many calls
 */
async function importCloudDetails(ovh, projectIds, nic, heartbeat = () => {}) {
  console.log('\n--- Importing cloud project details ---');

  // The month of the current consumption: the latest that the usage of a project reports
  let consumptionMonth = null;

  for (const projectId of projectIds) {
    heartbeat();
    console.log(`  Project ${projectId}...`);

    // Current usage (hourly + monthly)
    try {
      const usage = await ovh.requestPromised('GET', `/cloud/project/${projectId}/usage/current`);

      if (usage) {
        const { start: periodStart, end: periodEnd } = usagePeriod(usage);
        if (!consumptionMonth || periodStart > consumptionMonth) consumptionMonth = periodStart;

        // Clear old data for this project: its consumption of the other months is kept
        db.cloudDetails.clearProjectInventory(projectId);
        db.cloudDetails.clearConsumptionOfMonth(projectId, periodStart);

        // Process hourly usage
        if (usage.hourlyUsage) {
          const hourlyTypes = ['instance', 'volume', 'snapshot', 'objectStorage'];
          for (const rt of hourlyTypes) {
            const items = usage.hourlyUsage[rt] || [];
            for (const item of items) {
              for (const detail of (item.details || [])) {
                db.cloudDetails.insertConsumption({
                  project_id: projectId,
                  period_start: periodStart,
                  period_end: periodEnd,
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
                  period_start: periodStart,
                  period_end: periodEnd,
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

    // Block storage volumes
    try {
      const volumes = await withRetry(() => ovh.requestPromised('GET', `/cloud/project/${projectId}/volume`));
      db.transaction(() => {
        db.cloudDetails.clearVolumesByProject(projectId);
        for (const v of (volumes || [])) {
          db.cloudDetails.upsertVolume({
            id: v.id,
            project_id: projectId,
            name: v.name || '',
            region: v.region || '',
            type: v.type || '',
            size_gb: v.size ?? null,
            status: v.status || '',
            bootable: v.bootable ? 1 : 0,
            attached_to: (v.attachedTo || []).join(','),
            plan_code: v.planCode || null,
            created_at: v.creationDate || null
          });
        }
      });
      console.log(`    ${(volumes || []).length} volumes`);
    } catch (err) {
      console.warn(`    Volume fetch failed, keeping the stored volumes: ${err.message || err.error}`);
    }

    // Instance snapshots (images)
    try {
      const snapshots = await withRetry(() => ovh.requestPromised('GET', `/cloud/project/${projectId}/snapshot`));
      db.transaction(() => {
        db.cloudDetails.clearSnapshotsByProject(projectId);
        for (const s of (snapshots || [])) {
          db.cloudDetails.upsertSnapshot({
            id: s.id,
            project_id: projectId,
            name: s.name || '',
            region: s.region || '',
            size_gb: s.size ?? null,
            status: s.status || '',
            visibility: s.visibility || '',
            os_type: s.type || '',
            created_at: s.creationDate || null
          });
        }
      });
      console.log(`    ${(snapshots || []).length} snapshots`);
    } catch (err) {
      console.warn(`    Snapshot fetch failed, keeping the stored snapshots: ${err.message || err.error}`);
    }

    // Object storage buckets (S3 + Cold Archive)
    try {
      const buckets = await fetchObjectStorageBuckets(ovh, projectId);
      // Replace the snapshot only once the whole fetch succeeded, so a failed
      // call never leaves the dashboard with an empty bucket list.
      db.transaction(() => {
        db.cloudDetails.clearBucketsByProject(projectId);
        for (const bucket of buckets) {
          db.cloudDetails.upsertBucket(bucket);
        }
      });
      console.log(`    ${buckets.length} object storage buckets`);
    } catch (err) {
      console.warn(`    Object storage fetch failed, keeping the stored buckets: ${err.message || err.error}`);
    }
  }

  // Read as the current consumption, even when no project used anything yet this month
  if (consumptionMonth) db.cloudDetails.setCurrentConsumptionMonth(consumptionMonth, nic);
}

// The day the bills of an account start from, null for its first: in a differential import,
// its own latest bill, unless --since says from when, so that an account added since the
// last import gets its whole history
function billsStartOf(nic, params) {
  if (params.full) return null;
  if (params.diff) return params.since || db.bills.getLatestDate(nic) || null;
  return params.from;
}

/**
 * Imports a bill of the account and its lines, in one transaction: a bill is stored whole or
 * not at all, and one imported again replaces its lines, which OVH may have changed. Each line
 * is classified now, as the readers use the classification that is stored.
 * @param {object} ovh - The OVH API client of the account
 * @param {string} billId - The bill
 * @param {object} account - `nic`, the NIC handle of the account, which the bill carries,
 *   `params`, the options of the run, `projectMap`, the name of each of its Public Cloud
 *   projects by id, and `resourceTypeMap`, the type of each service of its inventories by id
 * @returns {Promise<number>} How many lines it stored
 * @throws When the bill or the list of its lines cannot be fetched: the bill is skipped
 */
async function importBill(ovh, billId, { nic, params, projectMap, resourceTypeMap }) {
  const { bill, details } = await fetchBillDetails(ovh, billId);
  // How the bill was paid belongs to the balance, which --include-account asks for
  const paymentInfo = params.includeAccount ? await fetchBillPayment(ovh, billId) : null;

  db.transaction(() => {
    db.bills.upsert({ ...bill, account: nic });
    if (paymentInfo) {
      db.balance.updateBillPayment(billId, paymentInfo);
    }
    db.details.deleteByBillId(billId);
    db.details.insertMany(details.map(detail => ({
      ...detail,
      // The domain of a line of a Public Cloud project is the project's id; that of another
      // line names its service, such as a server or a domain name
      project_id: projectMap.hasOwnProperty(detail.domain) ? detail.domain : null,
      service_type: classifyService(detail.description),
      // The inventories know the type of the services they list; the domain and the wording
      // of the line tell those of the others
      resource_type: resourceTypeMap[detail.domain]
        || classifyResourceTypeFromDomain(detail.domain, detail.description),
    })));
  });
  return details.length;
}

// --- The carbon footprint (#147) ---

// How the import waits for the carbon calculator: it asks how its task goes every 3 seconds,
// as OVHcloud's control panel does, for 2 minutes at most, as a generation takes seconds
const CARBON_POLL_INTERVAL_MS = 3000;
const CARBON_WAIT_MINUTES = 2;
const CARBON_WAIT_MS = CARBON_WAIT_MINUTES * 60 * 1000;

/**
 * Imports the carbon footprint of the account: the carbon calculator generates the file of its
 * last 24 months, which the import downloads from the link of its task, and whose lines
 * replace those of these months (see data/carbon-footprint.js). A footprint that cannot be
 * imported replaces nothing, and the rest of the import goes on, the run's status unchanged
 * (#151): a key without the right to ask for it gets one line that names the right, and any
 * other failure counts among the failed items.
 * @param {object} ovh - The OVH API client of the account
 * @param {string} nic - The NIC handle of the account, which every line it stores carries
 * @param {Function} heartbeat - Keeps the run's lock while the import waits for the task
 */
async function importCarbonFootprint(ovh, nic, heartbeat) {
  console.log('\n--- Importing the carbon footprint ---');
  // Whether the carbon calculator took the request of the file: until it has, a refusal is the
  // key's lack of the right to make it
  let requested = false;
  try {
    const months = footprintMonths(new Date());
    const request = { startMonth: `${months.first}-01`, endMonth: `${months.last}-01` };
    const { taskID } = await withRetry(() => ovh.requestPromised(
      'POST', '/me/carbonCalculator/csv', request,
    ));
    requested = true;

    let task = { status: 'IN_PROGRESS' };
    for (let waited = 0; task.status === 'IN_PROGRESS' && waited < CARBON_WAIT_MS;
      waited += CARBON_POLL_INTERVAL_MS) {
      await new Promise(resolve => setTimeout(resolve, CARBON_POLL_INTERVAL_MS));
      task = await withRetry(() => ovh.requestPromised(
        'GET', `/me/carbonCalculator/task/${taskID}`,
      ));
      heartbeat();
    }
    if (task.status === 'IN_PROGRESS') {
      throw new Error(`The carbon calculator's task ${taskID} was still in progress after `
        + `${CARBON_WAIT_MINUTES} minutes`);
    }
    if (task.status !== 'SUCCESS') {
      throw new Error(`The carbon calculator's task ${taskID} ended ${task.status}`);
    }

    const response = await fetch(task.link);
    if (!response.ok) {
      throw new Error(`The carbon footprint file could not be downloaded: HTTP ${response.status}`);
    }
    const lines = readFootprintFile(await response.text());
    db.carbon.replaceMonths(nic, months, lines);
    console.log(`  Imported ${lines.length} footprint lines, `
      + `from ${months.first} to ${months.last}`);
  } catch (err) {
    // Nothing failed: the key was not given that right
    if (!requested && isNotGranted(err)) {
      console.warn('  The API key lacks the right POST /me/carbonCalculator/csv, which the '
        + 'carbon footprint needs: add it to import the footprint');
      return;
    }
    failedItemCount += 1;
    console.error(`  Error importing the carbon footprint: ${describeError(err)}`);
  }
}

/**
 * Imports one account through its OVH API client: its projects, its inventories when asked,
 * its bills from the day that billsStartOf() gives, then the other datasets asked for. Every
 * row it writes carries the account's NIC handle, or reaches it through its bill or project.
 * @param {object} ovh - The OVH API client of the account
 * @param {string} nic - The NIC handle of the account
 * @param {object} run - `params`, the options of the run, `importType`, as its log entry
 *   names it, `toDate`, the day it imports the bills to, and `heartbeat()`, which keeps the
 *   run's lock
 * @returns {Promise<{imported: {projects: number, bills: number, details: number},
 *   error: (*|undefined)}>} What it wrote, counted as it wrote it, even when it failed
 *   partway, as its rows stay; and what failed it, when the list of its projects or of its
 *   bills could not be fetched
 */
async function importAccount(ovh, nic, { params, importType, toDate, heartbeat }) {
  const imported = { projects: 0, bills: 0, details: 0 };
  try {
    // Unless the database had one account alone, the rows stored before the accounts are
    // each account's whose API lists them (#114): its bills first, before its latest bill
    // tells where its import starts. The writers of its projects and services claim those it
    // lists.
    if (db.accounts.hasRowsWithoutAccount('bills')) await claimBillsOfBefore(ovh, nic);
    // Once one account alone claimed the bills stored before, the database was its own, and
    // it gets the rest: before the datasets, so that its own history replaces the months
    // stored then, rather than adding them twice
    const given = db.accounts.attributeToSoleClaimer();
    if (given) {
      console.log(`  Attributed ${given.attributed} rows stored before to the account `
        + `${given.nic}, which claimed every bill stored then`);
    }

    // The projects first: their ids tell the bill lines of Public Cloud
    const projects = await fetchProjects(ovh);
    const projectMap = {};
    for (const project of projects) {
      db.projects.upsert({ ...project, account: nic });
      projectMap[project.id] = project.name;
      imported.projects += 1;
    }

    // Then the inventories, when asked: they tell the type of the services that bill lines
    // name
    const { resourceTypes: resourceTypeMap, listed } = params.includeInventory
      ? await importInventory(ovh, projectMap, nic)
      : { resourceTypes: {}, listed: {} };
    // Each dataset keeps the run's lock, as each bill and each project do: --all, which the
    // cron and the resync import, takes many calls for each
    heartbeat();

    const billIds = await fetchBills(ovh, billsStartOf(nic, params), toDate);
    console.log('\nProcessing bills...');
    for (const [index, billId] of billIds.entries()) {
      // Each bill keeps the run's lock: a whole history takes long
      heartbeat();
      process.stdout.write(`  [${index + 1}/${billIds.length}] ${billId}...`);
      // A differential import only adds the bills it lacks, which keeps the daily run short
      if (importType === 'differential' && db.bills.exists(billId)) {
        console.log(' skipped (exists)');
        continue;
      }
      try {
        const lines = await importBill(ovh, billId, { nic, params, projectMap, resourceTypeMap });
        imported.bills += 1;
        imported.details += lines;
        console.log(` ${lines} details`);
      } catch (err) {
        // The bill is skipped, as a failed item is, and counted in the summary
        failedItemCount += 1;
        console.log(` ERROR: ${describeError(err)}`);
      }
    }

    // A service that another account's API lists too is the account's that bills it: its
    // bills, now stored, may name one that an account imported before it stored (#114)
    const takenOver = db.accounts.takeOverBilledRows(nic,
      { projects: Object.keys(projectMap), ...listed });
    if (takenOver > 0) {
      console.log(`  Took over ${takenOver} services that another account's API lists too, `
        + 'as the bills of this account name them');
    }

    // The other datasets, only when asked: each takes many calls
    if (params.includeConsumption) {
      await importConsumption(ovh, nic);
      heartbeat();
    }
    if (params.includeAccount) {
      await importAccountData(ovh, nic);
      heartbeat();
    }
    if (params.includeCloudDetails) {
      await importCloudDetails(ovh, Object.keys(projectMap), nic, heartbeat);
    }
    if (params.includeCarbon) {
      await importCarbonFootprint(ovh, nic, heartbeat);
      heartbeat();
    }
    return { imported };
  } catch (err) {
    // A call that rejects with nothing fails the account all the same
    return { imported, error: err || new Error(describeError(err)) };
  }
}

function printUsage() {
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
  console.error('  --include-carbon        Import the carbon footprint of the last 24 months');
  console.error('  --all                   Import all additional data');
  console.error('  --account <NIC handle>  Import the configured account of this NIC handle only');
  console.error('                          (with --full, clear and reimport that account only)');
}

// The summary that ends a run which imported its accounts, or some of them
function printSummary(title, stats) {
  console.log(`\n=== ${title} ===`);
  console.log(`Projects: ${stats.projects}`);
  console.log(`Bills: ${stats.bills}`);
  console.log(`Details: ${stats.details}`);
  console.log(`Failed items: ${failedItemCount}`);
}

/**
 * Imports every account of the configuration, one after the other, under the lock of one
 * import log entry, or the account that --account names. An account that fails does not stop
 * the others: the run then ends partial, naming those that failed, or failed when all did.
 * A full import clears the accounts that it can import, and those only (#114). Each run
 * records which accounts the configuration lists, and gives the rows stored before the
 * accounts to their account, when the database tells it (see data/ownership.js).
 * @param {object} params - The options, as parseArgs() reads them
 */
async function runImport(params) {
  const stats = { bills: 0, details: 0, projects: 0 };
  failedItemCount = 0;

  if (!params.full && !params.diff && !params.from) {
    printUsage();
    process.exit(1);
    return;
  }
  if (params.account === '') {
    console.error('Error: --account needs the NIC handle of the account to import');
    process.exit(1);
    return;
  }

  // The accounts, before the lock is taken: a malformed configuration imports nothing
  let configuration;
  try {
    configuration = loadAccounts();
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
    return;
  }
  const several = configuration.accounts.length > 1;

  // Determine import type and dates. The log entry records the latest bill of the database
  // as the start of a differential import: each account then starts from its own.
  let importType = 'period';
  let fromDate = params.from;
  let toDate = params.to || new Date().toISOString().split('T')[0];

  if (params.full) {
    importType = 'full';
    fromDate = null;
    toDate = null;
    console.log('\n=== FULL IMPORT ===');
    console.log(params.account
      ? `This will clear the imported data of the account ${params.account} and reimport it.`
      : 'This will clear the imported data of each account it can import, and reimport it.');
    console.log('The consumption of each project is kept: OVH cannot give its past months '
      + 'again.\n');
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
    console.log(params.since
      ? `Importing bills since: ${params.since}\n`
      : 'Importing the bills of each account since its latest bill\n');
  } else {
    console.log(`\n=== PERIOD IMPORT ===`);
    console.log(`From: ${fromDate}`);
    console.log(`To: ${toDate}\n`);
  }

  // The import log's entry is the lock that the other imports check, so it is written
  // before any call to the API. It records the run even when GET /me fails.
  const importId = db.importLog.start(importType, fromDate, toDate);

  try {
    // A configuration of several entries marks the database for good, whatever their GET /me
    // answers: its rows without an account may be any of those accounts', even one that no
    // run could record, so that a single account configured later never gets them all (#114)
    if (several) db.accounts.markSeveralAccounts();
    // Before any write or clear: an account that cannot name itself must leave the data as
    // it is, since nothing could tell whose rows it would write
    const attempts = await readEveryAccount(configuration.accounts, several);
    throwIfSameAccount(attempts, configuration.source);
    if (several) markOtherCurrencies(attempts);
    // The attempts that the run imports: every account, or the one that --account names
    const accounts = params.account
      ? [findAccount(attempts, params.account, configuration.source)]
      : attempts;

    // Each account named is recorded, with the name and budget of its entry, and the
    // failure of one that bills in another currency
    const [only] = accounts;
    const migrated = db.transaction(() => {
      for (const { entry, nic, lastNic, currency, error } of accounts) {
        if (nic) {
          db.accounts.upsert({ nic, currency, name: entry.name, budget: entry.budget });
          if (error) db.accounts.recordImport(nic, { status: 'failed', error: reasonOf(error) });
        } else if (lastNic) {
          // GET /me failed, but the entry's name is the one that an import last recorded an
          // account with: that account would otherwise keep the status of its last import
          db.accounts.recordImport(lastNic, { status: 'failed', error: reasonOf(error) });
        }
        // An entry without a name, or one never imported, leads to no account that the data
        // can tell: only the run's log names it, by its place
      }
      // Which accounts the configuration lists, whatever the run imports of them: one that it
      // no longer lists keeps its data, and is no longer imported (#114)
      db.accounts.recordConfiguration(attempts.map(({ nic, lastNic }) => nic ?? lastNic ?? null));
      // Rows stored before the upgrade carry no account. With a single account configured, in
      // a database that has never known another, they can only be its own: they get it at
      // the first import, and none is left after. Once the database has known another
      // account, those left are the Unknown account's, which a removed account may have left.
      if (!several && only.nic && db.accounts.isOnlyAccount(only.nic)) {
        return { attributed: db.accounts.attributeRowsWithoutAccount(only.nic) };
      }
      // Otherwise, each account claims those that its API lists as it is imported (#114),
      // and those that none claims are the Unknown account's. The balance and consumption
      // snapshots cannot be claimed: they go, once an account is to record its own.
      const importing = accounts.some(({ nic, error }) => nic && !error);
      return { deleted: importing ? db.accounts.deleteSnapshotsWithoutAccount() : 0 };
    });
    if (migrated.attributed > 0) {
      console.log(`  Attributed ${migrated.attributed} rows stored before to the account `
        + `${only.nic}`);
    }
    if (migrated.deleted > 0) {
      console.log(`  Deleted ${migrated.deleted} balance and consumption snapshots stored `
        + 'before the accounts, which no account can claim');
    }

    // A full import clears each account that it imports, once every account has named itself,
    // in one transaction (#114). An account that it cannot import keeps its data, which the
    // run's error then says, as do an account no longer configured and the rows without an
    // account. A full import of every account starts the import log again, but for the entry
    // of this import, which the other imports check; one of a single account keeps it, as it
    // holds the other accounts' imports.
    const importable = accounts.filter(({ error }) => !error);
    const unimportable = accounts.filter(({ error }) => error);
    if (params.full && importable.length > 0) {
      db.transaction(() => {
        for (const { nic } of importable) db.clearAccount(nic);
        if (!params.account) db.importLog.clearAllBut(importId);
      });
    }
    const keptAtFull = params.full && several && unimportable.length > 0;
    if (keptAtFull) {
      console.warn('Keeping the data of the accounts that cannot be imported: '
        + `${joinWithAnd(unimportable.map(describeAccount))}`);
    }

    // The run's entry of the import log is the lock that the other imports check: the run
    // shows that it is alive as it goes, however long it takes
    const heartbeat = () => db.importLog.heartbeat(importId);
    for (const account of importable) {
      if (several) console.log(`\n=== ACCOUNT ${describeAccount(account)} ===`);
      const { imported, error } = await importAccount(account.client, account.nic,
        { params, importType, toDate, heartbeat });
      // What it wrote counts, even when it failed partway: its rows stay
      for (const figure of Object.keys(stats)) stats[figure] += imported[figure];
      if (error) {
        // The next accounts are imported all the same
        account.error = error;
        db.accounts.recordImport(account.nic, { status: 'failed', error: reasonOf(error) });
        if (several) console.error(`Account ${describeAccount(account)}: ${reasonOf(error)}`);
      } else {
        db.accounts.recordImport(account.nic, { status: 'success' });
      }
      heartbeat();
    }

    const failed = accounts.filter(({ error }) => error);
    if (failed.length > 0) {
      const kept = '. A full import clears only the accounts that it can import: the data of '
        + `${joinWithAnd(unimportable.map(describeAccount))} was kept`;
      const message = failureMessage(accounts, several) + (keptAtFull ? kept : '');
      if (failed.length === accounts.length) throw new Error(message);
      db.importLog.partial(importId, stats, message);
      printSummary('IMPORT PARTIAL', stats);
      console.error(message);
      process.exit(1);
      return;
    }

    // Complete import log
    db.importLog.complete(importId, stats);
    printSummary('IMPORT COMPLETE', stats);
  } catch (err) {
    db.importLog.fail(importId, reasonOf(err));
    console.error('\n=== IMPORT FAILED ===');
    console.error(reasonOf(err));
    process.exit(1);
  } finally {
    db.closeDb();
  }
}

// Run, unless required by the tests
if (require.main === module) {
  const params = parseArgs();
  runImport(params);
}

module.exports = { importCloudDetails, importInventory, parseArgs, runImport };
