/**
 * Tests for the costs by project of a period, which the Overview and the Compare tab read
 * through /api/analysis/by-project: the bill lines of each Public Cloud project added up,
 * most expensive project first, on a throwaway database.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

describe('costs by project', () => {
  let db;
  let dataDir;

  // A bill line of a Public Cloud project, or of no project for any other service
  const line = (id, billId, projectId, price) => ({
    id, bill_id: billId, project_id: projectId, domain: projectId || 'example.com',
    description: `${id} line`, quantity: 1, unit_price: price, total_price: price,
    service_type: 'Compute', resource_type: projectId ? 'cloud_project' : 'domain',
  });

  const bill = (id, date) => db.bills.upsert({
    id, date, price_without_tax: 0, price_with_tax: 0, tax: 0, currency: 'EUR',
    pdf_url: null, html_url: null,
  });

  const project = (id, name) => db.projects.upsert({
    id, name, description: name, status: 'ok', created_at: null,
  });

  // A row of the costs by project
  const costs = (projectId, projectName, total, detailsCount) => ({
    project_id: projectId, project_name: projectName, total, details_count: detailsCount,
  });

  beforeAll(() => {
    // data/db.js reads DATA_DIR once, when it is first required
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovh-project-costs-'));
    process.env.DATA_DIR = dataDir;
    db = require('../data/db');

    project('project-production', 'Production');
    project('project-staging', 'Staging');
    bill('FR0008', '2026-08-31');
    bill('FR0009', '2026-09-10');
    bill('FR0010', '2026-10-10');
    db.details.insertMany([
      line('FR0008-1', 'FR0008', 'project-production', 500),
      line('FR0009-1', 'FR0009', 'project-production', 100),
      line('FR0009-2', 'FR0009', 'project-production', 20),
      line('FR0009-3', 'FR0009', 'project-staging', 50),
      // A domain, billed to no project
      line('FR0009-4', 'FR0009', null, 12),
      line('FR0010-1', 'FR0010', 'project-production', 30),
    ]);

    // In October, bill lines of two projects missing from the projects table: the server
    // cannot name them. The foreign key forbids such lines, so they are written with it off
    // here, but databases in use hold some: the dashboard shows their projects as "Unknown".
    const sqlite = db.getDb();
    sqlite.pragma('foreign_keys = OFF');
    db.details.insertMany([
      line('FR0010-2', 'FR0010', 'project-gone-1', 40),
      line('FR0010-3', 'FR0010', 'project-gone-2', 15),
    ]);
    sqlite.pragma('foreign_keys = ON');
  });

  afterAll(() => {
    db.closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('adds up the bill lines of each project over the period, most expensive first', () => {
    expect(db.analysis.byProject('2026-09-01', '2026-09-30')).toEqual([
      costs('project-production', 'Production', 120, 2),
      costs('project-staging', 'Staging', 50, 1),
    ]);
  });

  // Without it, the Compare tab could not tell them apart (#55)
  test('gives a project missing from the projects table its own id, without a name', () => {
    expect(db.analysis.byProject('2026-10-01', '2026-10-31')).toEqual([
      costs('project-gone-1', null, 40, 1),
      costs('project-production', 'Production', 30, 1),
      costs('project-gone-2', null, 15, 1),
    ]);
  });
});
