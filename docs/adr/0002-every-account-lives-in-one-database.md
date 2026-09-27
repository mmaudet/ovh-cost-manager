# Every account lives in one database

An OCM instance can import several OVH accounts (#106), where the initial scope said one
account per instance. They share one database: every row imported from OVH belongs to an
account, known by the NIC handle that `GET /me` gives at each import, so that renaming or
reordering the accounts in `config.json` never detaches their data. The root rows (bills,
projects, inventories, balance and consumption snapshots, consumption history, credit
movements) carry that NIC handle in a column; the child rows (bill lines, cloud resources,
per-project consumption and quotas) reach it through their bill or their project. "All
accounts" is then the absence of a filter, one account is a filter on that column, and one
import run serves them all.

The operations that act on a whole table today act on one account instead: the removal of
the services OVH no longer lists, the replacement of the consumption history, the clearing
of `--full`, and the reads of the latest balance and consumption snapshot. The accounts
must bill in the same currency, which the import checks, as the totals add their amounts.

A service that two accounts' APIs list, such as a server billed to one account and managed
by another, is stored once: it belongs to the account whose bill lines name it, or else to
the first configured account that lists it, and another account that lists it never takes
it over. An account removed from the configuration keeps its data, and is no longer
imported.

## The rows stored before the accounts

A database from before the accounts could only hold one account's data, as OCM took one set
of credentials. Its rows carry no account, and the imports give them one:

- with a single account configured, in a database that has only ever known that account,
  it gets them all at its first import. The accounts table tells the accounts that the
  imports recorded, and a mark in the import state, which no run clears, tells that a
  run's configuration listed several entries, even one whose GET /me never answered;
- otherwise each account claims the rows that its API lists: its bills, from its whole bill
  list, its projects and services, and each credit movement that its API gives again, the
  same id, date and amount, as two accounts' movements can share their ids;
- once no bill is left without an account, and every bill claimed went to one and the same
  account, the database was that account's, and it gets every other row without an account.
  The import checks it right after each account's bill claims, before its other datasets,
  so that the consumption history it imports replaces the months stored then rather than
  adds them twice. Each account's count of claimed bills keeps the claims of every run, as
  an account whose import failed claims its bills in a later one;
- when a rule gives an account the rows, one whose key the account already holds, such as a
  credit movement that its import stored again, is its own older copy, and goes;
- the balance and consumption snapshots that no account can claim go: each account's
  import records its own.

The rows that no account gets stay without one: they are the Unknown account's
(`CONTEXT.md`), which the imports of the accounts never delete, and the server lists.

A known limit: the rule of one account's database needs bills. A base that holds a
consumption history but no bill tells nothing, so its rows stay the Unknown account's, and
once the account imports the same months again, the view of all accounts counts them twice.

## Considered options

- **One database per account**, joined when the server reads them: every query of the
  "all accounts" view would span several files, and the existing databases would need
  moving.
- **One instance per account, and a separate aggregator**: the duplication of today's
  workaround, with the aggregation left outside OCM.
