/**
 * Tests for an import of several accounts (#113), against a simulated OVH API that serves
 * each account through its own credentials: one run imports them one after the other, each
 * from its own latest bill, and an account that fails does not stop the others.
 */

const {
  ok, fail, calls, CONFIG_FILES, serveAccount, useConfig, useThrowawayImport,
} = require('./support/simulated-ovh');

jest.mock('ovh', () => require('./support/simulated-ovh').ovh);
jest.mock('jsonfile', () => require('./support/simulated-ovh').jsonfile);

const throwaway = useThrowawayImport('ocm-several-accounts-');
let db;
let importer;
beforeAll(() => {
  ({ db, importer } = throwaway);
});

beforeEach(() => {
  // The day the differential imports run to
  jest.setSystemTime(new Date('2026-09-15T10:00:00Z'));
  // The progress of the bills
  jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

// The accounts that OVH serves, invented. Montréal bills in another currency.
const LYON = { nic: 'xx1111-ovh', currency: 'EUR' };
const PARIS = { nic: 'yy2222-ovh', currency: 'EUR' };
const MONTREAL = { nic: 'zz3333-ovh', currency: 'CAD' };

// Credentials that lead to no account, as a revoked key
const REVOKED = {
  credentials: {
    appKey: 'app-revoked', appSecret: 'secret-revoked', consumerKey: 'consumer-revoked',
    endpoint: 'ovh-eu',
  },
};

// Configures these accounts, in this order, under the accounts section: each entry is an
// account that OVH serves, or REVOKED, with the fields of its entry, such as its name
const useAccounts = (...entries) => useConfig({
  accounts: entries.map(({ served, ...fields }) => ({
    ...fields, credentials: served.credentials,
  })),
});

// Serves on these routes no Public Cloud project, and these bills, as [id, date], each of one
// line: the bill list gives those of the dates asked for, as OVH filters it on date.from and
// date.to, both included
function serveBills(accountRoutes, bills) {
  accountRoutes.set('/cloud/project', ok([]));
  accountRoutes.set('/me/bill', (params = {}) => Promise.resolve(bills
    .filter(([, date]) => (!params['date.from'] || date >= params['date.from'])
      && (!params['date.to'] || date <= params['date.to']))
    .map(([id]) => id)));
  for (const [id, date] of bills) {
    accountRoutes.set(`/me/bill/${id}`, ok({
      billId: id,
      date: `${date}T00:00:00+02:00`,
      priceWithoutTax: { value: 10, currencyCode: 'EUR' },
      priceWithTax: { value: 12, currencyCode: 'EUR' },
      tax: { value: 2, currencyCode: 'EUR' },
    }));
    accountRoutes.set(`/me/bill/${id}/details`, ok(['D1']));
    accountRoutes.set(`/me/bill/${id}/details/D1`, ok({
      domain: 'example.com', description: 'Nom de domaine example.com', quantity: '1',
      unitPrice: { value: 10, currencyCode: 'EUR' },
      totalPrice: { value: 10, currencyCode: 'EUR' },
    }));
  }
}

// Serves on these routes these Public Cloud projects, named by their ids
function serveProjects(accountRoutes, ids) {
  accountRoutes.set('/cloud/project', ok(ids));
  for (const id of ids) {
    accountRoutes.set(`/cloud/project/${id}`, ok({ description: id, status: 'ok' }));
  }
}

// A bill of the account, as an earlier import stored it
const storeBill = (id, date, nic) => db.bills.upsert({
  id, date, price_without_tax: 10, price_with_tax: 12, tax: 2, currency: 'EUR', pdf_url: null,
  html_url: null, account: nic,
});

// Runs an import as import.js runs it with these options. Retry delays run on fake timers,
// so a retried call costs no real time.
async function runImport(params) {
  const done = importer.runImport(params);
  await jest.runAllTimersAsync();
  await done;
}

// A period import of September, with none of the datasets that the bills do not give
const importSeptember = (options = {}) =>
  runImport({ from: '2026-09-01', to: '2026-09-30', ...options });

// The bills stored, as [id, NIC handle of their account]
const storedBills = () => db.getDb().prepare('SELECT id, account FROM bills ORDER BY id').all()
  .map(bill => [bill.id, bill.account]);

// How the last import of each account recorded ended, as [NIC handle, status, error]
const lastImports = () => db.accounts.getAll()
  .map(account => [account.nic, account.last_import_status, account.last_import_error]);

// How each run of the import log ended, as [status, error]
const runs = () => db.importLog.getAll().map(entry => [entry.status, entry.error_message]);

// The routes that the clients of an account's credentials called, in order
const routesCalledWith = ({ credentials }) => calls
  .filter(call => call.consumerKey === credentials.consumerKey)
  .map(call => call.route);

// The consumer keys of the clients that called the API, in order, those of consecutive calls
// once
const clientsInCallOrder = () => calls
  .map(call => call.consumerKey)
  .filter((key, index, keys) => key !== keys[index - 1]);

// The date from which each client asked for the bill list, in order
const billListsAskedFrom = () => calls
  .filter(call => call.route === '/me/bill')
  .map(call => [call.consumerKey, call.params?.['date.from']]);

// The summary that ends an import that imported its accounts: its last five lines
const summary = () => console.log.mock.calls.slice(-5).map(([line]) => line);

describe('an import of several accounts', () => {
  test('imports every account, each through its own credentials', async () => {
    const lyon = serveAccount(LYON);
    const paris = serveAccount(PARIS);
    serveBills(lyon.routes, [['FR-L1', '2026-09-01']]);
    serveBills(paris.routes, [['FR-P1', '2026-09-01']]);
    useAccounts({ served: lyon, name: 'Lyon' }, { served: paris });

    await importSeptember();

    expect(storedBills()).toEqual([['FR-L1', LYON.nic], ['FR-P1', PARIS.nic]]);
    expect(lastImports()).toEqual([[LYON.nic, 'success', null], [PARIS.nic, 'success', null]]);
    expect(runs()).toEqual([['success', null]]);
    expect(summary()).toEqual([
      '\n=== IMPORT COMPLETE ===', 'Projects: 0', 'Bills: 2', 'Details: 2', 'Failed items: 0',
    ]);
    expect(process.exit).not.toHaveBeenCalled();
  });

  // Before importing any, so that two entries of one account fail the run first
  test('reads every account first, then imports them one after the other, in their order',
    async () => {
      const lyon = serveAccount(LYON);
      const paris = serveAccount(PARIS);
      serveBills(lyon.routes, [['FR-L1', '2026-09-01']]);
      serveBills(paris.routes, [['FR-P1', '2026-09-01']]);
      useAccounts({ served: lyon }, { served: paris });

      await importSeptember();

      const [lyonKey, parisKey] = [lyon, paris].map(served => served.credentials.consumerKey);
      expect(clientsInCallOrder()).toEqual([lyonKey, parisKey, lyonKey, parisKey]);
      expect(calls.slice(0, 2).map(call => call.route)).toEqual(['/me', '/me']);
    });

  test('holds a single entry of the import log, the lock, until the last account is imported',
    async () => {
      const lyon = serveAccount(LYON);
      const paris = serveAccount(PARIS);
      serveBills(lyon.routes, [['FR-L1', '2026-09-01']]);
      serveBills(paris.routes, [['FR-P1', '2026-09-01']]);
      useAccounts({ served: lyon }, { served: paris });
      // The import log as the last account's bills are asked for
      let whileLast;
      const billList = paris.routes.get('/me/bill');
      paris.routes.set('/me/bill', (params) => {
        whileLast = { running: db.importLog.isRunning(), runs: runs() };
        return billList(params);
      });

      await importSeptember();

      expect(whileLast).toEqual({ running: true, runs: [['running', null]] });
      expect(runs()).toEqual([['success', null]]);
    });
});

describe('the lock of a run', () => {
  // Makes the run look as if it had started, and last shown that it is alive, 40 minutes ago,
  // as a long run would without keeping its lock. Gives whether it still holds it then.
  function ageTheLock() {
    db.getDb().prepare(`
      UPDATE import_log SET
        started_at = datetime('now', '-40 minutes'),
        heartbeat_at = datetime('now', '-40 minutes')
      WHERE status = 'running'
    `).run();
    return db.importLog.isRunning();
  }

  // Before a route answers, runs `before`
  const around = (accountRoutes, route, before) => {
    const answer = accountRoutes.get(route);
    accountRoutes.set(route, (params) => {
      before();
      return answer(params);
    });
  };

  // A whole history takes long
  test('is kept after each bill, however long the run takes', async () => {
    const lyon = serveAccount(LYON);
    serveBills(lyon.routes, [['FR-L1', '2026-09-01'], ['FR-L2', '2026-09-02']]);
    useAccounts({ served: lyon });
    const held = {};
    around(lyon.routes, '/me/bill/FR-L1', () => { held.aged = ageTheLock(); });
    around(lyon.routes, '/me/bill/FR-L2', () => { held.atNextBill = db.importLog.isRunning(); });

    await importSeptember();

    expect(held).toEqual({ aged: false, atNextBill: true });
  });

  test('is kept from one account to the next', async () => {
    const lyon = serveAccount(LYON);
    const paris = serveAccount(PARIS);
    // No bill: the account's own import is all that can keep the lock
    serveBills(lyon.routes, []);
    serveBills(paris.routes, []);
    useAccounts({ served: lyon }, { served: paris });
    const held = {};
    around(lyon.routes, '/me/bill', () => { held.aged = ageTheLock(); });
    around(paris.routes, '/cloud/project', () => {
      held.atNextAccount = db.importLog.isRunning();
    });

    await importSeptember();

    expect(held).toEqual({ aged: false, atNextAccount: true });
  });
});

describe('a differential import of several accounts', () => {
  // Lyon was imported up to its bill of August. Paris was added since: none of its bills is
  // stored, and its first is older than Lyon's latest.
  function serveLyonAndNewParis() {
    const lyon = serveAccount(LYON);
    const paris = serveAccount(PARIS);
    storeBill('FR-L1', '2026-08-01', LYON.nic);
    serveBills(lyon.routes, [['FR-L1', '2026-08-01'], ['FR-L2', '2026-09-01']]);
    serveBills(paris.routes, [['FR-P1', '2026-07-01'], ['FR-P2', '2026-09-01']]);
    useAccounts({ served: lyon }, { served: paris });
    return [lyon, paris].map(served => served.credentials.consumerKey);
  }

  test('starts each account from its own latest bill, and one without any from its first',
    async () => {
      const [lyonKey, parisKey] = serveLyonAndNewParis();

      await runImport({ diff: true });

      expect(billListsAskedFrom()).toEqual([[lyonKey, '2026-08-01'], [parisKey, undefined]]);
      expect(storedBills()).toEqual([
        ['FR-L1', LYON.nic], ['FR-L2', LYON.nic], ['FR-P1', PARIS.nic], ['FR-P2', PARIS.nic],
      ]);
    });

  test('starts every account from --since', async () => {
    const [lyonKey, parisKey] = serveLyonAndNewParis();

    await runImport({ diff: true, since: '2026-08-15' });

    expect(billListsAskedFrom()).toEqual([[lyonKey, '2026-08-15'], [parisKey, '2026-08-15']]);
    expect(storedBills()).toEqual([['FR-L1', LYON.nic], ['FR-L2', LYON.nic], ['FR-P2', PARIS.nic]]);
  });
});

describe('an account that fails', () => {
  test('does not stop the accounts after it, and the run ends partial, naming it', async () => {
    const lyon = serveAccount(LYON);
    const paris = serveAccount(PARIS);
    serveBills(lyon.routes, [['FR-L1', '2026-09-01']]);
    lyon.routes.set('/cloud/project', fail(500, 'Internal server error'));
    serveBills(paris.routes, [['FR-P1', '2026-09-01']]);
    useAccounts({ served: lyon, name: 'Lyon' }, { served: paris });

    await importSeptember();

    expect(storedBills()).toEqual([['FR-P1', PARIS.nic]]);
    expect(lastImports()).toEqual([
      [LYON.nic, 'failed', 'Internal server error'], [PARIS.nic, 'success', null],
    ]);
    expect(runs()).toEqual([
      ['partial', '1 of 2 accounts failed: "Lyon" (xx1111-ovh): Internal server error'],
    ]);
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  // What it wrote before it failed stays, and counts in the figures of the run
  test('counts in the figures of the run what it wrote before it failed', async () => {
    const lyon = serveAccount(LYON);
    const paris = serveAccount(PARIS);
    serveBills(lyon.routes, [['FR-L1', '2026-09-01']]);
    serveProjects(lyon.routes, ['proj-l1', 'proj-l2']);
    // Its projects are stored, then its bill list fails
    serveProjects(paris.routes, ['proj-p1', 'proj-p2']);
    paris.routes.set('/me/bill', fail(500, 'Internal server error'));
    useAccounts({ served: lyon }, { served: paris });

    await importSeptember();

    const { status, projects_imported: projects, bills_imported: bills } = db.importLog.getLatest();
    expect({ status, projects, bills }).toEqual({ status: 'partial', projects: 4, bills: 1 });
    expect(db.projects.getAll()).toHaveLength(4);
    expect(summary()).toEqual([
      '\n=== IMPORT PARTIAL ===', 'Projects: 4', 'Bills: 1', 'Details: 1', 'Failed items: 0',
    ]);
  });

  // Its NIC handle is unknown: GET /me names it
  test('in its GET /me is named by its place in the accounts section', async () => {
    const lyon = serveAccount(LYON);
    serveBills(lyon.routes, [['FR-L1', '2026-09-01']]);
    useAccounts({ served: lyon }, { served: REVOKED });

    await importSeptember();

    expect(storedBills()).toEqual([['FR-L1', LYON.nic]]);
    expect(lastImports()).toEqual([[LYON.nic, 'success', null]]);
    expect(runs()).toEqual([
      ['partial', '1 of 2 accounts failed: accounts[1]: This credential is not valid'],
    ]);
  });

  // Rather than leave the account with the success of its last import. GET /me cannot name
  // it, but its entry's name is the one that an import recorded it with.
  test('in its GET /me is recorded on the account of its name', async () => {
    const lyon = serveAccount(LYON);
    const paris = serveAccount(PARIS);
    serveBills(lyon.routes, []);
    serveBills(paris.routes, []);
    useAccounts({ served: lyon, name: 'Lyon' }, { served: paris });
    await importSeptember();
    // Its key revoked since
    useAccounts({ served: REVOKED, name: 'Lyon' }, { served: paris });

    await importSeptember();

    expect(lastImports()).toEqual([
      [LYON.nic, 'failed', 'This credential is not valid'], [PARIS.nic, 'success', null],
    ]);
  });

  test('along with every other fails the run, which names each', async () => {
    const lyon = serveAccount(LYON);
    serveBills(lyon.routes, [['FR-L1', '2026-09-01']]);
    lyon.routes.set('/cloud/project', fail(500, 'Internal server error'));
    useAccounts({ served: lyon, name: 'Lyon' }, { served: REVOKED });

    await importSeptember();

    const message = '2 of 2 accounts failed: "Lyon" (xx1111-ovh): Internal server error; '
      + 'accounts[1]: This credential is not valid';
    expect(runs()).toEqual([['failed', message]]);
    expect(console.error.mock.calls.slice(-2)).toEqual([['\n=== IMPORT FAILED ==='], [message]]);
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});

describe('two entries that lead to the same account', () => {
  test('fail the run before it imports anything, naming both', async () => {
    const lyon = serveAccount(LYON, 'lyon');
    const lyonAgain = serveAccount(LYON, 'lyon-again');
    const paris = serveAccount(PARIS);
    for (const served of [lyon, lyonAgain, paris]) serveBills(served.routes, []);
    useAccounts({ served: lyon, name: 'Lyon' }, { served: paris }, { served: lyonAgain });

    await importSeptember();

    const message = `"Lyon" and accounts[2] in ${CONFIG_FILES.project} are the same account, `
      + 'xx1111-ovh: list each account once';
    expect(runs()).toEqual([['failed', message]]);
    expect(calls.map(call => call.route)).toEqual(['/me', '/me', '/me']);
    expect(db.accounts.getAll()).toEqual([]);
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});

describe('the currency of the accounts', () => {
  test('fails an account billing in another than the first account, naming it and both',
    async () => {
      const lyon = serveAccount(LYON);
      const montreal = serveAccount(MONTREAL);
      serveBills(lyon.routes, [['FR-L1', '2026-09-01']]);
      serveBills(montreal.routes, [['CA-M1', '2026-09-01']]);
      useAccounts({ served: lyon, name: 'Lyon' }, { served: montreal });

      await importSeptember();

      const refusal = 'The account bills in CAD, not in EUR as "Lyon" (xx1111-ovh), the first '
        + 'configured account: every account must bill in the same currency';
      expect(storedBills()).toEqual([['FR-L1', LYON.nic]]);
      expect(lastImports()).toEqual([
        [LYON.nic, 'success', null], [MONTREAL.nic, 'failed', refusal],
      ]);
      expect(runs()).toEqual([
        ['partial', `1 of 2 accounts failed: accounts[1] (zz3333-ovh): ${refusal}`],
      ]);
      // Read, never imported
      expect(routesCalledWith(montreal)).toEqual(['/me']);
    });

  test('is that of the first account read, when the first configured cannot be read',
    async () => {
      const montreal = serveAccount(MONTREAL);
      const lyon = serveAccount(LYON);
      serveBills(montreal.routes, [['CA-M1', '2026-09-01']]);
      serveBills(lyon.routes, [['FR-L1', '2026-09-01']]);
      useAccounts({ served: REVOKED }, { served: montreal, name: 'Montréal' }, { served: lyon });

      await importSeptember();

      const refusal = 'The account bills in EUR, not in CAD as "Montréal" (zz3333-ovh), the first '
        + 'configured account that could be read: every account must bill in the same currency';
      expect(storedBills()).toEqual([['CA-M1', MONTREAL.nic]]);
      expect(runs()).toEqual([['partial', '2 of 3 accounts failed: accounts[0]: This credential '
        + `is not valid; accounts[2] (xx1111-ovh): ${refusal}`]]);
    });

  test('is not checked with a single account', async () => {
    const montreal = serveAccount(MONTREAL);
    serveBills(montreal.routes, [['CA-M1', '2026-09-01']]);
    useAccounts({ served: montreal });

    await importSeptember();

    expect(lastImports()).toEqual([[MONTREAL.nic, 'success', null]]);
    expect(runs()).toEqual([['success', null]]);
  });
});

describe('an import limited to one account (--account)', () => {
  test('imports the configured account of that NIC handle alone', async () => {
    const lyon = serveAccount(LYON);
    const paris = serveAccount(PARIS);
    serveBills(lyon.routes, [['FR-L1', '2026-09-01']]);
    serveBills(paris.routes, [['FR-P1', '2026-09-01']]);
    useAccounts({ served: lyon, name: 'Lyon' }, { served: paris });

    await importSeptember({ account: PARIS.nic });

    expect(storedBills()).toEqual([['FR-P1', PARIS.nic]]);
    expect(lastImports()).toEqual([[PARIS.nic, 'success', null]]);
    expect(runs()).toEqual([['success', null]]);
    // Read to find the account, never imported
    expect(routesCalledWith(lyon)).toEqual(['/me']);
  });

  // The run is that account's alone
  test('imports it when another account cannot be read', async () => {
    const paris = serveAccount(PARIS);
    serveBills(paris.routes, [['FR-P1', '2026-09-01']]);
    useAccounts({ served: REVOKED }, { served: paris });

    await importSeptember({ account: PARIS.nic });

    expect(storedBills()).toEqual([['FR-P1', PARIS.nic]]);
    expect(runs()).toEqual([['success', null]]);
    expect(process.exit).not.toHaveBeenCalled();
  });

  // The configuration has several accounts, whatever the run imports of them: their currency
  // is checked, and the messages name each account
  test('names the account in the error of the run when it fails', async () => {
    const lyon = serveAccount(LYON);
    const montreal = serveAccount(MONTREAL);
    serveBills(lyon.routes, []);
    serveBills(montreal.routes, [['CA-M1', '2026-09-01']]);
    useAccounts({ served: lyon, name: 'Lyon' }, { served: montreal });

    await importSeptember({ account: MONTREAL.nic });

    expect(runs()).toEqual([[
      'failed',
      '1 of 1 account failed: accounts[1] (zz3333-ovh): The account bills in CAD, not in EUR '
        + 'as "Lyon" (xx1111-ovh), the first configured account: every account must bill in '
        + 'the same currency',
    ]]);
    expect(storedBills()).toEqual([]);
  });

  // Either it is not configured, or it is the account that could not be read
  test('fails when no account read has that NIC handle, naming those it could not read',
    async () => {
      const lyon = serveAccount(LYON);
      useAccounts({ served: lyon }, { served: REVOKED });

      await importSeptember({ account: PARIS.nic });

      expect(runs()).toEqual([[
        'failed',
        `No account configured in ${CONFIG_FILES.project} has the NIC handle yy2222-ovh, unless `
          + 'it is one that could not be read: accounts[1]: This credential is not valid',
      ]]);
    });

  test('fails when no configured account has that NIC handle, naming it', async () => {
    const lyon = serveAccount(LYON);
    serveBills(lyon.routes, [['FR-L1', '2026-09-01']]);
    useAccounts({ served: lyon });

    await importSeptember({ account: 'zz3333-ovh' });

    const message = `No account configured in ${CONFIG_FILES.project} has the NIC handle `
      + 'zz3333-ovh';
    expect(runs()).toEqual([['failed', message]]);
    expect(storedBills()).toEqual([]);
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  // Rather than import every account
  test('is refused without a NIC handle', async () => {
    const lyon = serveAccount(LYON);
    useAccounts({ served: lyon });

    await importSeptember({ account: '' });

    expect(process.exit).toHaveBeenCalledWith(1);
    expect(console.error)
      .toHaveBeenCalledWith('Error: --account needs the NIC handle of the account to import');
    expect(db.importLog.getAll()).toEqual([]);
    expect(calls).toEqual([]);
  });

  // Clearing a single account's data comes with #114
  test('is refused with --full, which clears every account', async () => {
    const lyon = serveAccount(LYON);
    useAccounts({ served: lyon });

    await runImport({ full: true, account: LYON.nic });

    expect(process.exit).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith('Error: --full clears every account, so it '
      + 'cannot be limited to one with --account yet: run --full alone, or --account with '
      + '--diff or --from');
    expect(db.importLog.getAll()).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe('a full import of several accounts', () => {
  test('clears every account, and imports each again', async () => {
    const lyon = serveAccount(LYON);
    const paris = serveAccount(PARIS);
    // Bills that OVH no longer lists
    storeBill('FR-L0', '2026-08-01', LYON.nic);
    storeBill('FR-P0', '2026-08-01', PARIS.nic);
    serveBills(lyon.routes, [['FR-L1', '2026-09-01']]);
    serveBills(paris.routes, [['FR-P1', '2026-09-01']]);
    useAccounts({ served: lyon }, { served: paris });

    await runImport({ full: true });

    expect(storedBills()).toEqual([['FR-L1', LYON.nic], ['FR-P1', PARIS.nic]]);
    expect(runs()).toEqual([['success', null]]);
  });

  // Clearing would drop the data of the account that it cannot import again
  test('clears nothing when an account cannot be read, and imports the others', async () => {
    const lyon = serveAccount(LYON);
    storeBill('FR-L0', '2026-08-01', LYON.nic);
    storeBill('FR-P0', '2026-08-01', PARIS.nic);
    serveBills(lyon.routes, [['FR-L1', '2026-09-01']]);
    useAccounts({ served: lyon }, { served: REVOKED });

    await runImport({ full: true });

    expect(storedBills()).toEqual([
      ['FR-L0', LYON.nic], ['FR-L1', LYON.nic], ['FR-P0', PARIS.nic],
    ]);
    // Said where the import history shows it, not only in the console
    expect(runs()).toEqual([[
      'partial',
      '1 of 2 accounts failed: accounts[1]: This credential is not valid. Nothing was cleared, '
        + 'as a full import clears every account or none',
    ]]);
  });
});

describe('the rows stored before the accounts', () => {
  // Which account they belong to is for #114 to tell, from what each account's API lists
  test('are given to no account when several accounts are configured', async () => {
    db.getDb().prepare(`
      INSERT INTO bills (id, date, price_without_tax, currency)
      VALUES ('FR-0', '2026-06-01', 10, 'EUR')
    `).run();
    const lyon = serveAccount(LYON);
    const paris = serveAccount(PARIS);
    serveBills(lyon.routes, []);
    serveBills(paris.routes, []);
    useAccounts({ served: lyon }, { served: paris });

    await runImport({ diff: true });

    expect(storedBills()).toEqual([['FR-0', null]]);
    expect(runs()).toEqual([['success', null]]);
  });
});
