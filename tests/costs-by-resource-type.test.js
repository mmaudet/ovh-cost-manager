/**
 * Tests for the costs by resource type of a period, which the Overview and the Infrastructure
 * tab list through /api/analysis/by-resource-type: the bill lines of each resource type added
 * up, most expensive first, on a throwaway database.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

describe('costs by resource type', () => {
  let db;
  let dataDir;

  const bill = (id, date) => db.bills.upsert({
    id, date, price_without_tax: 0, price_with_tax: 0, tax: 0, currency: 'EUR',
    pdf_url: null, html_url: null,
  });

  // A bill line of a service, with its resource type, null for none
  const line = (id, billId, domain, resourceType, price) => ({
    id, bill_id: billId, project_id: null, domain, description: `${id} line`, quantity: 1,
    unit_price: price, total_price: price, service_type: 'Other', resource_type: resourceType,
  });

  // A row of the costs by resource type
  const costs = (resourceType, total, detailsCount, serviceCount) => ({
    resource_type: resourceType, total, details_count: detailsCount,
    service_count: serviceCount,
  });

  beforeAll(() => {
    // data/db.js reads DATA_DIR once, when it is first required
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovh-resource-types-'));
    process.env.DATA_DIR = dataDir;
    db = require('../data/db');

    bill('FR0009', '2026-09-01');
    bill('FR0010', '2026-09-15');
    db.details.insertMany([
      // Without a resource type, as the bill lines imported before they had one
      line('FR0009-1', 'FR0009', 'mail-a.example', null, 3),
      line('FR0009-2', 'FR0009', 'option-b.example', null, 1.5),
      line('FR0010-1', 'FR0010', 'ns3000001.ip-203-0-113.eu', 'dedicated_server', 270),
      // The service of the first line, typed 'other' since
      line('FR0010-2', 'FR0010', 'mail-a.example', 'other', 3),
    ]);
  });

  afterAll(() => {
    db.closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  // #86: the bill lines without a resource type and those typed 'other' came out as two
  // 'other' rows, which the Overview and the Infrastructure tab showed side by side
  test('adds up the bill lines without a resource type in the one other row', () => {
    expect(db.inventory.byResourceType('2026-09-01', '2026-09-30')).toEqual([
      costs('dedicated_server', 270, 1, 1),
      // The service billed with and without a resource type counts once
      costs('other', 7.5, 3, 2),
    ]);
  });
});
