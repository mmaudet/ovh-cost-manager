/**
 * The CSV exports of the API (#137): the bills, the bill lines, the costs by project and the
 * inventory, on the server started in a child process over a database that the test seeds. A
 * single-account database gets the same files as before an instance could import several
 * accounts, byte for byte: their names, their byte order mark, their columns and their rows.
 */

const {
  LYON, bill, project, server, vps, storage, recordAccounts,
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
  db.balance.updateBillPayment('FR1001', { type: 'creditCard', date: '2026-09-06', status: 'paid' });
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

// The headers of the files
const BILLS = '"Facture";"Date";"Montant HT";"Montant TTC";"TVA";"Devise"';
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
});
