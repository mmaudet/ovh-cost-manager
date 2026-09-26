/**
 * Tests for the monthly trend queries of the Trends tab: they add up the bill
 * lines of the months between two dates, both included, whatever the real
 * date, and give every one of those months, billed or not.
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

  // The rows of the trend by resource type, as [month, resource type, total], in the order
  // of their months and resource types
  const byMonthAndResourceType = (rows) => rows
    .map(({ month, resource_type: resourceType, total }) => [month, resourceType, total])
    .sort((a, b) => `${a[0]} ${a[1]}`.localeCompare(`${b[0]} ${b[1]}`));

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
    // December 2026 and February 2027, around a January without any bill
    bill('FR0011', '2026-12-10', 60);
    bill('FR0012', '2027-02-10', 70, 8);
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

  // Each resource type in every month, at 0 in the months it was not billed in (#65)
  test('adds up each resource type of those months', () => {
    const rows = db.analysis.monthlyTrendByResourceType('2026-07-01', '2026-09-30');

    expect(byMonthAndResourceType(rows)).toEqual([
      ['2026-07', 'cloud_project', 20],
      ['2026-07', 'dedicated_server', 0],
      ['2026-08', 'cloud_project', 30],
      ['2026-08', 'dedicated_server', 5],
      ['2026-09', 'cloud_project', 40],
      ['2026-09', 'dedicated_server', 0],
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

  // #65: a trend of N months gives N months, those without any bill at 0
  describe('over months without any bill', () => {
    // November 2026 to February 2027: November, the first, and January were not billed
    const { from, to } = trendWindow('2027-02', 4);

    test('adds up every month, at 0 for a month without any bill', () => {
      expect(db.analysis.monthlyTrend(from, to)).toEqual([
        { month: '2026-11', total: 0 },
        { month: '2026-12', total: 60 },
        { month: '2027-01', total: 0 },
        { month: '2027-02', total: 78 },
      ]);
    });

    test('adds up each resource type in every month, at 0 for a month without any bill', () => {
      const rows = db.analysis.monthlyTrendByResourceType(from, to);

      expect(byMonthAndResourceType(rows)).toEqual([
        ['2026-11', 'cloud_project', 0],
        ['2026-11', 'dedicated_server', 0],
        ['2026-12', 'cloud_project', 60],
        ['2026-12', 'dedicated_server', 0],
        ['2027-01', 'cloud_project', 0],
        ['2027-01', 'dedicated_server', 0],
        ['2027-02', 'cloud_project', 70],
        ['2027-02', 'dedicated_server', 8],
      ]);
    });

    // No resource type was billed: none has a trend to give months to
    test('adds up 0 for every month of a window without any bill', () => {
      const window = trendWindow('2026-05', 2);

      expect(db.analysis.monthlyTrend(window.from, window.to)).toEqual([
        { month: '2026-04', total: 0 },
        { month: '2026-05', total: 0 },
      ]);
      expect(db.analysis.monthlyTrendByResourceType(window.from, window.to)).toEqual([]);
    });
  });
});
