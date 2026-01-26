/**
 * Tests for service classification function
 */

// Same classification logic as data/import.js
function classifyService(description) {
  const desc = (description || '').toLowerCase();

  if (desc.includes('instance') || desc.includes('compute') || desc.includes('vm') ||
      desc.includes('forfait mensuel') || desc.includes('consommation à l\'heure')) {
    if (desc.includes('gpu') || desc.includes('l40s') || desc.includes('l4-') ||
        desc.includes('a100') || desc.includes('v100') || desc.includes('t4')) {
      return 'AI/ML';
    }
    return 'Compute';
  }

  if (desc.includes('storage') || desc.includes('stockage') || desc.includes('bucket') ||
      desc.includes('swift') || desc.includes('object') || desc.includes('archive') ||
      desc.includes('snapshot') || desc.includes('backup') || desc.includes('disque')) {
    return 'Storage';
  }

  if (desc.includes('network') || desc.includes('loadbalancer') || desc.includes('floating ip') ||
      desc.includes('gateway') || desc.includes('bandwidth') || desc.includes('octavia') ||
      desc.includes('private network') || desc.includes('vrack')) {
    return 'Network';
  }

  if (desc.includes('database') || desc.includes('postgresql') || desc.includes('mysql') ||
      desc.includes('mongodb') || desc.includes('redis') || desc.includes('kafka') ||
      desc.includes('opensearch') || desc.includes('cassandra')) {
    return 'Database';
  }

  if (desc.includes('ai ') || desc.includes(' ml') || desc.includes('machine learning') ||
      desc.includes('notebook') || desc.includes('training')) {
    return 'AI/ML';
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

    test('classifies backup services as Storage', () => {
      expect(classifyService('Backup service')).toBe('Storage');
      expect(classifyService('Snapshot volume')).toBe('Storage');
      expect(classifyService('Archive cold')).toBe('Storage');
    });

    test('classifies disk services as Storage', () => {
      expect(classifyService('Disque additionnel')).toBe('Storage');
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
  });

  describe('Other classification', () => {
    test('classifies unknown services as Other', () => {
      expect(classifyService('Domain name renewal')).toBe('Other');
      expect(classifyService('SSL Certificate')).toBe('Other');
      expect(classifyService('Support premium')).toBe('Other');
      expect(classifyService('')).toBe('Other');
      expect(classifyService(null)).toBe('Other');
      expect(classifyService(undefined)).toBe('Other');
    });
  });
});
