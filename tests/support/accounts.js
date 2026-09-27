/**
 * What the tests share about accounts (#112): the account of the tests, and the form of the
 * times that SQLite writes, such as when an account's last import ended. And, for the tests
 * of the account parameter of the server's routes (#115), the accounts of the database they
 * seed, the writers of their rows, and what the server answers to an account it refuses.
 */

// The account of the tests, which GET /me names by its NIC handle. Invented, as every value
// of the tests is.
const ACCOUNT = { nic: 'xx1111-ovh', currency: 'EUR' };

// A time as SQLite's CURRENT_TIMESTAMP writes it: UTC, to the second
const SQLITE_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

// The accounts of a database seeded with several, by NIC handle: two with bills, and one
// that an import recorded, but that has no bill yet
const LYON = 'xx1111-ovh';
const PARIS = 'yy2222-ovh';
const NEW_ACCOUNT = 'zz3333-ovh';

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
  error: "Invalid 'account' parameter: expected the NIC handle of an account, or unknown",
};

module.exports = {
  ACCOUNT, SQLITE_TIME, LYON, PARIS, NEW_ACCOUNT, project, bill, REFUSED,
};
