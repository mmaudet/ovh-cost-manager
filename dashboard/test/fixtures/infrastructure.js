// The infrastructure of the synthetic account beyond Public Cloud, as
// /api/inventory/servers, /vps and /storage and
// /api/analysis/resource-type-details answer. Each service of the inventory
// names its account (#123): the only account of the instance, by its NIC
// handle.

// The accounts of accounts.js, by NIC handle: the Lyon subsidiary, which is
// the account of account.js, the unnamed account, and the account removed
// from config.json
const LYON = 'xx1111-ovh';
const UNNAMED = 'yy2222-ovh';
const REMOVED = 'zz3333-ovh';

// Two dedicated servers, sorted by name as the server does. The first is the
// one billed every month. The second was just delivered: it has no bill line
// yet, and neither its RAM nor its renewal could be read.
const billedServer = {
  id: 'ns3000001.ip-203-0-113.eu',
  display_name: 'backup-server',
  reverse: 'backup.example.com',
  datacenter: 'rbx8',
  os: 'debian12_64',
  state: 'ok',
  cpu: 'Intel Xeon-E 2388G',
  // In MB
  ram_size: 65536,
  disk_info: [{ type: 'NVMe', capacity: 960, count: 2 }],
  bandwidth: 1000,
  expiration_date: '2026-09-20',
  renewal_type: 'automatic',
  imported_at: '2026-09-14 04:01:10',
  account: LYON,
};

const newServer = {
  id: 'ns3000002.ip-198-51-100.eu',
  // Without a display name or a reverse, the import names it after its id
  display_name: 'ns3000002.ip-198-51-100.eu',
  reverse: '',
  datacenter: 'gra3',
  os: 'none_64',
  state: 'error',
  cpu: 'AMD EPYC 4344P',
  ram_size: 0,
  disk_info: [],
  bandwidth: 0,
  expiration_date: null,
  renewal_type: '',
  imported_at: '2026-09-14 04:01:12',
  account: LYON,
};

// A VPS and a file storage paid for the year: in the inventory, but not on
// the bills of these three months
const vps = {
  id: 'vps-0a1b2c3d.vps.ovh.net',
  display_name: 'vps-0a1b2c3d.vps.ovh.net',
  model: 'vps-le-2-2-40',
  zone: 'Region OpenStack: os-gra7',
  state: 'running',
  os: 'Debian 12',
  vcpus: 2,
  ram_mb: 2048,
  disk_gb: 40,
  expiration_date: '2026-10-10',
  renewal_type: 'automatic',
  ip_addresses: ['192.0.2.10'],
  imported_at: '2026-09-14 04:01:15',
  account: LYON,
};

const fileStorage = {
  id: 'netapp-5f2c9a1e',
  service_type: 'netapp',
  display_name: 'shared-files',
  region: 'eu-west-gra',
  total_size_gb: 1024,
  used_size_gb: 0,
  share_count: 3,
  expiration_date: '2027-03-01',
  imported_at: '2026-09-14 04:01:20',
  account: LYON,
};

const serverRental = {
  domain: 'ns3000001.ip-203-0-113.eu',
  description: 'Location du serveur RISE-1 ns3000001.ip-203-0-113.eu - 1 mois',
  total: 270,
  line_count: 1,
};

const veeamBackup = (vm, total) => ({
  domain: vm,
  description: `Veeam Managed Backup - ${vm}`,
  total,
  line_count: 1,
});

export const infrastructure = {
  inventoryServers: [billedServer, newServer],
  inventoryVps: [vps],
  inventoryStorage: [fileStorage],

  // The bill lines of a resource type grouped by service, most expensive
  // first. No detail for the other resource types.
  resourceTypeDetails: {
    dedicated_server: {
      '2026-09': [serverRental],
      '2026-08': [serverRental],
    },
    backup: {
      '2026-09': [
        veeamBackup('vm-app-1.example.com', 40),
        veeamBackup('vm-db-1.example.com', 30),
        veeamBackup('vm-files-1.example.com', 20),
      ],
      '2026-08': [
        veeamBackup('vm-app-1.example.com', 25),
        veeamBackup('vm-db-1.example.com', 15),
      ],
    },
  },
};

// The inventory as the accounts of accounts.js hold it (#123): for all
// accounts, and for each account, by its id. The server just delivered is
// the unnamed account's, which has a VPS too; the account that config.json no
// longer lists keeps the server it was billed for; the Unknown account holds
// a server and a storage service stored before OCM told accounts apart.

const deliveredServer = { ...newServer, account: UNNAMED };
const removedServer = {
  ...billedServer,
  id: 'ns3000003.ip-203-0-113.eu',
  display_name: 'db-server',
  reverse: 'db.example.com',
  expiration_date: '2026-09-17',
  imported_at: '2026-08-31 04:00:40',
  account: REMOVED,
};
const legacyServer = {
  id: 'ns3000004.ip-203-0-113.eu',
  display_name: 'legacy-server',
  reverse: '',
  datacenter: 'sbg3',
  os: 'debian11_64',
  state: 'ok',
  cpu: 'Intel Xeon E3-1245v5',
  ram_size: 32768,
  disk_info: [],
  bandwidth: 500,
  expiration_date: null,
  renewal_type: 'manual',
  imported_at: '2026-01-10 03:00:00',
  account: null,
};
const stagingVps = {
  ...vps,
  id: 'vps-4e5f6a7b.vps.ovh.net',
  display_name: 'staging-vps',
  zone: 'Region OpenStack: os-sbg5',
  expiration_date: '2026-10-12',
  ip_addresses: ['192.0.2.20'],
  account: UNNAMED,
};
const oldStorage = {
  ...fileStorage,
  id: 'netapp-7a6b5c4d',
  display_name: 'old-nas',
  total_size_gb: 512,
  expiration_date: '2026-09-10',
  imported_at: '2026-01-10 03:00:20',
  account: null,
};

const removedServerRental = {
  domain: 'ns3000003.ip-203-0-113.eu',
  description: 'Location du serveur RISE-1 ns3000003.ip-203-0-113.eu - 1 mois',
  total: 200,
  line_count: 1,
};
const legacyServerRental = {
  domain: 'ns3000004.ip-203-0-113.eu',
  description: 'Location du serveur KS-1 ns3000004.ip-203-0-113.eu - 1 mois',
  total: 90,
  line_count: 1,
};
// The Veeam backups of September, which are the unnamed account's
const septemberBackups = infrastructure.resourceTypeDetails.backup['2026-09'];
// A service that bill lines name, as the account whose bills they are on billed it
const billedTo = (account) => (line) => ({ ...line, account });

export const infrastructureOfSeveralAccounts = {
  // By name, then by the NIC handle of their account, as the server sorts them
  all: {
    inventoryServers: [billedServer, removedServer, legacyServer, deliveredServer],
    inventoryVps: [stagingVps, vps],
    inventoryStorage: [oldStorage, fileStorage],
    // The bill lines of a resource type by service and account, for the list that names the
    // account of each service: those of September by service, each billed to one account
    resourceTypeDetailsByAccount: {
      dedicated_server: { '2026-09': [serverRental].map(billedTo(LYON)) },
      backup: { '2026-09': septemberBackups.map(billedTo(UNNAMED)) },
    },
  },
  ofAccount: {
    [LYON]: {
      inventoryServers: [billedServer],
      inventoryVps: [vps],
      inventoryStorage: [fileStorage],
      resourceTypeDetails: { dedicated_server: { '2026-09': [serverRental] } },
    },
    [UNNAMED]: {
      inventoryServers: [deliveredServer],
      inventoryVps: [stagingVps],
      resourceTypeDetails: { backup: { '2026-09': septemberBackups } },
    },
    // Up to August, its latest month
    [REMOVED]: {
      inventoryServers: [removedServer],
      resourceTypeDetails: { dedicated_server: { '2026-08': [removedServerRental] } },
    },
    // Up to July, its only month
    unknown: {
      inventoryServers: [legacyServer],
      inventoryStorage: [oldStorage],
      resourceTypeDetails: { dedicated_server: { '2026-07': [legacyServerRental] } },
    },
  },
};
