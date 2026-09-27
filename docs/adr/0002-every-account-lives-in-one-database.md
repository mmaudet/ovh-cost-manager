# Every account lives in one database

An OCM instance can import several OVH accounts (#106), where the initial scope said one
account per instance. They share one database: every row imported from OVH carries the
NIC handle of its account, read from `GET /me` at each import, so that renaming or
reordering the accounts in `config.json` never detaches their data. "All accounts" is then
the absence of a filter, one account is a filter on that column, and one import run
serves them all.

The operations that act on a whole table today act on one account instead: the removal of
the services OVH no longer lists, the replacement of the consumption history, the clearing
of `--full`, and the reads of the latest balance and consumption snapshot. The accounts
must bill in the same currency, which the import checks, as the totals add their amounts.

## Considered options

- **One database per account**, joined when the server reads them: every query of the
  "all accounts" view would span several files, and the existing databases would need
  moving.
- **One instance per account, and a separate aggregator**: the duplication of today's
  workaround, with the aggregation left outside OCM.
