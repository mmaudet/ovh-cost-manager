const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.resolve(__dirname, 'ovh-bills.db');
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

    // Classify resource_type for bill_details that haven't been classified yet
    classifyResourceTypes(db);
  }
  return db;
}

/**
 * Classify resource_type on bill_details based on domain patterns
 */
function classifyResourceTypes(database) {
  const unclassified = database.prepare(
    'SELECT COUNT(*) as cnt FROM bill_details WHERE resource_type IS NULL'
  ).get();
  if (unclassified.cnt === 0) return;

  // Match domains to known project IDs
  database.exec(`
    UPDATE bill_details SET resource_type = 'cloud_project'
    WHERE resource_type IS NULL AND domain IN (SELECT id FROM projects)
  `);

  // Dedicated servers: ns*.ip-*.eu or ns*.ovh.net patterns
  database.exec(`
    UPDATE bill_details SET resource_type = 'dedicated_server'
    WHERE resource_type IS NULL AND (domain LIKE 'ns%ip-%.eu' OR domain LIKE 'ns%.ovh.net')
  `);

  // Load balancers
  database.exec(`
    UPDATE bill_details SET resource_type = 'load_balancer'
    WHERE resource_type IS NULL AND domain LIKE 'loadbalancer-%'
  `);

  // Storage (zpool)
  database.exec(`
    UPDATE bill_details SET resource_type = 'storage'
    WHERE resource_type IS NULL AND domain LIKE 'zpool-%'
  `);

  // IP blocks
  database.exec(`
    UPDATE bill_details SET resource_type = 'ip_service'
    WHERE resource_type IS NULL AND (domain LIKE 'ip-%' OR domain LIKE '%.ip-%')
  `);

  // Domain names
  database.exec(`
    UPDATE bill_details SET resource_type = 'domain'
    WHERE resource_type IS NULL AND (domain LIKE '%.com' OR domain LIKE '%.fr' OR domain LIKE '%.org'
      OR domain LIKE '%.net' OR domain LIKE '%.io' OR domain LIKE '%.eu'
      OR domain LIKE '%.cloud' OR domain LIKE '%.tech' OR domain LIKE '%.dev'
      OR domain LIKE '%.info' OR domain LIKE '%.pro')
    AND domain NOT LIKE 'ns%'
  `);

  // Telephony (phone numbers)
  database.exec(`
    UPDATE bill_details SET resource_type = 'telephony'
    WHERE resource_type IS NULL AND domain GLOB '[0-9]*' AND LENGTH(domain) >= 10
  `);

  // Everything remaining
  database.exec(`
    UPDATE bill_details SET resource_type = 'other'
    WHERE resource_type IS NULL
  `);
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
  }
};

// Analysis queries
const analysisOps = {
  byProject: (fromDate, toDate) => {
    const db = getDb();
    return db.prepare(`
      SELECT
        p.id as project_id,
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

  monthlyTrend: (months = 6) => {
    const db = getDb();
    return db.prepare(`
      SELECT
        strftime('%Y-%m', b.date) as month,
        SUM(d.total_price) as total
      FROM bill_details d
      JOIN bills b ON d.bill_id = b.id
      WHERE b.date >= date('now', 'start of month', '-' || ? || ' months')
      GROUP BY strftime('%Y-%m', b.date)
      ORDER BY month
    `).all(months);
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

  clearAll: () => {
    const db = getDb();
    db.exec('DELETE FROM dedicated_servers');
    db.exec('DELETE FROM vps_instances');
    db.exec('DELETE FROM storage_services');
  }
};

// Cloud detail operations (Phase 4)
const cloudDetailOps = {
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
    }
    query += ' ORDER BY period_start DESC';
    return db.prepare(query).all(...params);
  },

  getConsumptionByResourceType: (projectId) => {
    const db = getDb();
    return db.prepare(`
      SELECT resource_type, SUM(total_price) as total, COUNT(*) as count
      FROM project_consumption
      WHERE project_id = ?
      GROUP BY resource_type
      ORDER BY total DESC
    `).all(projectId);
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

  getInstancesByProject: (projectId) => {
    const db = getDb();
    return db.prepare('SELECT * FROM cloud_instances WHERE project_id = ? ORDER BY name').all(projectId);
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

  clearByProject: (projectId) => {
    const db = getDb();
    db.prepare('DELETE FROM project_consumption WHERE project_id = ?').run(projectId);
    db.prepare('DELETE FROM cloud_instances WHERE project_id = ?').run(projectId);
    db.prepare('DELETE FROM project_quotas WHERE project_id = ?').run(projectId);
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
    `).get();
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
      WHERE resource_name LIKE 'l4-%' OR resource_name LIKE 'l40s-%'
        OR resource_name LIKE 'a100-%' OR resource_name LIKE 't1-%'
        OR resource_name LIKE 't2-%' OR resource_name LIKE 'h100-%'
        OR resource_name LIKE 'v100-%'
      GROUP BY project_id
    `).all();
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
  db.exec('DELETE FROM bill_details');
  db.exec('DELETE FROM bills');
  db.exec('DELETE FROM projects');
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

module.exports = {
  getDb,
  closeDb,
  clearAll,
  transaction,
  projects: projectOps,
  bills: billOps,
  details: detailOps,
  importLog: importLogOps,
  analysis: analysisOps,
  consumption: consumptionOps,
  account: accountOps,
  inventory: inventoryOps,
  cloudDetails: cloudDetailOps
};
