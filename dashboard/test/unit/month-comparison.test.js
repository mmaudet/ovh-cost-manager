import { describe, it, expect } from 'vitest';
import {
  byNameAndAccount, comparedMonthsOf, comparisonValues, pairMonths, valuesAsShown,
  withoutVariation,
} from '../../src/utils/monthComparison.js';
import { months } from '../fixtures/calendar.js';

// The rows of a comparison of months A and B of the Compare tab, from what each month gave:
// the products of a Public Cloud project (#181), or the services of a resource type (#192),
// each with its amount (total)
const service = (identifier, total) => ({ domain: identifier, description: identifier, total });
const byIdentifier = ({ domain }) => domain;

// The pairs, each as [key, amount in month A, amount in month B]
const amounts = (pairs) => pairs.map(({ key, valA, valB }) => [key, valA, valB]);

describe('pairMonths', () => {
  it('pairs what months A and B gave by key, with what each month gave', () => {
    const serverA = service('ns3000001', 120);
    const serverB = service('ns3000001', 140);

    expect(pairMonths([serverA], [serverB], byIdentifier)).toEqual([
      { key: 'ns3000001', rowA: serverA, rowB: serverB, valA: 120, valB: 140 },
    ]);
  });

  it('gives 0 in a month that gave nothing for a key', () => {
    const inA = service('ns3000003', 150);
    const inB = service('ns3000002', 60);

    expect(pairMonths([inA], [inB], byIdentifier)).toEqual([
      { key: 'ns3000003', rowA: inA, rowB: undefined, valA: 150, valB: 0 },
      { key: 'ns3000002', rowA: undefined, rowB: inB, valA: 0, valB: 60 },
    ]);
  });

  it("keeps month A's keys in their order, then those of month B only in theirs", () => {
    expect(amounts(pairMonths(
      [service('b', 10), service('a', 5)],
      [service('d', 30), service('a', 7), service('c', 20)],
      byIdentifier,
    ))).toEqual([
      ['b', 10, 0],
      ['a', 5, 7],
      ['d', 0, 30],
      ['c', 0, 20],
    ]);
  });

  it('gives the rows of month B when month A gave none, and none when neither did', () => {
    expect(amounts(pairMonths([], [service('a', 7)], byIdentifier))).toEqual([['a', 0, 7]]);
    expect(pairMonths([], [], byIdentifier)).toEqual([]);
  });

  // As the products of a project, or a service and its account
  it('pairs by any key', () => {
    const products = (instances, storage) => [
      { product: 'instances', total: instances }, { product: 'object_storage', total: storage },
    ];

    const byProduct = ({ product }) => product;

    expect(amounts(pairMonths(products(440.6, 24.9), products(538.9, 25), byProduct)))
      .toEqual([['instances', 440.6, 538.9], ['object_storage', 24.9, 25]]);
    expect(amounts(pairMonths(
      [{ id: 'vm-1', account: 'xx1111-ovh', total: 10 }],
      [{ id: 'vm-1', account: 'yy2222-ovh', total: 20 }],
      ({ id, account }) => `${id} ${account}`,
    ))).toEqual([['vm-1 xx1111-ovh', 10, 0], ['vm-1 yy2222-ovh', 0, 20]]);
  });
});

// What makes a row of month A and one of month B the same: what it names, and its account, as
// the lists that name the account of each row ask for them by account (#194)
describe('byNameAndAccount', () => {
  const byServiceAndAccount = byNameAndAccount(({ domain }) => domain);
  // The pairs, each as [name, account, amount in month A, amount in month B]
  const namedPairs = (pairs) => pairs.map(({ rowA, rowB, valA, valB }) => {
    const { domain, account } = rowB ?? rowA;
    return [domain, account, valA, valB];
  });
  const billedTo = (account, identifier, total) => ({ ...service(identifier, total), account });

  it('pairs the rows of the same name and account, a name of two accounts once for each', () => {
    expect(namedPairs(pairMonths(
      [billedTo('xx1111-ovh', 'example.com', 15)],
      [billedTo('xx1111-ovh', 'example.com', 10), billedTo('yy2222-ovh', 'example.com', 7)],
      byServiceAndAccount,
    ))).toEqual([
      ['example.com', 'xx1111-ovh', 15, 10],
      ['example.com', 'yy2222-ovh', 0, 7],
    ]);
  });

  // The Unknown account, null, apart from the others
  it("pairs the Unknown account's rows apart from the other accounts'", () => {
    expect(namedPairs(pairMonths(
      [billedTo(null, 'ns3000004', 90)],
      [billedTo('xx1111-ovh', 'ns3000004', 40)],
      byServiceAndAccount,
    ))).toEqual([
      ['ns3000004', null, 90, 0],
      ['ns3000004', 'xx1111-ovh', 0, 40],
    ]);
  });

  // As the lists that name no account ask for them
  it('pairs the rows that name no account by their names', () => {
    expect(namedPairs(pairMonths(
      [service('example.com', 15), service('example.org', 15)],
      [service('example.com', 17)],
      byServiceAndAccount,
    ))).toEqual([
      ['example.com', undefined, 15, 17],
      ['example.org', undefined, 15, 0],
    ]);
  });
});

// What a comparison of two months knows of them, which its variations and the sort of its
// tables read (#216): whether either is the month in progress, as the months list marks it, and
// whether its amounts are its projected cost (#217)
describe('comparedMonthsOf', () => {
  const [september, august, july] = months;
  const inProgress = [{ ...september, inProgress: true }, august, july];
  // A comparison of the month in progress at what it billed so far, and of complete months
  const partial = { monthInProgress: true, projected: false };
  const complete = { monthInProgress: false, projected: false };

  it('knows whether month A or B is the month in progress', () => {
    expect(comparedMonthsOf(inProgress, august, september)).toEqual(partial);
    expect(comparedMonthsOf(inProgress, september, july)).toEqual(partial);
    expect(comparedMonthsOf(inProgress, july, august)).toEqual(complete);
    expect(comparedMonthsOf(months, august, september)).toEqual(complete);
  });

  // Before months A and B have their defaults, and for the header, before a month with no bill
  it('knows of no month in progress without a month', () => {
    expect(comparedMonthsOf(inProgress, null, undefined)).toEqual(complete);
  });

  it('knows that the month in progress is at its projected cost when its amounts are', () => {
    expect(comparedMonthsOf(inProgress, august, september, { projected: true }))
      .toEqual({ monthInProgress: true, projected: true });
  });

  // Complete months have no projected cost
  it('knows of no projected cost between complete months', () => {
    expect(comparedMonthsOf(inProgress, july, august, { projected: true })).toEqual(complete);
  });
});

// The values of a product in the columns that sort a project's comparison, as an example
const productValues = comparisonValues('product', ({ product }) => product);
const instances = { product: 'instances', valA: 100, valB: 150 };
// What each column gives a row, as [product, month A, month B, variation]
const columnsOf = (values, row) => ['product', 'totalA', 'totalB', 'variation']
  .map((column) => values[column](row));

// The values of the rows while the variation shows "—" (#216)
describe('withoutVariation', () => {
  it('gives no variation, and the values of the other columns', () => {
    expect(columnsOf(withoutVariation(productValues), instances))
      .toEqual(['instances', 100, 150, null]);
  });

  it('leaves the values it is given as they were', () => {
    withoutVariation(productValues);

    expect(columnsOf(productValues, instances)).toEqual(['instances', 100, 150, 50]);
  });
});

// The values that sort a comparison's rows, as the comparison shows them (#146, #216)
describe('valuesAsShown', () => {
  it('drops the variation while month A or B is the month in progress', () => {
    expect(columnsOf(valuesAsShown({ monthInProgress: true }, productValues), instances))
      .toEqual(['instances', 100, 150, null]);
  });

  it('keeps the values of two complete months', () => {
    expect(valuesAsShown({ monthInProgress: false }, productValues)).toBe(productValues);
  });

  // Whose variations are computed then (#217)
  it('keeps the values of the month in progress at its projected cost', () => {
    const projected = { monthInProgress: true, projected: true };

    expect(valuesAsShown(projected, productValues)).toBe(productValues);
  });
});
