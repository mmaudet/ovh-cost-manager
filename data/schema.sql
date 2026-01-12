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
