/**
 * Tests for the credits of the Public Cloud projects (data/cloud-credits.js): a credit as OVH's
 * GET /cloud/project/{id}/credit/{id} answers it, and the credit that remains of them, which
 * counts the credits still available and still valid at the time it is read.
 */

const { readCredit, remainingCredit } = require('../data/cloud-credits');

// Now, as the server reads the credits: 15 September 2026, noon in Paris
const NOW = new Date('2026-09-15T12:00:00+02:00');

describe('readCredit', () => {
  test('reads what OVH answers of a credit', () => {
    expect(readCredit({
      id: 2156874,
      description: 'Voucher PUBLIC-CLOUD-2026',
      products: [],
      total_credit: { currencyCode: 'EUR', text: '500.00 €', value: 500 },
      available_credit: { currencyCode: 'EUR', text: '312.40 €', value: 312.4 },
      used_credit: { currencyCode: 'EUR', text: '187.60 €', value: 187.6 },
      validity: { from: '2026-01-01T00:00:00+01:00', to: '2027-01-01T00:00:00+01:00' },
      bill: null,
    })).toEqual({
      credit_id: '2156874',
      description: 'Voucher PUBLIC-CLOUD-2026',
      available: 312.4,
      total: 500,
      currency: 'EUR',
      valid_from: '2026-01-01T00:00:00+01:00',
      valid_to: '2027-01-01T00:00:00+01:00',
    });
  });

  test('reads a credit without validity or total', () => {
    expect(readCredit({ id: 7, available_credit: { value: 20, currencyCode: 'EUR' } }))
      .toMatchObject({ credit_id: '7', available: 20, total: null, valid_from: null, valid_to: null });
  });
});

describe('remainingCredit', () => {
  // A credit of a project
  const credit = (project_id, available, valid_to = null) => ({
    project_id, available, currency: 'EUR', valid_to,
  });

  test('adds up the credits still available and still valid, to the cent', () => {
    expect(remainingCredit([
      credit('p1', 312.4, '2027-01-01T00:00:00+01:00'),
      credit('p1', 100.005, '2026-12-01T00:00:00+01:00'),
      credit('p2', 50),
    ], NOW)).toEqual({
      available_total: 462.41,
      currency: 'EUR',
      credit_count: 3,
      project_count: 2,
      // The end of the validity that ends first
      expires_at: '2026-12-01T00:00:00+01:00',
    });
  });

  test('leaves out a credit used up, and one whose validity has ended', () => {
    expect(remainingCredit([
      credit('p1', 0, '2027-01-01T00:00:00+01:00'),
      credit('p1', -5),
      // This morning, in Paris
      credit('p2', 40, '2026-09-15T08:00:00+02:00'),
      credit('p2', 25, '2026-09-16T00:00:00+02:00'),
    ], NOW)).toEqual({
      available_total: 25,
      currency: 'EUR',
      credit_count: 1,
      project_count: 1,
      expires_at: '2026-09-16T00:00:00+02:00',
    });
  });

  test('counts a credit whose end cannot be read, as one without an end', () => {
    expect(remainingCredit([credit('p1', 10, 'not a date')], NOW))
      .toMatchObject({ available_total: 10, credit_count: 1, expires_at: null });
  });

  test('is nothing without a credit that counts', () => {
    expect(remainingCredit([credit('p1', 0)], NOW)).toEqual({
      available_total: 0, currency: null, credit_count: 0, project_count: 0, expires_at: null,
    });
  });
});
