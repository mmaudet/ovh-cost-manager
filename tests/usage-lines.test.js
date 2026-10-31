/**
 * Tests for the bill lines that a Public Cloud project's usage of a month makes, for an account
 * whose cost source is its Public Cloud usage (data/usage-lines.js): against an answer of
 * usage/history/{id} that a real one of May 2026 gives, anonymised and cut down to a few items
 * of each part, its totals added up again. The lines must read as the bill lines of their
 * charges do, so that the products, the instances and the AI Endpoints models read them alike.
 */

const USAGE = require('./fixtures/cloud-usage-history.json');
const { usageBillOf, usageLines, usageMonth } = require('../data/usage-lines');
const { publicCloudProductOf } = require('../data/public-cloud-products');
const { readInstanceLine, readVolumeLine } = require('../data/public-cloud-lines');
const { modelFigures } = require('../data/ai-endpoints');
const { classifyService } = require('../data/classify');

// The lines of the answer, by description, as [quantity, cost]
const byDescription = (lines) => Object.fromEntries(
  lines.map(({ description, quantity, total_price }) => [description, [quantity, total_price]]),
);

// The bill line of an instance's monthly plan, the instance named by the end of its id
const monthlyPlan = (flavor, id, region) => 'Forfait mensuel pour une instance '
  + `${flavor} (id 00000000-0000-4000-8000-00000000${id}, region ${region}) - 01 mois`;

const sumOf = (lines) => lines.reduce((sum, { total_price }) => sum + total_price, 0);

describe('the lines of a month of usage', () => {
  const lines = usageLines(USAGE);

  test('give each charge one line, worded as its bill line, its parts added up', () => {
    expect(byDescription(lines)).toEqual({
      // Beyond the savings plan, the flavor alone; the others by flavor and region
      "Consommation à l'heure pour les instances b3-8": [6922, 354.4064],
      "Consommation à l'heure pour les instances b3-16 gra9": [503, 51.4569],
      // Each instance on a monthly plan
      [monthlyPlan('c2-60', '3470', 'gra9')]: [1, 280.8],
      [monthlyPlan('c2-60', '3471', 'gra9')]: [1, 280.8],
      [monthlyPlan('b2-7', '3465', 'sbg5')]: [1, 25.17],
      'Savings plan (id : a-k8s-nodes) pour 1 instance(s) b3-8': [1, 28.03],
      'Savings plan (id : b-k8s-nodes) pour 3 instance(s) b3-8': [3, 84.09],
      'Disques supplémentaires à gra9 de type classic': [126480, 7.46232],
      'Disques supplémentaires à gra9 de type high-speed': [260400, 30.9876],
      'Snapshots Public Cloud - gra9': [0, 46.835035],
      'Stockage Standard - Bucket bucketName-1 sur la région gra': [470.496679, 0.007057],
      'Stockage Standard - Bucket bucketName-1 sur la région sbg': [18.535043, 0.000278],
      "Nombre de tokens d'entrée pour le modèle AI Endpoints bge-m3": [7489, 0.000075],
      "Nombre de tokens d'entrée pour le modèle AI Endpoints gpt-oss-120b": [7005, 0.00056],
      'Nombre de tokens de sortie pour le modèle AI Endpoints gpt-oss-120b': [1581, 0.000632],
      "Nombre de tokens d'entrée pour le modèle AI Endpoints mistral-7b-instruct-v0-3":
        [6262, 0.000626],
      'Nombre de tokens de sortie pour le modèle AI Endpoints mistral-7b-instruct-v0-3':
        [2123, 0.000212],
      'Sauvegarde de disques - gra9': [4813.377355, 0.0722],
      'Sauvegarde de disques - sbg5': [2226.697454, 0.0334],
      'Public Cloud Public IP - gra9': [745, 0],
      'Public Cloud Floating IP - gra9': [744, 2.0088],
      'Public Cloud Floating IP - sbg5': [744, 2.0088],
      'Octavia Loadbalancer loadbalancer-s - gra9': [744, 6.1752],
      'Public Cloud Gateway s - sbg5': [744, 2.0832],
      'Public Cloud Databases postgresql-business-db1-4 à gra': [1488, 141.2112],
      'Public Cloud Databases postgresql-business-additionnal-storage-gb à gra':
        [238080, 142.848],
      // Two clusters of one plan in a region, on one line
      'Public Cloud Databases mongodb-production-b3-8 à gra': [2550, 284.07],
      'Public Cloud Databases mysql-essential-db1-4 à sbg': [744, 55.5024],
    });
  });

  // OVH rounds a type's total to the millionth, which its components' may then miss by one:
  // half a cent at least makes a line of what no part names
  test('add up to the total that OVH gives the month, to the cent', () => {
    expect(sumOf(lines)).toBeCloseTo(USAGE.totalPrice.value, 2);
    expect(lines.map(({ description }) => description))
      .not.toContain('Autres consommations Public Cloud');
  });

  test('give what no part names a line of its own', () => {
    const usage = { ...USAGE, totalPrice: { value: USAGE.totalPrice.value + 12.5 } };

    const other = usageLines(usage)
      .filter(({ description }) => description === 'Autres consommations Public Cloud');

    expect(other).toEqual([
      { description: 'Autres consommations Public Cloud', quantity: 0, unit_price: 0,
        total_price: 12.500001 },
    ]);
  });

  test('give each line its unit price', () => {
    const [hourly] = lines.filter(({ description }) => description.endsWith('b3-16 gra9'));

    expect(hourly.unit_price).toBeCloseTo(51.4569 / 503, 6);
  });

  // Each line in the card that its bill line counts in, and so in the cloud total
  test('read as the products of their bill lines', () => {
    const products = {};
    for (const { description, total_price } of lines) {
      const product = publicCloudProductOf(description);
      products[product] = Math.round(((products[product] ?? 0) + total_price) * 1e6) / 1e6;
    }

    expect(products).toEqual({
      instances: 992.6333,
      savingsPlans: 112.12,
      volumes: 38.44992,
      snapshots: 46.835035,
      objectStorage: 0.007335,
      volumeBackups: 0.1056,
      ai: 0.002105,
      floatingIps: 4.0176,
      loadBalancers: 6.1752,
      gateways: 2.0832,
      databases: 623.6316,
      other: 0,
    });
  });

  test('name the flavor, region and instance that the instance costs read', () => {
    const instances = lines.map(({ description }) => readInstanceLine(description))
      .filter(Boolean);

    expect(instances).toEqual(expect.arrayContaining([
      { flavor: 'b3-8', region: null, monthly: false, instanceId: null },
      { flavor: 'b3-16', region: 'gra9', monthly: false, instanceId: null },
      { flavor: 'c2-60', region: 'gra9', monthly: true,
        instanceId: '00000000-0000-4000-8000-000000003470' },
      { flavor: 'b2-7', region: 'sbg5', monthly: true,
        instanceId: '00000000-0000-4000-8000-000000003465' },
    ]));
    // Not a savings plan's
    expect(instances).toHaveLength(5);
  });

  test('name the region and type that the volume costs read', () => {
    const volumes = lines.map(({ description }) => readVolumeLine(description)).filter(Boolean);

    expect(volumes).toEqual([
      { region: 'gra9', type: 'classic' }, { region: 'gra9', type: 'high-speed' },
    ]);
  });

  test('name the AI Endpoints models and count their tokens', () => {
    const { models } = modelFigures(lines.map(line => ({ ...line, month: '2026-05' })));

    // Each costs less than a cent: they come by name
    expect(models).toEqual([
      { model: 'bge-m3', tokens: { input: 7489, output: null }, cost: 0 },
      { model: 'gpt-oss-120b', tokens: { input: 7005, output: 1581 }, cost: 0 },
      { model: 'mistral-7b-instruct-v0-3', tokens: { input: 6262, output: 2123 }, cost: 0 },
    ]);
  });

  test('give the service types that their bill lines do', () => {
    const typeOf = (start) => classifyService(
      lines.find(({ description }) => description.startsWith(start)).description,
    );

    expect(typeOf("Consommation à l'heure")).toBe('Compute');
    expect(typeOf('Disques supplémentaires')).toBe('Storage');
    expect(typeOf('Public Cloud Databases')).toBe('Database');
    expect(typeOf('Public Cloud Floating IP')).toBe('Network');
    expect(typeOf('Nombre de tokens')).toBe('AI/ML');
  });
});

describe('a usage of a type that no wording names', () => {
  test('is a line of the type, the component and the region, which the products may read',
    () => {
      const lines = usageLines({
        resourcesUsage: [{
          type: 'kafka-connect', totalPrice: 3,
          resources: [{ region: 'GRA', components: [{ name: 'connector-m', totalPrice: 3 }] }],
        }],
        totalPrice: 3,
      });

      expect(lines.map(({ description }) => description))
        .toEqual(['Public Cloud kafka-connect connector-m - gra']);
    });
});

describe('the month of a usage and its bill', () => {
  test('is the month of the start of its period, read from its digits', () => {
    expect(usageMonth(USAGE)).toBe('2026-05');
    // Midnight in Paris, the evening before in UTC
    expect(usageMonth({ period: { from: '2026-06-01T00:00:00+02:00' } })).toBe('2026-06');
    expect(usageMonth({})).toBeNull();
  });

  // As OVH bills a Public Cloud project's month: the month of use of its lines is the month
  // of the usage
  test('is billed on the first day of the next month, on a bill of its own', () => {
    expect(usageBillOf('ab1234-ovh', '2026-05'))
      .toEqual({ id: 'usage-ab1234-ovh-2026-05', date: '2026-06-01' });
    expect(usageBillOf('ab1234-ovh', '2026-12'))
      .toEqual({ id: 'usage-ab1234-ovh-2026-12', date: '2027-01-01' });
  });
});
