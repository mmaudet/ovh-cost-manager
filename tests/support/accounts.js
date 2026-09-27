/**
 * What the tests share about accounts (#112): the account of the tests, and the form of the
 * times that SQLite writes, such as when an account's last import ended. And, for the tests
 * of the account parameter of the server's routes (#115), the accounts of the database they
 * seed, the value that selects the Unknown account, the writers of their rows, and what the
 * server answers to an account it refuses.
 */

// The value that selects the Unknown account, from the data layer's module that has no side
// effect: data/db.js reads config.json when it loads without DATA_DIR
const { UNKNOWN_ACCOUNT } = require('../../data/sql-conditions');

// The accounts of a database seeded with several, by NIC handle: two with bills, and one
// that an import recorded, but that has no bill yet. Invented, as every value of the tests
// is.
const LYON = 'xx1111-ovh';
const PARIS = 'yy2222-ovh';
const NEW_ACCOUNT = 'zz3333-ovh';

// The account of the tests, which GET /me names by its NIC handle
const ACCOUNT = { nic: LYON, currency: 'EUR' };

// A time as SQLite's CURRENT_TIMESTAMP writes it: UTC, to the second
const SQLITE_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

// A project and a bill of an account, written through the data layer (data/db.js)
const project = (db, id, name, account) => db.projects.upsert({
  id, name, description: name, status: 'ok', created_at: null, account,
});
const bill = (db, id, date, account) => db.bills.upsert({
  id, date, price_without_tax: 0, price_with_tax: 0, tax: 0, currency: 'EUR',
  pdf_url: null, html_url: null, account,
});

// What the server answers to an account parameter it refuses (server/account-parameter.js)
const REFUSED = {
  error: "Invalid 'account' parameter: expected the NIC handle of an account, or "
    + UNKNOWN_ACCOUNT,
};

module.exports = {
  ACCOUNT, SQLITE_TIME, LYON, PARIS, NEW_ACCOUNT, UNKNOWN_ACCOUNT, project, bill, REFUSED,
};
