/**
 * Tests for service classification function
 */

const { classifyService, classifyResourceTypeFromDomain } = require('../data/classify');

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

    // OVHcloud bills Logs Data Platform as « DBAAS-LOGS »: each of its charges stays Database,
    // its resource type of its own included (#246). The charges of an invoice's DBAAS-LOGS lines.
    test('keeps every charge of Logs Data Platform as Database (#246)', () => {
      for (const charge of [
        'Logs - Account rental for 1 month',
        'Logs - Streams - Hot Storage 1 to 100 GB',
        'Logs - Streams - Hot Storage > 101 GB',
        'Logs - Streams - Hot Storage Free tier',
        'Logs - Streams - Cold Storage Standard',
        'Logs - Input instances',
        'Logs - Hosted OpenSearch Dashboards instances',
      ]) {
        expect(classifyService(charge)).toBe('Database');
      }
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

describe('classifyResourceTypeFromDomain', () => {
  const UUID = '330202de-7481-44f3-a2c8-097532da59bf';

  describe('Cloud Disk Array disambiguation', () => {
    test('classifies Cloud Disk Array as storage despite its UUID domain', () => {
      expect(classifyResourceTypeFromDomain(UUID, 'Cloud Disk Array storage 2TB – 1 month')).toBe('storage');
      expect(classifyResourceTypeFromDomain(UUID, 'Cloud Disk Array storage 2TB – 1 month au prorata : 27 jours')).toBe('storage');
      expect(classifyResourceTypeFromDomain(UUID, 'Cloud Disk Array storage 2TB – installation')).toBe('storage');
    });

    test('still classifies genuine UUID-domain licenses as license', () => {
      expect(classifyResourceTypeFromDomain(UUID, 'Windows Server 2019 License')).toBe('license');
      expect(classifyResourceTypeFromDomain(UUID, '')).toBe('license');
      expect(classifyResourceTypeFromDomain(UUID)).toBe('license');
    });
  });

  // A Logs Data Platform service is billed under its own identifier, `ldp-` and a code: it is
  // not storage, though its streams' hot and cold storage are among its charges (CONTEXT.md)
  describe('Logs Data Platform (#246)', () => {
    test('gives a service of an ldp- identifier a resource type of its own', () => {
      expect(classifyResourceTypeFromDomain('ldp-ab-12345', 'Logs - Account rental for 1 month'))
        .toBe('logs_data_platform');
      expect(classifyResourceTypeFromDomain(
        'ldp-ab-12345', 'Logs - Streams - Hot Storage 1 to 100 GB',
      )).toBe('logs_data_platform');
      expect(classifyResourceTypeFromDomain('ldp-cd-67890')).toBe('logs_data_platform');
    });
  });

  describe('other resource types still resolve', () => {
    test('dedicated server, vps, cloud project', () => {
      expect(classifyResourceTypeFromDomain('ns3145678.ip-1-2-3.eu')).toBe('dedicated_server');
      expect(classifyResourceTypeFromDomain('vps-abc123')).toBe('vps');
      expect(classifyResourceTypeFromDomain('0123456789abcdef0123456789abcdef')).toBe('cloud_project');
    });

    test('null/empty domain falls back to other', () => {
      expect(classifyResourceTypeFromDomain('')).toBe('other');
      expect(classifyResourceTypeFromDomain(null)).toBe('other');
    });
  });
});
