/**
 * What the tests share about accounts (#112): the account of the tests, and the form of the
 * times that SQLite writes, such as when an account's last import ended. For the tests of the
 * accounts that the server lists (#114) and of their budgets (#117), what records them as an
 * import does, and the credentials of their entries of config.json. And, for the tests of the
 * account parameter of the server's routes (#115), the accounts of the database they seed,
 * the value that selects the Unknown account, the writers of their rows, and what the server
 * answers to an account it refuses.
 */

// The value that selects the Unknown account, from the data layer's module that has no side
// effect: data/db.js reads config.json when it loads without DATA_DIR
const { UNKNOWN_ACCOUNT } = require('../../data/sql-conditions');

// The accounts of a database seeded with several, by NIC handle: two with bills, and one
// that an import recorded, but that has no bill yet. Invented, as every value of the tests
// is.
const LYON = 'xx1111-ovh';
const PARIS = 'yy2222-ovh';
const NEW_ACCOUNT = 'zz3333-ovh';

// The account of the tests, which GET /me names by its NIC handle
const ACCOUNT = { nic: LYON, currency: 'EUR' };

// A time as SQLite's CURRENT_TIMESTAMP writes it: UTC, to the second
const SQLITE_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/**
 * Records accounts as an import does, and the configuration of its run, which lists them in
 * the order given.
 * @param {object} db - The data layer (data/db.js)
 * @param {...{ nic: string, name: (?string|undefined), budget: (?number|undefined) }} accounts
 *   Each account's NIC handle, and the name and budget of its entry of config.json, if given
 */
function recordAccounts(db, ...accounts) {
  for (const account of accounts) db.accounts.upsert({ currency: 'EUR', ...account });
  db.accounts.recordConfiguration(accounts.map(({ nic }) => nic));
}

/**
 * The credentials of an entry of config.json, invented, for the tests that give the server
 * an accounts section: it checks them, but never uses them.
 * @param {string} key - What tells the entry's keys apart from another's, such as 'lyon'
 * @returns {{ appKey: string, appSecret: string, consumerKey: string, endpoint: string }}
 */
const credentials = (key) => ({
  appKey: `app-${key}`, appSecret: `secret-${key}`, consumerKey: `consumer-${key}`,
  endpoint: 'ovh-eu',
});

// The writers of the rows below write a row of an account through the data layer, and one of
// the Unknown account, null, as the database held it before the accounts: the data layer
// refuses a row without an account. `writeOfAccount` writes the row of an account.
function write(db, table, row, writeOfAccount) {
  if (row.account !== null) return writeOfAccount(row);
  const { account, ...rest } = row;
  const columns = Object.keys(rest);
  return db.getDb().prepare(`
    INSERT INTO ${table} (${columns.join(', ')})
    VALUES (${columns.map((column) => `@${column}`).join(', ')})
  `).run(rest);
}

// A bill of an account, of these amounts, without and with tax, and of its tax: none by
// default
const bill = (db, id, date, account, {
  priceWithoutTax = 0, priceWithTax = 0, tax = 0,
} = {}) => write(db, 'bills', {
  id, date, price_without_tax: priceWithoutTax, price_with_tax: priceWithTax, tax,
  currency: 'EUR', pdf_url: null, html_url: null, account,
}, (row) => db.bills.upsert(row));

// Dates a snapshot, given what its write returned, at a time as SQLite writes it: without
// one, it keeps the time it was written at
function takeAt(db, table, { lastInsertRowid }, takenAt) {
  if (takenAt === undefined) return;
  db.getDb().prepare(`UPDATE ${table} SET snapshot_date = ? WHERE id = ?`)
    .run(takenAt, lastInsertRowid);
}

// A Public Cloud project of an account
const project = (db, id, name, account) => write(db, 'projects', {
  id, name, description: name, status: 'ok', created_at: null, account,
}, (row) => db.projects.upsert(row));

// What a Public Cloud project consumed in a period, from the first day of a month to the day
// of the import, for `total`; its account is its project's
const consumption = (db, projectId, [from, to], total) => db.cloudDetails.insertConsumption({
  project_id: projectId, period_start: from, period_end: to, resource_type: 'instance',
  resource_id: `${projectId}-instance`, resource_name: 'b3-8', quantity: 312, unit: 'Hour',
  unit_price: 0, total_price: total, region: 'GRA11',
});

// The month-end forecast that OVH gives a Public Cloud project for the month of `from`, its
// first day, as the import stores it (#224); its account is its project's
const projectForecast = (db, projectId, from, total) => db.cloudDetails.upsertForecast({
  project_id: projectId, period_start: from, total_price: total,
});

// The month of the current consumption that the import of an account's consumption recorded,
// its first day
const consumptionMonth = (db, account, month) => write(db, 'import_state', {
  key: 'consumption_month', value: month, account,
}, (row) => db.cloudDetails.setCurrentConsumptionMonth(row.value, row.account));

// A consumption snapshot of an account, which its import records from what OVH tells of the
// month in a period: the consumption so far, the forecast, and their details
function snapshot(db, account, [from, to], { current, forecast, details = {}, takenAt }) {
  const written = write(db, 'consumption_snapshots', {
    period_start: from, period_end: to, current_total: current, forecast_total: forecast,
    currency: 'EUR', raw_data: JSON.stringify(details), account,
  }, (row) => db.consumption.insertSnapshot(row));
  takeAt(db, 'consumption_snapshots', written, takenAt);
}

// An entry of the consumption history of an account, as its import stores each that OVH
// gives for a period
const historyEntry = (db, account, [from, to], serviceType, total) => write(db,
  'consumption_history', {
    period_start: from, period_end: to, service_type: serviceType, total, currency: 'EUR',
    raw_data: '{}', account,
  }, (row) => db.consumption.insertHistory(row));

// A balance of an account: its debt, its credits and its deposits
function balance(db, account, { debt, credit, deposit, takenAt }) {
  const written = write(db, 'account_balance', {
    debt_balance: debt, credit_balance: credit, deposit_total: deposit, currency: 'EUR',
    account,
  }, (row) => db.balance.insertBalance(row));
  takeAt(db, 'account_balance', written, takenAt);
}

// A movement of a credit of an account, whose balance the start of its id names: a voucher
// when it adds, a use when it takes
const movement = (db, account, { id, amount, date, description = `Movement ${id}` }) => write(
  db, 'credit_movements', {
    id, balance_name: id.split('_')[0], amount, date, description,
    movement_type: amount > 0 ? 'VOUCHER' : 'USE', account,
  }, (row) => db.balance.insertCreditMovement(row),
);

// A dedicated server, a VPS and a storage service of an account's inventory, as its import
// stores them (#123): its id, its name, and its expiration date, null when it is not known
const server = (db, account, { id, name, expires = null }) => write(db, 'dedicated_servers', {
  id, display_name: name, reverse: id, datacenter: 'rbx8', os: 'debian12_64', state: 'ok',
  cpu: 'Intel Xeon-E 2388G', ram_size: 65536, disk_info: '[]', bandwidth: 1000,
  expiration_date: expires, renewal_type: 'automatic', account,
}, (row) => db.inventory.upsertServer(row));

const vps = (db, account, { id, name, expires = null }) => write(db, 'vps_instances', {
  id, display_name: name, model: 'vps-le-2-2-40', zone: 'Region OpenStack: os-gra7',
  state: 'running', os: 'Debian 12', vcpus: 2, ram_mb: 2048, disk_gb: 40,
  expiration_date: expires, renewal_type: 'automatic', ip_addresses: '["192.0.2.10"]', account,
}, (row) => db.inventory.upsertVps(row));

const storage = (db, account, { id, name, expires = null }) => write(db, 'storage_services', {
  id, service_type: 'netapp', display_name: name, region: 'eu-west-gra', total_size_gb: 1024,
  used_size_gb: 0, share_count: 3, expiration_date: expires, account,
}, (row) => db.inventory.upsertStorage(row));

// What the server answers to an account parameter it refuses (server/account-parameter.js)
const REFUSED = {
  error: "Invalid 'account' parameter: expected the NIC handle of an account, or "
    + UNKNOWN_ACCOUNT,
};

module.exports = {
  ACCOUNT, SQLITE_TIME, LYON, PARIS, NEW_ACCOUNT, UNKNOWN_ACCOUNT, recordAccounts, credentials,
  project, bill, REFUSED, consumption, projectForecast, consumptionMonth, snapshot, historyEntry,
  balance, movement, server, vps, storage,
};
