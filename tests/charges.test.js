/**
 * The charge of a bill line (see CONTEXT.md), what it pays for as its description names it without
 * the period it covers, and what lines add up to by charge: those of a Public Cloud product, which
 * the Compare tab unfolds the product into (#195), and those of the Logs Data Platform services,
 * which the Infrastructure tab lists (#247). The descriptions are OVHcloud's; every amount is made
 * up.
 */

const { chargeOf, chargesOf } = require('../data/charges');
const { LDP_CHARGES, inAugust } = require('./support/logs-data-platform');

const { accountRental: ACCOUNT_RENTAL, hotStorage: HOT_STORAGE } = LDP_CHARGES;
// A Public Cloud project's hourly use of a flavor, whose apostrophe some bills write curly
const HOURLY_USE = 'Consommation à l\'heure pour les instances b3-8 gra11';
const HOURLY_USE_CURLY = 'Consommation à l’heure pour les instances b3-8 gra11';

// A bill line as data/db.js reads it: its description and its amount, and, for the lines of a
// query that counts the projected lines of the month in progress, its projected part
const line = (description, price, projected) => ({
  description, total_price: price, ...(projected === undefined ? {} : { projected }),
});

describe('chargeOf', () => {
  // So that the lines of one charge name it alike whatever the month they cover
  test('names a charge without the period that ends its description on some bills', () => {
    expect(chargeOf(inAugust(HOT_STORAGE))).toBe(HOT_STORAGE);
    expect(chargeOf(HOT_STORAGE)).toBe(HOT_STORAGE);
  });

  // Those that end a prorata's description name its instance and region, and no date
  test('keeps brackets that hold no date', () => {
    const prorata = 'Prorata de la facturation mensuelle d\'une instance r3-32 '
      + '(id 5a1c2e3d-0000-4000-8000-000000000003, region sbg5)';

    expect(chargeOf(prorata)).toBe(prorata);
  });

  test('writes its apostrophes straight, as some bills write them curly', () => {
    expect(chargeOf(HOURLY_USE_CURLY)).toBe(HOURLY_USE);
  });
});

describe('chargesOf', () => {
  test('adds up the lines of each charge, to the cent, the most expensive first', () => {
    expect(chargesOf([
      line(HOT_STORAGE, 0.333),
      line(ACCOUNT_RENTAL, 30),
      line(inAugust(HOT_STORAGE), 0.333),
      line(HOT_STORAGE, 0.333),
      line(HOURLY_USE_CURLY, 12),
      line(HOURLY_USE, 0.5),
    ])).toEqual([
      { charge: ACCOUNT_RENTAL, total: 30 },
      { charge: HOURLY_USE, total: 12.5 },
      { charge: HOT_STORAGE, total: 1 },
    ]);
  });

  // A refund keeps its charge below 0 €, the last, so that the charges add up to what their
  // lines cost; a charge at 0 €, such as a free tier, or one that a refund cancels out, does not
  // show
  test('leaves out the charges at 0 €, and keeps those below', () => {
    expect(chargesOf([
      line(ACCOUNT_RENTAL, 30),
      line(LDP_CHARGES.freeTier, 0),
      line(LDP_CHARGES.inputInstances, 12),
      line(LDP_CHARGES.inputInstances, -12),
      line(LDP_CHARGES.coldStorage, -1.5),
      line(LDP_CHARGES.dashboards, null),
    ])).toEqual([
      { charge: ACCOUNT_RENTAL, total: 30 },
      { charge: LDP_CHARGES.coldStorage, total: -1.5 },
    ]);
  });

  test('orders the charges of the same cost by charge', () => {
    expect(chargesOf([
      line(LDP_CHARGES.inputInstances, 12),
      line(LDP_CHARGES.dashboards, 12),
      line(LDP_CHARGES.coldStorage, 12),
    ]).map(({ charge }) => charge)).toEqual([
      LDP_CHARGES.dashboards, LDP_CHARGES.inputInstances, LDP_CHARGES.coldStorage,
    ]);
  });

  // The lines of a query that counts the projected lines of the month in progress (#219)
  test('gives each charge its projected part when asked, and none otherwise', () => {
    const lines = [
      line(ACCOUNT_RENTAL, 30, 0),
      line(ACCOUNT_RENTAL, 30, 30),
      line(HOT_STORAGE, 12.5, 12.5),
    ];

    expect(chargesOf(lines, { projected: true })).toEqual([
      { charge: ACCOUNT_RENTAL, total: 60, projected: 30 },
      { charge: HOT_STORAGE, total: 12.5, projected: 12.5 },
    ]);
    expect(chargesOf(lines)).toEqual([
      { charge: ACCOUNT_RENTAL, total: 60 },
      { charge: HOT_STORAGE, total: 12.5 },
    ]);
  });
});
