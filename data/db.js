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

let db = null;

/**
 * Safely add a column to a table if it doesn't exist
 */
function addColumnIfNotExists(database, table, column, type) {
  const columns = database.pragma(`table_info(${table})`);
  if (!columns.find(c => c.name === column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

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
  upsert: (project) => {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO projects (id, name, description, status, created_at, updated_at)
      VALUES (@id, @name, @description, @status, @created_at, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        name = @name,
        description = @description,
        status = @status,
        updated_at = CURRENT_TIMESTAMP
    `);
    return stmt.run(project);
  },

  getAll: () => {
    const db = getDb();
    return db.prepare('SELECT * FROM projects ORDER BY name').all();
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
      INSERT INTO bills (id, date, price_without_tax, price_with_tax, tax, currency, pdf_url, html_url, imported_at)
      VALUES (@id, @date, @price_without_tax, @price_with_tax, @tax, @currency, @pdf_url, @html_url, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        date = @date,
        price_without_tax = @price_without_tax,
        price_with_tax = @price_with_tax,
        tax = @tax,
        currency = @currency,
        pdf_url = @pdf_url,
        html_url = @html_url,
        imported_at = CURRENT_TIMESTAMP
    `);
    return stmt.run(bill);
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

  getLatestDate: () => {
    const db = getDb();
    const result = db.prepare('SELECT MAX(date) as latest FROM bills').get();
    return result?.latest;
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

  complete: (id, stats) => {
    const db = getDb();
    const stmt = db.prepare(`
      UPDATE import_log SET
        completed_at = CURRENT_TIMESTAMP,
        bills_imported = ?,
        details_imported = ?,
        projects_imported = ?,
        status = 'success'
      WHERE id = ?
    `);
    return stmt.run(stats.bills, stats.details, stats.projects, id);
  },

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

  getLatest: () => {
    const db = getDb();
    return db.prepare('SELECT * FROM import_log ORDER BY id DESC LIMIT 1').get();
  },

  getAll: () => {
    const db = getDb();
    return db.prepare('SELECT * FROM import_log ORDER BY id DESC').all();
  },

  // An import is in progress when the latest entry is still 'running' and
  // started less than 30 minutes ago (an older one is a crashed run).
  // started_at is a UTC CURRENT_TIMESTAMP without timezone, so its age is
  // computed in SQL against 'now', which is UTC too.
  isRunning: () => {
    const db = getDb();
    const running = db.prepare(`
      SELECT 1 FROM import_log
      WHERE id = (SELECT MAX(id) FROM import_log)
        AND status = 'running'
        AND datetime(started_at) > datetime('now', '-30 minutes')
    `).get();
    return Boolean(running);
  }
};

// Analysis queries
const analysisOps = {
  // The costs of each project billed between two dates, most expensive first. A project
  // missing from the projects table keeps the id of its bill lines, without a name: the
  // dashboard tells such projects apart by their id (#55).
  byProject: (fromDate, toDate) => {
    const db = getDb();
    return db.prepare(`
      SELECT
        d.project_id as project_id,
        p.name as project_name,
        SUM(d.total_price) as total,
        COUNT(d.id) as details_count
      FROM bill_details d
      JOIN bills b ON d.bill_id = b.id
      LEFT JOIN projects p ON d.project_id = p.id
      WHERE b.date >= ? AND b.date <= ?
        AND d.project_id IS NOT NULL
      GROUP BY d.project_id
      ORDER BY total DESC
    `).all(fromDate, toDate);
  },

  byService: (fromDate, toDate) => {
    const db = getDb();
    return db.prepare(`
      SELECT
        d.service_type,
        SUM(d.total_price) as total,
        COUNT(d.id) as details_count
      FROM bill_details d
      JOIN bills b ON d.bill_id = b.id
      WHERE b.date >= ? AND b.date <= ?
      GROUP BY d.service_type
      ORDER BY total DESC
    `).all(fromDate, toDate);
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
  // for the Trends tab to say it has no data.
  monthlyTrend: (fromDate, toDate) => {
    const db = getDb();
    const billed = db.prepare(`
      SELECT
        strftime('%Y-%m', b.date) as month,
        SUM(d.total_price) as total
      FROM bill_details d
      JOIN bills b ON d.bill_id = b.id
      WHERE b.date >= ? AND b.date <= ?
      GROUP BY strftime('%Y-%m', b.date)
      ORDER BY month
    `).all(fromDate, toDate);
    if (billed.length === 0) return [];
    const totals = new Map(billed.map(({ month, total }) => [month, total]));
    return monthsOfWindow(fromDate, toDate)
      .map((month) => ({ month, total: totals.get(month) ?? 0 }));
  },

  // The cost of each resource type billed between two dates, both included, in every month
  // between them, 0 for a month it was not billed in: each resource type's trend gives
  // every month, as the monthly trend does (#65). Nothing when none of them has a bill,
  // since no resource type was billed.
  monthlyTrendByResourceType: (fromDate, toDate) => {
    const db = getDb();
    const billed = db.prepare(`
      SELECT
        strftime('%Y-%m', b.date) as month,
        COALESCE(d.resource_type, 'other') as resource_type,
        SUM(d.total_price) as total
      FROM bill_details d
      JOIN bills b ON d.bill_id = b.id
      WHERE b.date >= ? AND b.date <= ?
      GROUP BY strftime('%Y-%m', b.date), COALESCE(d.resource_type, 'other')
      ORDER BY month
    `).all(fromDate, toDate);
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

  summary: (fromDate, toDate) => {
    const db = getDb();

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
    `).get(fromDate, toDate);

    return totals;
  },

  nonCloudTotal: (fromDate, toDate) => {
    const db = getDb();
    return db.prepare(`
      SELECT
        SUM(d.total_price) as total,
        COUNT(d.id) as items_count
      FROM bill_details d
      JOIN bills b ON d.bill_id = b.id
      WHERE b.date >= ? AND b.date <= ?
        AND d.project_id IS NULL
    `).get(fromDate, toDate);
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
      INSERT INTO consumption_snapshots (snapshot_date, period_start, period_end, current_total, forecast_total, currency, raw_data)
      VALUES (CURRENT_TIMESTAMP, @period_start, @period_end, @current_total, @forecast_total, @currency, @raw_data)
    `);
    return stmt.run(snapshot);
  },

  getLatestSnapshot: () => {
    const db = getDb();
    return db.prepare('SELECT * FROM consumption_snapshots ORDER BY id DESC LIMIT 1').get();
  },

  insertHistory: (entry) => {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO consumption_history (period_start, period_end, service_type, total, currency, raw_data, imported_at)
      VALUES (@period_start, @period_end, @service_type, @total, @currency, @raw_data, CURRENT_TIMESTAMP)
    `);
    return stmt.run(entry);
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

  clearHistory: () => {
    const db = getDb();
    db.exec('DELETE FROM consumption_history');
  }
};

// Account balance operations (Phase 2)
const accountOps = {
  insertBalance: (balance) => {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO account_balance (snapshot_date, debt_balance, credit_balance, deposit_total, currency)
      VALUES (CURRENT_TIMESTAMP, @debt_balance, @credit_balance, @deposit_total, @currency)
    `);
    return stmt.run(balance);
  },

  getLatestBalance: () => {
    const db = getDb();
    return db.prepare('SELECT * FROM account_balance ORDER BY id DESC LIMIT 1').get();
  },

  insertCreditMovement: (movement) => {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO credit_movements (id, balance_name, amount, date, description, movement_type, imported_at)
      VALUES (@id, @balance_name, @amount, @date, @description, @movement_type, CURRENT_TIMESTAMP)
    `);
    return stmt.run(movement);
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

// Inventory operations (Phase 3)
const inventoryOps = {
  // Dedicated servers
  upsertServer: (server) => {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO dedicated_servers (id, display_name, reverse, datacenter, os, state, cpu, ram_size, disk_info, bandwidth, expiration_date, renewal_type, imported_at)
      VALUES (@id, @display_name, @reverse, @datacenter, @os, @state, @cpu, @ram_size, @disk_info, @bandwidth, @expiration_date, @renewal_type, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        display_name = @display_name, reverse = @reverse, datacenter = @datacenter, os = @os, state = @state,
        cpu = @cpu, ram_size = @ram_size, disk_info = @disk_info, bandwidth = @bandwidth,
        expiration_date = @expiration_date, renewal_type = @renewal_type, imported_at = CURRENT_TIMESTAMP
    `);
    return stmt.run(server);
  },

  getAllServers: () => {
    const db = getDb();
    return db.prepare('SELECT * FROM dedicated_servers ORDER BY display_name').all();
  },

  // VPS
  upsertVps: (vps) => {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO vps_instances (id, display_name, model, zone, state, os, vcpus, ram_mb, disk_gb, expiration_date, renewal_type, ip_addresses, imported_at)
      VALUES (@id, @display_name, @model, @zone, @state, @os, @vcpus, @ram_mb, @disk_gb, @expiration_date, @renewal_type, @ip_addresses, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        display_name = @display_name, model = @model, zone = @zone, state = @state, os = @os,
        vcpus = @vcpus, ram_mb = @ram_mb, disk_gb = @disk_gb,
        expiration_date = @expiration_date, renewal_type = @renewal_type, ip_addresses = @ip_addresses, imported_at = CURRENT_TIMESTAMP
    `);
    return stmt.run(vps);
  },

  getAllVps: () => {
    const db = getDb();
    return db.prepare('SELECT * FROM vps_instances ORDER BY display_name').all();
  },

  // Storage
  upsertStorage: (storage) => {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO storage_services (id, service_type, display_name, region, total_size_gb, used_size_gb, share_count, expiration_date, imported_at)
      VALUES (@id, @service_type, @display_name, @region, @total_size_gb, @used_size_gb, @share_count, @expiration_date, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        service_type = @service_type, display_name = @display_name, region = @region,
        total_size_gb = @total_size_gb, used_size_gb = @used_size_gb, share_count = @share_count,
        expiration_date = @expiration_date, imported_at = CURRENT_TIMESTAMP
    `);
    return stmt.run(storage);
  },

  getAllStorage: () => {
    const db = getDb();
    return db.prepare('SELECT * FROM storage_services ORDER BY display_name').all();
  },

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

    return [...servers, ...vps, ...storages];
  },

  // Analysis by resource type
  byResourceType: (fromDate, toDate) => {
    const db = getDb();
    return db.prepare(`
      SELECT
        COALESCE(d.resource_type, 'other') as resource_type,
        SUM(d.total_price) as total,
        COUNT(d.id) as details_count,
        COUNT(DISTINCT d.domain) as service_count
      FROM bill_details d
      JOIN bills b ON d.bill_id = b.id
      WHERE b.date >= ? AND b.date <= ?
      GROUP BY d.resource_type
      ORDER BY total DESC
    `).all(fromDate, toDate);
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

  // Public Cloud detailed stats (Kubernetes clusters, S3 buckets, etc)
  getPublicCloudStats: (fromDate, toDate) => {
    const db = getDb();
    
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
    `).get(fromDate, toDate);

    // Count object storage buckets from the imported inventory (buckets that exist
    // right now, including the ones that cost nothing over the period). Falls back
    // to the billing-derived count when the inventory has never been imported.
    let s3 = db.prepare(`
      SELECT COUNT(*) as count FROM object_storage_buckets
      WHERE created_at IS NULL OR SUBSTR(created_at, 1, 10) <= ?
    `).get(toDate);
    if (!s3?.count) {
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
          GROUP BY description
        )
      `).get(fromDate, toDate);
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
    `).get(fromDate, toDate);

    // Instances: monthly + hourly lines. Savings plans read as "%instance%" but
    // are prepaid compute billed on their own line, they are counted apart.
    const instances = db.prepare(`
      SELECT ROUND(SUM(d.total_price), 2) as total
      FROM bill_details d
      JOIN bills b ON d.bill_id = b.id
      WHERE b.date >= ? AND b.date <= ?
        AND (d.description LIKE 'Forfait mensuel pour une instance%'
             OR d.description LIKE 'Consommation à l%heure pour les instances%')
    `).get(fromDate, toDate);

    const volumes = db.prepare(`
      SELECT ROUND(SUM(d.total_price), 2) as total
      FROM bill_details d
      JOIN bills b ON d.bill_id = b.id
      WHERE b.date >= ? AND b.date <= ?
        AND d.description LIKE 'Disques supplémentaires%'
    `).get(fromDate, toDate);
    const volumeCount = db.prepare(`
      SELECT COUNT(*) as count FROM cloud_volumes
      WHERE created_at IS NULL OR SUBSTR(created_at, 1, 10) <= ?
    `).get(toDate);

    const snapshots = db.prepare(`
      SELECT ROUND(SUM(d.total_price), 2) as total
      FROM bill_details d
      JOIN bills b ON d.bill_id = b.id
      WHERE b.date >= ? AND b.date <= ?
        AND d.description LIKE 'Snapshots Public Cloud%'
    `).get(fromDate, toDate);
    const snapshotCount = db.prepare(`
      SELECT COUNT(*) as count FROM cloud_snapshots
      WHERE created_at IS NULL OR SUBSTR(created_at, 1, 10) <= ?
    `).get(toDate);

    const savingsPlans = db.prepare(`
      SELECT COUNT(DISTINCT d.description) as count, ROUND(SUM(d.total_price), 2) as total
      FROM bill_details d
      JOIN bills b ON d.bill_id = b.id
      WHERE b.date >= ? AND b.date <= ?
        AND d.description LIKE 'Savings plan%'
    `).get(fromDate, toDate);

    // Count Container Registry services
    const registry = db.prepare(`
      SELECT COUNT(DISTINCT domain) as count, ROUND(SUM(total_price), 2) as total
      FROM bill_details d
      JOIN bills b ON d.bill_id = b.id
      WHERE b.date >= ? AND b.date <= ?
        AND (LOWER(description) LIKE '%registry%' OR LOWER(description) LIKE '%container registry%' OR LOWER(description) LIKE '%harbor%')
    `).get(fromDate, toDate);

    // Count AI/ML services
    const aiml = db.prepare(`
      SELECT COUNT(DISTINCT domain) as count, ROUND(SUM(total_price), 2) as total
      FROM bill_details d
      JOIN bills b ON d.bill_id = b.id
      WHERE b.date >= ? AND b.date <= ?
        AND (LOWER(description) LIKE '%ai training%' OR LOWER(description) LIKE '%ai deploy%' OR LOWER(description) LIKE '%notebook%' OR LOWER(description) LIKE '%ml%')
    `).get(fromDate, toDate);

    // Count Load Balancers
    const lbs = db.prepare(`
      SELECT COUNT(DISTINCT domain) as count, ROUND(SUM(total_price), 2) as total
      FROM bill_details d
      JOIN bills b ON d.bill_id = b.id
      WHERE b.date >= ? AND b.date <= ?
        AND (LOWER(description) LIKE '%load balancer%' OR LOWER(description) LIKE '%loadbalancer%' OR LOWER(description) LIKE '%octavia%')
    `).get(fromDate, toDate);

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
  // with no usage yet. The consumption of every month is kept (#54). Before any import
  // records its month, the latest month stored; null when there is none.
  getCurrentConsumptionMonth: () => {
    const db = getDb();
    const recorded = db.prepare(
      "SELECT value FROM import_state WHERE key = 'consumption_month'"
    ).get();
    if (recorded) return recorded.value;
    return db.prepare('SELECT MAX(period_start) as month FROM project_consumption').get().month;
  },

  setCurrentConsumptionMonth: (periodStart) => {
    const db = getDb();
    db.prepare(`
      INSERT INTO import_state (key, value, updated_at)
      VALUES ('consumption_month', ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).run(periodStart);
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
  clearByProject: (projectId) => {
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

  // GPU cost summary from bill_details (covers full history) + project_consumption (current month)
  getGpuSummary: (from, to) => {
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

    let dateFilter = '';
    const params = {};
    if (from) { dateFilter += ' AND b.date >= @from'; params.from = from; }
    if (to) { dateFilter += ' AND b.date <= @to'; params.to = to; }

    // Total GPU cost from bills
    const total = db.prepare(`
      SELECT SUM(bd.total_price) as total, COUNT(DISTINCT bd.domain) as project_count
      FROM bill_details bd
      JOIN bills b ON bd.bill_id = b.id
      WHERE ${GPU_DESC_WHERE} ${dateFilter}
    `).get(params);

    // By GPU model from bills
    const byModel = db.prepare(`
      SELECT
        ${GPU_MODEL_CASE} as gpu_model,
        SUM(bd.total_price) as total,
        COUNT(*) as count
      FROM bill_details bd
      JOIN bills b ON bd.bill_id = b.id
      WHERE ${GPU_DESC_WHERE} ${dateFilter}
      GROUP BY gpu_model
      ORDER BY total DESC
    `).all(params);

    // By project from bills
    const byProject = db.prepare(`
      SELECT
        COALESCE(p.name, bd.domain) as project_name,
        bd.domain as project_id,
        SUM(bd.total_price) as total
      FROM bill_details bd
      JOIN bills b ON bd.bill_id = b.id
      LEFT JOIN projects p ON bd.domain = p.id
      WHERE ${GPU_DESC_WHERE} ${dateFilter}
      GROUP BY bd.domain
      ORDER BY total DESC
    `).all(params);

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
      WHERE ${GPU_DESC_WHERE} ${dateFilter}
      GROUP BY month
      ORDER BY month
    `).all(params);

    return {
      total: total?.total || 0,
      project_count: total?.project_count || 0,
      byModel,
      byProject,
      monthlyTrend
    };
  },

  // GPU instances from cloud_instances (uses plan_code)
  getGpuInstances: () => {
    const db = getDb();
    return db.prepare(`
      SELECT ci.*, p.name as project_name
      FROM cloud_instances ci
      JOIN projects p ON ci.project_id = p.id
      WHERE ci.plan_code LIKE 'l4-%' OR ci.plan_code LIKE 'l40s-%'
        OR ci.plan_code LIKE 'a100-%' OR ci.plan_code LIKE 't1-%'
        OR ci.plan_code LIKE 't2-%' OR ci.plan_code LIKE 'h100-%'
        OR ci.plan_code LIKE 'v100-%'
      ORDER BY p.name, ci.name
    `).all();
  }
};

// Clear all data (for full import)
function clearAll() {
  const db = getDb();
  // Supprimer d'abord toutes les tables qui référencent projects ou bills
  db.exec('DELETE FROM bill_details');
  db.exec('DELETE FROM project_consumption');
  db.exec('DELETE FROM cloud_instances');
  db.exec('DELETE FROM project_quotas');
  db.exec('DELETE FROM object_storage_buckets');
  db.exec('DELETE FROM cloud_volumes');
  db.exec('DELETE FROM cloud_snapshots');
  db.exec('DELETE FROM bills');
  db.exec('DELETE FROM projects');
  // Optionnel : vider aussi les autres tables annexes si besoin
  db.exec('DELETE FROM import_log');
  db.exec('DELETE FROM consumption_snapshots');
  db.exec('DELETE FROM consumption_history');
  db.exec('DELETE FROM account_balance');
  db.exec('DELETE FROM credit_movements');
  db.exec('DELETE FROM dedicated_servers');
  db.exec('DELETE FROM vps_instances');
  db.exec('DELETE FROM storage_services');
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
   * One row per service (bill `domain` field) with its family and cost.
   */
  getItems: (fromDate, toDate) => {
    const db = getDb();
    const rows = db.prepare(`
      SELECT d.domain as domain,
             d.description as description,
             d.total_price as price,
             b.date as date,
             COALESCE(d.resource_type, 'other') as resource_type
      FROM bill_details d
      JOIN bills b ON d.bill_id = b.id
      WHERE b.date >= ? AND b.date <= ?
        AND COALESCE(d.resource_type, 'other') IN ('domain', 'other', 'web_cloud')
        AND d.project_id IS NULL
    `).all(fromDate, toDate);

    // The Infrastructure tab leaves the 'domain' and 'web_cloud' types out, so
    // a line of those types the wording does not place still lands here. An
    // unrecognised 'other' line stays in the Infrastructure tab only.
    const fallback = { domain: 'domain', web_cloud: 'option' };

    const byService = new Map();
    for (const row of rows) {
      const category = classifyWebCloud(row.description, row.domain) || fallback[row.resource_type];
      if (!category) continue;

      // A domain and its DNS zone share the same `domain` value, so the family
      // is part of the key: they are two billable services.
      const key = `${category}|${row.domain}`;
      const item = byService.get(key) || {
        name: row.domain,
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

    return [...byService.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  },

  /**
   * Count and cost per family, for the summary cards.
   */
  getSummary: (fromDate, toDate) => {
    const items = webCloudOps.getItems(fromDate, toDate);
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
  transaction,
  allocateProRata,
  projects: projectOps,
  bills: billOps,
  details: detailOps,
  importLog: importLogOps,
  analysis: analysisOps,
  consumption: consumptionOps,
  account: accountOps,
  inventory: inventoryOps,
  cloudDetails: cloudDetailOps,
  webCloud: webCloudOps
};
