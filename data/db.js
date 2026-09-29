const Database = require('better-sqlite3');
const { classifyWebCloud, WEB_CLOUD_FAMILIES } = require('./classify');
const {
  instanceLineCondition, readInstanceLine, readVolumeLine,
} = require('./public-cloud-lines');
const { aiEndpointsLineCondition, modelFigures } = require('./ai-endpoints');
const { tieFootprint } = require('./carbon-ties');
const { MONTHLY_KINDS } = require('./cloud-usage');
const { productFigures } = require('./public-cloud-products');
const { storageClassLabel } = require('./storage-classes');
const { monthsOfWindow, shiftMonth } = require('./months');
const ownership = require('./ownership');
// The conditions of the queries that keep one account's rows (#115), or a list of ids
const {
  UNKNOWN_ACCOUNT, accountCondition, configuredAccountsCondition, idInList,
} = require('./sql-conditions');
// What brings a database that an earlier version created to schema.sql's form
const {
  addColumnIfNotExists, hasColumn, keyLacks, migrateWhenNeeded, rekeyTable,
} = require('./migrations');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Load dataDir from config.json (credentials + settings)
function loadDataDirFromConfig() {
  const configPaths = [
    path.resolve(__dirname, '..', 'config.json'),
    path.resolve(os.homedir(), 'my-ovh-bills', 'config.json')
  ];
  for (const configPath of configPaths) {
    try {
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (config.dataDir) return config.dataDir;
      }
    } catch (e) {
      // Try next path
    }
  }
  return null;
}

// Priority: DATA_DIR env var > config.json dataDir > default (__dirname)
const DATA_DIR = process.env.DATA_DIR || loadDataDirFromConfig() || __dirname;
const DB_PATH = path.resolve(DATA_DIR, 'ovh-bills.db');
const SCHEMA_PATH = path.resolve(__dirname, 'schema.sql');

// The tables whose rows carry the NIC handle of their account (#112, ADR 0002): see
// data/ownership.js, which tells which account each row belongs to
const { ACCOUNT_TABLES } = ownership;

/**
 * Checks that a row that a writer of ACCOUNT_TABLES stores carries the NIC handle of its
 * account. Written without it, a row would lose the account it has, as the upserts
 * overwrite it, and the next import would give the row to whichever account it reads.
 * @param {string} table - The table written, which the error names
 * @param {object} row - The row, whose `account` is the NIC handle of its account
 * @returns {object} The row
 * @throws {Error} When the row has no account
 */
function requireAccount(table, row) {
  if (typeof row.account !== 'string' || row.account === '') {
    throw new Error(`Cannot write a row of ${table} without the NIC handle of its account`);
  }
  return row;
}

/**
 * The ORDER BY terms that order rows by their account, after what orders them first: by NIC
 * handle, the Unknown account's last. The lists that name the account of each row order so
 * the rows that their other terms tie, such as a project or a service billed to several
 * accounts, or two servers of one name (#118, #122, #123).
 * @param {string} column - The column of the query that holds the NIC handle of its rows'
 *   account, null for the Unknown account
 * @returns {string}
 */
function accountOrder(column) {
  return `${column} IS NULL, ${column}`;
}

/**
 * How a query of costs groups the bill lines of its bills `b` by project or service, and
 * orders the rows, whose `total` it sums: those of the breakdown by project and of the GPU
 * costs (#118), and the bill lines of a resource type (#123). By project or service, as before
 * the accounts; or, for the lists that name the account of each row, by project or service and
 * account: one billed to several accounts, such as one moved from an account to another, then
 * has a row for each, with the NIC handle of its account, null for the Unknown account, as a
 * bill line belongs to the account of its bill (ADR 0002).
 *
 * Most expensive first; those that cost the same by id, the last first, as SQLite gave them
 * before the queries told accounts apart; and the rows of one by account (accountOrder()).
 * @param {string} column - The column of the query that holds the id of the project or of the
 *   service
 * @param {boolean} byAccount - Whether to give a row to each project or service and account
 * @returns {{ select: string, groupBy: string, orderBy: string }} What the query selects
 *   besides, to follow its other columns, and what GROUP BY and ORDER BY take
 */
function costGrouping(column, byAccount) {
  const byCost = `total DESC, ${column} DESC`;
  if (!byAccount) return { select: '', groupBy: column, orderBy: byCost };
  return {
    select: ', b.account as account',
    groupBy: `${column}, b.account`,
    orderBy: `${byCost}, ${accountOrder('b.account')}`,
  };
}

let db = null;

// An operation of data/ownership.js, on the database that getDb() opens
const onDb = (operation) => (...args) => operation(getDb(), ...args);

/**
 * Initialize and return database connection
 */
function getDb() {
  if (!db) {
    // Ensure DATA_DIR exists
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // Initialize schema if needed
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
    db.exec(schema);

    // Schema migrations: add columns that may not exist yet
    addColumnIfNotExists(db, 'bill_details', 'resource_type', 'TEXT');
    addColumnIfNotExists(db, 'bills', 'payment_type', 'TEXT');
    addColumnIfNotExists(db, 'bills', 'payment_date', 'DATETIME');
    addColumnIfNotExists(db, 'bills', 'payment_status', 'TEXT');
    addColumnIfNotExists(db, 'cloud_instances', 'plan_code', 'TEXT');
    // Empty in a database from before #112: the next import fills it
    for (const table of ACCOUNT_TABLES) {
      addColumnIfNotExists(db, table, 'account', 'TEXT');
    }
    // The name and budget of each account's entry in config.json (#113), which the next
    // import of the account records
    addColumnIfNotExists(db, 'accounts', 'name', 'TEXT');
    addColumnIfNotExists(db, 'accounts', 'budget', 'INTEGER');
    // The place of each account in the configuration, which each run records (#114). An
    // account recorded before was configured at its last import: each takes its place in the
    // order the accounts were first recorded, until the next run records the configuration.
    migrateWhenNeeded(db, () => !hasColumn(db, 'accounts', 'position'), () => {
      addColumnIfNotExists(db, 'accounts', 'position', 'INTEGER');
      db.exec(`
        UPDATE accounts SET position =
          (SELECT COUNT(*) FROM accounts AS earlier WHERE earlier.rowid < accounts.rowid)
      `);
    });
    // How many bills stored before the accounts each account claimed, which tells whether
    // the database was one account's (#114)
    addColumnIfNotExists(db, 'accounts', 'claimed_bills', 'INTEGER NOT NULL DEFAULT 0');
    // When each account's last import that succeeded ended (#124). An earlier version kept
    // how the last import ended only: that of an account whose last import succeeded is its
    // last that did, and an account whose last import failed has none that it can tell.
    migrateWhenNeeded(db, () => !hasColumn(db, 'accounts', 'last_success_at'), () => {
      addColumnIfNotExists(db, 'accounts', 'last_success_at', 'DATETIME');
      db.exec(`
        UPDATE accounts SET last_success_at = last_import_at WHERE last_import_status = 'success'
      `);
    });
    // What keeps the lock of a long import (#113)
    addColumnIfNotExists(db, 'import_log', 'heartbeat_at', 'DATETIME');
    // The credit movements keyed by their account too (#114): their ids, which join the name
    // of their balance and their number, can be those of another account's. And the import
    // state kept by account, where what an import recorded before carries none.
    for (const table of ['credit_movements', 'import_state']) {
      migrateWhenNeeded(db, () => keyLacks(db, table, 'account'),
        () => rekeyTable(db, schema, table));
    }
  }
  return db;
}

/**
 * Close database connection
 */
function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

// Project operations
const projectOps = {
  /**
   * Records a Public Cloud project that an account's API lists, or updates one stored: one
   * that another account holds stays that account's, and one stored without an account goes
   * to this one (see LISTED_SERVICE_TABLES in data/ownership.js)
   * @param {object} project - As the import stores it, with `account`, the NIC handle of the
   *   account whose API lists it
   * @throws {Error} When the project has no account (see requireAccount())
   */
  upsert: (project) => {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO projects (id, name, description, status, created_at, updated_at, account)
      VALUES (@id, @name, @description, @status, @created_at, CURRENT_TIMESTAMP, @account)
      ON CONFLICT(id) DO UPDATE SET
        name = @name,
        description = @description,
        status = @status,
        updated_at = CURRENT_TIMESTAMP,
        account = COALESCE(account, @account)
    `);
    return stmt.run(requireAccount('projects', project));
  },

  /**
   * @param {?string} [account] - The account whose projects to list (see accountCondition()):
   *   every account's by default (#121)
   * @returns {object[]} The projects, by name, each with the NIC handle of its account
   */
  getAll: (account = null) => {
    const ofAccount = accountCondition(account, 'p.account');
    return getDb().prepare(`SELECT * FROM projects p WHERE ${ofAccount.sql} ORDER BY name`)
      .all(...ofAccount.params);
  },

  /**
   * The projects of the account (see accountCondition()), every account's by default, as the
   * Public Cloud tab lists them (#121): most consuming first, each with its account, its
   * number of instances, and what it consumed in the month of the last import of the
   * consumption, which keeps the other months (#54).
   * @param {?string} [account]
   * @returns {object[]}
   */
  getEnriched: (account = null) => {
    const ofAccount = accountCondition(account, 'p.account');
    return getDb().prepare(`
      SELECT
        p.id, p.name, p.description, p.status, p.account,
        COALESCE(ci.instance_count, 0) as instance_count,
        COALESCE(pc.consumption_total, 0) as consumption_total,
        pc.period_start, pc.period_end
      FROM projects p
      LEFT JOIN (
        SELECT project_id, COUNT(*) as instance_count
        FROM cloud_instances
        GROUP BY project_id
      ) ci ON ci.project_id = p.id
      LEFT JOIN (
        SELECT project_id, SUM(total_price) as consumption_total,
               MIN(period_start) as period_start, MAX(period_end) as period_end
        FROM project_consumption
        WHERE period_start = ?
        GROUP BY project_id
      ) pc ON pc.project_id = p.id
      WHERE ${ofAccount.sql}
      ORDER BY consumption_total DESC
    `).all(cloudDetailOps.getCurrentConsumptionMonth(), ...ofAccount.params);
  },

  getById: (id) => {
    const db = getDb();
    return db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  }
};

// Bill operations
const billOps = {
  upsert: (bill) => {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO bills (id, date, price_without_tax, price_with_tax, tax, currency, pdf_url, html_url, imported_at, account)
      VALUES (@id, @date, @price_without_tax, @price_with_tax, @tax, @currency, @pdf_url, @html_url, CURRENT_TIMESTAMP, @account)
      ON CONFLICT(id) DO UPDATE SET
        date = @date,
        price_without_tax = @price_without_tax,
        price_with_tax = @price_with_tax,
        tax = @tax,
        currency = @currency,
        pdf_url = @pdf_url,
        html_url = @html_url,
        imported_at = CURRENT_TIMESTAMP,
        account = @account
    `);
    return stmt.run(requireAccount('bills', bill));
  },

  /**
   * The bills between two dates, each optional, the latest first
   * @param {?string} [fromDate] - The first day, none by default
   * @param {?string} [toDate] - The last day, none by default
   * @param {?string} [account] - The account whose bills to list (see accountCondition()):
   *   every account's by default (#137)
   * @returns {object[]} The bills, each with the NIC handle of its account
   */
  getAll: (fromDate, toDate, account = null) => {
    const ofAccount = accountCondition(account, 'account');
    const conditions = [ofAccount.sql];
    const params = [...ofAccount.params];
    if (fromDate) {
      conditions.push('date >= ?');
      params.push(fromDate);
    }
    if (toDate) {
      conditions.push('date <= ?');
      params.push(toDate);
    }
    return getDb().prepare(`
      SELECT * FROM bills WHERE ${conditions.join(' AND ')} ORDER BY date DESC
    `).all(...params);
  },

  getById: (id) => {
    const db = getDb();
    return db.prepare('SELECT * FROM bills WHERE id = ?').get(id);
  },

  /**
   * @param {?string} [account] - The account whose bills count (see accountCondition()):
   *   every account's by default
   * @returns {?string} The date of the latest bill stored, of the account when one is given;
   *   null when there is none
   */
  getLatestDate: (account = null) => {
    const ofAccount = accountCondition(account, 'b.account');
    const result = getDb().prepare(`
      SELECT MAX(b.date) as latest
      FROM bills b
      WHERE ${ofAccount.sql}
    `).get(...ofAccount.params);
    return result?.latest;
  },

  /**
   * @param {?string} [account] - The account whose bills count (see accountCondition()):
   *   every account's by default
   * @returns {string[]} The months billed, as YYYY-MM, most recent first
   */
  getMonths: (account = null) => {
    const ofAccount = accountCondition(account, 'b.account');
    return getDb().prepare(`
      SELECT DISTINCT strftime('%Y-%m', b.date) as month
      FROM bills b
      WHERE ${ofAccount.sql}
      ORDER BY month DESC
    `).pluck().all(...ofAccount.params);
  },

  exists: (id) => {
    const db = getDb();
    const result = db.prepare('SELECT 1 FROM bills WHERE id = ? LIMIT 1').get(id);
    return !!result;
  }
};

// Bill details operations
const detailOps = {
  insert: (detail) => {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO bill_details
      (id, bill_id, project_id, domain, description, quantity, unit_price, total_price, service_type, resource_type)
      VALUES (@id, @bill_id, @project_id, @domain, @description, @quantity, @unit_price, @total_price, @service_type, @resource_type)
    `);
    return stmt.run({ resource_type: null, ...detail });
  },

  insertMany: (details) => {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO bill_details
      (id, bill_id, project_id, domain, description, quantity, unit_price, total_price, service_type, resource_type)
      VALUES (@id, @bill_id, @project_id, @domain, @description, @quantity, @unit_price, @total_price, @service_type, @resource_type)
    `);

    const insertAll = db.transaction((items) => {
      for (const item of items) {
        stmt.run({ resource_type: null, ...item });
      }
    });

    return insertAll(details);
  },

  getByBillId: (billId) => {
    const db = getDb();
    return db.prepare('SELECT * FROM bill_details WHERE bill_id = ?').all(billId);
  },

  /**
   * The bill lines of the bills between two dates, both included, as the CSV export of the
   * bill lines gives them: each with the date, the payment status and the account of its bill,
   * as a bill line belongs to the account of its bill (ADR 0002), and the name of its project.
   * By date, then bill.
   * @param {string} fromDate
   * @param {string} toDate
   * @param {?string} [account] - The account whose bills' lines to list (see
   *   accountCondition()): every account's by default (#137)
   * @returns {object[]} The lines, each with `account`, the NIC handle of its bill's account,
   *   null for the Unknown account
   */
  getByPeriod: (fromDate, toDate, account = null) => {
    const ofAccount = accountCondition(account, 'b.account');
    return getDb().prepare(`
      SELECT
        d.bill_id,
        b.date,
        p.name as project_name,
        d.service_type,
        d.resource_type,
        d.description,
        d.quantity,
        d.unit_price,
        d.total_price,
        b.payment_status,
        b.account
      FROM bill_details d
      JOIN bills b ON d.bill_id = b.id
      LEFT JOIN projects p ON d.project_id = p.id
      WHERE b.date >= ? AND b.date <= ?
        AND ${ofAccount.sql}
      ORDER BY b.date, d.bill_id
    `).all(fromDate, toDate, ...ofAccount.params);
  },

  deleteByBillId: (billId) => {
    const db = getDb();
    return db.prepare('DELETE FROM bill_details WHERE bill_id = ?').run(billId);
  }
};

// Ends the import log entry of an import that imported its accounts, or some of them: what
// they imported, its status, 'success' or 'partial', and the error that names the accounts
// that failed, null when none did
function endImport(id, stats, status, errorMessage) {
  return getDb().prepare(`
    UPDATE import_log SET
      completed_at = CURRENT_TIMESTAMP,
      bills_imported = ?,
      details_imported = ?,
      projects_imported = ?,
      status = ?,
      error_message = ?
    WHERE id = ?
  `).run(stats.bills, stats.details, stats.projects, status, errorMessage, id);
}

// Import log operations
const importLogOps = {
  start: (type, fromDate, toDate) => {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO import_log (started_at, type, from_date, to_date, status)
      VALUES (CURRENT_TIMESTAMP, ?, ?, ?, 'running')
    `);
    const result = stmt.run(type, fromDate, toDate);
    return result.lastInsertRowid;
  },

  complete: (id, stats) => endImport(id, stats, 'success', null),

  fail: (id, errorMessage) => {
    const db = getDb();
    const stmt = db.prepare(`
      UPDATE import_log SET
        completed_at = CURRENT_TIMESTAMP,
        status = 'failed',
        error_message = ?
      WHERE id = ?
    `);
    return stmt.run(errorMessage, id);
  },

  // Ends an import that some of its accounts failed, and the others imported (#113)
  partial: (id, stats, errorMessage) => endImport(id, stats, 'partial', errorMessage),

  getLatest: () => {
    const db = getDb();
    return db.prepare('SELECT * FROM import_log ORDER BY id DESC LIMIT 1').get();
  },

  getAll: () => {
    const db = getDb();
    return db.prepare('SELECT * FROM import_log ORDER BY id DESC').all();
  },

  /**
   * Clears the log of every import but the one given: a full import of every account starts
   * the log again (#114), but for its own entry, which tells the other imports that it runs
   * @param {number} id - The entry to keep
   */
  clearAllBut: (id) => {
    const db = getDb();
    return db.prepare('DELETE FROM import_log WHERE id IS NOT ?').run(id);
  },

  // Records that the running import is alive, which keeps its lock: a run over several
  // accounts, or over an account's whole history, can take longer than 30 minutes (#113)
  heartbeat: (id) => {
    const db = getDb();
    return db.prepare('UPDATE import_log SET heartbeat_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(id);
  },

  // An import is in progress when the latest entry is still 'running' and
  // started, or last showed it is alive, less than 30 minutes ago (an older
  // one is a crashed run). The times are UTC CURRENT_TIMESTAMPs without
  // timezone, so their age is computed in SQL against 'now', which is UTC too.
  isRunning: () => {
    const db = getDb();
    const running = db.prepare(`
      SELECT 1 FROM import_log
      WHERE id = (SELECT MAX(id) FROM import_log)
        AND status = 'running'
        AND datetime(COALESCE(heartbeat_at, started_at)) > datetime('now', '-30 minutes')
    `).get();
    return Boolean(running);
  }
};

// The OVH accounts that the imports read, by the NIC handle that GET /me names (#112)
const accountsOps = {
  /**
   * Records an account that an import reads, or updates one it knows: its currency, and the
   * name and budget of its entry in config.json, which only an import can match with the
   * account (#113). A rename in config.json thus shows once the account is imported again.
   * @param {object} account - As GET /me names it
   * @param {string} account.nic - Its NIC handle
   * @param {?string} account.currency - The code of the currency it bills in, such as EUR
   * @param {?string} [account.name] - The name of its entry, null when it has none
   * @param {?number} [account.budget] - The budget of its entry, null when it has none
   */
  upsert: ({ nic, currency, name = null, budget = null }) => {
    const db = getDb();
    return db.prepare(`
      INSERT INTO accounts (nic, currency, name, budget) VALUES (@nic, @currency, @name, @budget)
      ON CONFLICT(nic) DO UPDATE SET currency = @currency, name = @name, budget = @budget
    `).run({ nic, currency, name, budget });
  },

  // Which account the rows belong to, and the rows that an import gives to an account,
  // takes over for one, or leaves the Unknown account's (#114): the operations of
  // data/ownership.js, on the database that getDb() opens, without their first parameter

  /** @see ownership.attributeRowsWithoutAccount */
  attributeRowsWithoutAccount: onDb(ownership.attributeRowsWithoutAccount),
  /** @see ownership.markSeveralAccounts */
  markSeveralAccounts: onDb(ownership.markSeveralAccounts),
  /** @see ownership.isOnlyAccount */
  isOnlyAccount: onDb(ownership.isOnlyAccount),
  /** @see ownership.hasRowsWithoutAccount */
  hasRowsWithoutAccount: onDb(ownership.hasRowsWithoutAccount),
  /** @see ownership.claimBills */
  claimBills: onDb(ownership.claimBills),
  /** @see ownership.attributeToSoleClaimer */
  attributeToSoleClaimer: onDb(ownership.attributeToSoleClaimer),
  /** @see ownership.claimCreditMovement */
  claimCreditMovement: onDb(ownership.claimCreditMovement),
  /** @see ownership.deleteSnapshotsWithoutAccount */
  deleteSnapshotsWithoutAccount: onDb(ownership.deleteSnapshotsWithoutAccount),
  /** @see ownership.takeOverBilledRows */
  takeOverBilledRows: onDb(ownership.takeOverBilledRows),

  /**
   * Records how the last import of the account ended, and that it ended now, for the
   * accounts route to tell whether its data is fresh: when it succeeded, that it is the last
   * that did, as one that fails leaves the data as the last that succeeded left it (#124).
   * @param {string} nic - The NIC handle of the account
   * @param {object} result
   * @param {string} result.status - 'success' or 'failed'
   * @param {?string} [result.error] - Why it failed
   */
  recordImport: (nic, { status, error = null }) => {
    const db = getDb();
    // CURRENT_TIMESTAMP is the same time throughout the statement
    return db.prepare(`
      UPDATE accounts SET
        last_import_at = CURRENT_TIMESTAMP,
        last_import_status = @status,
        last_import_error = @error,
        last_success_at = CASE
          WHEN @status = 'success' THEN CURRENT_TIMESTAMP ELSE last_success_at
        END
      WHERE nic = @nic
    `).run({ status, error, nic });
  },

  /**
   * @param {string} name - The name of an entry of config.json
   * @returns {object|undefined} The account that an import last recorded with that name, as
   *   the accounts table holds it: the account that the entry last led to
   */
  getByName: (name) => {
    const db = getDb();
    return db.prepare(`
      SELECT * FROM accounts WHERE name = ? ORDER BY last_import_at DESC LIMIT 1
    `).get(name);
  },

  // Whether an import recorded the account of a NIC handle: one that the server's routes can
  // select (#115)
  isRecorded: (nic) =>
    getDb().prepare('SELECT 1 FROM accounts WHERE nic = ?').get(nic) !== undefined,

  /**
   * Records which accounts the configuration of a run lists, among those recorded, and at
   * which place: the others are no longer configured, keep their data and are no longer
   * imported (#114). Each run records it, whatever it imports of them. When the run cannot
   * tell the account of an entry, which may be any of those recorded, the accounts that it
   * can tell take their places, and the others keep theirs: only a run that tells every
   * entry's account knows which ones the configuration no longer lists.
   * @param {Array<?string>} nics - The NIC handle of the account of each entry of the
   *   configuration, in its order: the one that its GET /me named, or else the one that an
   *   import last recorded with its entry's name; null for an entry that leads to no account
   *   that the run can tell
   */
  recordConfiguration: (nics) => {
    const db = getDb();
    const place = db.prepare('UPDATE accounts SET position = ? WHERE nic = ?');
    db.transaction(() => {
      if (nics.every(nic => nic)) db.exec('UPDATE accounts SET position = NULL');
      nics.forEach((nic, position) => {
        if (nic) place.run(position, nic);
      });
    })();
  },

  /**
   * @returns {object[]} Every account recorded: those that the configuration of the last run
   *   lists, in its order, then the others by NIC handle. Each gives the accounts table's
   *   nic, currency, last_import_at, last_import_status, last_import_error, last_success_at,
   *   name and budget, and `configured`, whether that configuration lists it.
   */
  getAll: () => getDb().prepare(`
    SELECT nic, currency, last_import_at, last_import_status, last_import_error,
      last_success_at, name, budget, position IS NOT NULL AS configured
    FROM accounts
    ORDER BY position IS NULL, position, nic
  `).all().map(account => ({ ...account, configured: account.configured === 1 }))
};

// Analysis queries
const analysisOps = {
  // The costs of each project billed between two dates, most expensive first, on the bills of
  // the account (see accountCondition()), every account's by default. A project missing from
  // the projects table keeps the id of its bill lines, without a name: the dashboard tells
  // such projects apart by their id (#55). One row per project, or, with byAccount, per
  // project and account, with its account (see costGrouping(), #118).
  byProject: (fromDate, toDate, account = null, { byAccount = false } = {}) => {
    const db = getDb();
    const ofAccount = accountCondition(account, 'b.account');
    const grouping = costGrouping('d.project_id', byAccount);
    return db.prepare(`
      SELECT
        d.project_id as project_id,
        p.name as project_name,
        SUM(d.total_price) as total,
        COUNT(d.id) as details_count${grouping.select}
      FROM bill_details d
      JOIN bills b ON d.bill_id = b.id
      LEFT JOIN projects p ON d.project_id = p.id
      WHERE b.date >= ? AND b.date <= ?
        AND d.project_id IS NOT NULL
        AND ${ofAccount.sql}
      GROUP BY ${grouping.groupBy}
      ORDER BY ${grouping.orderBy}
    `).all(fromDate, toDate, ...ofAccount.params);
  },

  // The costs of each service type billed between two dates, most expensive first, on the
  // bills of the account (see accountCondition()), every account's by default (#118)
  byService: (fromDate, toDate, account = null) => {
    const db = getDb();
    const ofAccount = accountCondition(account, 'b.account');
    return db.prepare(`
      SELECT
        d.service_type,
        SUM(d.total_price) as total,
        COUNT(d.id) as details_count
      FROM bill_details d
      JOIN bills b ON d.bill_id = b.id
      WHERE b.date >= ? AND b.date <= ?
        AND ${ofAccount.sql}
      GROUP BY d.service_type
      ORDER BY total DESC
    `).all(fromDate, toDate, ...ofAccount.params);
  },

  /**
   * The cost of each day between two dates, both included, that has a bill: the total of the
   * lines of its bills, the earliest day first
   * @param {string} fromDate - The first day
   * @param {string} toDate - The last day
   * @param {?string} [account] - The account whose bills count (see accountCondition()):
   *   every account's by default (#140)
   * @returns {Array<{ date: string, total: number }>}
   */
  dailyTrend: (fromDate, toDate, account = null) => {
    const db = getDb();
    const ofAccount = accountCondition(account, 'b.account');
    return db.prepare(`
      SELECT
        b.date,
        SUM(d.total_price) as total
      FROM bill_details d
      JOIN bills b ON d.bill_id = b.id
      WHERE b.date >= ? AND b.date <= ?
        AND ${ofAccount.sql}
      GROUP BY b.date
      ORDER BY b.date
    `).all(fromDate, toDate, ...ofAccount.params);
  },

  // The cost of every month between two dates, both included, 0 for a month without any
  // bill: a trend over N months gives N months (#65). Nothing when none of them has a bill,
  // for the Trends tab to say it has no data. On the bills of the account (see
  // accountCondition()), every account's by default (#120).
  monthlyTrend: (fromDate, toDate, account = null) => {
    const db = getDb();
    const ofAccount = accountCondition(account, 'b.account');
    const billed = db.prepare(`
      SELECT
        strftime('%Y-%m', b.date) as month,
        SUM(d.total_price) as total
      FROM bill_details d
      JOIN bills b ON d.bill_id = b.id
      WHERE b.date >= ? AND b.date <= ?
        AND ${ofAccount.sql}
      GROUP BY strftime('%Y-%m', b.date)
      ORDER BY month
    `).all(fromDate, toDate, ...ofAccount.params);
    if (billed.length === 0) return [];
    const totals = new Map(billed.map(({ month, total }) => [month, total]));
    return monthsOfWindow(fromDate, toDate)
      .map((month) => ({ month, total: totals.get(month) ?? 0 }));
  },

  // The cost of each resource type billed between two dates, both included, in every month
  // between them, 0 for a month it was not billed in: each resource type's trend gives
  // every month, as the monthly trend does (#65). Nothing when none of them has a bill,
  // since no resource type was billed. On the bills of the account (see accountCondition()),
  // every account's by default: the resource types billed to it alone (#120).
  monthlyTrendByResourceType: (fromDate, toDate, account = null) => {
    const db = getDb();
    const ofAccount = accountCondition(account, 'b.account');
    const billed = db.prepare(`
      SELECT
        strftime('%Y-%m', b.date) as month,
        COALESCE(d.resource_type, 'other') as resource_type,
        SUM(d.total_price) as total
      FROM bill_details d
      JOIN bills b ON d.bill_id = b.id
      WHERE b.date >= ? AND b.date <= ?
        AND ${ofAccount.sql}
      GROUP BY strftime('%Y-%m', b.date), COALESCE(d.resource_type, 'other')
      ORDER BY month
    `).all(fromDate, toDate, ...ofAccount.params);
    const totals = new Map(billed.map((row) => [`${row.month} ${row.resource_type}`, row.total]));
    // In the order the query first gives them, which orders the resource types of equal cost
    // on the chart
    const resourceTypes = [...new Set(billed.map((row) => row.resource_type))];
    return monthsOfWindow(fromDate, toDate).flatMap((month) => resourceTypes.map((type) => ({
      month,
      resource_type: type,
      total: totals.get(`${month} ${type}`) ?? 0,
    })));
  },

  // The totals of the bills between two dates of the account (see accountCondition()), every
  // account's by default
  summary: (fromDate, toDate, account = null) => {
    const db = getDb();
    const ofAccount = accountCondition(account, 'b.account');

    const totals = db.prepare(`
      SELECT
        SUM(CASE WHEN d.project_id IS NOT NULL THEN d.total_price ELSE 0 END) as cloud_total,
        SUM(CASE WHEN d.project_id IS NULL THEN d.total_price ELSE 0 END) as non_cloud_total,
        SUM(d.total_price) as grand_total,
        COUNT(DISTINCT b.id) as bills_count,
        COUNT(DISTINCT d.project_id) as projects_count
      FROM bill_details d
      JOIN bills b ON d.bill_id = b.id
      WHERE b.date >= ? AND b.date <= ?
        AND ${ofAccount.sql}
    `).get(fromDate, toDate, ...ofAccount.params);

    return totals;
  },

  /**
   * The AI Endpoints models that the bill lines of the Public Cloud projects name between two
   * dates (#193), each once, the projects together: the lines of the bills of the account (see
   * accountCondition()), every account's by default, as modelFigures() adds them up. Read when
   * the server reads the bills: no re-import.
   * @param {string} fromDate
   * @param {string} toDate
   * @param {?string} [account]
   * @returns {{total: number, models: object[]}} What the models cost in all, and each model
   *   with its tokens and its cost (see modelFigures())
   */
  aiEndpoints: (fromDate, toDate, account = null) => {
    const ofBills = accountCondition(account, 'b.account');
    // A prefilter only, the lines that name AI Endpoints: the reader of modelFigures() decides
    // which of them name a model
    const ofAiEndpointsLines = aiEndpointsLineCondition('d.description');
    return modelFigures(getDb().prepare(`
      SELECT d.description, d.quantity, d.total_price
      FROM bill_details d
      JOIN bills b ON d.bill_id = b.id
      WHERE b.date >= ? AND b.date <= ?
        AND d.project_id IS NOT NULL
        AND ${ofAiEndpointsLines.sql}
        AND ${ofBills.sql}
    `).all(fromDate, toDate, ...ofAiEndpointsLines.params, ...ofBills.params));
  },

  billsByProject: (projectNameOrId, fromDate, toDate) => {
    const db = getDb();
    let query = `
      SELECT
        b.id as bill_id,
        b.date,
        SUM(d.total_price) as amount
      FROM bills b
      JOIN bill_details d ON d.bill_id = b.id
      LEFT JOIN projects p ON d.project_id = p.id
      WHERE (p.name = ? OR p.id = ? OR d.project_id = ?)
    `;
    const params = [projectNameOrId, projectNameOrId, projectNameOrId];

    if (fromDate && toDate) {
      query += ' AND b.date >= ? AND b.date <= ?';
      params.push(fromDate, toDate);
    }

    query += ' GROUP BY b.id ORDER BY b.date DESC';
    return db.prepare(query).all(...params);
  },

  billsByMonth: (yearMonth) => {
    const db = getDb();
    return db.prepare(`
      SELECT
        b.id as bill_id,
        b.date,
        b.price_without_tax as amount
      FROM bills b
      WHERE strftime('%Y-%m', b.date) = ?
      ORDER BY b.date DESC
    `).all(yearMonth);
  }
};

// Consumption snapshot operations (Phase 1)
const consumptionOps = {
  insertSnapshot: (snapshot) => {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO consumption_snapshots (snapshot_date, period_start, period_end, current_total, forecast_total, currency, raw_data, account)
      VALUES (CURRENT_TIMESTAMP, @period_start, @period_end, @current_total, @forecast_total, @currency, @raw_data, @account)
    `);
    return stmt.run(requireAccount('consumption_snapshots', snapshot));
  },

  /**
   * What tells the current month's consumption of each account (#116): its latest
   * consumption snapshot, and what its Public Cloud projects consumed in the month of its
   * current consumption. Of the account given (see accountCondition()), or of every account
   * that has either, the Unknown account's included, by default: each account's import
   * records its own (#114).
   * @param {?string} [account]
   * @returns {{ account: ?string, snapshot: (object|undefined), cloud: object }[]} For each
   *   account, by NIC handle, the Unknown account's last: its NIC handle, null for the
   *   Unknown account; its latest snapshot, if any; and what its projects consumed (see
   *   cloudDetails.getConsumptionSummary())
   */
  getCurrentByAccount: (account = null) => {
    const db = getDb();
    const ofSnapshots = accountCondition(account, 'account');
    const ofProjects = accountCondition(account, 'p.account');
    const snapshots = db.prepare(`
      SELECT * FROM consumption_snapshots
      WHERE id IN (
        SELECT MAX(id) FROM consumption_snapshots WHERE ${ofSnapshots.sql} GROUP BY account
      )
    `).all(...ofSnapshots.params);
    // The accounts with a snapshot, or whose projects consumed in any month
    const accounts = db.prepare(`
      SELECT account FROM (
        SELECT account FROM consumption_snapshots WHERE ${ofSnapshots.sql}
        UNION
        SELECT p.account FROM project_consumption c LEFT JOIN projects p ON p.id = c.project_id
        WHERE ${ofProjects.sql}
      )
      ORDER BY account IS NULL, account
    `).pluck().all(...ofSnapshots.params, ...ofProjects.params);
    return accounts.map((nic) => ({
      account: nic,
      snapshot: snapshots.find((snapshot) => snapshot.account === nic),
      cloud: cloudDetailOps.getConsumptionSummary(nic ?? UNKNOWN_ACCOUNT),
    }));
  },

  insertHistory: (entry) => {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO consumption_history (period_start, period_end, service_type, total, currency, raw_data, imported_at, account)
      VALUES (@period_start, @period_end, @service_type, @total, @currency, @raw_data, CURRENT_TIMESTAMP, @account)
    `);
    return stmt.run(requireAccount('consumption_history', entry));
  },

  /**
   * The consumption history of the account (see accountCondition()), or of every account by
   * default, the Unknown account's included, the latest period first (#116). The entries of
   * the accounts for a period add up, as the accounts bill in one currency, like with like:
   * the first of a service type of each account with the first of that type of the others',
   * the second with the second. OVH may give an account several entries for a period, of
   * several types or of one: they thus stay apart, as they were before the accounts. Those of
   * a period come the latest stored first.
   * @param {string} [fromDate] - With toDate, the first day of the earliest period to give
   * @param {string} [toDate] - With fromDate, the last day of the latest period to give
   * @param {?string} [account]
   * @returns {object[]} Each entry's period_start and period_end, its service_type, its total
   *   and its currency
   */
  getHistory: (fromDate, toDate, account = null) => {
    const ofAccount = accountCondition(account, 'account');
    const conditions = [ofAccount.sql];
    const params = [...ofAccount.params];
    if (fromDate && toDate) {
      conditions.push('period_start >= ? AND period_end <= ?');
      params.push(fromDate, toDate);
    }
    return getDb().prepare(`
      SELECT period_start, period_end, service_type, SUM(total) as total,
        MIN(currency) as currency
      FROM (
        SELECT *, ROW_NUMBER() OVER (
          PARTITION BY account, period_start, period_end, service_type ORDER BY id
        ) as nth
        FROM consumption_history
        WHERE ${conditions.join(' AND ')}
      )
      GROUP BY period_start, period_end, service_type, nth
      ORDER BY period_start DESC, period_end DESC, MAX(id) DESC
    `).all(...params);
  },

  /**
   * Clears the consumption history of an account, which its import then replaces: the other
   * accounts' history, and that of the Unknown account, stay (#114)
   * @param {string} account - The NIC handle of the account
   */
  clearHistory: (account) => {
    const db = getDb();
    db.prepare('DELETE FROM consumption_history WHERE account = ?').run(account);
  }
};

// Account balance operations (Phase 2)
const balanceOps = {
  insertBalance: (balance) => {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO account_balance (snapshot_date, debt_balance, credit_balance, deposit_total, currency, account)
      VALUES (CURRENT_TIMESTAMP, @debt_balance, @credit_balance, @deposit_total, @currency, @account)
    `);
    return stmt.run(requireAccount('account_balance', balance));
  },

  /**
   * The balance of the account (see accountCondition()): its latest balance snapshot, whenever
   * it was taken. Or, for every account, by default, the sum of each account's latest, the
   * Unknown account's included, of the latest month that one of them was taken in: each
   * account's import records its own (#114), and the accounts bill in one currency, so their
   * balances add up (#116). An account's latest of an earlier month adds nothing, such as that
   * of an account no longer configured, nor, until the account is imported again, that of the
   * month before when another account's is of a new one.
   * @param {?string} [account]
   * @returns {object|undefined} The balance: the snapshot_date of the latest snapshot that it
   *   adds up, its debt_balance, credit_balance and deposit_total, and the currency of the
   *   snapshot stored last; undefined when there is none
   */
  getBalance: (account = null) => {
    const ofAccount = accountCondition(account, 'account');
    const { snapshots, ...balance } = getDb().prepare(`
      WITH latest AS (
        SELECT * FROM account_balance
        WHERE id IN (SELECT MAX(id) FROM account_balance WHERE ${ofAccount.sql} GROUP BY account)
      ), ofLatestMonth AS (
        SELECT * FROM latest
        WHERE substr(snapshot_date, 1, 7) = (SELECT substr(MAX(snapshot_date), 1, 7) FROM latest)
      )
      SELECT
        COUNT(*) as snapshots,
        MAX(snapshot_date) as snapshot_date,
        SUM(debt_balance) as debt_balance,
        SUM(credit_balance) as credit_balance,
        SUM(deposit_total) as deposit_total,
        (SELECT currency FROM ofLatestMonth ORDER BY id DESC LIMIT 1) as currency
      FROM ofLatestMonth
    `).get(...ofAccount.params);
    return snapshots === 0 ? undefined : balance;
  },

  insertCreditMovement: (movement) => {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO credit_movements (id, balance_name, amount, date, description, movement_type, imported_at, account)
      VALUES (@id, @balance_name, @amount, @date, @description, @movement_type, CURRENT_TIMESTAMP, @account)
    `);
    return stmt.run(requireAccount('credit_movements', movement));
  },

  /**
   * @param {?string} [account] - The account whose credit movements to list (see
   *   accountCondition()): every account's by default (#116)
   * @returns {object[]} The movements, as their table holds them, the most recent first
   */
  getCreditMovements: (account = null) => {
    const ofAccount = accountCondition(account, 'account');
    return getDb().prepare(`
      SELECT * FROM credit_movements WHERE ${ofAccount.sql} ORDER BY date DESC
    `).all(...ofAccount.params);
  },

  updateBillPayment: (billId, paymentInfo) => {
    const db = getDb();
    const stmt = db.prepare(`
      UPDATE bills SET payment_type = ?, payment_date = ?, payment_status = ? WHERE id = ?
    `);
    return stmt.run(paymentInfo.type, paymentInfo.date, paymentInfo.status, billId);
  }
};

/**
 * Makes the function that deletes the services of an inventory table whose id is not in
 * `ids`, the list that the OVH API of an account gave of all those that exist now: the
 * services cancelled since an import stored them (#74). It deletes only the services of that
 * account, `account`, its NIC handle: another account's services, and those that no account
 * holds, are not in its list (#114). The ids compare as text (see idInList()).
 * @param {string} table - The inventory table
 * @param {?string} [serviceType] - For a table whose list covers one type of its services
 *   only, that type: the others stay
 * @returns {function(Array<string|number>, string): number} The function, of the list and
 *   the account, which returns how many it deleted
 */
function deleteNotIn(table, serviceType = null) {
  const ofType = serviceType === null ? '' : 'service_type = ? AND ';
  const typeParams = serviceType === null ? [] : [serviceType];
  return (ids, account) => {
    const listed = idInList('id', ids);
    return getDb().prepare(`
      DELETE FROM ${table} WHERE account = ? AND ${ofType}NOT ${listed.sql}
    `).run(account, ...typeParams, ...listed.params).changes;
  };
}

// Every service of an inventory table, dedicated servers, VPS or storage services, of the
// account (see accountCondition()), every account's by default: by name, as before the
// accounts, then those of one name by account (accountOrder(), #123). SQLite gives the rows
// that its ORDER BY ties in the order it reads them, the table's: the services of one account
// keep the order they had before.
function listInventory(table, account) {
  const ofAccount = accountCondition(account, 'account');
  return getDb().prepare(`
    SELECT * FROM ${table} WHERE ${ofAccount.sql}
    ORDER BY display_name, ${accountOrder('account')}
  `).all(...ofAccount.params);
}

// Inventory operations (Phase 3)
const inventoryOps = {
  /**
   * Records a dedicated server that an account's API lists, or updates one stored: one that
   * another account holds stays that account's, and one stored without an account goes to
   * this one (see LISTED_SERVICE_TABLES in data/ownership.js)
   * @param {object} server - As the import stores it, with `account`, the NIC handle of the
   *   account whose API lists it
   * @throws {Error} When the server has no account (see requireAccount())
   */
  upsertServer: (server) => {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO dedicated_servers (id, display_name, reverse, datacenter, os, state, cpu, ram_size, disk_info, bandwidth, expiration_date, renewal_type, imported_at, account)
      VALUES (@id, @display_name, @reverse, @datacenter, @os, @state, @cpu, @ram_size, @disk_info, @bandwidth, @expiration_date, @renewal_type, CURRENT_TIMESTAMP, @account)
      ON CONFLICT(id) DO UPDATE SET
        display_name = @display_name, reverse = @reverse, datacenter = @datacenter, os = @os, state = @state,
        cpu = @cpu, ram_size = @ram_size, disk_info = @disk_info, bandwidth = @bandwidth,
        expiration_date = @expiration_date, renewal_type = @renewal_type, imported_at = CURRENT_TIMESTAMP,
        account = COALESCE(account, @account)
    `);
    return stmt.run(requireAccount('dedicated_servers', server));
  },

  /**
   * The dedicated servers of the inventory, as the Infrastructure tab lists them (#123)
   * @param {?string} [account] - The account whose servers to list (see accountCondition()):
   *   every account's by default
   * @returns {object[]} The servers, each with the NIC handle of its account, in the order of
   *   listInventory()
   */
  getAllServers: (account = null) => listInventory('dedicated_servers', account),

  /**
   * Records a VPS that an account's API lists, as upsertServer() records a server
   * @param {object} vps - As the import stores it, with `account`
   * @throws {Error} When the VPS has no account (see requireAccount())
   */
  upsertVps: (vps) => {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO vps_instances (id, display_name, model, zone, state, os, vcpus, ram_mb, disk_gb, expiration_date, renewal_type, ip_addresses, imported_at, account)
      VALUES (@id, @display_name, @model, @zone, @state, @os, @vcpus, @ram_mb, @disk_gb, @expiration_date, @renewal_type, @ip_addresses, CURRENT_TIMESTAMP, @account)
      ON CONFLICT(id) DO UPDATE SET
        display_name = @display_name, model = @model, zone = @zone, state = @state, os = @os,
        vcpus = @vcpus, ram_mb = @ram_mb, disk_gb = @disk_gb,
        expiration_date = @expiration_date, renewal_type = @renewal_type, ip_addresses = @ip_addresses, imported_at = CURRENT_TIMESTAMP,
        account = COALESCE(account, @account)
    `);
    return stmt.run(requireAccount('vps_instances', vps));
  },

  /**
   * The VPS of the inventory, as getAllServers() lists the servers (#123)
   * @param {?string} [account] - Every account's by default
   * @returns {object[]}
   */
  getAllVps: (account = null) => listInventory('vps_instances', account),

  /**
   * Records a storage service that an account's API lists, as upsertServer() records a server
   * @param {object} storage - As the import stores it, with `account`
   * @throws {Error} When the service has no account (see requireAccount())
   */
  upsertStorage: (storage) => {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO storage_services (id, service_type, display_name, region, total_size_gb, used_size_gb, share_count, expiration_date, imported_at, account)
      VALUES (@id, @service_type, @display_name, @region, @total_size_gb, @used_size_gb, @share_count, @expiration_date, CURRENT_TIMESTAMP, @account)
      ON CONFLICT(id) DO UPDATE SET
        service_type = @service_type, display_name = @display_name, region = @region,
        total_size_gb = @total_size_gb, used_size_gb = @used_size_gb, share_count = @share_count,
        expiration_date = @expiration_date, imported_at = CURRENT_TIMESTAMP,
        account = COALESCE(account, @account)
    `);
    return stmt.run(requireAccount('storage_services', storage));
  },

  /**
   * The storage services of the inventory, as getAllServers() lists the servers (#123)
   * @param {?string} [account] - Every account's by default
   * @returns {object[]}
   */
  getAllStorage: (account = null) => listInventory('storage_services', account),

  // The services of an account cancelled since an import stored them go, see deleteNotIn()
  // (#74, #114)
  deleteServersNotIn: deleteNotIn('dedicated_servers'),
  deleteVpsNotIn: deleteNotIn('vps_instances'),
  // Their list, /storage/netapp, names the NetApp services only
  deleteStorageNotIn: deleteNotIn('storage_services', 'netapp'),

  /**
   * How many services each inventory holds, the Public Cloud projects included (#123)
   * @param {?string} [account] - The account whose services to count (see
   *   accountCondition()): every account's by default
   * @returns {{ servers: number, vps: number, storage: number, cloud_projects: number }}
   */
  getSummary: (account = null) => {
    const db = getDb();
    const ofAccount = accountCondition(account, 'account');
    const count = (table) => db.prepare(
      `SELECT COUNT(*) as count FROM ${table} WHERE ${ofAccount.sql}`,
    ).get(...ofAccount.params).count;
    return {
      servers: count('dedicated_servers'),
      vps: count('vps_instances'),
      storage: count('storage_services'),
      cloud_projects: count('projects'),
    };
  },

  /**
   * The servers, VPS and storage services that expire within daysAhead days, in one list,
   * soonest first: those already expired stay in it, first (#74). Services that expire on the
   * same day keep the order of the inventories: servers, VPS, then storage; and those of one
   * inventory come by account (accountOrder(), #123), and keep the order of the table.
   *
   * For every account, the services of the accounts that the configuration lists, once an
   * import recorded them (see configuredAccountsCondition()): no import refreshes the services
   * of the Unknown account, nor those of an account no longer configured, which would stay
   * expired for good, ahead of those about to expire. They show with their own account.
   * @param {number} [daysAhead]
   * @param {?string} [account] - The account whose services to list (see accountCondition()):
   *   every configured account's by default
   * @returns {object[]} Each service's id, display name, type, expiration date, and the NIC
   *   handle of its account, null for the Unknown account
   */
  getExpiringServices: (daysAhead = 30, account = null) => {
    const db = getDb();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + daysAhead);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    const ofAccount = account === null
      ? configuredAccountsCondition('account')
      : accountCondition(account, 'account');
    const expiringIn = (table, type) => db.prepare(`
      SELECT id, display_name, '${type}' as type, expiration_date, account FROM ${table}
      WHERE expiration_date IS NOT NULL AND expiration_date <= ? AND ${ofAccount.sql}
      ORDER BY expiration_date, ${accountOrder('account')}
    `).all(cutoffStr, ...ofAccount.params);

    return [
      ...expiringIn('dedicated_servers', 'dedicated_server'),
      ...expiringIn('vps_instances', 'vps'),
      ...expiringIn('storage_services', 'storage'),
    ].sort((a, b) => a.expiration_date.localeCompare(b.expiration_date));
  },

  // Analysis by resource type, on the bills of the account (see accountCondition()), every
  // account's by default (#118). The bill lines without a resource type count as 'other', in
  // the same row as those typed 'other', as the details of that type list them (#86).
  byResourceType: (fromDate, toDate, account = null) => {
    const db = getDb();
    const ofAccount = accountCondition(account, 'b.account');
    return db.prepare(`
      SELECT
        COALESCE(d.resource_type, 'other') as resource_type,
        SUM(d.total_price) as total,
        COUNT(d.id) as details_count,
        COUNT(DISTINCT d.domain) as service_count
      FROM bill_details d
      JOIN bills b ON d.bill_id = b.id
      WHERE b.date >= ? AND b.date <= ?
        AND ${ofAccount.sql}
      GROUP BY COALESCE(d.resource_type, 'other')
      ORDER BY total DESC
    `).all(fromDate, toDate, ...ofAccount.params);
  },

  /**
   * The bill lines of a resource type between two dates, by service (bill `domain` field), on
   * the bills of the account (see accountCondition()), every account's by default (#123). Each
   * row gives the wording of the most expensive of its lines, what they cost and how many they
   * are. One row per service, as before the accounts; or, with byAccount, for the list that
   * names the account of each service, per service and account, with the NIC handle of its
   * account, null for the Unknown account: a service billed to several accounts, such as a
   * server moved from an account to another, then has a row for each, with the wording of its
   * own lines, as a bill line belongs to the account of its bill (ADR 0002).
   *
   * In the order of costGrouping(), as the costs by project (#118).
   * @param {string} resourceType
   * @param {string} fromDate
   * @param {string} toDate
   * @param {?string} [account]
   * @param {object} [options]
   * @param {boolean} [options.byAccount] - Whether to give a row to each service and account
   * @returns {object[]}
   */
  byResourceTypeDetails: (resourceType, fromDate, toDate, account = null,
    { byAccount = false } = {}) => {
    const db = getDb();
    const ofAccount = accountCondition(account, 'b.account');
    const ofLineAccount = accountCondition(account, 'b2.account');
    const grouping = costGrouping('d.domain', byAccount);
    // By account, the wording of the row's account's own lines
    const sameAccount = byAccount ? 'AND b2.account IS b.account' : '';
    return db.prepare(`
      SELECT
        d.domain,
        (SELECT d2.description FROM bill_details d2
         JOIN bills b2 ON d2.bill_id = b2.id
         WHERE d2.domain = d.domain AND COALESCE(d2.resource_type, 'other') = ?
           AND b2.date >= ? AND b2.date <= ?
           AND ${ofLineAccount.sql} ${sameAccount}
         ORDER BY d2.total_price DESC LIMIT 1
        ) as description,
        ROUND(SUM(d.total_price), 2) as total,
        COUNT(d.id) as line_count${grouping.select}
      FROM bill_details d
      JOIN bills b ON d.bill_id = b.id
      WHERE COALESCE(d.resource_type, 'other') = ?
        AND b.date >= ? AND b.date <= ?
        AND ${ofAccount.sql}
      GROUP BY ${grouping.groupBy}
      HAVING total > 0
      ORDER BY ${grouping.orderBy}
    `).all(
      resourceType, fromDate, toDate, ...ofLineAccount.params,
      resourceType, fromDate, toDate, ...ofAccount.params,
    );
  },

  /**
   * The figures of the Public Cloud cards over a period, for the account (see
   * accountCondition()), every account's by default (#121). Each bill line of a Public Cloud
   * project counts in one card, that of its product (data/public-cloud-products.js), and the
   * products without a card of their own in the other services, which name them. With the
   * Public Cloud credit that the bills used, they add up to the cloud total of the period,
   * which adds up the lines of the projects (#145).
   * The counts of volumes, snapshots and buckets are those of the inventory of its projects,
   * as a project's resources belong to its account (ADR 0002), but for the buckets of an
   * inventory that holds none (below); the other counts, those of the bill lines.
   * @param {string} fromDate
   * @param {string} toDate
   * @param {?string} [account]
   * @returns {object}
   */
  getPublicCloudStats: (fromDate, toDate, account = null) => {
    const db = getDb();
    const ofBills = accountCondition(account, 'b.account');
    const ofProjects = accountCondition(account, 'p.account');

    // The bill lines of the projects, by product
    const { figuresOf, others, credits } = productFigures(db.prepare(`
      SELECT d.description, d.domain, d.total_price
      FROM bill_details d
      JOIN bills b ON d.bill_id = b.id
      WHERE b.date >= ? AND b.date <= ?
        AND d.project_id IS NOT NULL
        AND ${ofBills.sql}
    `).all(fromDate, toDate, ...ofBills.params));

    // Count object storage buckets from the imported inventory (buckets that exist
    // right now, including the ones that cost nothing over the period): those of the
    // account's projects. When the inventory holds no bucket by the end of the period,
    // whatever its account, as when it has never been imported, count the buckets that
    // the account's bills name instead. Either way for every account at once, so that a
    // bucket counts once, in one account: its project's, or its bill's.
    const inventoryHoldsBuckets = db.prepare(`
      SELECT EXISTS (
        SELECT 1 FROM object_storage_buckets
        WHERE created_at IS NULL OR SUBSTR(created_at, 1, 10) <= ?
      ) as held
    `).get(toDate).held === 1;
    let s3;
    if (inventoryHoldsBuckets) {
      s3 = db.prepare(`
        SELECT COUNT(*) as count FROM object_storage_buckets o
        LEFT JOIN projects p ON p.id = o.project_id
        WHERE (o.created_at IS NULL OR SUBSTR(o.created_at, 1, 10) <= ?)
          AND ${ofProjects.sql}
      `).get(toDate, ...ofProjects.params);
    } else {
      s3 = db.prepare(`
        SELECT COUNT(*) as count
        FROM (
          SELECT description
          FROM bill_details d
          JOIN bills b ON d.bill_id = b.id
          WHERE b.date >= ? AND b.date <= ?
            AND (
              (LOWER(description) LIKE 'stockage standard - bucket%'
               OR LOWER(description) LIKE 'stockage high performance - bucket%'
               OR LOWER(description) LIKE 'stockage standard infrequent%bucket%')
              AND LOWER(description) NOT LIKE '%bande passante%'
            )
            AND ${ofBills.sql}
          GROUP BY description
        )
      `).get(fromDate, toDate, ...ofBills.params);
    }
    
    const volumeCount = db.prepare(`
      SELECT COUNT(*) as count FROM cloud_volumes v
      LEFT JOIN projects p ON p.id = v.project_id
      WHERE (v.created_at IS NULL OR SUBSTR(v.created_at, 1, 10) <= ?)
        AND ${ofProjects.sql}
    `).get(toDate, ...ofProjects.params);

    const snapshotCount = db.prepare(`
      SELECT COUNT(*) as count FROM cloud_snapshots s
      LEFT JOIN projects p ON p.id = s.project_id
      WHERE (s.created_at IS NULL OR SUBSTR(s.created_at, 1, 10) <= ?)
        AND ${ofProjects.sql}
    `).get(toDate, ...ofProjects.params);

    const card = (product, count) => ({ count, total: figuresOf(product).total });
    return {
      kubernetes: card('kubernetes', figuresOf('kubernetes').services),
      instances: { total: figuresOf('instances').total },
      volumes: card('volumes', volumeCount?.count || 0),
      snapshots: card('snapshots', snapshotCount?.count || 0),
      savingsPlans: card('savingsPlans', figuresOf('savingsPlans').descriptions),
      objectStorage: card('objectStorage', s3?.count || 0),
      registry: card('registry', figuresOf('registry').services),
      other: others,
      // The credit that the bills used, which pays for no product: with the cards, it adds up
      // to the cloud total
      credits: { total: credits },
      aiml: card('ai', figuresOf('ai').services),
      loadBalancers: card('loadBalancers', figuresOf('loadBalancers').services),
    };
  },

  // Backup stats (Veeam etc), on the bills of the account (see accountCondition()), every
  // account's by default: those of the Compare tab's months and of the Backup tab (#119)
  getBackupStats: (fromDate, toDate, account = null) => {
    const db = getDb();
    const ofAccount = accountCondition(account, 'b.account');

    // Count Veeam backup VMs
    const vms = db.prepare(`
      SELECT COUNT(DISTINCT domain) as count, ROUND(SUM(total_price), 2) as total
      FROM bill_details d
      JOIN bills b ON d.bill_id = b.id
      WHERE b.date >= ? AND b.date <= ?
        AND resource_type = 'backup'
        AND ${ofAccount.sql}
    `).get(fromDate, toDate, ...ofAccount.params);

    // Veeam Enterprise licenses (from descriptions)
    const enterprise = db.prepare(`
      SELECT COUNT(DISTINCT domain) as count, ROUND(SUM(total_price), 2) as total
      FROM bill_details d
      JOIN bills b ON d.bill_id = b.id
      WHERE b.date >= ? AND b.date <= ?
        AND (LOWER(description) LIKE '%veeam%' AND LOWER(description) LIKE '%enterprise%')
        AND ${ofAccount.sql}
    `).get(fromDate, toDate, ...ofAccount.params);

    return {
      vms: { count: vms?.count || 0, total: vms?.total || 0 },
      enterprise: { count: enterprise?.count || 0, total: enterprise?.total || 0 }
    };
  },

  clearAll: () => {
    const db = getDb();
    db.exec('DELETE FROM dedicated_servers');
    db.exec('DELETE FROM vps_instances');
    db.exec('DELETE FROM storage_services');
  }
};

/**
 * Normalize a flavor / plan code so a bill wording and an inventory plan code
 * can be compared: "c3-4.consumption.3AZ" and "c3-4-3az" are the same flavor.
 */
function normalizeFlavor(value) {
  return (value || '')
    .toLowerCase()
    .replace(/\.consumption|\.monthly\.postpaid/g, '')
    .replace(/[._]/g, '-');
}

/**
 * Per-instance cost over a period.
 *
 * Two billing modes, handled differently:
 *
 * - monthly instances carry their own UUID in the description ("Forfait mensuel
 *   pour une instance eg-30 (id <uuid>, region gra1)"), so the cost is exact.
 *   So does the prorata of that fee ("Prorata de la facturation mensuelle d'une
 *   instance b2-7 (id <uuid>)").
 * - hourly instances are billed on one aggregated line per flavor (and often
 *   per region): "Consommation à l'heure pour les instances r3-16 gra11". That
 *   line is split evenly across the matching hourly instances and flagged as an
 *   estimate: the API exposes no per-instance runtime to weight it with.
 *
 * A line whose instance is not among the instances of the period ends up in
 * `unmatched`, whatever its billing mode.
 *
 * Compute covered by a savings plan is billed on the plan's own line and is
 * deliberately left out of both: it belongs to the plan, not to an instance.
 *
 * @returns {{costs: Map<string, {total: number, estimated: boolean}>, unmatched: number}}
 */
function computeInstanceCosts(db, projectId, fromDate, toDate) {
  const costs = new Map();
  let unmatched = 0;

  const ofInstanceLines = instanceLineCondition('d.description');
  const lines = db.prepare(`
    SELECT d.description as description, d.total_price as price
    FROM bill_details d
    JOIN bills b ON d.bill_id = b.id
    WHERE d.project_id = ?
      AND b.date >= ? AND b.date <= ?
      AND ${ofInstanceLines.sql}
  `).all(projectId, fromDate, toDate, ...ofInstanceLines.params);

  // An instance created after the period did not run during it, so it takes
  // no share of that period's lines (same rule as the buckets)
  const instances = db.prepare(`
    SELECT id, plan_code, flavor, region, monthly_billing FROM cloud_instances
    WHERE project_id = ?
      AND (created_at IS NULL OR SUBSTR(created_at, 1, 10) <= ?)
  `).all(projectId, toDate);

  const add = (id, price, estimated) => {
    const current = costs.get(id) || { total: 0, estimated: false };
    current.total = Math.round((current.total + price) * 100) / 100;
    current.estimated = current.estimated || estimated;
    costs.set(id, current);
  };

  const hourly = instances.filter(i => !i.monthly_billing);
  const known = new Set(instances.map(i => i.id));

  for (const line of lines) {
    const instanceLine = readInstanceLine(line.description);

    // Monthly fee or its prorata: charged to the instance named by its id
    if (instanceLine?.instanceId) {
      if (known.has(instanceLine.instanceId)) add(instanceLine.instanceId, line.price, false);
      else unmatched += line.price;
      continue;
    }

    // "Consommation à l'heure pour les instances <flavor> [<region>]"
    if (!instanceLine || instanceLine.monthly || !instanceLine.flavor) {
      unmatched += line.price;
      continue;
    }
    const { flavor: named, region: namedRegion } = instanceLine;

    const candidates = [];
    if (namedRegion) {
      const region = namedRegion.toLowerCase();
      const flavor = normalizeFlavor(named);
      candidates.push(...hourly.filter(i =>
        (i.region || '').toLowerCase() === region &&
        (normalizeFlavor(i.plan_code) === flavor || normalizeFlavor(i.flavor) === flavor)
      ));
    }
    // Or the last word was part of the flavor, which the line names without a region
    if (!candidates.length) {
      const flavor = normalizeFlavor(namedRegion ? `${named}-${namedRegion}` : named);
      candidates.push(...hourly.filter(i =>
        normalizeFlavor(i.plan_code) === flavor || normalizeFlavor(i.flavor) === flavor
      ));
    }

    if (!candidates.length) { unmatched += line.price; continue; }

    // No runtime available per instance, so split the line evenly. The rounding
    // residual goes to the first one so the column still adds up to the bill.
    const share = Math.round((line.price / candidates.length) * 100) / 100;
    candidates.forEach(i => add(i.id, share, true));
    const residual = Math.round((line.price - share * candidates.length) * 100) / 100;
    if (residual !== 0) add(candidates[0].id, residual, true);
  }

  return { costs, unmatched: Math.round(unmatched * 100) / 100 };
}

/**
 * Spread an aggregated bill amount over rows, pro rata of a weight.
 *
 * Several OVH lines are billed per region (and per type) with no per-resource
 * breakdown: Cold Archive storage, extra disks, snapshots. Every unit inside
 * such a line is charged at the same rate, so splitting on the resource size is
 * exact up to intra-month changes. Rows that receive a share are flagged
 * `allocated` so the UI can show the amount as an estimate.
 *
 * The rounding residual goes to the heaviest row, so the rows always add up to
 * the billed amount.
 *
 * @param {Array<Object>} rows    mutated in place: `total` and `allocated`
 * @param {number} total          amount to spread
 * @param {Function} weightOf     row -> weight (0 or less excludes the row)
 * @returns {boolean}             false when nothing could be spread (no weight,
 *                                or a credit note, which is never spread): the
 *                                caller keeps the line on a row of its own
 */
function allocateProRata(rows, total, weightOf) {
  if (!total) return true;
  if (total < 0) return false;

  const eligible = rows.filter(r => weightOf(r) > 0);
  const totalWeight = eligible.reduce((sum, r) => sum + weightOf(r), 0);
  if (!totalWeight) return false;

  let distributed = 0;
  for (const row of eligible) {
    const share = Math.round(total * (weightOf(row) / totalWeight) * 100) / 100;
    row.total = Math.round(((row.total || 0) + share) * 100) / 100;
    row.allocated = true;
    distributed += share;
  }

  const residual = Math.round((total - distributed) * 100) / 100;
  if (residual !== 0) {
    const heaviest = eligible.reduce((a, b) => (weightOf(b) > weightOf(a) ? b : a));
    heaviest.total = Math.round((heaviest.total + residual) * 100) / 100;
  }
  return true;
}

/**
 * Spread the aggregated "Stockage Cold Archive" bill line over the archived
 * buckets, pro rata of their stored volume.
 *
 * OVH bills archived buckets on a single line that carries no bucket name, so
 * there is no exact per-bucket figure to read. Every archived byte is charged
 * at the same rate, which makes the volume split accurate up to intra-month
 * volume changes. Buckets that are still archiving keep their own named line
 * for the part that has not moved to the archive tier yet, so they are left
 * out of the split even though a fraction of their data is already archived.
 *
 * Rows that receive a share are flagged `allocated` so the UI can show the
 * amount as an estimate rather than a billed figure.
 */
function allocateColdArchive(db, rows, projectId, fromDate, toDate) {
  const coldArchive = db.prepare(`
    SELECT ROUND(SUM(d.total_price), 2) as total
    FROM bill_details d
    JOIN bills b ON d.bill_id = b.id
    WHERE d.project_id = ?
      AND b.date >= ? AND b.date <= ?
      AND LOWER(d.description) LIKE 'stockage cold archive%'
  `).get(projectId, fromDate, toDate);

  const coldArchiveTotal = coldArchive?.total || 0;
  if (!coldArchiveTotal) return;

  const archived = rows.filter(r => r.status === 'archived' && r.objects_size > 0);
  const archivedSize = archived.reduce((sum, r) => sum + r.objects_size, 0);

  // No inventory to spread it over, or a credit note (never spread): keep the
  // bill line visible on its own row so the panel total still matches the bill.
  if (!archivedSize || coldArchiveTotal < 0) {
    rows.push({
      name: 'Stockage Cold Archive',
      region: null,
      storage_class: 'Cold Archive',
      status: null,
      objects_count: null,
      objects_size: null,
      created_at: null,
      total: coldArchiveTotal,
      in_inventory: 0,
      allocated: true
    });
    return;
  }

  allocateProRata(archived, coldArchiveTotal, r => r.objects_size);
}

/**
 * Spread the aggregated "Public Cloud Archive (region gra)" bill lines over the
 * Swift containers of that region, pro rata of their stored volume.
 *
 * Same shape as Cold Archive: the line carries a region, never a container
 * name. Verified on a live account: the billed quantity divided by the hours in
 * the month equals the summed container size to the GiB.
 */
function allocateSwiftArchive(db, rows, projectId, fromDate, toDate) {
  const lines = db.prepare(`
    SELECT d.description as description, ROUND(SUM(d.total_price), 2) as total
    FROM bill_details d
    JOIN bills b ON d.bill_id = b.id
    WHERE d.project_id = ?
      AND b.date >= ? AND b.date <= ?
      AND LOWER(d.description) LIKE 'public cloud archive (region%'
    GROUP BY d.description
  `).all(projectId, fromDate, toDate);

  for (const line of lines) {
    const region = (line.description.match(/region\s+([^)]+)\)/i)?.[1] || '').trim().toLowerCase();
    const matching = rows.filter(r =>
      r.storage_class === 'Public Cloud Archive' &&
      (r.region || '').toLowerCase() === region &&
      r.objects_size > 0
    );
    if (!allocateProRata(matching, line.total, r => r.objects_size)) {
      rows.push({
        name: line.description,
        region: region || null,
        storage_class: 'Public Cloud Archive',
        status: null,
        objects_count: null,
        objects_size: null,
        created_at: null,
        total: line.total,
        in_inventory: 0,
        allocated: true
      });
    }
  }
}

/**
 * The bill lines of a Public Cloud project over a period, as productFigures() reads them: those
 * of the bills of the account (see accountCondition()), every account's by default.
 * @param {string} projectId
 * @param {string} fromDate
 * @param {string} toDate
 * @param {?string} [account]
 * @returns {{description: ?string, domain: ?string, total_price: number}[]}
 */
function projectBillLines(projectId, fromDate, toDate, account = null) {
  const ofAccount = accountCondition(account, 'b.account');
  return getDb().prepare(`
    SELECT d.description, d.domain, d.total_price
    FROM bill_details d
    JOIN bills b ON d.bill_id = b.id
    WHERE d.project_id = ? AND b.date >= ? AND b.date <= ?
      AND ${ofAccount.sql}
  `).all(projectId, fromDate, toDate, ...ofAccount.params);
}

// Cloud detail operations (Phase 4)
const cloudDetailOps = {
  /**
   * The month of the current consumption, which the readers show when no month is asked for:
   * the month that the last import of the consumption covered, even with no usage yet. The
   * consumption of every month is kept (#54). Each account records its own (#114): an
   * account's is its own, which its current consumption reads (#116), or, when its imports
   * recorded none, such as those before #114, which recorded it without the account, the
   * latest recorded. That of every account is the latest of theirs, which the readers of the
   * consumption of projects read.
   * @param {?string} [account] - The account (see accountCondition()): every account by
   *   default
   * @returns {?string} Its first day, YYYY-MM-01; before any import records a month, the
   *   latest month stored of the account's projects; null when there is none
   */
  getCurrentConsumptionMonth: (account = null) => {
    const db = getDb();
    // The latest month recorded for an account (see accountCondition())
    const recordedFor = (whose) => {
      const { sql, params } = accountCondition(whose, 'account');
      return db.prepare(`
        SELECT MAX(value) AS month FROM import_state WHERE key = 'consumption_month' AND ${sql}
      `).get(...params).month;
    };
    // An account whose imports recorded none reads the latest of every account's
    const recorded = recordedFor(account) || (account === null ? null : recordedFor(null));
    if (recorded) return recorded;
    const ofProjects = accountCondition(account, 'p.account');
    return db.prepare(`
      SELECT MAX(c.period_start) as month
      FROM project_consumption c LEFT JOIN projects p ON p.id = c.project_id
      WHERE ${ofProjects.sql}
    `).get(...ofProjects.params).month;
  },

  /**
   * Records the month that an import of an account's project consumption covered.
   * @param {string} periodStart - Its first day, YYYY-MM-01
   * @param {string} account - The NIC handle of the account
   */
  setCurrentConsumptionMonth: (periodStart, account) => {
    const db = getDb();
    db.prepare(`
      INSERT INTO import_state (key, value, updated_at, account)
      VALUES ('consumption_month', @periodStart, CURRENT_TIMESTAMP, @account)
      ON CONFLICT(key, account) DO UPDATE SET
        value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).run(requireAccount('import_state', { periodStart, account }));
  },

  insertConsumption: (entry) => {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO project_consumption (project_id, period_start, period_end, resource_type, resource_id, resource_name, quantity, unit, unit_price, total_price, region, imported_at)
      VALUES (@project_id, @period_start, @period_end, @resource_type, @resource_id, @resource_name, @quantity, @unit, @unit_price, @total_price, @region, CURRENT_TIMESTAMP)
    `);
    return stmt.run(entry);
  },

  getConsumptionByProject: (projectId, fromDate, toDate) => {
    const db = getDb();
    let query = 'SELECT * FROM project_consumption WHERE project_id = ?';
    const params = [projectId];
    if (fromDate && toDate) {
      query += ' AND period_start >= ? AND period_end <= ?';
      params.push(fromDate, toDate);
    } else {
      query += ' AND period_start = ?';
      params.push(cloudDetailOps.getCurrentConsumptionMonth());
    }
    query += ' ORDER BY period_start DESC';
    return db.prepare(query).all(...params);
  },

  getConsumptionByResourceType: (projectId) => {
    const db = getDb();
    return db.prepare(`
      SELECT resource_type, SUM(total_price) as total, COUNT(*) as count
      FROM project_consumption
      WHERE project_id = ? AND period_start = ?
      GROUP BY resource_type
      ORDER BY total DESC
    `).all(projectId, cloudDetailOps.getCurrentConsumptionMonth());
  },

  upsertInstance: (instance) => {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO cloud_instances (id, project_id, name, flavor, plan_code, region, status, created_at, monthly_billing, imported_at)
      VALUES (@id, @project_id, @name, @flavor, @plan_code, @region, @status, @created_at, @monthly_billing, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        name = @name, flavor = @flavor, plan_code = @plan_code, region = @region, status = @status,
        monthly_billing = @monthly_billing, imported_at = CURRENT_TIMESTAMP
    `);
    return stmt.run({ plan_code: null, ...instance });
  },

  // Instances of a project. With a period, each one carries its billed cost;
  // `cost_estimated` marks the ones whose cost is a share of an aggregated
  // hourly line rather than a figure billed under their own id.
  getInstancesByProject: (projectId, fromDate, toDate) => {
    const db = getDb();
    const instances = db.prepare(
      'SELECT * FROM cloud_instances WHERE project_id = ? ORDER BY name'
    ).all(projectId);

    if (!fromDate || !toDate) return instances;

    const { costs, unmatched } = computeInstanceCosts(db, projectId, fromDate, toDate);
    const rows = instances.map(i => {
      const cost = costs.get(i.id);
      return {
        ...i,
        // null, not 0: no billed line at all is not the same as costing nothing
        total: cost ? cost.total : null,
        cost_estimated: cost ? cost.estimated : false
      };
    });

    // Lines whose instances are gone from the inventory: kept on a row of
    // their own, flagged `unallocated`, so the column still adds up
    if (unmatched !== 0) {
      rows.push({ id: null, name: null, total: unmatched, cost_estimated: false, unallocated: true });
    }
    return rows;
  },

  insertQuota: (quota) => {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO project_quotas (project_id, region, max_cores, max_instances, max_ram_mb, used_cores, used_instances, used_ram_mb, snapshot_date)
      VALUES (@project_id, @region, @max_cores, @max_instances, @max_ram_mb, @used_cores, @used_instances, @used_ram_mb, CURRENT_TIMESTAMP)
    `);
    return stmt.run(quota);
  },

  getQuotasByProject: (projectId) => {
    const db = getDb();
    return db.prepare(`
      SELECT * FROM project_quotas WHERE project_id = ?
      AND snapshot_date = (SELECT MAX(snapshot_date) FROM project_quotas WHERE project_id = ?)
      ORDER BY region
    `).all(projectId, projectId);
  },

  // Get bucket details for a project.
  //
  // The list comes from the imported inventory (object_storage_buckets), so a
  // bucket with no cost over the period is still returned. Costs come from the
  // bill lines, matched on the bucket name + region parsed out of the French
  // description ("Stockage Standard - Bucket mybucket sur la région gra").
  // Buckets that are billed but absent from the inventory (deleted, or
  // inventory never imported) are appended with in_inventory = 0.
  //
  // The class only comes from the inventory: OVH writes "Stockage Standard" on
  // these lines whatever the class, so an unknown class stays null.
  getBucketsByProject: (projectId, fromDate, toDate) => {
    const db = getDb();

    // A bucket created after the period did not exist then, so it must not show
    // up on an older month. Compare on the date part only, the inventory stores
    // a full ISO timestamp. A bucket billed over the period but filtered out
    // here still surfaces through the "billed but not in inventory" path below.
    const inventory = db.prepare(`
      SELECT name, region, storage_class, status, objects_count, objects_size, created_at
      FROM object_storage_buckets
      WHERE project_id = ?
        AND (created_at IS NULL OR SUBSTR(created_at, 1, 10) <= ?)
    `).all(projectId, toDate);

    // ' sur la région ' is 15 characters, '- Bucket ' is 9
    const costs = db.prepare(`
      WITH bucket_lines AS (
        SELECT
          SUBSTR(d.description, INSTR(d.description, '- Bucket ') + 9) as tail,
          d.total_price as price
        FROM bill_details d
        JOIN bills b ON d.bill_id = b.id
        WHERE d.project_id = ?
          AND b.date >= ? AND b.date <= ?
          AND d.description LIKE '%- Bucket %'
      )
      SELECT
        CASE WHEN INSTR(tail, ' sur la région ') > 0
             THEN SUBSTR(tail, 1, INSTR(tail, ' sur la région ') - 1)
             ELSE TRIM(tail) END as name,
        CASE WHEN INSTR(tail, ' sur la région ') > 0
             THEN TRIM(SUBSTR(tail, INSTR(tail, ' sur la région ') + 15))
             ELSE '' END as region,
        ROUND(SUM(price), 2) as total
      FROM bucket_lines
      GROUP BY name, region
    `).all(projectId, fromDate, toDate);

    const key = (name, region) => `${(name || '').toLowerCase()}|${(region || '').toLowerCase()}`;
    const costByBucket = new Map(costs.map(c => [key(c.name, c.region), c]));

    const rows = inventory.map(b => {
      const cost = costByBucket.get(key(b.name, b.region));
      if (cost) costByBucket.delete(key(b.name, b.region));
      return {
        name: b.name,
        region: b.region,
        storage_class: storageClassLabel(b.storage_class),
        status: b.status,
        objects_count: b.objects_count,
        objects_size: b.objects_size,
        created_at: b.created_at,
        total: cost?.total || 0,
        in_inventory: 1,
        allocated: false
      };
    });

    // Billed but not in the inventory: deleted buckets, or inventory not imported yet.
    // 'NoSuchBucket_error' is an OVH placeholder on bandwidth lines, not a bucket.
    for (const cost of costByBucket.values()) {
      if (!cost.name || cost.name === 'NoSuchBucket_error') continue;
      rows.push({
        name: cost.name,
        region: cost.region,
        storage_class: null,
        status: null,
        objects_count: null,
        objects_size: null,
        created_at: null,
        total: cost.total,
        in_inventory: 0,
        allocated: false
      });
    }

    allocateColdArchive(db, rows, projectId, fromDate, toDate);
    allocateSwiftArchive(db, rows, projectId, fromDate, toDate);

    return rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  },

  // Get instance consumption total for a project
  getInstanceTotalByProject: (projectId, fromDate, toDate) => {
    const db = getDb();
    return db.prepare(`
      SELECT ROUND(SUM(total_price), 2) as total
      FROM bill_details d
      JOIN bills b ON d.bill_id = b.id
      WHERE d.project_id = ?
        AND b.date >= ? AND b.date <= ?
        AND (
          LOWER(description) LIKE '%instance%'
          OR LOWER(description) LIKE '%forfait mensuel%'
          OR LOWER(description) LIKE '%prorata%'
        )
        -- "Savings plan ... pour 3 instance(s) c3-4" matches '%instance%' but is
        -- prepaid compute, not an instance line: it belongs to the savings plan
        -- panel and would otherwise double-count against the per-instance costs.
        AND LOWER(description) NOT LIKE 'savings plan%'
    `).get(projectId, fromDate, toDate);
  },

  upsertVolume: (volume) => {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO cloud_volumes (id, project_id, name, region, type, size_gb, status, bootable, attached_to, plan_code, created_at, imported_at)
      VALUES (@id, @project_id, @name, @region, @type, @size_gb, @status, @bootable, @attached_to, @plan_code, @created_at, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        name = @name, region = @region, type = @type, size_gb = @size_gb, status = @status,
        bootable = @bootable, attached_to = @attached_to, plan_code = @plan_code,
        created_at = @created_at, imported_at = CURRENT_TIMESTAMP
    `);
    return stmt.run(volume);
  },

  upsertSnapshot: (snapshot) => {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO cloud_snapshots (id, project_id, name, region, size_gb, status, visibility, os_type, created_at, imported_at)
      VALUES (@id, @project_id, @name, @region, @size_gb, @status, @visibility, @os_type, @created_at, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        name = @name, region = @region, size_gb = @size_gb, status = @status,
        visibility = @visibility, os_type = @os_type, created_at = @created_at,
        imported_at = CURRENT_TIMESTAMP
    `);
    return stmt.run(snapshot);
  },

  clearVolumesByProject: (projectId) => {
    getDb().prepare('DELETE FROM cloud_volumes WHERE project_id = ?').run(projectId);
  },

  clearSnapshotsByProject: (projectId) => {
    getDb().prepare('DELETE FROM cloud_snapshots WHERE project_id = ?').run(projectId);
  },

  /**
   * Volumes of a project with their cost.
   *
   * OVH bills extra disks per region and per type ("Disques supplémentaires à
   * gra5 de type classic"), never per volume, so each line is spread over the
   * volumes of that region and type pro rata of their size. Verified against a
   * live account: the billed quantity divided by the hours in the month equals
   * the summed volume size to the GB.
   */
  getVolumesByProject: (projectId, fromDate, toDate) => {
    const db = getDb();
    const volumes = db.prepare(`
      SELECT id, name, region, type, size_gb, status, bootable, attached_to, created_at
      FROM cloud_volumes
      WHERE project_id = ?
        AND (created_at IS NULL OR SUBSTR(created_at, 1, 10) <= ?)
    `).all(projectId, toDate).map(v => ({ ...v, total: 0, allocated: false }));

    const lines = db.prepare(`
      SELECT d.description as description, ROUND(SUM(d.total_price), 2) as total
      FROM bill_details d
      JOIN bills b ON d.bill_id = b.id
      WHERE d.project_id = ?
        AND b.date >= ? AND b.date <= ?
        AND d.description LIKE 'Disques supplémentaires%'
      GROUP BY d.description
    `).all(projectId, fromDate, toDate);

    for (const line of lines) {
      // "Disques supplémentaires à <region> de type <type>"
      const volume = readVolumeLine(line.description);
      const region = (volume?.region || '').toLowerCase();
      const type = (volume?.type || '').toLowerCase();
      const matching = volumes.filter(v =>
        (v.region || '').toLowerCase() === region && (v.type || '').toLowerCase() === type
      );
      if (!allocateProRata(matching, line.total, v => v.size_gb)) {
        volumes.push({
          id: null, name: line.description, region: volume?.region || null,
          type: volume?.type || null,
          size_gb: null, status: null, bootable: 0, attached_to: null, created_at: null,
          total: line.total, allocated: true, in_inventory: 0
        });
      }
    }

    return volumes.sort((a, b) => b.total - a.total || (a.name || '').localeCompare(b.name || ''));
  },

  /**
   * Snapshots of a project with their cost. Same aggregation as volumes, but
   * billed per region only ("Snapshots Public Cloud - gra1").
   */
  getSnapshotsByProject: (projectId, fromDate, toDate) => {
    const db = getDb();
    const snapshots = db.prepare(`
      SELECT id, name, region, size_gb, status, visibility, os_type, created_at
      FROM cloud_snapshots
      WHERE project_id = ?
        AND (created_at IS NULL OR SUBSTR(created_at, 1, 10) <= ?)
    `).all(projectId, toDate).map(s => ({ ...s, total: 0, allocated: false }));

    const lines = db.prepare(`
      SELECT d.description as description, ROUND(SUM(d.total_price), 2) as total
      FROM bill_details d
      JOIN bills b ON d.bill_id = b.id
      WHERE d.project_id = ?
        AND b.date >= ? AND b.date <= ?
        AND d.description LIKE 'Snapshots Public Cloud%'
      GROUP BY d.description
    `).all(projectId, fromDate, toDate);

    for (const line of lines) {
      // Split on the " - " separator only: 3-AZ regions have dashes of their
      // own ("Snapshots Public Cloud - eu-west-par")
      const region = (line.description.split(' - ').pop() || '').trim().toLowerCase();
      const matching = snapshots.filter(s => (s.region || '').toLowerCase() === region);
      if (!allocateProRata(matching, line.total, s => s.size_gb)) {
        snapshots.push({
          id: null, name: line.description, region: region || null, size_gb: null,
          status: null, visibility: null, os_type: null, created_at: null,
          total: line.total, allocated: true, in_inventory: 0
        });
      }
    }

    return snapshots.sort((a, b) => b.total - a.total || (a.name || '').localeCompare(b.name || ''));
  },

  /**
   * The products of a Public Cloud project over a period that its detail shows no section of
   * its own for, such as its registry, its databases or its load balancers, each with its
   * cost, the most expensive first, and the Public Cloud credit that its bills used (#145).
   * The detail lists the instances, buckets, volumes, snapshots and savings plans itself.
   * @param {string} projectId
   * @param {string} fromDate
   * @param {string} toDate
   * @returns {{total: number, products: {product: string, total: number}[], credits: number}}
   */
  getOtherServicesByProject: (projectId, fromDate, toDate) => {
    const { others, credits } = productFigures(projectBillLines(projectId, fromDate, toDate),
      ['instances', 'objectStorage', 'volumes', 'snapshots', 'savingsPlans']);
    return { ...others, credits };
  },

  /**
   * Every Public Cloud product of a project over a period, from its bills, each with its cost
   * and its charges, the most expensive first, and the Public Cloud credit that the bills used,
   * which has none (#181, #195): what the Compare tab compares for a project, month by month,
   * and unfolds each product into. With the credit, the products add up to the project's cost
   * in analysis.byProject(), for the same account.
   * @param {string} projectId
   * @param {string} fromDate
   * @param {string} toDate
   * @param {?string} [account] - The account whose bills count (see accountCondition()): every
   *   account's by default. A project's bill lines belong to the account of their bill, which
   *   may not be the project's own, as for a project moved to another account (ADR 0002).
   * @returns {{total: number, products: {product: string, total: number, charges: {charge:
   *   string, total: number}[]}[], credits: number}} Each product's charges as productFigures()
   *   gives them: what their lines add up to, to the cent, the most expensive first, those at
   *   0 € left out
   */
  getProductsByProject: (projectId, fromDate, toDate, account = null) => {
    // No product set apart, so that the products that productFigures() names `others` are
    // every one of them, the credit aside
    const { figuresOf, others: everyProduct, credits } = productFigures(
      projectBillLines(projectId, fromDate, toDate, account), [],
    );
    return {
      ...everyProduct,
      products: everyProduct.products.map((entry) => ({
        ...entry, charges: figuresOf(entry.product).charges,
      })),
      credits,
    };
  },

  /**
   * Savings plans of a project, read from the bills.
   *
   * There is no savings plan route under /cloud/project in the v6 API, but the
   * bill line carries everything worth showing:
   *   "Savings plan (id : savings-plan-3xc3-4_node_k8s) pour 3 instance(s) c3-4 - Durée : 1M"
   *
   * `covered` is how many instances the plan pays for, `flavor_covered` the
   * same summed over every plan of that flavor, and `inventory` how many
   * instances of that flavor actually exist. Coverage is read per flavor:
   * plans paying for more than what runs is money burnt, fewer means the
   * surplus is billed at the hourly rate.
   */
  getSavingsPlansByProject: (projectId, fromDate, toDate) => {
    const db = getDb();
    const lines = db.prepare(`
      SELECT d.description as description,
             ROUND(SUM(d.total_price), 2) as total,
             COUNT(*) as months,
             MIN(b.date) as first_date,
             MAX(b.date) as last_date
      FROM bill_details d
      JOIN bills b ON d.bill_id = b.id
      WHERE d.project_id = ?
        AND b.date >= ? AND b.date <= ?
        AND d.description LIKE 'Savings plan%'
      GROUP BY d.description
    `).all(projectId, fromDate, toDate);

    const instances = db.prepare(
      'SELECT plan_code, flavor FROM cloud_instances WHERE project_id = ?'
    ).all(projectId);

    const plans = lines.map(line => {
      const id = line.description.match(/\(id\s*:\s*([^)]+)\)/i)?.[1]?.trim() || null;
      const covered = parseInt(line.description.match(/pour\s+(\d+)\s+instance/i)?.[1] || '0', 10);
      const flavor = line.description.match(/instance\(s\)\s+(\S+)/i)?.[1] || null;
      const duration = line.description.match(/Durée\s*:\s*(\S+)/i)?.[1] || null;
      const normalized = normalizeFlavor(flavor);
      const inventory = normalized
        ? instances.filter(i => normalizeFlavor(i.plan_code) === normalized || normalizeFlavor(i.flavor) === normalized).length
        : null;

      return {
        id,
        flavor,
        duration,
        covered,
        inventory,
        months: line.months,
        first_date: line.first_date,
        last_date: line.last_date,
        total: line.total
      };
    });

    // Two plans of 3 and 2 c3-4 over 4 running c3-4 each look fine on their
    // own: only their sum shows the over-coverage
    const coveredByFlavor = new Map();
    for (const plan of plans) {
      const key = normalizeFlavor(plan.flavor);
      if (key) coveredByFlavor.set(key, (coveredByFlavor.get(key) || 0) + plan.covered);
    }

    return plans
      .map(plan => ({ ...plan, flavor_covered: coveredByFlavor.get(normalizeFlavor(plan.flavor)) ?? null }))
      .sort((a, b) => b.total - a.total);
  },

  upsertBucket: (bucket) => {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO object_storage_buckets (id, project_id, name, region, storage_class, status, objects_count, objects_size, created_at, imported_at)
      VALUES (@id, @project_id, @name, @region, @storage_class, @status, @objects_count, @objects_size, @created_at, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        name = @name, region = @region, storage_class = @storage_class, status = @status,
        objects_count = @objects_count, objects_size = @objects_size, created_at = @created_at,
        imported_at = CURRENT_TIMESTAMP
    `);
    return stmt.run(bucket);
  },

  clearBucketsByProject: (projectId) => {
    const db = getDb();
    db.prepare('DELETE FROM object_storage_buckets WHERE project_id = ?').run(projectId);
  },

  // A project's instances and quotas: inventories, which each import replaces
  clearProjectInventory: (projectId) => {
    const db = getDb();
    db.prepare('DELETE FROM cloud_instances WHERE project_id = ?').run(projectId);
    db.prepare('DELETE FROM project_quotas WHERE project_id = ?').run(projectId);
  },

  // A project's consumption of the month that starts on `periodStart` (YYYY-MM-01). The
  // consumption is kept month by month: an import replaces the month it imports only (#54)
  clearConsumptionOfMonth: (projectId, periodStart) => {
    const db = getDb();
    db.prepare('DELETE FROM project_consumption WHERE project_id = ? AND period_start = ?')
      .run(projectId, periodStart);
  },

  /**
   * What the Public Cloud projects of an account consumed in the month of its current
   * consumption (#116; see getCurrentConsumptionMonth())
   * @param {string} account - The account (see accountCondition()): a NIC handle, or
   *   UNKNOWN_ACCOUNT
   * @returns {{ period_start: ?string, period_end: ?string, total: ?number,
   *   monthly_total: ?number, project_count: number }} The period from the earliest start to
   *   the latest end of their consumption, its total, the part of it that OVH gives for the
   *   whole month (#145), and the number of projects that it covers
   */
  getConsumptionSummary: (account) => {
    const ofAccount = accountCondition(account, 'p.account');
    const monthly = MONTHLY_KINDS.map(() => '?').join(', ');
    return getDb().prepare(`
      SELECT
        MIN(c.period_start) as period_start,
        MAX(c.period_end) as period_end,
        SUM(c.total_price) as total,
        SUM(CASE WHEN c.resource_type IN (${monthly}) THEN c.total_price ELSE 0 END)
          as monthly_total,
        COUNT(DISTINCT c.project_id) as project_count
      FROM project_consumption c LEFT JOIN projects p ON p.id = c.project_id
      WHERE c.period_start = ? AND ${ofAccount.sql}
    `).get(...MONTHLY_KINDS, cloudDetailOps.getCurrentConsumptionMonth(account),
      ...ofAccount.params);
  },

  // GPU cost summary from bill_details (covers full history) + project_consumption (current
  // month), on the bills of the account (see accountCondition()), every account's by default
  // (#120). The projects come once each, or, with byAccount, once for each account that billed
  // them, with that account, as those of analysis.byProject() do (#118).
  getGpuSummary: (from, to, account = null, { byAccount = false } = {}) => {
    const db = getDb();

    // GPU detection in bill_details.description
    const GPU_DESC_WHERE = `(
      bd.description LIKE '%instances l4-%'
      OR bd.description LIKE '%instance l4-%'
      OR bd.description LIKE '%instances l40s-%'
      OR bd.description LIKE '%instance l40s-%'
      OR bd.description LIKE '%instances a100-%'
      OR bd.description LIKE '%instance a100-%'
      OR bd.description LIKE '%instances h100-%'
      OR bd.description LIKE '%instance h100-%'
      OR bd.description LIKE '%instances v100-%'
      OR bd.description LIKE '%instance v100-%'
      OR bd.description LIKE '%instances t1-%'
      OR bd.description LIKE '%instance t1-%'
      OR bd.description LIKE '%instances t2-%'
      OR bd.description LIKE '%instance t2-%'
    )`;

    // GPU model extraction from description
    const GPU_MODEL_CASE = `
      CASE
        WHEN bd.description LIKE '%l4-%' AND bd.description NOT LIKE '%l40s-%' THEN 'NVIDIA L4'
        WHEN bd.description LIKE '%l40s-%' THEN 'NVIDIA L40S'
        WHEN bd.description LIKE '%a100-%' THEN 'NVIDIA A100'
        WHEN bd.description LIKE '%h100-%' THEN 'NVIDIA H100'
        WHEN bd.description LIKE '%v100-%' THEN 'NVIDIA V100'
        WHEN bd.description LIKE '%t1-%' THEN 'NVIDIA T4'
        WHEN bd.description LIKE '%t2-%' THEN 'NVIDIA T4'
        ELSE 'GPU'
      END`;

    // The GPU lines of the bills of the account (see accountCondition()), between the dates
    // when they are given: the condition of every query below, and its arguments
    const ofAccount = accountCondition(account, 'b.account');
    const conditions = [GPU_DESC_WHERE, ofAccount.sql];
    const args = [...ofAccount.params];
    if (from) { conditions.push('b.date >= ?'); args.push(from); }
    if (to) { conditions.push('b.date <= ?'); args.push(to); }
    const where = conditions.join(' AND ');

    // Total GPU cost from bills
    const total = db.prepare(`
      SELECT SUM(bd.total_price) as total, COUNT(DISTINCT bd.domain) as project_count
      FROM bill_details bd
      JOIN bills b ON bd.bill_id = b.id
      WHERE ${where}
    `).get(...args);

    // By GPU model from bills
    const byModel = db.prepare(`
      SELECT
        ${GPU_MODEL_CASE} as gpu_model,
        SUM(bd.total_price) as total,
        COUNT(*) as count
      FROM bill_details bd
      JOIN bills b ON bd.bill_id = b.id
      WHERE ${where}
      GROUP BY gpu_model
      ORDER BY total DESC
    `).all(...args);

    // By project from bills, and by account when asked (see costGrouping(), #118)
    const grouping = costGrouping('bd.domain', byAccount);
    const byProject = db.prepare(`
      SELECT
        COALESCE(p.name, bd.domain) as project_name,
        bd.domain as project_id,
        SUM(bd.total_price) as total${grouping.select}
      FROM bill_details bd
      JOIN bills b ON bd.bill_id = b.id
      LEFT JOIN projects p ON bd.domain = p.id
      WHERE ${where}
      GROUP BY ${grouping.groupBy}
      ORDER BY ${grouping.orderBy}
    `).all(...args);

    // Get GPU flavors per project from project_consumption (current month detail): those of
    // its instances, whose name is their flavor, as a bucket may be named like one (#145)
    const projectFlavors = db.prepare(`
      SELECT project_id, GROUP_CONCAT(DISTINCT resource_name) as gpu_flavors
      FROM project_consumption
      WHERE period_start = ?
        AND resource_type IN ('instance', 'instance_monthly')
        AND (resource_name LIKE 'l4-%' OR resource_name LIKE 'l40s-%'
        OR resource_name LIKE 'a100-%' OR resource_name LIKE 't1-%'
        OR resource_name LIKE 't2-%' OR resource_name LIKE 'h100-%'
        OR resource_name LIKE 'v100-%')
      GROUP BY project_id
    `).all(cloudDetailOps.getCurrentConsumptionMonth());
    const flavorMap = {};
    for (const pf of projectFlavors) { flavorMap[pf.project_id] = pf.gpu_flavors; }

    // Enrich byProject with flavor info
    for (const p of byProject) {
      p.gpu_flavors = flavorMap[p.project_id] || '';
    }

    // Monthly trend from bills
    const monthlyTrend = db.prepare(`
      SELECT
        strftime('%Y-%m', b.date) as month,
        SUM(bd.total_price) as total
      FROM bill_details bd
      JOIN bills b ON bd.bill_id = b.id
      WHERE ${where}
      GROUP BY month
      ORDER BY month
    `).all(...args);

    return {
      total: total?.total || 0,
      project_count: total?.project_count || 0,
      byModel,
      byProject,
      monthlyTrend
    };
  },

  // GPU instances from cloud_instances (uses plan_code), of the projects of the account (see
  // accountCondition()), every account's by default (#120)
  getGpuInstances: (account = null) => {
    const db = getDb();
    const ofAccount = accountCondition(account, 'p.account');
    return db.prepare(`
      SELECT ci.*, p.name as project_name
      FROM cloud_instances ci
      JOIN projects p ON ci.project_id = p.id
      WHERE (ci.plan_code LIKE 'l4-%' OR ci.plan_code LIKE 'l40s-%'
        OR ci.plan_code LIKE 'a100-%' OR ci.plan_code LIKE 't1-%'
        OR ci.plan_code LIKE 't2-%' OR ci.plan_code LIKE 'h100-%'
        OR ci.plan_code LIKE 'v100-%')
        AND ${ofAccount.sql}
      ORDER BY p.name, ci.name
    `).all(...ofAccount.params);
  }
};

/**
 * Execute a function within a database transaction
 * @param {Function} fn - Function to execute (receives db as parameter)
 * @returns {*} Result of the function
 */
function transaction(fn) {
  const database = getDb();
  return database.transaction(fn)(database);
}

// Orders two rows' accounts, NIC handles or null for the Unknown account: by NIC handle, the
// Unknown account last, and the same account as equal
function compareAccounts(a, b) {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a.localeCompare(b);
}

/**
 * Web Cloud operations (domains, DNS zones, hosting, email, options).
 *
 * Read entirely from the bills: the /domain, /hosting/web and /email/* routes
 * are usually not granted to the consumer key this project asks for, so there
 * is no inventory to join against. Candidates are the lines that already fall
 * outside Public Cloud, dedicated servers and private cloud, then
 * classifyWebCloud() sorts them by family from the wording.
 */
const webCloudOps = {
  /**
   * One row per service (bill `domain` field) with its family and cost, and the account whose
   * bills billed it: its NIC handle, null for the Unknown account.
   * @param {string} fromDate
   * @param {string} toDate
   * @param {?string} [account] - The account whose bills count (see accountCondition()):
   *   every account's by default
   */
  getItems: (fromDate, toDate, account = null) => {
    const db = getDb();
    const ofAccount = accountCondition(account, 'b.account');
    const rows = db.prepare(`
      SELECT d.domain as domain,
             d.description as description,
             d.total_price as price,
             b.date as date,
             b.account as account,
             COALESCE(d.resource_type, 'other') as resource_type
      FROM bill_details d
      JOIN bills b ON d.bill_id = b.id
      WHERE b.date >= ? AND b.date <= ?
        AND COALESCE(d.resource_type, 'other') IN ('domain', 'other', 'web_cloud')
        AND d.project_id IS NULL
        AND ${ofAccount.sql}
    `).all(fromDate, toDate, ...ofAccount.params);

    // The Infrastructure tab leaves the 'domain' and 'web_cloud' types out, so
    // a line of those types the wording does not place still lands here. An
    // unrecognised 'other' line stays in the Infrastructure tab only.
    const fallback = { domain: 'domain', web_cloud: 'option' };

    const byService = new Map();
    for (const row of rows) {
      const category = classifyWebCloud(row.description, row.domain) || fallback[row.resource_type];
      if (!category) continue;

      // A domain and its DNS zone share the same `domain` value, so the family
      // is part of the key: they are two billable services. So is the account: a
      // service billed on two accounts' bills, as one that moved from an account
      // to another, is a service of each, with its own cost (#122).
      const key = JSON.stringify([category, row.domain, row.account]);
      const item = byService.get(key) || {
        name: row.domain,
        account: row.account,
        category,
        description: row.description,
        total: 0,
        line_count: 0,
        first_date: row.date,
        last_date: row.date
      };
      item.total = Math.round((item.total + row.price) * 100) / 100;
      item.line_count += 1;
      if (row.date < item.first_date) item.first_date = row.date;
      if (row.date > item.last_date) {
        item.last_date = row.date;
        item.description = row.description; // keep the most recent wording
      }
      byService.set(key, item);
    }

    // Most expensive first, then by name. A service that costs the same on several accounts
    // comes by the NIC handle of each, the Unknown account's last, rather than in the order
    // the import wrote its bill lines in; the services of one account keep their order.
    return [...byService.values()].sort((a, b) => b.total - a.total
      || a.name.localeCompare(b.name)
      || compareAccounts(a.account, b.account));
  },

  /**
   * Count and cost per family, for the summary cards, of the services that getItems() lists:
   * a service billed to several accounts counts once for each.
   * @param {string} fromDate
   * @param {string} toDate
   * @param {?string} [account] - The account whose bills count (see accountCondition()):
   *   every account's by default
   */
  getSummary: (fromDate, toDate, account = null) => {
    const items = webCloudOps.getItems(fromDate, toDate, account);
    const summary = {};
    for (const category of WEB_CLOUD_FAMILIES) {
      summary[category] = { count: 0, total: 0 };
    }
    for (const item of items) {
      summary[item.category].count += 1;
      summary[item.category].total = Math.round((summary[item.category].total + item.total) * 100) / 100;
    }
    summary.total = Math.round(items.reduce((sum, i) => sum + i.total, 0) * 100) / 100;
    return summary;
  }
};

// The carbon footprint of the accounts (#147): the lines of the file that OVHcloud's carbon
// calculator generates for each account, month by month (see data/carbon-footprint.js)

// A footprint line's location-based footprint, in kg CO2eq: the carbon footprint that OCM
// shows, market-based aside (see CONTEXT.md)
const LOCATION_FOOTPRINT = 'manufacturing + electricity_location + operations_location';

// What the queries of a carbon footprint select of its lines: its location-based footprint
// by emission source and in total, in kg CO2eq, to the hundredth
const FOOTPRINT_SUMS = `
  ROUND(SUM(manufacturing), 2) as manufacturing,
  ROUND(SUM(electricity_location), 2) as electricity,
  ROUND(SUM(operations_location), 2) as operations,
  ROUND(SUM(${LOCATION_FOOTPRINT}), 2) as total`;

// How many months the trend of the carbon footprint covers (#154)
const TREND_MONTHS = 12;

// The footprint lines of the months from `first` to `last`, YYYY-MM, of the account (see
// accountCondition()), or of every account, each with its location-based footprint, as
// tieFootprint() takes them
function footprintLinesOf(first, last, account) {
  const ofAccount = accountCondition(account, 'account');
  return getDb().prepare(`
    SELECT *, ${LOCATION_FOOTPRINT} as footprint
    FROM carbon_footprint_lines
    WHERE month >= ? AND month <= ? AND ${ofAccount.sql}
    ORDER BY id
  `).all(first, last, ...ofAccount.params);
}

// The bill lines of the months of use from `first` to `last`, YYYY-MM, of the account (see
// accountCondition()), or of every account, as tieFootprint() takes them, each with its month
// of use: the lines of a Public Cloud project, which OVHcloud bills after use, are on the next
// month's bills, the others on the month's. The dates of the bills bound the query, which
// their index serves.
function billLinesOfUse(first, last, account) {
  const ofBills = accountCondition(account, 'b.account');
  const dayOne = (month) => `${month}-01`;
  return getDb().prepare(`
    SELECT d.description, d.domain, d.project_id, d.resource_type, d.total_price, b.account,
      CASE WHEN d.project_id IS NULL THEN substr(b.date, 1, 7)
        ELSE strftime('%Y-%m', substr(b.date, 1, 10), 'start of month', '-1 month')
      END as month
    FROM bills b
    JOIN bill_details d ON d.bill_id = b.id
    WHERE b.date >= ? AND b.date < ?
      AND ((d.project_id IS NOT NULL AND b.date >= ?) OR (d.project_id IS NULL AND b.date < ?))
      AND ${ofBills.sql}
  `).all(
    dayOne(first), dayOne(shiftMonth(last, 2)), dayOne(shiftMonth(first, 1)),
    dayOne(shiftMonth(last, 1)), ...ofBills.params,
  );
}

// The region of each instance of the inventory, which places a prorata that names none
const instanceRegionsOf = () => new Map(getDb().prepare('SELECT id, region FROM cloud_instances')
  .all().map(({ id, region }) => [id, region]));

const carbonOps = {
  /**
   * Replaces an account's footprint lines of some months with those of a file, in one
   * transaction: the lines of its other months stay, those older than the months the carbon
   * calculator gives included (ADR 0003), and so do the other accounts'.
   * @param {string} account - The NIC handle of the account
   * @param {{first: string, last: string}} months - The first and the last month replaced,
   *   YYYY-MM: the file's lines of other months are left out
   * @param {object[]} lines - The lines of the file, as readFootprintFile() reads them
   */
  replaceMonths: (account, { first, last }, lines) => {
    const db = getDb();
    const insert = db.prepare(`
      INSERT INTO carbon_footprint_lines (
        account, month, type, datacenter, product_range, name, server_domain, manufacturing,
        electricity_location, electricity_market, operations_location, operations_market
      ) VALUES (
        @account, @month, @type, @datacenter, @product_range, @name, @server_domain,
        @manufacturing, @electricity_location, @electricity_market, @operations_location,
        @operations_market
      )
    `);
    db.transaction(() => {
      db.prepare(`
        DELETE FROM carbon_footprint_lines WHERE account = ? AND month >= ? AND month <= ?
      `).run(account, first, last);
      for (const line of lines) {
        if (line.month < first || line.month > last) continue;
        insert.run(requireAccount('carbon_footprint_lines', { ...line, account }));
      }
    })();
  },

  /**
   * The carbon footprint of a month, location-based, of the account (see accountCondition()),
   * or of every account by default: its emissions by emission source, and in total, in kg
   * CO2eq, to the hundredth, with its market-based total (#152).
   * @param {string} month - YYYY-MM
   * @param {?string} [account]
   * @returns {?{manufacturing: number, electricity: number, operations: number, total: number,
   *   marketBasedTotal: number}} Null when the month has no footprint line
   */
  getMonthFootprint: (month, account = null) => {
    const ofAccount = accountCondition(account, 'account');
    const { lines, ...footprint } = getDb().prepare(`
      SELECT COUNT(*) as lines, ${FOOTPRINT_SUMS},
        ROUND(SUM(manufacturing + electricity_market + operations_market), 2)
          as marketBasedTotal
      FROM carbon_footprint_lines
      WHERE month = ? AND ${ofAccount.sql}
    `).get(month, ...ofAccount.params);
    return lines > 0 ? footprint : null;
  },

  /**
   * The carbon footprint of the 12 months that end on a month (#154), location-based, of the
   * account (see accountCondition()), or of every account by default: each month's footprint
   * by emission source and in total, in kg CO2eq, to the hundredth, and its covered share
   * (#157), as getTies() gives it.
   * @param {string} end - The last month, YYYY-MM
   * @param {?string} [account]
   * @returns {{month: string, footprint: ?object, coveredShare: ?number}[]} Each month, the
   *   earliest first, with its footprint and its covered share, null for a month without a
   *   footprint
   */
  getTrend: (end, account = null) => {
    const first = shiftMonth(end, 1 - TREND_MONTHS);
    const ofAccount = accountCondition(account, 'account');
    const byMonth = new Map(getDb().prepare(`
      SELECT month, ${FOOTPRINT_SUMS}
      FROM carbon_footprint_lines
      WHERE month >= ? AND month <= ? AND ${ofAccount.sql}
      GROUP BY month
    `).all(first, end, ...ofAccount.params).map(({ month, ...footprint }) => [month, footprint]));
    // The lines of the 12 months and the bill lines of their months of use, read at once
    const footprintLines = Map.groupBy(footprintLinesOf(first, end, account), line => line.month);
    const billLines = Map.groupBy(billLinesOfUse(first, end, account), line => line.month);
    const instanceRegions = instanceRegionsOf();
    return Array.from({ length: TREND_MONTHS }, (_, index) => {
      const month = shiftMonth(first, index);
      const footprint = byMonth.get(month) ?? null;
      return {
        month,
        footprint,
        coveredShare: footprint
          ? tieFootprint(footprintLines.get(month), billLines.get(month) ?? [], instanceRegions)
            .coveredShare
          : null,
      };
    });
  },

  /**
   * The lines of a month's carbon footprint, of the account (see accountCondition()), or of
   * every account by default, each with what the bill lines that it ties to cost in that month
   * of use, and its intensity (#155, see data/carbon-ties.js); and the covered cost of the
   * month of use, with its covered share (#157).
   * @param {string} month - YYYY-MM
   * @param {?string} [account]
   * @returns {{lines: object[], coveredCost: number, coveredShare: ?number}} As
   *   tieFootprint() gives them, from the bill lines of the month of use of every account
   *   asked for, those without a footprint included
   */
  getTies: (month, account = null) => tieFootprint(
    footprintLinesOf(month, month, account), billLinesOfUse(month, month, account),
    instanceRegionsOf(),
  ),

  /**
   * The latest month that has a carbon footprint, of the account (see accountCondition()), or
   * of any account by default (#152): OVHcloud gives none for the current month.
   * @param {?string} [account]
   * @returns {?string} YYYY-MM, null when there is no footprint at all
   */
  getLatestMonth: (account = null) => {
    const ofAccount = accountCondition(account, 'account');
    return getDb().prepare(`
      SELECT MAX(month) FROM carbon_footprint_lines WHERE ${ofAccount.sql}
    `).pluck().get(...ofAccount.params);
  },

  /**
   * The accounts that have no carbon footprint for a month (#153), which the footprint of all
   * accounts leaves out: the configured accounts, and those that the configuration no longer
   * lists but that were billed that month, whose costs the page adds up with the others'. In
   * the order of accountsOps.getAll(). The Unknown account, which never has a footprint, is
   * not an account of the accounts table.
   * @param {string} month - YYYY-MM
   * @returns {string[]} Their NIC handles
   */
  getAccountsWithoutFootprint: (month) => {
    const db = getDb();
    const withFootprint = new Set(db.prepare(`
      SELECT DISTINCT account FROM carbon_footprint_lines WHERE month = ?
    `).pluck().all(month));
    const billed = new Set(db.prepare(`
      SELECT DISTINCT account FROM bills WHERE substr(date, 1, 7) = ? AND account IS NOT NULL
    `).pluck().all(month));
    return accountsOps.getAll()
      .filter(({ nic, configured }) => !withFootprint.has(nic) && (configured || billed.has(nic)))
      .map(({ nic }) => nic);
  },
};

module.exports = {
  getDb,
  closeDb,
  // What a full import of an account clears (#114), on the database that getDb() opens

  /** @see ownership.clearAccount */
  clearAccount: onDb(ownership.clearAccount),
  transaction,
  allocateProRata,
  UNKNOWN_ACCOUNT,
  projects: projectOps,
  bills: billOps,
  details: detailOps,
  importLog: importLogOps,
  accounts: accountsOps,
  analysis: analysisOps,
  consumption: consumptionOps,
  balance: balanceOps,
  inventory: inventoryOps,
  cloudDetails: cloudDetailOps,
  webCloud: webCloudOps,
  carbon: carbonOps,
};
