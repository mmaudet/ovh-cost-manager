/**
 * The CSV exports of the API (#137): the bills, the bill lines, the costs by project and the
 * inventory, on the server started in a child process over a database that the test seeds. As
 * the data routes do (#115), each takes the account parameter: a NIC handle that the accounts
 * table records keeps that account's rows, the reserved value `unknown` the rows without an
 * account (the Unknown account), and no parameter those of every account, as before. Any
 * other value is refused.
 *
 * When the database holds several accounts, as the dashboard offers the account selector then,
 * each file gains an `account` column, last, for a spreadsheet to pivot the rows by account:
 * the NIC handle of each row's account, empty for the Unknown account. A single-account
 * database gets the same files as before an instance could import several accounts, byte for
 * byte: their names, their byte order mark, their columns and their rows.
 */

const {
  LYON, PARIS, NEW_ACCOUNT, UNKNOWN_ACCOUNT, REFUSED, bill, project, server, vps, storage,
  historyEntry, recordAccounts,
} = require('./support/accounts');
const { startOcm } = require('./support/ocm-server');

// The dates of September, which the exports of a period ask for
const SEPTEMBER = 'from=2026-09-01&to=2026-09-30';

// A bill line: of a Public Cloud project, whose id is its domain, or of another service,
// named by its domain; `quantity` units at `unitPrice` each
const line = (id, billId, {
  project: projectId = null, domain = projectId, description, serviceType, resourceType,
  quantity = 1, unitPrice,
}) => ({
  id, bill_id: billId, project_id: projectId, domain, description, quantity,
  unit_price: unitPrice, total_price: quantity * unitPrice, service_type: serviceType,
  resource_type: resourceType,
});

// The rows of a single account, which carry its NIC handle, `account`, or none, as those that
// OCM imported before it told accounts apart: two projects, three bills of September and one
// of August, which the exports of September leave out, their bill lines, and an inventory.
// Every NIC handle, name and amount is made up.
function seedOneAccount(db, account) {
  // Its imports record it, and the configuration of their run, which lists it
  if (account !== null) recordAccounts(db, { nic: account });
  project(db, 'project-production', 'Production', account);
  project(db, 'project-staging', 'Staging', account);
  bill(db, 'FR0999', '2026-08-28', account, { price: 99, priceWithTax: 118.8, tax: 19.8 });
  // Two bills of the same day, FR1001 stored last
  bill(db, 'FR1002', '2026-09-05', account, { price: 40, priceWithTax: 48, tax: 8 });
  bill(db, 'FR1001', '2026-09-05', account, { price: 700.5, priceWithTax: 840.6, tax: 140.1 });
  bill(db, 'FR1003', '2026-09-20', account, { price: 150.25, priceWithTax: 180.3, tax: 30.05 });
  // How FR1001 was paid, which the balance's import records
  db.balance.updateBillPayment('FR1001', {
    type: 'creditCard', date: '2026-09-06', status: 'paid',
  });
  db.details.insertMany([
    line('FR0999-1', 'FR0999', {
      project: 'project-production', description: 'Instances b3-8 GRA11',
      serviceType: 'Compute', resourceType: 'cloud_project', quantity: 198, unitPrice: 0.5,
    }),
    // The lines of FR1001 stored in another order than their ids'
    line('FR1001-2', 'FR1001', {
      project: 'project-production', description: 'Stockage objet GRA',
      serviceType: 'Storage', resourceType: 'cloud_project', unitPrice: 40.5,
    }),
    line('FR1001-1', 'FR1001', {
      project: 'project-production', description: 'Instances b3-8 GRA11',
      serviceType: 'Compute', resourceType: 'cloud_project', quantity: 720, unitPrice: 0.5,
    }),
    line('FR1001-3', 'FR1001', {
      project: 'project-staging', description: 'Instances l4-90 GRA11',
      serviceType: 'AI/ML', resourceType: 'cloud_project', quantity: 100, unitPrice: 3,
    }),
    // A wording with double quotes, which the file doubles
    line('FR1002-1', 'FR1002', {
      domain: 'example.com', description: 'Nom de domaine "example.com" - 1 an',
      serviceType: 'Other', resourceType: 'domain', unitPrice: 40,
    }),
    line('FR1003-1', 'FR1003', {
      domain: 'ns3000001.ip-203-0-113.eu',
      description: 'Location du serveur RISE-1 ns3000001.ip-203-0-113.eu - 1 mois',
      serviceType: 'Compute', resourceType: 'dedicated_server', unitPrice: 150.25,
    }),
  ]);
  // A server without an expiration date, and a storage service without one either
  server(db, account, { id: 'ns3000003.ip-203-0-113.eu', name: 'db-server' });
  server(db, account, {
    id: 'ns3000001.ip-203-0-113.eu', name: 'backup-server', expires: '2027-01-31',
  });
  vps(db, account, {
    id: 'vps-0a1b2c3d.vps.ovh.net', name: 'vps-0a1b2c3d.vps.ovh.net', expires: '2026-12-15',
  });
  storage(db, account, { id: 'netapp-5f2c9a1e', name: 'shared-files' });
}

// Two accounts, one that an import recorded without any row, and the Unknown account, null,
// whose rows the imports before the accounts stored, and that no account claimed since. The
// configuration of the last import lists the three accounts. Staging moved from Lyon to Paris
// during September: both billed it.
function seedAccounts(db) {
  recordAccounts(db, { nic: LYON, name: 'Lyon subsidiary' }, { nic: PARIS }, { nic: NEW_ACCOUNT });
  project(db, 'project-production', 'Production', LYON);
  project(db, 'project-staging', 'Staging', PARIS);
  project(db, 'project-legacy', 'Legacy', null);
  bill(db, 'FR1001', '2026-09-05', LYON, { price: 650, priceWithTax: 780, tax: 130 });
  bill(db, 'FR1002', '2026-08-05', LYON, { price: 500, priceWithTax: 600, tax: 100 });
  bill(db, 'FR2001', '2026-09-10', PARIS, { price: 270, priceWithTax: 324, tax: 54 });
  bill(db, 'FR0001', '2026-09-20', null, { price: 90, priceWithTax: 108, tax: 18 });
  const instances = (id, billId, projectId, flavor, serviceType, price) => line(id, billId, {
    project: projectId, description: `Instances ${flavor} GRA11`, serviceType,
    resourceType: 'cloud_project', unitPrice: price,
  });
  const domain = (id, billId, name, price) => line(id, billId, {
    domain: name, description: `Nom de domaine ${name} - 1 an`, serviceType: 'Other',
    resourceType: 'domain', unitPrice: price,
  });
  db.details.insertMany([
    instances('FR1001-1', 'FR1001', 'project-production', 'b3-8', 'Compute', 600),
    instances('FR1001-2', 'FR1001', 'project-staging', 'l40s-180', 'AI/ML', 50),
    instances('FR1002-1', 'FR1002', 'project-production', 'b3-8', 'Compute', 500),
    instances('FR2001-1', 'FR2001', 'project-staging', 'b3-16', 'Compute', 230),
    domain('FR2001-2', 'FR2001', 'example.com', 40),
    instances('FR0001-1', 'FR0001', 'project-legacy', 't1-45', 'AI/ML', 60),
    domain('FR0001-2', 'FR0001', 'legacy.example.org', 30),
  ]);
  server(db, LYON, {
    id: 'ns3000001.ip-203-0-113.eu', name: 'backup-server', expires: '2027-01-31',
  });
  server(db, PARIS, {
    id: 'ns3000005.ip-198-51-100.eu', name: 'app-server', expires: '2026-11-30',
  });
  server(db, null, { id: 'ns3000004.ip-203-0-113.eu', name: 'legacy-server' });
  vps(db, LYON, {
    id: 'vps-0a1b2c3d.vps.ovh.net', name: 'vps-0a1b2c3d.vps.ovh.net', expires: '2026-12-15',
  });
  storage(db, PARIS, { id: 'netapp-5f2c9a1e', name: 'shared-files' });
}

// A route with the account parameter, which names this account
const forAccount = (route, account) =>
  `${route}${route.includes('?') ? '&' : '?'}account=${account}`;

// What the server answers to an export: its status, the type and the name of the file, and
// its content
async function exported(ocm, path) {
  const { status, headers, body } = await ocm.getText(path);
  return {
    status,
    type: headers.get('content-type'),
    disposition: headers.get('content-disposition'),
    body,
  };
}

// A CSV file of these lines, the header first, as the server answers it under this name: with
// a byte order mark, for Excel to read it as UTF-8
const csvFile = (filename, ...lines) => ({
  status: 200,
  type: 'text/csv; charset=utf-8',
  disposition: `attachment; filename="${filename}"`,
  body: `\ufeff${lines.join('\n')}`,
});

// The headers of the files, and a header with the account column, which comes last
const BILLS = '"Facture";"Date";"Montant HT";"Montant TTC";"TVA";"Devise"';
const withAccount = (header) => `${header};"account"`;
const DETAILS = '"Facture";"Date";"Projet";"Type Service";"Type Ressource";"Description";'
  + '"Quantite";"Prix Unitaire";"Prix Total";"Statut Paiement"';
const BY_PROJECT = '"Projet";"ID Projet";"Total HT";"Nb Lignes"';
const INVENTORY = '"Type";"ID";"Nom";"Localisation";"Specifications";"Etat";"Expiration";'
  + '"Renouvellement"';

// The inventory's file is named after the day of the export, in UTC
const today = () => new Date().toISOString().split('T')[0];

// A single-account installation gets the files it got before an instance could import several
// accounts. Its rows belong to its account, or to none, as until the first import since the
// upgrade.
describe.each([
  ['whose rows carry its account', LYON],
  ['imported before OCM told accounts apart', null],
])('a single-account database %s', (_, account) => {
  let single;

  beforeAll(async () => {
    single = await startOcm(() => ({}), { seed: (db) => seedOneAccount(db, account) });
  }, 30000);

  afterAll(async () => {
    await single?.stop();
  });

  // Amounts with a decimal comma, for a French Excel; the bills of one day the last stored
  // first
  test('exports the bills of a period, the latest first', async () => {
    expect(await exported(single, `/api/export/bills?${SEPTEMBER}`)).toEqual(csvFile(
      'factures_2026-09-01_2026-09-30.csv',
      BILLS,
      '"FR1003";"2026-09-20";150,25;180,3;30,05;"EUR"',
      '"FR1001";"2026-09-05";700,5;840,6;140,1;"EUR"',
      '"FR1002";"2026-09-05";40;48;8;"EUR"',
    ));
  });

  // The lines of a bill in the order they were stored. A line of no project, or of a bill
  // whose payment is not known, leaves the cell empty.
  test('exports the bill lines of a period, by date and bill', async () => {
    expect(await exported(single, `/api/export/details?${SEPTEMBER}`)).toEqual(csvFile(
      'details_2026-09-01_2026-09-30.csv',
      DETAILS,
      '"FR1001";"2026-09-05";"Production";"Storage";"cloud_project";"Stockage objet GRA";'
        + '1;40,5;40,5;"paid"',
      '"FR1001";"2026-09-05";"Production";"Compute";"cloud_project";"Instances b3-8 GRA11";'
        + '720;0,5;360;"paid"',
      '"FR1001";"2026-09-05";"Staging";"AI/ML";"cloud_project";"Instances l4-90 GRA11";'
        + '100;3;300;"paid"',
      '"FR1002";"2026-09-05";;"Other";"domain";"Nom de domaine ""example.com"" - 1 an";'
        + '1;40;40;',
      '"FR1003";"2026-09-20";;"Compute";"dedicated_server";'
        + '"Location du serveur RISE-1 ns3000001.ip-203-0-113.eu - 1 mois";1;150,25;150,25;',
    ));
  });

  test('exports the costs of each project of a period, the most expensive first', async () => {
    expect(await exported(single, `/api/export/by-project?${SEPTEMBER}`)).toEqual(csvFile(
      'couts_par_projet_2026-09-01_2026-09-30.csv',
      BY_PROJECT,
      '"Production";"project-production";400,5;2',
      '"Staging";"project-staging";300;1',
    ));
  });

  // The servers, then the VPS, then the storage services, each by name
  test('exports the services of the inventory', async () => {
    expect(await exported(single, '/api/export/inventory')).toEqual(csvFile(
      `inventaire_${today()}.csv`,
      INVENTORY,
      '"Dedicated Server";"ns3000001.ip-203-0-113.eu";"backup-server";"rbx8";'
        + '"Intel Xeon-E 2388G / 65536MB RAM";"ok";"2027-01-31";"automatic"',
      '"Dedicated Server";"ns3000003.ip-203-0-113.eu";"db-server";"rbx8";'
        + '"Intel Xeon-E 2388G / 65536MB RAM";"ok";"";"automatic"',
      '"VPS";"vps-0a1b2c3d.vps.ovh.net";"vps-0a1b2c3d.vps.ovh.net";'
        + '"Region OpenStack: os-gra7";"2 vCPU / 2048MB RAM / 40GB";"running";"2026-12-15";'
        + '"automatic"',
      '"Storage";"netapp-5f2c9a1e";"shared-files";"eu-west-gra";"1024GB";"";"";""',
    ));
  });

  // Its account, or the Unknown account for the rows without one, gives the same files as
  // every account, without the account column
  test('exports the same files for its account', async () => {
    for (const route of [
      `/api/export/bills?${SEPTEMBER}`, `/api/export/details?${SEPTEMBER}`,
      `/api/export/by-project?${SEPTEMBER}`,
    ]) {
      expect(await exported(single, forAccount(route, account ?? UNKNOWN_ACCOUNT)))
        .toEqual(await exported(single, route));
    }
  });
});

describe('a database of several accounts', () => {
  let ocm;

  beforeAll(async () => {
    ocm = await startOcm(() => ({}), { seed: seedAccounts });
  }, 30000);

  afterAll(async () => {
    await ocm?.stop();
  });

  // The file of an export for the account that the parameter names, or for every account
  // without one
  const exportOf = (route, account) =>
    exported(ocm, account === undefined ? route : forAccount(route, account));

  describe('GET /api/export/bills', () => {
    const route = `/api/export/bills?${SEPTEMBER}`;
    const bills = (...lines) => csvFile(
      'factures_2026-09-01_2026-09-30.csv', withAccount(BILLS), ...lines,
    );
    const lyon = `"FR1001";"2026-09-05";650;780;130;"EUR";"${LYON}"`;
    const paris = `"FR2001";"2026-09-10";270;324;54;"EUR";"${PARIS}"`;
    const legacy = '"FR0001";"2026-09-20";90;108;18;"EUR";';

    test('exports the bills of every account without the parameter, each with its account',
      async () => {
        expect(await exportOf(route)).toEqual(bills(legacy, paris, lyon));
      });

    test('exports the bills of the account whose NIC handle it gives', async () => {
      expect(await exportOf(route, LYON)).toEqual(bills(lyon));
      expect(await exportOf(route, PARIS)).toEqual(bills(paris));
    });

    test('exports those of the Unknown account, and none of an account without a bill',
      async () => {
        expect(await exportOf(route, UNKNOWN_ACCOUNT)).toEqual(bills(legacy));
        expect(await exportOf(route, NEW_ACCOUNT)).toEqual(bills());
      });
  });

  // A bill line belongs to the account of its bill (ADR 0002)
  describe('GET /api/export/details', () => {
    const route = `/api/export/details?${SEPTEMBER}`;
    const details = (...lines) => csvFile(
      'details_2026-09-01_2026-09-30.csv', withAccount(DETAILS), ...lines,
    );
    // No bill's payment is known
    const lyon = [
      '"FR1001";"2026-09-05";"Production";"Compute";"cloud_project";"Instances b3-8 GRA11";'
        + `1;600;600;;"${LYON}"`,
      '"FR1001";"2026-09-05";"Staging";"AI/ML";"cloud_project";"Instances l40s-180 GRA11";'
        + `1;50;50;;"${LYON}"`,
    ];
    const paris = [
      '"FR2001";"2026-09-10";"Staging";"Compute";"cloud_project";"Instances b3-16 GRA11";'
        + `1;230;230;;"${PARIS}"`,
      '"FR2001";"2026-09-10";;"Other";"domain";"Nom de domaine example.com - 1 an";'
        + `1;40;40;;"${PARIS}"`,
    ];
    const legacy = [
      '"FR0001";"2026-09-20";"Legacy";"AI/ML";"cloud_project";"Instances t1-45 GRA11";1;60;60;;',
      '"FR0001";"2026-09-20";;"Other";"domain";"Nom de domaine legacy.example.org - 1 an";'
        + '1;30;30;;',
    ];

    test('exports the bill lines of every account without the parameter, each with its account',
      async () => {
        expect(await exportOf(route)).toEqual(details(...lyon, ...paris, ...legacy));
      });

    test('exports the lines of the bills of the account whose NIC handle it gives', async () => {
      expect(await exportOf(route, LYON)).toEqual(details(...lyon));
      expect(await exportOf(route, PARIS)).toEqual(details(...paris));
    });

    test('exports those of the Unknown account, and none of an account without a bill',
      async () => {
        expect(await exportOf(route, UNKNOWN_ACCOUNT)).toEqual(details(...legacy));
        expect(await exportOf(route, NEW_ACCOUNT)).toEqual(details());
      });
  });

  // One row for each project and account that billed it, as the Overview's breakdown by
  // project gives them when it names the account of each project (#118)
  describe('GET /api/export/by-project', () => {
    const route = `/api/export/by-project?${SEPTEMBER}`;
    const byProject = (...lines) => csvFile(
      'couts_par_projet_2026-09-01_2026-09-30.csv', withAccount(BY_PROJECT), ...lines,
    );
    const production = `"Production";"project-production";600;1;"${LYON}"`;
    const legacy = '"Legacy";"project-legacy";60;1;';
    // Staging, moved from Lyon to Paris, as each account billed it
    const lyonStaging = `"Staging";"project-staging";50;1;"${LYON}"`;
    const parisStaging = `"Staging";"project-staging";230;1;"${PARIS}"`;

    // The most expensive first
    test('exports each project for each account that billed it without the parameter',
      async () => {
        expect(await exportOf(route))
          .toEqual(byProject(production, parisStaging, legacy, lyonStaging));
      });

    test('exports the projects that the bills of the account whose NIC handle it gives billed',
      async () => {
        expect(await exportOf(route, LYON)).toEqual(byProject(production, lyonStaging));
        expect(await exportOf(route, PARIS)).toEqual(byProject(parisStaging));
      });

    test('exports those of the Unknown account, and none of an account without a bill',
      async () => {
        expect(await exportOf(route, UNKNOWN_ACCOUNT)).toEqual(byProject(legacy));
        expect(await exportOf(route, NEW_ACCOUNT)).toEqual(byProject());
      });
  });

  // Rather than export every account's rows, or none, for a request that names an account
  describe('an account the server does not know', () => {
    test.each([
      ['a NIC handle that no import recorded', 'ww4444-ovh'],
      ['an empty value', ''],
      ['several values', `${LYON}&account=${PARIS}`],
    ])('is refused by the exports, naming the parameter: %s', async (_, value) => {
      for (const route of [
        `/api/export/bills?${SEPTEMBER}`, `/api/export/details?${SEPTEMBER}`,
        `/api/export/by-project?${SEPTEMBER}`,
      ]) {
        expect(await ocm.get(forAccount(route, value))).toEqual({ status: 400, body: REFUSED });
      }
    });
  });
});

// The files name the account of each row once the accounts route lists two accounts at least,
// as the dashboard offers the account selector then: the Unknown account counts while some
// rows have no account, whatever they are, and an account that config.json no longer lists
// counts too, even without any row
describe.each([
  ['an account and rows without an account', (db) => {
    historyEntry(db, null, ['2026-07-01', '2026-07-31'], 'consumption', 175.5);
  }],
  ['an account and one that config.json no longer lists', (db) => {
    recordAccounts(db, { nic: PARIS }, { nic: LYON });
    db.accounts.recordConfiguration([LYON]);
  }],
])('a database of %s', (_, seedOther) => {
  let ocm;

  beforeAll(async () => {
    ocm = await startOcm(() => ({}), {
      seed: (db) => {
        recordAccounts(db, { nic: LYON });
        bill(db, 'FR1001', '2026-09-05', LYON, { price: 650, priceWithTax: 780, tax: 130 });
        seedOther(db);
      },
    });
  }, 30000);

  afterAll(async () => {
    await ocm?.stop();
  });

  test('exports each row with its account', async () => {
    expect(await exported(ocm, `/api/export/bills?${SEPTEMBER}`)).toEqual(csvFile(
      'factures_2026-09-01_2026-09-30.csv',
      withAccount(BILLS),
      `"FR1001";"2026-09-05";650;780;130;"EUR";"${LYON}"`,
    ));
  });
});
