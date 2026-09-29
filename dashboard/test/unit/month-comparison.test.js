import { describe, it, expect } from 'vitest';
import { byNameAndAccount, pairMonths } from '../../src/utils/monthComparison.js';

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

    expect(amounts(pairMonths(products(440.6, 24.9), products(538.9, 25), ({ product }) => product)))
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
