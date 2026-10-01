/**
 * What the tests of Logs Data Platform share (#246, #247): the charges of an invoice's DBAAS-LOGS
 * lines, as OVHcloud words them, and the period that ends a description on some accounts' bills.
 */

// The rental of a service's account, which covers the month of its bill, and what the service
// consumed in the month before: the hot storage of its streams, in three tiers, a free one among
// them, their cold storage, its input instances and its hosted OpenSearch Dashboards instances
const LDP_CHARGES = {
  accountRental: 'Logs - Account rental for 1 month',
  hotStorage: 'Logs - Streams - Hot Storage 1 to 100 GB',
  hotStorageOver101Gb: 'Logs - Streams - Hot Storage > 101 GB',
  freeTier: 'Logs - Streams - Hot Storage Free tier',
  coldStorage: 'Logs - Streams - Cold Storage Standard',
  inputInstances: 'Logs - Input instances',
  dashboards: 'Logs - Hosted OpenSearch Dashboards instances',
};

// The description of a line as some accounts' bills end it, with the period that it covers: the
// month before its bill's for what a service consumed, the month of its bill for the rental
const inAugust = (description) => `${description} (01/08/2026-31/08/2026)`;
const inSeptember = (description) => `${description} (01/09/2026-30/09/2026)`;

module.exports = { LDP_CHARGES, inAugust, inSeptember };
