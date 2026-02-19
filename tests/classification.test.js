/**
 * Tests for service classification function
 */

// Same classification logic as data/import.js
function classifyService(description) {
  const desc = (description || '').toLowerCase();

  // AI/ML - check first as GPU instances should be AI/ML not Compute
  if (desc.includes('gpu') || desc.includes('l40s') || desc.includes('l4-') ||
      desc.includes('a100') || desc.includes('v100') || desc.includes('t4') ||
      desc.includes('h100') || desc.includes('ai ') || desc.includes(' ml') ||
      desc.includes('machine learning') || desc.includes('notebook') || desc.includes('training') ||
      desc.includes('ai deploy') || desc.includes('ai training') || desc.includes('ai notebook')) {
    return 'AI/ML';
  }

  // Licenses - check early because "Windows Server" contains "server"
  if (desc.includes('license') || desc.includes('licence')) {
    return 'Licenses';
  }

  // Backup - Veeam and backup services
  if (desc.includes('veeam') || desc.includes('backup')) {
    return 'Backup';
  }

  // Support & Services - check early because "management fee" might conflict
  if (desc.includes('support') || desc.includes('management fee') ||
      desc.includes('professional service')) {
    return 'Support';
  }

  // Database - check before Storage because "Logs - Streams" contains "storage"
  if (desc.includes('database') || desc.includes('postgresql') || desc.includes('mysql') ||
      desc.includes('mongodb') || desc.includes('redis') || desc.includes('kafka') ||
      desc.includes('opensearch') || desc.includes('cassandra') || desc.includes('mariadb') ||
      desc.includes('m3db') || desc.includes('grafana') || desc.includes('logs data platform') ||
      desc.includes('elasticsearch') || desc.includes('timeseries') ||
      desc.includes('logs -') || desc.includes('streams -')) {
    return 'Database';
  }

  // Storage - S3, Object Storage, Swift, volumes, snapshots, datastores, backup
  // Check before Compute because "swift container" should be Storage not Compute
  if (desc.includes('storage') || desc.includes('stockage') || desc.includes('bucket') ||
      desc.includes('swift') || desc.includes('object') || desc.includes('archive') ||
      desc.includes('snapshot') || desc.includes('disque') ||
      desc.includes('volume') || desc.includes('disk') || desc.includes('s3') ||
      desc.includes('cold archive') || desc.includes('high perf') || desc.includes('classic') ||
      desc.includes('block storage') || desc.includes('additional disk') ||
      desc.includes('datastore') || desc.includes('zpool')) {
    return 'Storage';
  }

  // Compute - instances, VMs, Kubernetes, containers, hosts, bare metal
  if (desc.includes('instance') || desc.includes('compute') || desc.includes('vm') ||
      desc.includes('forfait mensuel') || desc.includes('consommation à l\'heure') ||
      desc.includes('kubernetes') || desc.includes('kube') || desc.includes('k8s') ||
      desc.includes('managed kubernetes') || desc.includes('container') ||
      desc.includes('registry') || desc.includes('worker node') || desc.includes('control plane') ||
      desc.includes('serveur') || desc.includes('server') || desc.includes('vcpu') ||
      desc.includes('ram ') || desc.includes('mémoire') ||
      // Private Cloud / vSphere hosts
      desc.includes('host ') || desc.includes('host rental') || desc.includes('esxi') ||
      desc.includes('vsphere') || desc.includes('vmware') || desc.includes('premier 384') ||
      desc.includes('premier 768') || desc.includes('premier rental') ||
      // Bare metal Scale servers
      desc.includes('scale-') || desc.includes('advance-') || desc.includes('infra-') ||
      desc.includes('hg-') || desc.includes('eg-') || desc.includes('mg-') ||
      // General dedicated
      desc.includes('rental for 1 month') && (desc.includes('scale') || desc.includes('advance'))) {
    return 'Compute';
  }

  // Network - load balancers, IPs, bandwidth, egress
  if (desc.includes('network') || desc.includes('loadbalancer') || desc.includes('load balancer') ||
      desc.includes('floating ip') || desc.includes('gateway') || desc.includes('bandwidth') ||
      desc.includes('octavia') || desc.includes('private network') || desc.includes('vrack') ||
      desc.includes('egress') || desc.includes('ingress') || desc.includes('traffic') ||
      desc.includes('trafic') || desc.includes('ip failover') || desc.includes('additional ip') ||
      desc.includes('public ip') || desc.includes('réseau') || desc.includes('outgoing') ||
      desc.includes('ip v4 block') || desc.includes('ip block') || desc.includes('/27') ||
      desc.includes('/28') || desc.includes('/29') || desc.includes('/30')) {
    return 'Network';
  }

  return 'Other';
}

describe('classifyService', () => {
  describe('Compute classification', () => {
    test('classifies instance types as Compute', () => {
      expect(classifyService('Instance s1-2')).toBe('Compute');
      expect(classifyService('b2-7 instance hourly')).toBe('Compute');
    });

    test('classifies VM as Compute', () => {
      expect(classifyService('VM monthly')).toBe('Compute');
    });

    test('classifies French compute terms', () => {
      expect(classifyService('Forfait mensuel serveur')).toBe('Compute');
      expect(classifyService("Consommation à l'heure")).toBe('Compute');
    });

    test('classifies Kubernetes as Compute', () => {
      expect(classifyService('Managed Kubernetes Service')).toBe('Compute');
      expect(classifyService('Kubernetes cluster')).toBe('Compute');
      expect(classifyService('K8s node')).toBe('Compute');
      expect(classifyService('Kube worker')).toBe('Compute');
      expect(classifyService('Control plane')).toBe('Compute');
      expect(classifyService('Worker node b2-7')).toBe('Compute');
    });

    test('classifies container services as Compute', () => {
      expect(classifyService('Container Registry')).toBe('Compute');
      expect(classifyService('Harbor registry')).toBe('Compute');
    });
  });

  describe('AI/ML classification', () => {
    test('classifies GPU instances as AI/ML', () => {
      expect(classifyService('Instance GPU L40S')).toBe('AI/ML');
      expect(classifyService('Instance L4-120')).toBe('AI/ML');
      expect(classifyService('A100 GPU instance')).toBe('AI/ML');
      expect(classifyService('V100 compute')).toBe('AI/ML');
      expect(classifyService('T4 instance')).toBe('AI/ML');
    });

    test('classifies AI services as AI/ML', () => {
      expect(classifyService('AI Notebook')).toBe('AI/ML');
      expect(classifyService('ML Training job')).toBe('AI/ML');
      expect(classifyService('Machine Learning platform')).toBe('AI/ML');
    });
  });

  describe('Storage classification', () => {
    test('classifies storage services', () => {
      expect(classifyService('Object Storage')).toBe('Storage');
      expect(classifyService('Stockage bloc')).toBe('Storage');
      expect(classifyService('S3 bucket')).toBe('Storage');
      expect(classifyService('Swift container')).toBe('Storage');
    });

    test('classifies backup services as Backup', () => {
      expect(classifyService('Backup service')).toBe('Backup');
      expect(classifyService('Snapshot volume')).toBe('Storage');
      expect(classifyService('Archive cold')).toBe('Storage');
    });

    test('classifies disk services as Storage', () => {
      expect(classifyService('Disque additionnel')).toBe('Storage');
    });

    test('classifies S3 services as Storage', () => {
      expect(classifyService('S3 Standard')).toBe('Storage');
      expect(classifyService('S3 High Performance')).toBe('Storage');
      expect(classifyService('Cold Archive')).toBe('Storage');
      expect(classifyService('Block Storage Classic')).toBe('Storage');
      expect(classifyService('High perf storage')).toBe('Storage');
    });
  });

  describe('Network classification', () => {
    test('classifies network services', () => {
      expect(classifyService('LoadBalancer')).toBe('Network');
      expect(classifyService('Floating IP')).toBe('Network');
      expect(classifyService('Gateway')).toBe('Network');
      expect(classifyService('Bandwidth 1Gbps')).toBe('Network');
    });

    test('classifies OVH network products', () => {
      expect(classifyService('Octavia LB')).toBe('Network');
      expect(classifyService('Private Network')).toBe('Network');
      expect(classifyService('vRack')).toBe('Network');
    });

    test('classifies traffic/egress as Network', () => {
      expect(classifyService('Outgoing traffic')).toBe('Network');
      expect(classifyService('Egress bandwidth')).toBe('Network');
      expect(classifyService('Ingress data')).toBe('Network');
      expect(classifyService('Public IP hourly')).toBe('Network');
      expect(classifyService('IP Failover')).toBe('Network');
      expect(classifyService('Additional IP')).toBe('Network');
    });
  });

  describe('Database classification', () => {
    test('classifies database services', () => {
      expect(classifyService('PostgreSQL managed')).toBe('Database');
      expect(classifyService('MySQL database')).toBe('Database');
      expect(classifyService('MongoDB cluster')).toBe('Database');
      expect(classifyService('Redis cache')).toBe('Database');
    });

    test('classifies messaging as Database', () => {
      expect(classifyService('Kafka cluster')).toBe('Database');
      expect(classifyService('OpenSearch')).toBe('Database');
      expect(classifyService('Cassandra')).toBe('Database');
    });

    test('classifies observability services as Database', () => {
      expect(classifyService('Logs Data Platform')).toBe('Database');
      expect(classifyService('Grafana managed')).toBe('Database');
      expect(classifyService('M3DB metrics')).toBe('Database');
      expect(classifyService('Elasticsearch')).toBe('Database');
    });

    test('classifies LDP logs streams as Database', () => {
      expect(classifyService('Logs - Streams - Hot Storage 1 to 100 GB')).toBe('Database');
    });
  });

  describe('Private Cloud / vSphere classification', () => {
    test('classifies ESXi hosts as Compute', () => {
      expect(classifyService('Host PREMIER 384 Rental for 1 month')).toBe('Compute');
      expect(classifyService('Host PREMIER 768 Rental for 1 month')).toBe('Compute');
      expect(classifyService('ESXi host rental')).toBe('Compute');
      expect(classifyService('vSphere host')).toBe('Compute');
      expect(classifyService('VMware host')).toBe('Compute');
    });

    test('classifies datastores as Storage', () => {
      expect(classifyService('Datastore 2020-9000gb-ssd-full Rental for 1 month')).toBe('Storage');
      expect(classifyService('Datastore 2020-2000gb-ssd-full - Pack Rental')).toBe('Storage');
    });

    test('classifies Veeam backup as Backup', () => {
      expect(classifyService('Veeam Backup Enterprise Rental for 1 month')).toBe('Backup');
    });

    test('classifies management fees as Support', () => {
      expect(classifyService('Management fees range Premier Rental for 1 month')).toBe('Support');
    });
  });

  describe('Bare metal / Dedicated servers classification', () => {
    test('classifies Scale servers as Compute', () => {
      expect(classifyService('Scale-i2 rental for 1 month')).toBe('Compute');
      expect(classifyService('Scale-i1 rental for 1 month')).toBe('Compute');
    });

    test('classifies Advance/Infra servers as Compute', () => {
      expect(classifyService('Advance-1 rental')).toBe('Compute');
      expect(classifyService('Infra-2 rental')).toBe('Compute');
    });
  });

  describe('Network classification (IP blocks)', () => {
    test('classifies IP blocks as Network', () => {
      expect(classifyService('Additional IP v4 block /27RIPE Rental for 1 month')).toBe('Network');
      expect(classifyService('Additional IP v4 block /28RIPE Rental for 1 month')).toBe('Network');
      expect(classifyService('IP block /29')).toBe('Network');
    });
  });

  describe('Licenses classification', () => {
    test('classifies Windows licenses as Licenses', () => {
      expect(classifyService('Windows Server 2022 Standard Edition license - 24 cores rental')).toBe('Licenses');
      expect(classifyService('Windows Server 2022 Standard Edition license - 16 cores rental')).toBe('Licenses');
    });

    test('classifies SQL Server licenses as Licenses', () => {
      expect(classifyService('SQL Server Standard license')).toBe('Licenses');
    });
  });

  describe('Support classification', () => {
    test('classifies premium support as Support', () => {
      expect(classifyService('Premium Level of Support rental for 1 month')).toBe('Support');
    });

    test('classifies professional services as Support', () => {
      expect(classifyService('Professional Service consulting')).toBe('Support');
    });
  });

  describe('Other classification', () => {
    test('classifies unknown services as Other', () => {
      expect(classifyService('Domain name renewal')).toBe('Other');
      expect(classifyService('SSL Certificate')).toBe('Other');
      expect(classifyService('')).toBe('Other');
      expect(classifyService(null)).toBe('Other');
      expect(classifyService(undefined)).toBe('Other');
    });
  });
});
