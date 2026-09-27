/**
 * What the tests share about accounts (#112): the account of the tests, and the form of the
 * times that SQLite writes, such as when an account's last import ended.
 */

// The account of the tests, which GET /me names by its NIC handle. Invented, as every value
// of the tests is.
const ACCOUNT = { nic: 'xx1111-ovh', currency: 'EUR' };

// A time as SQLite's CURRENT_TIMESTAMP writes it: UTC, to the second
const SQLITE_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

module.exports = { ACCOUNT, SQLITE_TIME };
