/**
 * The charges of the Logs Data Platform services (#247): what their bill lines add up to, by
 * charge (see CONTEXT.md), as the Infrastructure tab lists them for the month it shows. The lines
 * are those that data/db.js reads, of the resource type that the classification gives these
 * services, `ldp-` and a code (#246). Their descriptions are those of an invoice's DBAAS-LOGS
 * lines, some ending with the period that they cover; every amount is made up.
 */

const { chargeFigures } = require('../data/logs-data-platform');

// The charges of an invoice's DBAAS-LOGS lines, as OVHcloud words them: the account's rental,
// which covers the month of its bill, and its consumption of the month before, the hot storage
// of its streams in three tiers, a free one among them, their cold storage, its input instances
// and its hosted OpenSearch Dashboards instances
const ACCOUNT_RENTAL = 'Logs - Account rental for 1 month';
const HOT_STORAGE = 'Logs - Streams - Hot Storage 1 to 100 GB';
const HOT_STORAGE_OVER_101_GB = 'Logs - Streams - Hot Storage > 101 GB';
const COLD_STORAGE = 'Logs - Streams - Cold Storage Standard';
const INPUT_INSTANCES = 'Logs - Input instances';
const DASHBOARDS = 'Logs - Hosted OpenSearch Dashboards instances';

// A bill line of a Logs Data Platform service, as data/db.js reads it: its description and its
// amount, and the service it bills, one by default
const line = (description, price, service = 'ldp-ab-12345') => ({
  domain: service, description, total_price: price,
});
// The description of a line as some accounts' bills end it, with the period that it covers: the
// month before its bill's for what the service consumed, the month of its bill for the rental
const inAugust = (description) => `${description} (01/08/2026-31/08/2026)`;
const inSeptember = (description) => `${description} (01/09/2026-30/09/2026)`;

describe('chargeFigures', () => {
  test('adds up the lines of each charge, the most expensive first, and what they cost in all',
    () => {
      expect(chargeFigures([
        line(ACCOUNT_RENTAL, 30),
        line(HOT_STORAGE, 18.4),
        line(HOT_STORAGE_OVER_101_GB, 7.25),
        line(COLD_STORAGE, 2.1),
        line(INPUT_INSTANCES, 12),
        line(DASHBOARDS, 24),
      ])).toEqual({
        total: 93.75,
        charges: [
          { charge: ACCOUNT_RENTAL, total: 30 },
          { charge: DASHBOARDS, total: 24 },
          { charge: HOT_STORAGE, total: 18.4 },
          { charge: INPUT_INSTANCES, total: 12 },
          { charge: HOT_STORAGE_OVER_101_GB, total: 7.25 },
          { charge: COLD_STORAGE, total: 2.1 },
        ],
      });
    });

  // So that a charge is one row, whether its lines carry their period or not, and reads alike
  // from one month to the next
  test('names a charge without the period that ends its lines on some bills', () => {
    expect(chargeFigures([
      line(inAugust(HOT_STORAGE), 9.2),
      line(HOT_STORAGE, 3.6),
      line(inSeptember(ACCOUNT_RENTAL), 30),
    ])).toEqual({
      total: 42.8,
      charges: [
        { charge: ACCOUNT_RENTAL, total: 30 },
        { charge: HOT_STORAGE, total: 12.8 },
      ],
    });
  });

  // A charge whose description holds an apostrophe, made up: the input instances in French, as
  // some bills would write it curly, as they write « l’heure », and others straight
  test("writes a charge's apostrophe straight, as some bills write it curly", () => {
    expect(chargeFigures([
      line('Logs - Instances d’entrée', 6),
      line("Logs - Instances d'entrée", 4),
    ])).toEqual({
      total: 10,
      charges: [{ charge: "Logs - Instances d'entrée", total: 10 }],
    });
  });

  // As a product's charges are: the free tier of the hot storage never shows, nor a charge that
  // a refund cancels out, or more, nor a line whose amount the bill does not give
  test('leaves out the charges that cost nothing, or less, from the charges and their total',
    () => {
      expect(chargeFigures([
        line(ACCOUNT_RENTAL, 30),
        line(inAugust('Logs - Streams - Hot Storage Free tier'), 0),
        line(INPUT_INSTANCES, 12),
        line(INPUT_INSTANCES, -12),
        line(COLD_STORAGE, -1.5),
        line(DASHBOARDS, null),
      ])).toEqual({
        total: 30,
        charges: [{ charge: ACCOUNT_RENTAL, total: 30 }],
      });
    });

  // Such as a month whose only lines are the free tier, or none
  test('gives no charge, at 0 in all, for lines that cost nothing, or none', () => {
    expect(chargeFigures([line(ACCOUNT_RENTAL, 0)])).toEqual({ total: 0, charges: [] });
    expect(chargeFigures([])).toEqual({ total: 0, charges: [] });
  });

  // An account may hold several Logs Data Platform services, each billed under its own
  // identifier, and the lines of all accounts add up alike: one row per charge
  test('adds up the lines of one charge whatever their service', () => {
    expect(chargeFigures([
      line(ACCOUNT_RENTAL, 30, 'ldp-ab-12345'),
      line(HOT_STORAGE, 18.4, 'ldp-ab-12345'),
      line(ACCOUNT_RENTAL, 30, 'ldp-cd-67890'),
      line(inAugust(HOT_STORAGE), 3.6, 'ldp-cd-67890'),
    ])).toEqual({
      total: 82,
      charges: [
        { charge: ACCOUNT_RENTAL, total: 60 },
        { charge: HOT_STORAGE, total: 22 },
      ],
    });
  });

  // What the charges cost in all adds up their costs, so that the table's rows add up to its
  // total row
  test('gives each cost to the cent, and what the charges cost in all from them', () => {
    expect(chargeFigures([
      line(INPUT_INSTANCES, 0.333),
      line(INPUT_INSTANCES, 0.333),
      line(INPUT_INSTANCES, 0.333),
      line(COLD_STORAGE, 0.004),
      line(COLD_STORAGE, 0.004),
    ])).toEqual({
      total: 1.01,
      charges: [
        { charge: INPUT_INSTANCES, total: 1 },
        { charge: COLD_STORAGE, total: 0.01 },
      ],
    });
  });

  // So that the order does not depend on the order of the lines
  test('orders the charges of the same cost by charge', () => {
    expect(chargeFigures([
      line(INPUT_INSTANCES, 12),
      line(DASHBOARDS, 12),
      line(COLD_STORAGE, 12),
    ]).charges.map(({ charge }) => charge)).toEqual([DASHBOARDS, INPUT_INSTANCES, COLD_STORAGE]);
  });
});
