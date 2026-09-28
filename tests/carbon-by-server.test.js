/**
 * The list of the carbon footprint (#155), GET /api/carbon/by-server, of the server started
 * in a child process over a database that the test seeds as the import writes it: each line
 * of OVHcloud's file with what it cost in the month of use, as the bill lines that it ties to
 * say, and its intensity.
 */

const {
  LYON, PARIS, UNKNOWN_ACCOUNT, recordAccounts, bill, project,
} = require('./support/accounts');
const { CARBON_MONTHS: MONTHS, footprintLine, withSeededOcm } = require('./support/carbon');

// The instances of Lyon's monthly plans
const PLAN = '5e2487f7-9131-4898-97b3-9d3f532625e4';
const PRORATED = '89804469-61f2-486b-82a5-398ac89db348';

// A bill line of a bill, as the import stores it: of a Public Cloud project when given one
let lineNumber = 0;
const line = (billId, { projectId = null, domain = projectId, description, cost, type }) => {
  lineNumber += 1;
  return {
    id: `${billId}_D${lineNumber}`, bill_id: billId, project_id: projectId, domain, description,
    quantity: '1', unit_price: cost, total_price: cost, service_type: 'Other',
    resource_type: type ?? (projectId ? 'cloud_project' : null),
  };
};

// A dedicated server's line, billed in advance for the month of its bill
const serverLine = (billId, domain, cost) => line(billId, {
  domain, description: 'ADVANCE-2 | AMD EPYC 4244P location - 1 mois', cost,
  type: 'dedicated_server',
});

function seed(db) {
  recordAccounts(db, { nic: LYON }, { nic: PARIS });
  project(db, 'p-lyon', 'Production', LYON);
  project(db, 'p-paris', 'Staging', PARIS);
  // The instance of a prorata that names no region, which the inventory knows
  db.cloudDetails.upsertInstance({
    id: PRORATED, project_id: 'p-lyon', name: 'web-2', flavor: 'b2-15',
    plan_code: 'b2-15.monthly.postpaid', region: 'GRA7', status: 'ACTIVE',
    created_at: '2026-08-10', monthly_billing: 1,
  });

  const lyon = (projectLine) => ({ projectId: 'p-lyon', ...projectLine });
  // The Public Cloud bill of September, which pays for August
  bill(db, 'FR-PCI-SEP', '2026-09-03', LYON);
  db.details.insertMany([
    line('FR-PCI-SEP', lyon({
      description: "Consommation à l'heure pour les instances b2-7 gra11", cost: 100,
    })),
    line('FR-PCI-SEP', lyon({
      description: `Forfait mensuel pour une instance b2-15 (id ${PLAN}, region gra7) - 01 mois`,
      cost: 50,
    })),
    line('FR-PCI-SEP', lyon({
      description: `Prorata de la facturation mensuelle d'une instance b2-15 (id ${PRORATED})`,
      cost: 5,
    })),
    line('FR-PCI-SEP', lyon({
      description: 'Disques supplémentaires à gra9 de type high-speed', cost: 30,
    })),
    // An encrypted volume, which the file counts as its base type
    line('FR-PCI-SEP', lyon({
      description: 'Disques supplémentaires à gra9 de type high-speed-luks', cost: 12,
    })),
    // In a 3AZ region, which OVHcloud does not cover, a flavor that it covers elsewhere
    line('FR-PCI-SEP', lyon({
      description: "Consommation à l'heure pour les instances b2-7 eu-west-par", cost: 20,
    })),
    // A savings plan pays for a plan, not an instance, of a flavor that the file gives
    line('FR-PCI-SEP', lyon({
      description: 'Savings plan b2-7 (id : sp-1) pour 2 instance(s) b2-7 Durée : 12 mois',
      cost: 40,
    })),
    // A flavor whose footprint line names no datacenter, in a region that the file covers
    line('FR-PCI-SEP', lyon({
      description: "Consommation à l'heure pour les instances b3-64 sbg5", cost: 10,
    })),
    // And in a 3AZ region, which that line does not cover either
    line('FR-PCI-SEP', lyon({
      description: "Consommation à l'heure pour les instances b3-64 eu-west-par", cost: 7,
    })),
    // In a region named by its continent, its direction and its city: Toronto
    line('FR-PCI-SEP', lyon({
      description: "Consommation à l'heure pour les instances b2-7 ca-east-tor", cost: 15,
    })),
  ]);
  // The Public Cloud bill of August, which pays for July: not August's
  bill(db, 'FR-PCI-AUG', '2026-08-03', LYON);
  db.details.insertMany([line('FR-PCI-AUG', lyon({
    description: "Consommation à l'heure pour les instances b2-7 gra11", cost: 999,
  }))]);
  // The dedicated servers, billed in advance in August, and in March
  bill(db, 'FR-SRV-AUG', '2026-08-10', LYON);
  db.details.insertMany([
    serverLine('FR-SRV-AUG', 'ns1.ip-10-0-0.eu', 65),
    serverLine('FR-SRV-AUG', 'ns2.ip-10-0-0.eu', 80),
  ]);
  bill(db, 'FR-SRV-MAR', '2026-03-10', LYON);
  db.details.insertMany([
    serverLine('FR-SRV-MAR', 'ns1.ip-10-0-0.eu', 65),
    serverLine('FR-SRV-MAR', 'ns2.ip-10-0-0.eu', 80),
  ]);
  // Paris's Public Cloud bill of September
  bill(db, 'FR-PCI-PARIS', '2026-09-03', PARIS);
  db.details.insertMany([line('FR-PCI-PARIS', {
    projectId: 'p-paris', description: "Consommation à l'heure pour les instances b2-7 gra11",
    cost: 200,
  })]);

  const compute = (name, datacenter, emissions) => footprintLine({
    type: 'PCI-COMPUTE', product_range: name.split('-')[0], name, datacenter,
    server_domain: null, ...emissions,
  });
  db.carbon.replaceMonths(LYON, MONTHS, [
    { ...compute('b2-7', 'GRA', { manufacturing: 3, electricity: [5, 1], operations: [2, 2] }),
      month: '2026-08' },
    { ...compute('b2-15.monthly', 'GRA',
      { manufacturing: 2, electricity: [3, 1], operations: [1, 1] }), month: '2026-08' },
    // The same flavor in another datacenter: only the inventory places the prorata
    { ...compute('b2-15.monthly', 'SBG',
      { manufacturing: 1, electricity: [1, 0.5], operations: [1, 1] }), month: '2026-08' },
    { ...compute('b2-7', 'TOR', { manufacturing: 1, electricity: [3, 1], operations: [1, 1] }),
      month: '2026-08' },
    { ...compute('b3-64', 'ALL', { manufacturing: 0.4, electricity: [0.4, 0.1],
      operations: [0.2, 0.2] }), month: '2026-08' },
    // Nothing billed it
    { ...compute('r2-15', 'GRA', { manufacturing: 1, electricity: [2, 1], operations: [1, 1] }),
      month: '2026-08' },
    footprintLine({
      month: '2026-08', type: 'PCI-BLOCK-STORAGE', product_range: 'high-speed',
      name: 'high-speed', datacenter: 'GRA', server_domain: null, manufacturing: 1,
      electricity: [0.5, 0.2], operations: [0.5, 0.5],
    }),
    footprintLine({
      month: '2026-08', server_domain: 'ns1.ip-10-0-0.eu', manufacturing: 10,
      electricity: [6, 1], operations: [4, 4],
    }),
    footprintLine({
      month: '2026-08', server_domain: 'ns2.ip-10-0-0.eu', manufacturing: 15,
      electricity: [9, 2], operations: [6, 6],
    }),
    // March names no server, as OVHcloud's file did before July 2026
    footprintLine({
      month: '2026-03', product_range: 'ADV-IV', name: null, server_domain: null,
      manufacturing: 5, electricity: [3, 1], operations: [2, 2],
    }),
    footprintLine({
      month: '2026-03', product_range: 'ADV-IV', name: null, server_domain: null,
      manufacturing: 7, electricity: [5, 1], operations: [3, 3],
    }),
  ]);
  db.carbon.replaceMonths(PARIS, MONTHS, [
    { ...compute('b2-7', 'GRA', { manufacturing: 7, electricity: [12, 3], operations: [6, 6] }),
      month: '2026-08' },
  ]);
}

// The server over the seeded database, for the time of `use`
const withOcm = (use) => withSeededOcm(seed, use);

// A row of the list: a line of the file, of Lyon by default, with its footprint, its cost and
// its intensity. Lines of the Public Cloud name no server.
const row = (fields) => ({
  type: 'PCI-COMPUTE', range: null, serverDomain: null, unnamedServers: null, account: LYON,
  ...fields,
});

// Lyon's August, the most emitting first
const LYON_AUGUST = [
  row({
    type: 'BAREMETAL', name: 'advance-2', range: 'advance gen4', datacenter: 'GRA',
    serverDomain: 'ns2.ip-10-0-0.eu', footprint: 30, cost: 80, intensity: 0.375,
  }),
  row({
    type: 'BAREMETAL', name: 'advance-2', range: 'advance gen4', datacenter: 'GRA',
    serverDomain: 'ns1.ip-10-0-0.eu', footprint: 20, cost: 65, intensity: 0.3077,
  }),
  // The hourly line of September's bill, not that of August's, nor the 3AZ line or the
  // savings plan of the flavor
  row({ name: 'b2-7', range: 'b2', datacenter: 'GRA', footprint: 10, cost: 100, intensity: 0.1 }),
  // The monthly plan, and the prorata whose instance the inventory places in GRA7
  row({
    name: 'b2-15.monthly', range: 'b2', datacenter: 'GRA', footprint: 6, cost: 55,
    intensity: 0.1091,
  }),
  row({
    name: 'b2-7', range: 'b2', datacenter: 'TOR', footprint: 5, cost: 15, intensity: 0.3333,
  }),
  row({ name: 'r2-15', range: 'r2', datacenter: 'GRA', footprint: 4, cost: null, intensity: null }),
  row({
    name: 'b2-15.monthly', range: 'b2', datacenter: 'SBG', footprint: 3, cost: null,
    intensity: null,
  }),
  // The volumes, the encrypted one included
  row({
    type: 'PCI-BLOCK-STORAGE', name: 'high-speed', range: 'high-speed', datacenter: 'GRA',
    footprint: 2, cost: 42, intensity: 0.0476,
  }),
  // The line of sbg5, not the 3AZ one
  row({ name: 'b3-64', range: 'b3', datacenter: 'ALL', footprint: 1, cost: 10, intensity: 0.1 }),
];

test("lists a month's footprint lines with their cost in the month of use", async () => {
  await withOcm(async (ocm) => {
    expect(await ocm.get(`/api/carbon/by-server?month=2026-08&account=${LYON}`)).toEqual({
      status: 200, body: { month: '2026-08', lines: LYON_AUGUST },
    });
  });
}, 30000);

test('lists the lines of every account, each tied within its account', async () => {
  await withOcm(async (ocm) => {
    const { body } = await ocm.get('/api/carbon/by-server?month=2026-08');
    expect(body.lines).toEqual([
      LYON_AUGUST[0],
      // Paris's b2-7, which ties to Paris's line only
      row({
        name: 'b2-7', range: 'b2', datacenter: 'GRA', account: PARIS, footprint: 25, cost: 200,
        intensity: 0.125,
      }),
      ...LYON_AUGUST.slice(1),
    ]);
    // The Unknown account, which never has one
    expect((await ocm.get(`/api/carbon/by-server?month=2026-08&account=${UNKNOWN_ACCOUNT}`))
      .body.lines).toEqual([]);
  });
}, 30000);

// Before July 2026, OVHcloud's file names no dedicated server
test('gathers the servers that the file does not name in one line', async () => {
  await withOcm(async (ocm) => {
    expect((await ocm.get(`/api/carbon/by-server?month=2026-03&account=${LYON}`)).body).toEqual({
      month: '2026-03',
      lines: [row({
        type: 'BAREMETAL', name: null, range: null, datacenter: null, unnamedServers: 2,
        footprint: 25, cost: 145, intensity: 0.1724,
      })],
    });
  });
}, 30000);

test('refuses a month that is not one', async () => {
  await withOcm(async (ocm) => {
    const { status, body } = await ocm.get('/api/carbon/by-server?month=2026-8');
    expect([status, body.error]).toEqual([400, expect.stringMatching(/^Invalid 'month'/)]);
  });
}, 30000);

// The list as a CSV file (#156), as the other exports of the API write theirs: ';' between the
// cells, a decimal comma, and, as the database holds several accounts, the account last
test('exports the list of a month as CSV', async () => {
  await withOcm(async (ocm) => {
    const { status, headers, body } = await ocm.getText(
      `/api/export/carbon?month=2026-08&account=${LYON}`,
    );
    expect([status, headers.get('content-type'), headers.get('content-disposition')]).toEqual([
      200, 'text/csv; charset=utf-8', 'attachment; filename="empreinte_carbone_2026-08.csv"',
    ]);
    const lines = body.split('\n');
    expect(lines.slice(0, 3)).toEqual([
      '﻿"Élément";"Type";"Gamme";"Datacenter";"Empreinte (kgCO2e)";"Coût";'
        + '"Intensité (kgCO2e/€)";"account"',
      `"ns2.ip-10-0-0.eu";"BAREMETAL";"advance gen4";"GRA";30;80;0,375;"${LYON}"`,
      `"ns1.ip-10-0-0.eu";"BAREMETAL";"advance gen4";"GRA";20;65;0,3077;"${LYON}"`,
    ]);
    // A line that nothing billed has neither a cost nor an intensity
    expect(lines).toContain(`"r2-15";"PCI-COMPUTE";"r2";"GRA";4;;;"${LYON}"`);

    // March, whose file names no server
    expect((await ocm.getText(`/api/export/carbon?month=2026-03&account=${LYON}`)).body
      .split('\n')[1]).toBe(
      `"Serveurs dédiés non nommés par OVHcloud (2)";"BAREMETAL";;;25;145;0,1724;"${LYON}"`,
    );
    // A month that is not one
    expect((await ocm.getText('/api/export/carbon?month=2026-8')).status).toBe(400);
  });
}, 30000);
