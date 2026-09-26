// The infrastructure of the synthetic account beyond Public Cloud, as
// /api/inventory/servers, /vps and /storage and
// /api/analysis/resource-type-details answer.

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
};

// A VPS and a file storage paid for the year: in the inventory, but not on
// the bills of these three months
const vps = {
  id: 'vps-0a1b2c3d.vps.ovh.net',
  display_name: 'vps-0a1b2c3d.vps.ovh.net',
  model: 'vps-le-2-2-40',
  zone: 'Region OpenStack: os-gra7',
  state: 'running',
  // The import stores the disk size there, not the operating system (#57)
  os: '40',
  vcpus: 2,
  ram_mb: 2048,
  disk_gb: 40,
  expiration_date: '2026-10-10',
  renewal_type: 'automatic',
  ip_addresses: ['192.0.2.10'],
  imported_at: '2026-09-14 04:01:15',
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
