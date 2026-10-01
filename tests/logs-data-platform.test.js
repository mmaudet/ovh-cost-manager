/**
 * The charges of the Logs Data Platform services (#247): what their bill lines add up to, by
 * charge (see CONTEXT.md), and in all, as the Infrastructure tab lists them for the month it
 * shows. The lines are those that data/db.js reads, of the resource type that the classification
 * gives these services, `ldp-` and a code (#246). Their descriptions are those of an invoice's
 * DBAAS-LOGS lines, some ending with the period that they cover; every amount is made up. How a
 * charge is read from a description, and how the charges are ordered, tests/charges.test.js pins.
 */

const { chargeFigures } = require('../data/logs-data-platform');
const { LDP_CHARGES, inAugust, inSeptember } = require('./support/logs-data-platform');

// The charges of an invoice's DBAAS-LOGS lines, as OVHcloud words them
const {
  accountRental: ACCOUNT_RENTAL, hotStorage: HOT_STORAGE,
  hotStorageOver101Gb: HOT_STORAGE_OVER_101_GB, freeTier: FREE_TIER, coldStorage: COLD_STORAGE,
  inputInstances: INPUT_INSTANCES, dashboards: DASHBOARDS,
} = LDP_CHARGES;

// A bill line of a Logs Data Platform service, as data/db.js reads it: its description and its
// amount, and the service it bills, one by default
const line = (description, price, service = 'ldp-ab-12345') => ({
  domain: service, description, total_price: price,
});

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

  // As a product's charges are: the free tier of the hot storage never shows, nor a charge that a
  // refund cancels out, nor a line whose amount the bill does not give. A charge that a refund
  // brings below 0 € shows, so that the charges add up to what the lines cost: the month's Logs
  // Data Platform cost.
  test('leaves out the charges at 0 €, and keeps those that a refund brings below', () => {
    expect(chargeFigures([
      line(ACCOUNT_RENTAL, 30),
      line(inAugust(FREE_TIER), 0),
      line(INPUT_INSTANCES, 12),
      line(INPUT_INSTANCES, -12),
      line(COLD_STORAGE, -1.5),
      line(DASHBOARDS, null),
    ])).toEqual({
      total: 28.5,
      charges: [
        { charge: ACCOUNT_RENTAL, total: 30 },
        { charge: COLD_STORAGE, total: -1.5 },
      ],
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
});
