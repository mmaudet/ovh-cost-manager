const Database = require('better-sqlite3');
const { classifyWebCloud, WEB_CLOUD_FAMILIES } = require('./classify');
const { monthsOfWindow } = require('./months');
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

// The tables fed by the OVH API whose rows belong to no bill or project: each row holds the
// NIC handle of its account in an `account` column, which tells the accounts of one
// database apart (#112, ADR 0002). The other rows find their account through their bill
// (the bill lines) or their project (the instances, volumes, snapshots, buckets,
// consumption and quotas of a Public Cloud project).
const ACCOUNT_TABLES = [
  'bills', 'projects', 'dedicated_servers', 'vps_instances', 'storage_services',
  'account_balance', 'consumption_snapshots', 'consumption_history', 'credit_movements',
];

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

// The value that selects the Unknown account (see CONTEXT.md), the rows without an account,
// in the queries that can keep one account's rows and in the account parameter of the
// server's routes (#115). No NIC handle reads so.
const UNKNOWN_ACCOUNT = 'unknown';

/**
 * The condition that keeps the rows of an account in a query that can keep one account's
 * rows (#115, ADR 0002), to join with AND to its WHERE clause, and its parameters. Such a
 * query takes the account as the server's routes read it from their account parameter.
 * @param {?string} account - null for every account, UNKNOWN_ACCOUNT for the Unknown
 *   account, or else the NIC handle of an account
 * @param {string} column - The column of the query that holds the NIC handle of its rows'
 *   account: `b.account` for its bills, `p.account` for its projects
 * @returns {{ sql: string, params: string[] }} Always true for every account
 */
function accountCondition(account, column) {
  if (account === null) return { sql: '1 = 1', params: [] };
  if (account === UNKNOWN_ACCOUNT) return { sql: `${column} IS NULL`, params: [] };
  return { sql: `${column} = ?`, params: [account] };
}

/**
 * How a query of the costs of projects, those of the breakdown by project and of the GPU
 * costs, groups the bill lines of its bills `b` and orders the rows, whose `total` it sums
 * (#118). By project, as before the accounts; or, for the Overview's lists that name the
 * account of each project, by project and account: a project billed to several accounts, such
 * as one moved from an account to another, then has a row for each, with the NIC handle of
 * its account, null for the Unknown account, as a bill line belongs to the account of its bill
 * (ADR 0002).
 *
 * Most expensive first; projects that cost the same by id, the last first, as SQLite gave
 * them before the queries told accounts apart; and the rows of a project by account, by NIC
 * handle, the Unknown account's last, as the Web Cloud services (#122).
 * @param {string} projectColumn - The column of the query that holds the id of the project
 * @param {boolean} byAccount - Whether to give a row to each project and account
 * @returns {{ select: string, groupBy: string, orderBy: string }} What the query selects
 *   besides, to follow its other columns, and what GROUP BY and ORDER BY take
 */
function projectGrouping(projectColumn, byAccount) {
  const byCost = `total DESC, ${projectColumn} DESC`;
  if (!byAccount) return { select: '', groupBy: projectColumn, orderBy: byCost };
  return {
    select: ', b.account as account',
    groupBy: `${projectColumn}, b.account`,
    orderBy: `${byCost}, b.account IS NULL, b.account`,
  };
}

// The tables of the services that the APIs of two accounts can both list, such as a server
// whose technical contact is one account and whose billing is another's (#114). A service is
// stored once, and belongs to the account whose bill lines name it, or else to the first
// configured account that lists it. The writers of these tables never change the account of
// a service that an account holds, and the accounts are imported in the order of the
// configuration: the first that lists a service stores it. A writer gives a service stored
// before the accounts, without one, to the account that lists it. Then, once the account's
// bills are stored, accounts.takeOverBilledRows() gives it the services that it lists and
// bills.
const SERVICE_TABLES = ['projects', 'dedicated_servers', 'vps_instances', 'storage_services'];

let db = null;

/**
 * Safely add a column to a table if it doesn't exist
 * @returns {boolean} Whether it added the column
 */
function addColumnIfNotExists(database, table, column, type) {
  const columns = database.pragma(`table_info(${table})`);
  if (!columns.find(c => c.name === column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    return true;
  }
  return false;
}

/**
 * Gives a table the key that schema.sql defines for it now, which SQLite cannot change in
 * place (#114): its rows, with their rowids, go to the table as schema.sql creates it anew,
 * with its indexes. In a transaction that takes the write lock first, and only if the table
 * still has its former key then: the server and the import may open an old database
 * together.
 * @param {object} database - The database, as getDb() opens it
 * @param {string} table - The table
 * @param {string[]} columns - The columns of its rows, which both of its forms have
 * @param {function(): boolean} hasFormerKey - Whether the table still has its former key
 */
function rekeyTable(database, table, columns, hasFormerKey) {
  const rekey = database.transaction(() => {
    if (!hasFormerKey()) return;
    const former = `${table}_former_key`;
    database.exec(`ALTER TABLE ${table} RENAME TO ${former}`);
    // Its indexes follow it under their names, which schema.sql would find taken: they go,
    // and schema.sql creates them again on the new table
    const indexes = database.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL
    `).all(former);
    for (const { name } of indexes) database.exec(`DROP INDEX ${name}`);
    database.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));
    const list = columns.join(', ');
    database.exec(`INSERT INTO ${table} (rowid, ${list}) SELECT rowid, ${list} FROM ${former}`);
    database.exec(`DROP TABLE ${former}`);
  });
  rekey.immediate();
}

// Whether a column of a table is not part of its key, or does not exist
const outOfKey = (database, table, column) => !database.pragma(`table_info(${table})`)
  .some(({ name, pk }) => name === column && pk > 0);

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
    db.transaction(() => {
      if (addColumnIfNotExists(db, 'accounts', 'position', 'INTEGER')) {
        db.exec(`
          UPDATE accounts SET position =
            (SELECT COUNT(*) FROM accounts AS earlier WHERE earlier.rowid < accounts.rowid)
        `);
      }
    }).immediate();
    // How many bills stored before the accounts each account claimed, which tells whether
    // the database was one account's (#114)
    addColumnIfNotExists(db, 'accounts', 'claimed_bills', 'INTEGER NOT NULL DEFAULT 0');
    // What keeps the lock of a long import (#113)
    addColumnIfNotExists(db, 'import_log', 'heartbeat_at', 'DATETIME');
    // The credit movements keyed by their account too (#114): their ids, which join the name
    // of their balance and their number, can be those of another account's
    rekeyTable(db, 'credit_movements', [
      'id', 'balance_name', 'amount', 'date', 'description', 'movement_type', 'imported_at',
      'account',
    ], () => outOfKey(db, 'credit_movements', 'account'));
    // The import state kept by account (#114). What an import recorded before carries none.
    rekeyTable(db, 'import_state', ['key', 'value', 'updated_at'],
      () => outOfKey(db, 'import_state', 'account'));
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
  // Records a project that an account's API lists, see SERVICE_TABLES: one that another
  // account holds stays that account's
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

  getAll: (fromDate, toDate) => {
    const db = getDb();
    let query = 'SELECT * FROM bills';
    const params = [];

    if (fromDate && toDate) {
      query += ' WHERE date >= ? AND date <= ?';
      params.push(fromDate, toDate);
    } else if (fromDate) {
      query += ' WHERE date >= ?';
      params.push(fromDate);
    } else if (toDate) {
      query += ' WHERE date <= ?';
      params.push(toDate);
    }

    query += ' ORDER BY date DESC';
    return db.prepare(query).all(...params);
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

  // Clears the log of every import but the one given: a full import of every account starts
  // the log again, but for its own entry, which tells the other imports that it runs
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

  /**
   * Gives the account every row of ACCOUNT_TABLES that has none, and the import state
   * recorded without one. The writers refuse a row without an account, so these are the
   * rows stored before the upgrade: with a single account configured, they can only be its
   * own. A row whose key the account has since recorded, such as the month of its current
   * consumption, keeps none.
   * @param {string} nic - The NIC handle of the account
   * @returns {number} How many rows it gave the account
   */
  attributeRowsWithoutAccount: (nic) => {
    const db = getDb();
    const attribute = db.transaction(() => {
      let attributed = 0;
      for (const table of [...ACCOUNT_TABLES, 'import_state']) {
        attributed += db.prepare(`UPDATE OR IGNORE ${table} SET account = ? WHERE account IS NULL`)
          .run(nic).changes;
      }
      return attributed;
    });
    return attribute();
  },

  /**
   * @param {string} nic - The NIC handle of an account
   * @returns {boolean} Whether the database has never known another account: the accounts
   *   table records no other NIC handle. Its rows without an account can then only be that
   *   account's, stored before the accounts (#114).
   */
  isOnlyAccount: (nic) => getDb()
    .prepare('SELECT NOT EXISTS (SELECT 1 FROM accounts WHERE nic <> ?) AS only')
    .get(nic).only === 1,

  /**
   * @param {string} [table] - One of ACCOUNT_TABLES, or all of them when none is given
   * @returns {boolean} Whether it holds rows without an account: rows stored before the
   *   accounts that no account has claimed, which are the Unknown account's (see CONTEXT.md)
   */
  hasRowsWithoutAccount: (table) => {
    const db = getDb();
    return (table === undefined ? ACCOUNT_TABLES : [table]).some(name => db
      .prepare(`SELECT EXISTS (SELECT 1 FROM ${name} WHERE account IS NULL) AS found`)
      .get().found === 1);
  },

  /**
   * Gives the account the bills without an account that its API lists (#114): the bills
   * stored before the accounts are each account's whose full bill list names them. Those
   * that no account lists keep none. The account's count of claimed bills records the
   * claims, over every run, for attributeToSoleClaimer().
   * @param {string} nic - The NIC handle of the account, which the accounts table records
   * @param {Array<string>} billIds - Every bill that its API lists, by number
   * @returns {number} How many it claimed
   */
  claimBills: (nic, billIds) => {
    const db = getDb();
    const claim = db.transaction(() => {
      const claimed = db.prepare(`
        UPDATE bills SET account = ?
        WHERE account IS NULL AND id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
      `).run(nic, JSON.stringify(billIds)).changes;
      db.prepare('UPDATE accounts SET claimed_bills = claimed_bills + ? WHERE nic = ?')
        .run(claimed, nic);
      return claimed;
    });
    return claim();
  },

  /**
   * Gives every row without an account to the account that claimed every bill stored before
   * the accounts, once no bill is left without an account and no other account claimed any
   * (#114): the version before the accounts imported the single account that OCM took the
   * credentials of, so the database was that account's. Its consumption history, its credit
   * movements and the rest then go to it, which its own import replaces rather than adds.
   * @returns {?{nic: string, attributed: number}} The account and how many rows it got, or
   *   null when nothing tells that the database was one account's, or no row is left
   */
  attributeToSoleClaimer: () => {
    if (accountsOps.hasRowsWithoutAccount('bills')) return null;
    const claimers = getDb().prepare('SELECT nic FROM accounts WHERE claimed_bills > 0')
      .pluck().all();
    if (claimers.length !== 1) return null;
    const [nic] = claimers;
    const attributed = accountsOps.attributeRowsWithoutAccount(nic);
    return attributed > 0 ? { nic, attributed } : null;
  },

  /**
   * Gives the account the credit movement without an account that is this very movement of
   * its API (#114): the same id, which joins the name of its balance and its number, the same
   * date and the same amount. Two accounts' balances can share a name, and their movements
   * the same ids: another account's movement, which has another date or amount, is never
   * claimed. One whose key the account already has keeps none.
   * @param {object} movement - The movement as the import stores it: its `id`, `date`,
   *   `amount`, and `account`, the NIC handle of the account
   * @returns {boolean} Whether it claimed one
   */
  claimCreditMovement: ({ id, date, amount, account }) => getDb().prepare(`
    UPDATE OR IGNORE credit_movements SET account = @account
    WHERE account IS NULL AND id = @id AND date IS @date AND amount = @amount
  `).run({ id, date, amount, account }).changes > 0,

  /**
   * Deletes the balance and consumption snapshots without an account (#114): with several
   * accounts configured, no account can claim the account-wide figures stored before the
   * accounts, of which only the latest is read. Each account's import records its own.
   * @returns {number} How many it deleted
   */
  deleteSnapshotsWithoutAccount: () => {
    const db = getDb();
    const remove = db.transaction(() => ['account_balance', 'consumption_snapshots']
      .reduce((deleted, table) => deleted
        + db.prepare(`DELETE FROM ${table} WHERE account IS NULL`).run().changes, 0));
    return remove();
  },

  /**
   * Gives the account the services that its API lists but that another account holds, when
   * the latest bill with a line that names them, by its domain, is the account's: a service
   * that two accounts' APIs list belongs to the account that bills it (see SERVICE_TABLES).
   * The import runs it once the account's bills are stored: they may name a service that an
   * account imported before it stored first.
   * @param {string} nic - The NIC handle of the account
   * @param {Object<string, Array<string|number>>} listed - The ids of the services that its
   *   API lists, by the table that stores them, one of SERVICE_TABLES
   * @returns {number} How many services it took over
   */
  takeOverBilledRows: (nic, listed) => {
    const db = getDb();
    const billedBy = db.prepare(`
      SELECT b.account FROM bill_details d JOIN bills b ON b.id = d.bill_id
      WHERE d.domain = ? AND b.account IS NOT NULL
      ORDER BY b.date DESC, b.id DESC
      LIMIT 1
    `);
    const takeOver = db.transaction(() => {
      let taken = 0;
      for (const [table, ids] of Object.entries(listed)) {
        if (!SERVICE_TABLES.includes(table)) throw new Error(`${table} stores no service`);
        // Those that another account holds, which few are: the bills are read for them only
        const heldByOthers = db.prepare(`
          SELECT id FROM ${table}
          WHERE account <> ? AND id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
        `).all(nic, JSON.stringify(ids));
        const give = db.prepare(`UPDATE ${table} SET account = ? WHERE id = ?`);
        for (const { id } of heldByOthers) {
          if (billedBy.get(id)?.account === nic) taken += give.run(nic, id).changes;
        }
      }
      return taken;
    });
    return takeOver();
  },

  /**
   * Records how the last import of the account ended, and that it ended now, for the
   * accounts route to tell whether its data is fresh.
   * @param {string} nic - The NIC handle of the account
   * @param {object} result
   * @param {string} result.status - 'success' or 'failed'
   * @param {?string} [result.error] - Why it failed
   */
  recordImport: (nic, { status, error = null }) => {
    const db = getDb();
    return db.prepare(`
      UPDATE accounts SET
        last_import_at = CURRENT_TIMESTAMP,
        last_import_status = ?,
        last_import_error = ?
      WHERE nic = ?
    `).run(status, error, nic);
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
   * imported (#114). Each run records it, whatever it imports of them.
   * @param {Array<?string>} nics - The NIC handle of the account of each entry of the
   *   configuration, in its order: the one that its GET /me named, or else the one that an
   *   import last recorded with its entry's name; null for an entry that leads to no account
   *   that the run can tell
   */
  recordConfiguration: (nics) => {
    const db = getDb();
    const place = db.prepare('UPDATE accounts SET position = ? WHERE nic = ?');
    db.transaction(() => {
      db.exec('UPDATE accounts SET position = NULL');
      nics.forEach((nic, position) => {
        if (nic) place.run(position, nic);
      });
    })();
  },

  /**
   * @returns {object[]} Every account recorded, as the accounts table holds it: those that
   *   the configuration of the last run lists, in its order, then the others by NIC handle
   */
  getAll: () => {
    const db = getDb();
    return db.prepare('SELECT * FROM accounts ORDER BY position IS NULL, position, nic').all();
  }
};

// Analysis queries
const analysisOps = {
  // The costs of each project billed between two dates, most expensive first, on the bills of
  // the account (see accountCondition()), every account's by default. A project missing from
  // the projects table keeps the id of its bill lines, without a name: the dashboard tells
  // such projects apart by their id (#55). One row per project, or, with byAccount, per
  // project and account, with its account (see projectGrouping(), #118).
  byProject: (fromDate, toDate, account = null, { byAccount = false } = {}) => {
    const db = getDb();
    const ofAccount = accountCondition(account, 'b.account');
    const grouping = projectGrouping('d.project_id', byAccount);
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

  dailyTrend: (fromDate, toDate) => {
    const db = getDb();
    return db.prepare(`
      SELECT
        b.date,
        SUM(d.total_price) as total
      FROM bill_details d
      JOIN bills b ON d.bill_id = b.id
      WHERE b.date >= ? AND b.date <= ?
      GROUP BY b.date
      ORDER BY b.date
    `).all(fromDate, toDate);
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

  getLatestSnapshot: () => {
    const db = getDb();
    return db.prepare('SELECT * FROM consumption_snapshots ORDER BY id DESC LIMIT 1').get();
  },

  insertHistory: (entry) => {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO consumption_history (period_start, period_end, service_type, total, currency, raw_data, imported_at, account)
      VALUES (@period_start, @period_end, @service_type, @total, @currency, @raw_data, CURRENT_TIMESTAMP, @account)
    `);
    return stmt.run(requireAccount('consumption_history', entry));
  },

  getHistory: (fromDate, toDate) => {
    const db = getDb();
    let query = 'SELECT * FROM consumption_history';
    const params = [];
    if (fromDate && toDate) {
      query += ' WHERE period_start >= ? AND period_end <= ?';
      params.push(fromDate, toDate);
    }
    query += ' ORDER BY period_start DESC';
    return db.prepare(query).all(...params);
  },

  // Clears the consumption history of an account, by its NIC handle, which its import then
  // replaces: the other accounts' history, and that of no account, stay (#114)
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

  getLatestBalance: () => {
    const db = getDb();
    return db.prepare('SELECT * FROM account_balance ORDER BY id DESC LIMIT 1').get();
  },

  insertCreditMovement: (movement) => {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO credit_movements (id, balance_name, amount, date, description, movement_type, imported_at, account)
      VALUES (@id, @balance_name, @amount, @date, @description, @movement_type, CURRENT_TIMESTAMP, @account)
    `);
    return stmt.run(requireAccount('credit_movements', movement));
  },

  getCreditMovements: () => {
    const db = getDb();
    return db.prepare('SELECT * FROM credit_movements ORDER BY date DESC').all();
  },

  updateBillPayment: (billId, paymentInfo) => {
    const db = getDb();
    const stmt = db.prepare(`
      UPDATE bills SET payment_type = ?, payment_date = ?, payment_status = ? WHERE id = ?
    `);
    return stmt.run(paymentInfo.type, paymentInfo.date, paymentInfo.status, billId);
  }
};

// Makes the function that deletes the services of an inventory table whose id is not in
// `ids`, the list that the OVH API of an account gave of all those that exist now: the
// services cancelled since an import stored them (#74). It deletes only the services of that
// account, `account`, its NIC handle: another account's services, and those that no account
// holds, are not in its list (#114). `serviceType`, for a table whose list covers one type of
// its services only, leaves the others alone. The ids compare as text, as the table stores
// them: json_each() gives a number as an integer, which no text equals. The function returns
// how many it deleted.
function deleteNotIn(table, serviceType = null) {
  const ofType = serviceType === null ? '' : 'service_type = ? AND ';
  const typeParams = serviceType === null ? [] : [serviceType];
  return (ids, account) => {
    const db = getDb();
    return db.prepare(`
      DELETE FROM ${table}
      WHERE account = ? AND ${ofType}id NOT IN (SELECT CAST(value AS TEXT) FROM json_each(?))
    `).run(account, ...typeParams, JSON.stringify(ids)).changes;
  };
}

// Inventory operations (Phase 3). The writers of the services keep the account of a service
// that another account holds, see SERVICE_TABLES.
const inventoryOps = {
  // Dedicated servers
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

  getAllServers: () => {
    const db = getDb();
    return db.prepare('SELECT * FROM dedicated_servers ORDER BY display_name').all();
  },

  // VPS
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

  getAllVps: () => {
    const db = getDb();
    return db.prepare('SELECT * FROM vps_instances ORDER BY display_name').all();
  },

  // Storage
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

  getAllStorage: () => {
    const db = getDb();
    return db.prepare('SELECT * FROM storage_services ORDER BY display_name').all();
  },

  // The services of an account cancelled since an import stored them go, see deleteNotIn()
  // (#74, #114)
  deleteServersNotIn: deleteNotIn('dedicated_servers'),
  deleteVpsNotIn: deleteNotIn('vps_instances'),
  // Their list, /storage/netapp, names the NetApp services only
  deleteStorageNotIn: deleteNotIn('storage_services', 'netapp'),

  getSummary: () => {
    const db = getDb();
    const servers = db.prepare('SELECT COUNT(*) as count FROM dedicated_servers').get();
    const vps = db.prepare('SELECT COUNT(*) as count FROM vps_instances').get();
    const storage = db.prepare('SELECT COUNT(*) as count FROM storage_services').get();
    const projects = db.prepare('SELECT COUNT(*) as count FROM projects').get();
    return {
      servers: servers.count,
      vps: vps.count,
      storage: storage.count,
      cloud_projects: projects.count
    };
  },

  // The servers, VPS and storage services that expire within daysAhead days, in one list,
  // soonest first: those already expired stay in it, first (#74). Services that expire on the
  // same day keep the order of the inventories: servers, VPS, then storage.
  getExpiringServices: (daysAhead = 30) => {
    const db = getDb();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + daysAhead);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    const servers = db.prepare(
      "SELECT id, display_name, 'dedicated_server' as type, expiration_date FROM dedicated_servers WHERE expiration_date IS NOT NULL AND expiration_date <= ? ORDER BY expiration_date"
    ).all(cutoffStr);
    const vps = db.prepare(
      "SELECT id, display_name, 'vps' as type, expiration_date FROM vps_instances WHERE expiration_date IS NOT NULL AND expiration_date <= ? ORDER BY expiration_date"
    ).all(cutoffStr);
    const storages = db.prepare(
      "SELECT id, display_name, 'storage' as type, expiration_date FROM storage_services WHERE expiration_date IS NOT NULL AND expiration_date <= ? ORDER BY expiration_date"
    ).all(cutoffStr);

    return [...servers, ...vps, ...storages]
      .sort((a, b) => a.expiration_date.localeCompare(b.expiration_date));
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

  // Details for a specific resource type (grouped by domain)
  byResourceTypeDetails: (resourceType, fromDate, toDate) => {
    const db = getDb();
    return db.prepare(`
      SELECT
        d.domain,
        (SELECT d2.description FROM bill_details d2
         JOIN bills b2 ON d2.bill_id = b2.id
         WHERE d2.domain = d.domain AND COALESCE(d2.resource_type, 'other') = ?
           AND b2.date >= ? AND b2.date <= ?
         ORDER BY d2.total_price DESC LIMIT 1
        ) as description,
        ROUND(SUM(d.total_price), 2) as total,
        COUNT(d.id) as line_count
      FROM bill_details d
      JOIN bills b ON d.bill_id = b.id
      WHERE COALESCE(d.resource_type, 'other') = ?
        AND b.date >= ? AND b.date <= ?
      GROUP BY d.domain
      HAVING total > 0
      ORDER BY total DESC
    `).all(resourceType, fromDate, toDate, resourceType, fromDate, toDate);
  },

  /**
   * The figures of the Public Cloud cards over a period (Kubernetes clusters, S3 buckets, etc),
   * for the account (see accountCondition()), every account's by default (#121). The costs are
   * those of the bill lines of its bills; the counts of volumes, snapshots and buckets, those of
   * the inventory of its projects, as a project's resources belong to its account (ADR 0002),
   * but for the buckets of an inventory that holds none (below).
   * @param {string} fromDate
   * @param {string} toDate
   * @param {?string} [account]
   * @returns {object}
   */
  getPublicCloudStats: (fromDate, toDate, account = null) => {
    const db = getDb();
    const ofBills = accountCondition(account, 'b.account');
    const ofProjects = accountCondition(account, 'p.account');

    // Count unique Kubernetes services from descriptions. Savings plans for
    // nodes ("savings-plan-3xc3-4_node_k8s") match '%k8s%' but belong to the
    // savings plan card, as for the instance total.
    const k8s = db.prepare(`
      SELECT COUNT(DISTINCT domain) as count, ROUND(SUM(total_price), 2) as total
      FROM bill_details d
      JOIN bills b ON d.bill_id = b.id
      WHERE b.date >= ? AND b.date <= ?
        AND (LOWER(description) LIKE '%kubernetes%' OR LOWER(description) LIKE '%kube%' OR LOWER(description) LIKE '%k8s%')
        AND LOWER(description) NOT LIKE 'savings plan%'
        AND ${ofBills.sql}
    `).get(fromDate, toDate, ...ofBills.params);

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
    
    // Total cost for all object storage (including bandwidth, archives)
    const s3Total = db.prepare(`
      SELECT ROUND(SUM(total_price), 2) as total
      FROM bill_details d
      JOIN bills b ON d.bill_id = b.id
      WHERE b.date >= ? AND b.date <= ?
        AND (
          LOWER(description) LIKE '%stockage standard%bucket%'
          OR LOWER(description) LIKE '%stockage high performance%bucket%'
          OR LOWER(description) LIKE '%stockage standard infrequent%bucket%'
          OR LOWER(description) LIKE '%stockage d''objects%'
          OR LOWER(description) LIKE '%public cloud archive%'
          OR LOWER(description) LIKE 'stockage cold archive%'
        )
        AND ${ofBills.sql}
    `).get(fromDate, toDate, ...ofBills.params);

    // Instances: monthly + hourly lines. Savings plans read as "%instance%" but
    // are prepaid compute billed on their own line, they are counted apart.
    const instances = db.prepare(`
      SELECT ROUND(SUM(d.total_price), 2) as total
      FROM bill_details d
      JOIN bills b ON d.bill_id = b.id
      WHERE b.date >= ? AND b.date <= ?
        AND (d.description LIKE 'Forfait mensuel pour une instance%'
             OR d.description LIKE 'Consommation à l%heure pour les instances%')
        AND ${ofBills.sql}
    `).get(fromDate, toDate, ...ofBills.params);

    const volumes = db.prepare(`
      SELECT ROUND(SUM(d.total_price), 2) as total
      FROM bill_details d
      JOIN bills b ON d.bill_id = b.id
      WHERE b.date >= ? AND b.date <= ?
        AND d.description LIKE 'Disques supplémentaires%'
        AND ${ofBills.sql}
    `).get(fromDate, toDate, ...ofBills.params);
    const volumeCount = db.prepare(`
      SELECT COUNT(*) as count FROM cloud_volumes v
      LEFT JOIN projects p ON p.id = v.project_id
      WHERE (v.created_at IS NULL OR SUBSTR(v.created_at, 1, 10) <= ?)
        AND ${ofProjects.sql}
    `).get(toDate, ...ofProjects.params);

    const snapshots = db.prepare(`
      SELECT ROUND(SUM(d.total_price), 2) as total
      FROM bill_details d
      JOIN bills b ON d.bill_id = b.id
      WHERE b.date >= ? AND b.date <= ?
        AND d.description LIKE 'Snapshots Public Cloud%'
        AND ${ofBills.sql}
    `).get(fromDate, toDate, ...ofBills.params);
    const snapshotCount = db.prepare(`
      SELECT COUNT(*) as count FROM cloud_snapshots s
      LEFT JOIN projects p ON p.id = s.project_id
      WHERE (s.created_at IS NULL OR SUBSTR(s.created_at, 1, 10) <= ?)
        AND ${ofProjects.sql}
    `).get(toDate, ...ofProjects.params);

    const savingsPlans = db.prepare(`
      SELECT COUNT(DISTINCT d.description) as count, ROUND(SUM(d.total_price), 2) as total
      FROM bill_details d
      JOIN bills b ON d.bill_id = b.id
      WHERE b.date >= ? AND b.date <= ?
        AND d.description LIKE 'Savings plan%'
        AND ${ofBills.sql}
    `).get(fromDate, toDate, ...ofBills.params);

    // Count Container Registry services
    const registry = db.prepare(`
      SELECT COUNT(DISTINCT domain) as count, ROUND(SUM(total_price), 2) as total
      FROM bill_details d
      JOIN bills b ON d.bill_id = b.id
      WHERE b.date >= ? AND b.date <= ?
        AND (LOWER(description) LIKE '%registry%' OR LOWER(description) LIKE '%container registry%' OR LOWER(description) LIKE '%harbor%')
        AND ${ofBills.sql}
    `).get(fromDate, toDate, ...ofBills.params);

    // Count AI/ML services
    const aiml = db.prepare(`
      SELECT COUNT(DISTINCT domain) as count, ROUND(SUM(total_price), 2) as total
      FROM bill_details d
      JOIN bills b ON d.bill_id = b.id
      WHERE b.date >= ? AND b.date <= ?
        AND (LOWER(description) LIKE '%ai training%' OR LOWER(description) LIKE '%ai deploy%' OR LOWER(description) LIKE '%notebook%' OR LOWER(description) LIKE '%ml%')
        AND ${ofBills.sql}
    `).get(fromDate, toDate, ...ofBills.params);

    // Count Load Balancers
    const lbs = db.prepare(`
      SELECT COUNT(DISTINCT domain) as count, ROUND(SUM(total_price), 2) as total
      FROM bill_details d
      JOIN bills b ON d.bill_id = b.id
      WHERE b.date >= ? AND b.date <= ?
        AND (LOWER(description) LIKE '%load balancer%' OR LOWER(description) LIKE '%loadbalancer%' OR LOWER(description) LIKE '%octavia%')
        AND ${ofBills.sql}
    `).get(fromDate, toDate, ...ofBills.params);

    return {
      kubernetes: { count: k8s?.count || 0, total: k8s?.total || 0 },
      instances: { total: instances?.total || 0 },
      volumes: { count: volumeCount?.count || 0, total: volumes?.total || 0 },
      snapshots: { count: snapshotCount?.count || 0, total: snapshots?.total || 0 },
      savingsPlans: { count: savingsPlans?.count || 0, total: savingsPlans?.total || 0 },
      objectStorage: { count: s3?.count || 0, total: s3Total?.total || 0 },
      registry: { count: registry?.count || 0, total: registry?.total || 0 },
      aiml: { count: aiml?.count || 0, total: aiml?.total || 0 },
      loadBalancers: { count: lbs?.count || 0, total: lbs?.total || 0 }
    };
  },

  // Backup stats (Veeam etc)
  getBackupStats: (fromDate, toDate) => {
    const db = getDb();
    
    // Count Veeam backup VMs
    const vms = db.prepare(`
      SELECT COUNT(DISTINCT domain) as count, ROUND(SUM(total_price), 2) as total
      FROM bill_details d
      JOIN bills b ON d.bill_id = b.id
      WHERE b.date >= ? AND b.date <= ?
        AND resource_type = 'backup'
    `).get(fromDate, toDate);

    // Veeam Enterprise licenses (from descriptions)
    const enterprise = db.prepare(`
      SELECT COUNT(DISTINCT domain) as count, ROUND(SUM(total_price), 2) as total
      FROM bill_details d
      JOIN bills b ON d.bill_id = b.id
      WHERE b.date >= ? AND b.date <= ?
        AND (LOWER(description) LIKE '%veeam%' AND LOWER(description) LIKE '%enterprise%')
    `).get(fromDate, toDate);

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

  const lines = db.prepare(`
    SELECT d.description as description, d.total_price as price
    FROM bill_details d
    JOIN bills b ON d.bill_id = b.id
    WHERE d.project_id = ?
      AND b.date >= ? AND b.date <= ?
      AND (d.description LIKE 'Forfait mensuel pour une instance%'
           OR d.description LIKE 'Prorata de la facturation mensuelle d%une instance%'
           OR d.description LIKE 'Consommation à l%heure pour les instances%')
  `).all(projectId, fromDate, toDate);

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
    // Monthly fee or its prorata: charged to the instance named by its id
    const monthly = line.description.match(/\(id ([0-9a-f-]{36})/i);
    if (monthly) {
      if (known.has(monthly[1])) add(monthly[1], line.price, false);
      else unmatched += line.price;
      continue;
    }

    // "Consommation à l'heure pour les instances <flavor> [<region>]"
    const rest = line.description.replace(/^Consommation à l.heure pour les instances\s*/i, '').trim();
    if (!rest) { unmatched += line.price; continue; }

    const tokens = rest.split(/\s+/);
    const candidates = [];
    if (tokens.length > 1) {
      const region = tokens[tokens.length - 1].toLowerCase();
      const flavor = normalizeFlavor(tokens.slice(0, -1).join('-'));
      candidates.push(...hourly.filter(i =>
        (i.region || '').toLowerCase() === region &&
        (normalizeFlavor(i.plan_code) === flavor || normalizeFlavor(i.flavor) === flavor)
      ));
    }
    if (!candidates.length) {
      const flavor = normalizeFlavor(rest.replace(/\s+/g, '-'));
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

// Cloud detail operations (Phase 4)
const cloudDetailOps = {
  // The first day of the month of the current consumption, which the readers show when no
  // month is asked for: the month that the last import of the consumption covered, even
  // with no usage yet. The consumption of every month is kept (#54). Each account records
  // its own (#114): the latest of them, until the readers follow the account (#116). Before
  // any import records its month, the latest month stored; null when there is none.
  getCurrentConsumptionMonth: () => {
    const db = getDb();
    const recorded = db.prepare(
      "SELECT MAX(value) AS month FROM import_state WHERE key = 'consumption_month'"
    ).get().month;
    if (recorded) return recorded;
    return db.prepare('SELECT MAX(period_start) as month FROM project_consumption').get().month;
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
        storage_class: b.storage_class || null,
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
      const match = line.description.match(/à\s+(\S+)\s+de type\s+(.+)$/i);
      const region = (match?.[1] || '').toLowerCase();
      const type = (match?.[2] || '').trim().toLowerCase();
      const matching = volumes.filter(v =>
        (v.region || '').toLowerCase() === region && (v.type || '').toLowerCase() === type
      );
      if (!allocateProRata(matching, line.total, v => v.size_gb)) {
        volumes.push({
          id: null, name: line.description, region: match?.[1] || null, type: match?.[2] || null,
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

  // Aggregate total cloud consumption across all projects for the current period
  getConsumptionSummary: () => {
    const db = getDb();
    return db.prepare(`
      SELECT
        MIN(period_start) as period_start,
        MAX(period_end) as period_end,
        SUM(total_price) as total,
        COUNT(DISTINCT project_id) as project_count
      FROM project_consumption
      WHERE period_start = ?
    `).get(cloudDetailOps.getCurrentConsumptionMonth());
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

    // By project from bills, and by account when asked (see projectGrouping(), #118)
    const grouping = projectGrouping('bd.domain', byAccount);
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

    // Get GPU flavors per project from project_consumption (current month detail)
    const projectFlavors = db.prepare(`
      SELECT project_id, GROUP_CONCAT(DISTINCT resource_name) as gpu_flavors
      FROM project_consumption
      WHERE period_start = ?
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
 * Clears the imported data of every account, and of none, as a full import did before #114:
 * a full import now clears each account that it imports again, see clearAccount(). What an
 * import cannot fetch again is kept: the consumption of each project, of which OVH gives the
 * current month only (#54), with the month of its last import (import_state) and the
 * projects it belongs to. The account and consumption snapshots are cleared: only their
 * latest is read, which an import fetches again.
 * @param {?number} [importId] - The import log entry to keep, as it tells the other imports
 *   that one runs. The rest of the log is cleared.
 */
function clearAll(importId = null) {
  const db = getDb();
  // Supprimer d'abord toutes les tables qui référencent projects ou bills
  db.exec('DELETE FROM bill_details');
  db.exec('DELETE FROM cloud_instances');
  db.exec('DELETE FROM project_quotas');
  db.exec('DELETE FROM object_storage_buckets');
  db.exec('DELETE FROM cloud_volumes');
  db.exec('DELETE FROM cloud_snapshots');
  db.exec('DELETE FROM bills');
  db.exec('DELETE FROM projects WHERE id NOT IN (SELECT project_id FROM project_consumption)');
  // Optionnel : vider aussi les autres tables annexes si besoin
  db.prepare('DELETE FROM import_log WHERE id IS NOT ?').run(importId);
  db.exec('DELETE FROM consumption_snapshots');
  db.exec('DELETE FROM consumption_history');
  db.exec('DELETE FROM account_balance');
  db.exec('DELETE FROM credit_movements');
  db.exec('DELETE FROM dedicated_servers');
  db.exec('DELETE FROM vps_instances');
  db.exec('DELETE FROM storage_services');
}

/**
 * Clears the imported data of an account, for a full import of it (#114): its bills and
 * their lines, its inventories, the resources of its projects, its balance and consumption
 * snapshots, its credit movements and its consumption history, which the import fetches
 * again. What it cannot fetch again is kept, as clearAll() keeps it: the consumption of each
 * of its projects, with the month of its last import and the projects it belongs to. Another
 * account's data, and the rows without an account, stay, with the projects of this account
 * whose lines are on another account's bills.
 * @param {string} nic - The NIC handle of the account
 */
function clearAccount(nic) {
  const db = getDb();
  const run = (sql) => db.prepare(sql).run(nic);
  // First the rows that reference its bills and its projects
  run('DELETE FROM bill_details WHERE bill_id IN (SELECT id FROM bills WHERE account = ?)');
  for (const table of [
    'cloud_instances', 'project_quotas', 'object_storage_buckets', 'cloud_volumes',
    'cloud_snapshots',
  ]) {
    run(`DELETE FROM ${table} WHERE project_id IN (SELECT id FROM projects WHERE account = ?)`);
  }
  run('DELETE FROM bills WHERE account = ?');
  run(`
    DELETE FROM projects WHERE account = ?
      AND id NOT IN (SELECT project_id FROM project_consumption)
      AND id NOT IN (SELECT project_id FROM bill_details WHERE project_id IS NOT NULL)
  `);
  for (const table of [
    'consumption_snapshots', 'consumption_history', 'account_balance', 'credit_movements',
    'dedicated_servers', 'vps_instances', 'storage_services',
  ]) {
    run(`DELETE FROM ${table} WHERE account = ?`);
  }
}

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

module.exports = {
  getDb,
  closeDb,
  clearAll,
  clearAccount,
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
  webCloud: webCloudOps
};
