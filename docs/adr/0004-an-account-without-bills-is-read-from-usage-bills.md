# An account without bills is read from usage bills

Some organisations have their OVHcloud bills issued by a third party: neither the API nor the
control panel gives them, and `/me/bill` lists none. All OCM reads hangs on the bills, which
every query adds up the lines of. Such an account takes `"costSource": "cloudUsage"` in
`config.json` (`CONTEXT.md`: Cost source): its costs are then its Public Cloud projects'
usage, which `GET /cloud/project/{id}/usage/history` gives for the month of today and the six
months before, each month at public prices before tax, before any discount or Public Cloud
credit, its parts adding up to its total.

The import turns that usage into usage bills (`CONTEXT.md`), stored in the bills and bill
lines tables as OVH's are: one bill per account and month, marked `source = 'usage'`, holding
the lines of every project of the account. Each line is worded as the bill line of its charge
(`data/usage-lines.js`): an hourly flavor in a region, a monthly instance with its id, the
additional disks of a type in a region, a bucket, a database plan, a model's input tokens.
So every query, the products, the charges, the AI Endpoints models, the accounts and the
carbon ties read them as they read OVH's, and none had to change. Tests pin that each wording
reads as the product, the instance, the volume or the model it pays for.

A usage bill is dated on the first day of the month after its usage, as OVHcloud bills a
Public Cloud project's month: the month of use of its lines is the month of the usage, as for
a bill line, and the months of an account billed and of an account read from its usage
compare. The page names them by the month of their usage while it shows only such accounts.

The bill of the month of today's usage is provisional: each import rewrites it while the month
runs, and it is the account's month in progress, which each project's month-end forecast
projects, spread over its lines. The recurring services that tell the month in progress of a
billed account are read from OVH's bills alone.

OVH gives seven months of usage: a full import keeps the usage bills of an account read from
its usage, as it keeps the carbon footprints (ADR 0003), and fetches the months it still gives
again. It clears its OVH bills, which would count the same costs twice; and the usage bills of
an account whose cost source is its bills again, for the same reason.

The routes of the bills, `/api/bills`, its CSV export, and `/api/bills/:id` with its `details`
and its `payment`, give OVH's bills alone: a usage bill has no PDF, no payment, and no OVHcloud
number.

## Limits

- Only the Public Cloud is covered: the account's other services have an inventory, and no
  cost.
- The amounts are public prices before tax, above what the third party bills after its
  discounts and credits.
- The history starts seven months before the first import.
- With accounts of both cost sources shown together, one month only is in progress: that of
  the latest provisional usage bill.

## Considered options

- **A table of usage lines, and a view that joins them to the bill lines**: cleaner, but every
  query, the month in progress, the ownership rules and the tests of some fifty readers would
  have had to change.
- **`/me/consumption/usage/history`**: an account whose bills a third party issues gets no
  detail of its usage there, only of its Public Cloud projects' through their own routes.
- **Dating a usage bill in the month of its usage**: more natural for such an account alone, but
  its lines' month of use, the carbon ties and the comparison with billed accounts would have
  needed a rule of their own.
