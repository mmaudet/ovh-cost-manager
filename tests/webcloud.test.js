/**
 * Tests for Web Cloud bill line classification, and for the Web Cloud items
 * built from the bill lines stored in the database.
 *
 * The wordings below are OVH bill descriptions, French and English mixed, as
 * they appear on the same account. Domain names use the RFC 2606 reserved
 * examples: only the wording around them matters to the classifier.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { classifyWebCloud, WEB_CLOUD_FAMILIES } = require('../data/classify');

describe('classifyWebCloud', () => {
  describe('domain names', () => {
    test('classifies renewal requests', () => {
      expect(classifyWebCloud('example.com - .com demande de renouvellement - 12 mois')).toBe('domain');
      expect(classifyWebCloud('example.net - .net demande de renouvellement premium - 12 mois')).toBe('domain');
      expect(classifyWebCloud('example.org - .org demande de renouvellement - from 31/08/2026 to 31/08/2027')).toBe('domain');
    });

    test('classifies English domain wordings', () => {
      expect(classifyWebCloud('example.com domain renewal')).toBe('domain');
      expect(classifyWebCloud('example.com domain registration')).toBe('domain');
    });

    test('classifies creations and transfers', () => {
      expect(classifyWebCloud('example.com - .com création - 12 mois')).toBe('domain');
      expect(classifyWebCloud('example.fr - .fr transfert - 12 mois')).toBe('domain');
      expect(classifyWebCloud('example.net - .net creation - 12 months')).toBe('domain');
      expect(classifyWebCloud('example.org - .org transfer - 12 months')).toBe('domain');
    });
  });

  describe('DNS zones', () => {
    test('classifies zone renewals', () => {
      expect(classifyWebCloud('example.com - Zone DNS - Renouvellement')).toBe('dns_zone');
      expect(classifyWebCloud('example.com DNS zone rental')).toBe('dns_zone');
    });

    test('classifies DNS Anycast', () => {
      expect(classifyWebCloud('example.com - DNS Anycast - 12 mois')).toBe('dns_zone');
    });

    // A zone line also says "Renouvellement", so the zone test has to win
    test('does not fall through to the domain family', () => {
      expect(classifyWebCloud('example.org - Zone DNS - Renouvellement')).not.toBe('domain');
    });
  });

  describe('web hosting', () => {
    test('classifies hosting plans by offer name', () => {
      expect(classifyWebCloud('Performance 1 renewal (12 months)')).toBe('hosting');
      expect(classifyWebCloud('Performance 1 rental for 12 months')).toBe('hosting');
      expect(classifyWebCloud('Pro renewal (12 months)')).toBe('hosting');
      expect(classifyWebCloud('Freedom hosting')).toBe('hosting');
    });
  });

  describe('email', () => {
    test('classifies MX plans and hosting email options', () => {
      expect(classifyWebCloud('MX plan platform rental for 12 months')).toBe('email');
      expect(classifyWebCloud('MX plan account rental for 12 months')).toBe('email');
      expect(classifyWebCloud("Renouvellement de l'option email (5 comptes) liée à l'hébergement example.com")).toBe('email');
    });

    // "Pro" is also a hosting offer, the mail offers named after it must win
    test('classifies Email Pro and Zimbra accounts', () => {
      expect(classifyWebCloud('Email Pro account rental for 12 months')).toBe('email');
      expect(classifyWebCloud('Zimbra Pro account rental for 1 month')).toBe('email');
    });
  });

  describe('hosting options', () => {
    test('classifies databases, CDN and redirections', () => {
      expect(classifyWebCloud('Personal SQL option: 1 database of 250 MB - 11 months')).toBe('option');
      expect(classifyWebCloud('Renouvellement du SQL privé vp1-1')).toBe('option');
      expect(classifyWebCloud('CDN basic option rental for 12 months')).toBe('option');
      expect(classifyWebCloud('Redirection Redirection')).toBe('option');
    });

    test('classifies SSL certificates and Private SQL', () => {
      expect(classifyWebCloud('SSL certificate Sectigo DV for example.com - 12 months')).toBe('option');
      expect(classifyWebCloud('Private SQL 512 MB rental for 12 months')).toBe('option');
    });

    test('uses the domain suffix when the wording is ambiguous', () => {
      expect(classifyWebCloud('Option renewal', 'example.com-optional-415983076')).toBe('option');
    });
  });

  describe('non Web Cloud lines', () => {
    test('returns null for cloud and dedicated lines', () => {
      expect(classifyWebCloud('Managed Kubernetes Service - Standard multi-zones (eu-west-par)')).toBeNull();
      expect(classifyWebCloud('Forfait mensuel pour une instance eg-30')).toBeNull();
      expect(classifyWebCloud('Stockage Standard - Bucket my-bucket sur la région gra')).toBeNull();
      expect(classifyWebCloud('IP Load Balancer zone RBX 1 month rental')).toBeNull();
      expect(classifyWebCloud('Kimsufi KS-1 rental for 1 month')).toBeNull();
    });

    test('returns null for empty input', () => {
      expect(classifyWebCloud('')).toBeNull();
      expect(classifyWebCloud(null)).toBeNull();
      expect(classifyWebCloud(undefined)).toBeNull();
    });
  });

  // The Web Cloud summary has one bucket per listed family
  test('returns the families listed in WEB_CLOUD_FAMILIES', () => {
    const oneLinePerFamily = [
      'example.com - .com demande de renouvellement - 12 mois',
      'example.com - Zone DNS - Renouvellement',
      'Performance 1 renewal (12 months)',
      'MX plan account rental for 12 months',
      'CDN basic option rental for 12 months'
    ];
    expect(new Set(oneLinePerFamily.map(wording => classifyWebCloud(wording)))).toEqual(new Set(WEB_CLOUD_FAMILIES));
  });
});

describe('webCloud items and summary', () => {
  const FROM = '2026-01-01';
  const TO = '2026-12-31';
  const PROJECT_ID = '0123456789abcdef0123456789abcdef';
  let db;
  let dataDir;

  const line = (id, domain, description, price, resourceType, projectId = null) => ({
    id,
    bill_id: 'FR0001',
    project_id: projectId,
    domain,
    description,
    quantity: 1,
    unit_price: price,
    total_price: price,
    service_type: 'Other',
    resource_type: resourceType
  });

  beforeAll(() => {
    // data/db.js reads DATA_DIR once, when it is first required
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovh-webcloud-'));
    process.env.DATA_DIR = dataDir;
    db = require('../data/db');

    db.projects.upsert({ id: PROJECT_ID, name: 'my-project', description: null, status: 'ok', created_at: null });
    db.bills.upsert({
      id: 'FR0001', date: '2026-03-15', price_without_tax: 45.5, price_with_tax: 54.6,
      tax: 9.1, currency: 'EUR', pdf_url: null, html_url: null
    });
    db.details.insertMany([
      line('L1', 'example.com', 'example.com - .com demande de renouvellement - 12 mois', 10.5, 'domain'),
      line('L2', 'example.net', 'example.net - .net restauration - 12 mois', 20, 'domain'),
      line('L3', 'example.ovh', 'Frais de mise en service', 3, 'web_cloud'),
      line('L4', 'misc-service-1', 'Frais de gestion', 7, 'other'),
      // Imported before the resource_type column existed, hence NULL
      line('L5', PROJECT_ID, 'Stockage Standard - Bucket hosting-backups sur la région gra', 5, null, PROJECT_ID)
    ]);
  });

  afterAll(() => {
    db.closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  // The Infrastructure tab leaves both types out: Web Cloud is the only place
  // these lines show up
  test('files unrecognised domain lines under domain, web_cloud ones under option', () => {
    expect(db.webCloud.getItems(FROM, TO)).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'example.net', category: 'domain', total: 20 }),
      expect.objectContaining({ name: 'example.ovh', category: 'option', total: 3 })
    ]));
  });

  // 10.5 + 20 + 3: the unrecognised 'other' line stays in the Infrastructure tab
  test('adds up every domain and web_cloud line, but no unrecognised other line', () => {
    expect(db.webCloud.getSummary(FROM, TO).total).toBe(33.5);
  });

  // The bucket name reads like hosting, the project_id says Public Cloud
  test('leaves out Public Cloud lines whose resource_type is NULL', () => {
    expect(db.webCloud.getItems(FROM, TO).find(i => i.name === PROJECT_ID)).toBeUndefined();
  });

  // Adding up an item whose family has no bucket would throw
  test('has a count and a total for every Web Cloud family', () => {
    const summary = db.webCloud.getSummary(FROM, TO);
    for (const family of WEB_CLOUD_FAMILIES) {
      expect(summary[family]).toEqual({ count: expect.any(Number), total: expect.any(Number) });
    }
  });
});
