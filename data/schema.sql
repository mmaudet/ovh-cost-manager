-- OVH Bills Database Schema
-- SQLite database for storing OVH billing data

-- The OVH accounts that the imports read (see CONTEXT.md), by the NIC handle that GET /me
-- names. Each row fed by the OVH API holds that NIC handle in an `account` column, or finds
-- it through its bill or its project.
CREATE TABLE IF NOT EXISTS accounts (
  nic TEXT PRIMARY KEY NOT NULL, -- NIC handle
  currency TEXT,                 -- The currency the account bills in
  last_import_at DATETIME,       -- When its last import ended, NULL until one has
  last_import_status TEXT,       -- 'success', 'failed'
  last_import_error TEXT,        -- Why its last import failed
  name TEXT,                     -- The name of its entry in config.json at its last import
  budget INTEGER,                -- The budget of that entry
  position INTEGER,              -- Its place in the configuration of the last run, from 0,
                                 -- NULL when that one does not list it any more (#114)
  claimed_bills INTEGER NOT NULL DEFAULT 0, -- How many bills stored before the accounts it
                                 -- claimed, over every run (#114)
  last_success_at DATETIME       -- When its last import that succeeded ended, NULL until one
                                 -- has: its data is as fresh as that import left it (#124)
);

-- Cloud Projects
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,           -- OVH Project UUID
  name TEXT NOT NULL,
  description TEXT,
  status TEXT,
  created_at DATETIME,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  account TEXT                   -- NIC handle of its account
);

-- Bills (invoices)
CREATE TABLE IF NOT EXISTS bills (
  id TEXT PRIMARY KEY,           -- Ex: FR12345678
  date DATE NOT NULL,
  price_without_tax REAL,
  price_with_tax REAL,
  tax REAL,
  currency TEXT DEFAULT 'EUR',
  pdf_url TEXT,
  html_url TEXT,
  imported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  account TEXT                   -- NIC handle of its account
);

-- Bill details (line items)
CREATE TABLE IF NOT EXISTS bill_details (
  id TEXT PRIMARY KEY,
  bill_id TEXT NOT NULL,
  project_id TEXT,               -- NULL if not cloud
  domain TEXT,
  description TEXT,
  quantity REAL,
  unit_price REAL,
  total_price REAL,
  service_type TEXT,             -- Compute, Storage, Network, Database, AI/ML, Other
  FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- Import log for tracking imports
CREATE TABLE IF NOT EXISTS import_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at DATETIME NOT NULL,
  completed_at DATETIME,
  type TEXT NOT NULL,            -- 'full', 'period', 'differential'
  from_date DATE,
  to_date DATE,
  bills_imported INTEGER DEFAULT 0,
  details_imported INTEGER DEFAULT 0,
  projects_imported INTEGER DEFAULT 0,
  status TEXT DEFAULT 'running', -- 'running', 'success', 'failed', 'partial'
  error_message TEXT,
  heartbeat_at DATETIME          -- When the running import last showed that it is alive
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_bills_date ON bills(date);
CREATE INDEX IF NOT EXISTS idx_details_bill ON bill_details(bill_id);
CREATE INDEX IF NOT EXISTS idx_details_project ON bill_details(project_id);
CREATE INDEX IF NOT EXISTS idx_details_service ON bill_details(service_type);
CREATE INDEX IF NOT EXISTS idx_import_log_date ON import_log(started_at);

-- OIDC Sessions for back-channel logout support
CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,              -- Session ID (cookie value)
  user_id TEXT NOT NULL,             -- OIDC subject (sub claim)
  id_token TEXT,                     -- ID token for RP-initiated logout
  user_info TEXT NOT NULL,           -- JSON: user claims (name, email, etc)
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- Consumption snapshots (current + forecast)
CREATE TABLE IF NOT EXISTS consumption_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  period_start DATE,
  period_end DATE,
  current_total REAL,
  forecast_total REAL,
  currency TEXT DEFAULT 'EUR',
  raw_data TEXT, -- JSON brut pour détails par service
  account TEXT                   -- NIC handle of its account
);

CREATE INDEX IF NOT EXISTS idx_consumption_snapshots_date ON consumption_snapshots(snapshot_date);

-- Consumption history
CREATE TABLE IF NOT EXISTS consumption_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  service_type TEXT,
  total REAL,
  currency TEXT DEFAULT 'EUR',
  raw_data TEXT,
  imported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  account TEXT                   -- NIC handle of its account
);

CREATE INDEX IF NOT EXISTS idx_consumption_history_period ON consumption_history(period_start, period_end);

-- Account balance (debt + credits)
CREATE TABLE IF NOT EXISTS account_balance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  debt_balance REAL DEFAULT 0,
  credit_balance REAL DEFAULT 0,
  deposit_total REAL DEFAULT 0,
  currency TEXT DEFAULT 'EUR',
  account TEXT                   -- NIC handle of its account
);

-- Credit movements, keyed by their account and their id: two accounts can have the same ids
-- (#114)
CREATE TABLE IF NOT EXISTS credit_movements (
  id TEXT,                       -- balanceName_movementId
  balance_name TEXT NOT NULL,
  amount REAL,
  date DATETIME,
  description TEXT,
  movement_type TEXT,
  imported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  account TEXT,                  -- NIC handle of its account
  PRIMARY KEY (account, id)
);

CREATE INDEX IF NOT EXISTS idx_credit_movements_date ON credit_movements(date);

-- Dedicated servers inventory
CREATE TABLE IF NOT EXISTS dedicated_servers (
  id TEXT PRIMARY KEY,              -- serviceName
  display_name TEXT,
  reverse TEXT,
  datacenter TEXT,
  os TEXT,
  state TEXT,
  cpu TEXT,
  ram_size INTEGER,                 -- Mo
  disk_info TEXT,                   -- JSON: [{type, capacity, count}]
  bandwidth INTEGER,               -- Mbps
  expiration_date DATE,
  renewal_type TEXT,
  imported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  account TEXT                      -- NIC handle of its account
);

-- VPS instances inventory
CREATE TABLE IF NOT EXISTS vps_instances (
  id TEXT PRIMARY KEY,              -- serviceName
  display_name TEXT,
  model TEXT,
  zone TEXT,
  state TEXT,
  os TEXT,
  vcpus INTEGER,
  ram_mb INTEGER,
  disk_gb INTEGER,
  expiration_date DATE,
  renewal_type TEXT,
  ip_addresses TEXT,                -- JSON array
  imported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  account TEXT                      -- NIC handle of its account
);

-- Storage services inventory
CREATE TABLE IF NOT EXISTS storage_services (
  id TEXT PRIMARY KEY,
  service_type TEXT,                -- 'netapp', etc.
  display_name TEXT,
  region TEXT,
  total_size_gb REAL,
  used_size_gb REAL,
  share_count INTEGER,
  expiration_date DATE,
  imported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  account TEXT                      -- NIC handle of its account
);

-- Cloud project consumption details
CREATE TABLE IF NOT EXISTS project_consumption (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  period_start DATE,
  period_end DATE,
  resource_type TEXT,
  resource_id TEXT,
  resource_name TEXT,
  quantity REAL,
  unit TEXT,
  unit_price REAL,
  total_price REAL,
  region TEXT,
  imported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_project_consumption_project ON project_consumption(project_id);
CREATE INDEX IF NOT EXISTS idx_project_consumption_period ON project_consumption(period_start, period_end);

-- The month-end forecast that OVH gives each cloud project (#224), from
-- GET /cloud/project/{id}/usage/forecast: the latest that an import stored, which the next
-- replaces, of the month that its own period gives. The consumption cards read those of the
-- month of the current consumption. A row reaches its account through its project, as a
-- project's consumption does.
CREATE TABLE IF NOT EXISTS project_forecasts (
  project_id TEXT PRIMARY KEY,
  period_start DATE NOT NULL,       -- The first day of the month that it forecasts
  total_price REAL NOT NULL,        -- What OVH forecasts the project to cost in that month
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- What the imports record for the readers, by key and by account (#114).
-- 'consumption_month': the first day of the month that the last import of the account's
-- project consumption covered. A row without an account is one recorded before the accounts.
CREATE TABLE IF NOT EXISTS import_state (
  key TEXT NOT NULL,
  value TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  account TEXT,                  -- NIC handle of its account
  PRIMARY KEY (key, account)
);

-- Cloud instances per project
CREATE TABLE IF NOT EXISTS cloud_instances (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT,
  flavor TEXT,
  region TEXT,
  status TEXT,
  created_at DATETIME,
  monthly_billing INTEGER DEFAULT 0,
  imported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_cloud_instances_project ON cloud_instances(project_id);

-- Project quotas
CREATE TABLE IF NOT EXISTS project_quotas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  region TEXT,
  max_cores INTEGER,
  max_instances INTEGER,
  max_ram_mb INTEGER,
  used_cores INTEGER,
  used_instances INTEGER,
  used_ram_mb INTEGER,
  snapshot_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_project_quotas_project ON project_quotas(project_id);

-- Object storage buckets (S3 + Cold Archive), imported from the OVH API.
-- Unlike the billing-derived view, this is a live inventory: buckets with no
-- cost in the selected period are still listed.
CREATE TABLE IF NOT EXISTS object_storage_buckets (
  id TEXT PRIMARY KEY,              -- projectId:region:name
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  region TEXT,
  storage_class TEXT,               -- 'Standard', 'High Performance', 'Standard IA', 'Cold Archive'
  status TEXT,                      -- Cold Archive only: 'none', 'archived', ...
  objects_count INTEGER,
  objects_size REAL,                -- bytes
  created_at DATETIME,
  imported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_object_storage_buckets_project ON object_storage_buckets(project_id);

-- Block storage volumes attached to (or detached from) cloud instances
CREATE TABLE IF NOT EXISTS cloud_volumes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT,
  region TEXT,
  type TEXT,                        -- 'classic', 'high-speed', ...
  size_gb REAL,
  status TEXT,
  bootable INTEGER DEFAULT 0,
  attached_to TEXT,                 -- comma-separated instance ids, empty when detached
  plan_code TEXT,
  created_at DATETIME,
  imported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_cloud_volumes_project ON cloud_volumes(project_id);

-- Instance snapshots (images)
CREATE TABLE IF NOT EXISTS cloud_snapshots (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT,
  region TEXT,
  size_gb REAL,
  status TEXT,
  visibility TEXT,
  os_type TEXT,
  created_at DATETIME,
  imported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_cloud_snapshots_project ON cloud_snapshots(project_id);

-- The carbon footprint that OVHcloud's carbon calculator attributes to each account, month by
-- month (#147): one row per line of the file it generates, a dedicated server, or an instance
-- flavor or a volume type in a datacenter. Every row carries its account from its first
-- import: none was stored before the accounts, and a full import keeps them (ADR 0003), so
-- the table is none of the account tables of data/ownership.js.
CREATE TABLE IF NOT EXISTS carbon_footprint_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account TEXT NOT NULL,              -- NIC handle of its account
  month TEXT NOT NULL,                -- YYYY-MM
  type TEXT,                          -- 'BAREMETAL', 'PCI-COMPUTE', 'PCI-BLOCK-STORAGE', ...
  datacenter TEXT,                    -- 'GRA', 'RBX', ..., or 'ALL'
  product_range TEXT,                 -- 'advance gen4', 'b2', 'classic', ...
  name TEXT,                          -- A server's model, a flavor ('b2-7.monthly'), a volume type
  server_domain TEXT,                 -- A dedicated server's service name, since July 2026
  manufacturing REAL NOT NULL,        -- Its emissions in kg CO2eq: the manufacturing's,
  electricity_location REAL NOT NULL, -- and the electricity's and the operations', each
  electricity_market REAL NOT NULL,   -- location-based and market-based
  operations_location REAL NOT NULL,
  operations_market REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_carbon_footprint_lines_month
  ON carbon_footprint_lines(account, month);
