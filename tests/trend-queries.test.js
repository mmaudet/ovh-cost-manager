/**
 * Tests for the monthly trend queries of the Trends tab: they add up the bill
 * lines of the months between two dates, both included, whatever the real
 * date.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { trendWindow } = require('../server/months');

describe('monthly trend queries', () => {
  let db;
  let dataDir;

  // A bill, with a Public Cloud line and, when given, a dedicated server line
  const bill = (id, date, cloud, server = 0) => {
    db.bills.upsert({
      id, date, price_without_tax: cloud + server, price_with_tax: (cloud + server) * 1.2,
      tax: (cloud + server) * 0.2, currency: 'EUR', pdf_url: null, html_url: null,
    });
    const line = (suffix, price, resourceType) => ({
      id: `${id}-${suffix}`, bill_id: id, project_id: null, domain: `${suffix}.example`,
      description: `${suffix} line`, quantity: 1, unit_price: price, total_price: price,
      service_type: 'Other', resource_type: resourceType,
    });
    db.details.insertMany([
      line('cloud', cloud, 'cloud_project'),
      ...(server ? [line('server', server, 'dedicated_server')] : []),
    ]);
  };

  beforeAll(() => {
    // data/db.js reads DATA_DIR once, when it is first required
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovh-trends-'));
    process.env.DATA_DIR = dataDir;
    db = require('../data/db');

    // The last day of June and the first of October, around July to September
    bill('FR0006', '2026-06-30', 10);
    bill('FR0007', '2026-07-01', 20);
    bill('FR0008', '2026-08-15', 30, 5);
    bill('FR0009', '2026-09-30', 40);
    bill('FR0010', '2026-10-01', 50);
  });

  afterAll(() => {
    db.closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('adds up the months between the two dates, both included', () => {
    expect(db.analysis.monthlyTrend('2026-07-01', '2026-09-30')).toEqual([
      { month: '2026-07', total: 20 },
      { month: '2026-08', total: 35 },
      { month: '2026-09', total: 40 },
    ]);
  });

  test('adds up each resource type of those months', () => {
    const rows = db.analysis.monthlyTrendByResourceType('2026-07-01', '2026-09-30')
      .map(({ month, resource_type: resourceType, total }) => [month, resourceType, total])
      .sort((a, b) => `${a[0]} ${a[1]}`.localeCompare(`${b[0]} ${b[1]}`));

    expect(rows).toEqual([
      ['2026-07', 'cloud_project', 20],
      ['2026-08', 'cloud_project', 30],
      ['2026-08', 'dedicated_server', 5],
      ['2026-09', 'cloud_project', 40],
    ]);
  });

  // As for an account with no bill, where trendWindowFromQuery() gives no window
  test('finds nothing without a window', () => {
    expect(db.analysis.monthlyTrend(null, null)).toEqual([]);
    expect(db.analysis.monthlyTrendByResourceType(null, null)).toEqual([]);
  });

  // #66: 3 months used to cover June as well
  test('covers the 3 calendar months that end on September, without June', () => {
    const { from, to } = trendWindow('2026-09', 3);

    expect(db.analysis.monthlyTrend(from, to).map(({ month }) => month))
      .toEqual(['2026-07', '2026-08', '2026-09']);
  });
});
