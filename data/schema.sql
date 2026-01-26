-- OVH Bills Database Schema
-- SQLite database for storing OVH billing data

-- Cloud Projects
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,           -- OVH Project UUID
  name TEXT NOT NULL,
  description TEXT,
  status TEXT,
  created_at DATETIME,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
  imported_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
  error_message TEXT
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
  raw_data TEXT  -- JSON brut pour détails par service
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
  imported_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_consumption_history_period ON consumption_history(period_start, period_end);

-- Account balance (debt + credits)
CREATE TABLE IF NOT EXISTS account_balance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  debt_balance REAL DEFAULT 0,
  credit_balance REAL DEFAULT 0,
  deposit_total REAL DEFAULT 0,
  currency TEXT DEFAULT 'EUR'
);

-- Credit movements
CREATE TABLE IF NOT EXISTS credit_movements (
  id TEXT PRIMARY KEY,
  balance_name TEXT NOT NULL,
  amount REAL,
  date DATETIME,
  description TEXT,
  movement_type TEXT,
  imported_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
  imported_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
  imported_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
  imported_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
