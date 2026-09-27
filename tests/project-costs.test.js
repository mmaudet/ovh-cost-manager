/**
 * Tests for the costs by project of a period, which the Overview and the Compare tab read
 * through /api/analysis/by-project: the bill lines of each Public Cloud project added up,
 * most expensive project first, on a throwaway database.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ACCOUNT, PARIS } = require('./support/accounts');

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
    pdf_url: null, html_url: null, account: ACCOUNT.nic,
  });

  const project = (id, name) => db.projects.upsert({
    id, name, description: name, status: 'ok', created_at: null, account: ACCOUNT.nic,
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

  // For the Overview's lists that name the account of each project (#118): that of the bills
  // of a project missing from the projects table too
  test('gives each project the account of its bills when listed by account', () => {
    const ofAccount = (row) => ({ ...row, account: ACCOUNT.nic });

    expect(db.analysis.byProject('2026-10-01', '2026-10-31', null, { byAccount: true })).toEqual([
      ofAccount(costs('project-gone-1', null, 40, 1)),
      ofAccount(costs('project-production', 'Production', 30, 1)),
      ofAccount(costs('project-gone-2', null, 15, 1)),
    ]);
  });

  // The order that the breakdown by project, its Top projects chart, the GPU costs by project
  // and the top five projects of the summary give projects that cost the same (#118)
  describe('that cost the same', () => {
    // A bill line of the GPU instances of a project: a cost of the project, and a GPU cost
    const gpuLine = (id, billId, projectId, price) => ({
      ...line(id, billId, projectId, price), description: 'instances l4-90 GRA11',
    });
    // The projects of the rows, in their order, and the account of each
    const idsOf = (rows) => rows.map((row) => row.project_id);
    const accountsOf = (rows) => rows.map((row) => [row.project_id, row.account]);

    beforeAll(() => {
      // In November, three projects at 120 € each on one bill, written in this order
      project('project-kilo', 'Kilo');
      project('project-bravo', 'Bravo');
      project('project-echo', 'Echo');
      bill('FR0011', '2026-11-05');
      db.details.insertMany([
        gpuLine('FR0011-1', 'FR0011', 'project-kilo', 120),
        gpuLine('FR0011-2', 'FR0011', 'project-bravo', 120),
        gpuLine('FR0011-3', 'FR0011', 'project-echo', 120),
      ]);

      // In December, Kilo at 60 € on the bills of another account and of the Unknown
      // account, written first, and of the account
      db.bills.upsert({
        id: 'FR0013', date: '2026-12-05', price_without_tax: 0, price_with_tax: 0, tax: 0,
        currency: 'EUR', pdf_url: null, html_url: null, account: PARIS,
      });
      db.getDb().prepare(
        "INSERT INTO bills (id, date, currency, account) VALUES (?, ?, 'EUR', NULL)",
      ).run('FR0014', '2026-12-05');
      bill('FR0012', '2026-12-05');
      db.details.insertMany([
        gpuLine('FR0014-1', 'FR0014', 'project-kilo', 60),
        gpuLine('FR0013-1', 'FR0013', 'project-kilo', 60),
        gpuLine('FR0012-1', 'FR0012', 'project-kilo', 60),
      ]);
    });

    // As the queries gave them before they told accounts apart, and whatever the order of
    // their bill lines: listed by account too
    test('come by id, the last first', () => {
      const byId = ['project-kilo', 'project-echo', 'project-bravo'];
      const byAccount = { byAccount: true };

      expect(idsOf(db.analysis.byProject('2026-11-01', '2026-11-30'))).toEqual(byId);
      expect(idsOf(db.analysis.byProject('2026-11-01', '2026-11-30', null, byAccount)))
        .toEqual(byId);
      expect(idsOf(db.cloudDetails.getGpuSummary('2026-11-01', '2026-11-30').byProject))
        .toEqual(byId);
      expect(idsOf(db.cloudDetails.getGpuSummary('2026-11-01', '2026-11-30', null, byAccount)
        .byProject)).toEqual(byId);
    });

    // As the Web Cloud services billed to several accounts (#122)
    test('come for each account that billed them by NIC handle, the Unknown account last', () => {
      const ofEachAccount = [
        ['project-kilo', ACCOUNT.nic], ['project-kilo', PARIS], ['project-kilo', null],
      ];
      const byAccount = { byAccount: true };

      expect(accountsOf(db.analysis.byProject('2026-12-01', '2026-12-31', null, byAccount)))
        .toEqual(ofEachAccount);
      expect(accountsOf(db.cloudDetails.getGpuSummary('2026-12-01', '2026-12-31', null, byAccount)
        .byProject)).toEqual(ofEachAccount);
    });

    // Unless listed by account
    test('come once for all the accounts that billed them', () => {
      const once = [['project-kilo', 180]];
      const totalsOf = (rows) => rows.map((row) => [row.project_id, row.total]);

      expect(totalsOf(db.analysis.byProject('2026-12-01', '2026-12-31'))).toEqual(once);
      expect(totalsOf(db.cloudDetails.getGpuSummary('2026-12-01', '2026-12-31').byProject))
        .toEqual(once);
    });
  });
});
