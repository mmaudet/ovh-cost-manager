// The label of a Public Cloud product (CONTEXT.md), as the server names them
// (data/public-cloud-products.js), through the page's translations: the products of the other
// services card, those of a project's detail (#145), and every product of a project that the
// Compare tab compares, those that have a card of their own included (#181). A product the
// server names since reads as it is written.
const KEYS = {
  instances: 'productInstances',
  objectStorage: 'productObjectStorage',
  volumes: 'productVolumes',
  snapshots: 'productSnapshots',
  savingsPlans: 'productSavingsPlans',
  volumeBackups: 'productVolumeBackups',
  databases: 'productDatabases',
  loadBalancers: 'productLoadBalancers',
  floatingIps: 'productFloatingIps',
  gateways: 'productGateways',
  ai: 'productAi',
  registry: 'productRegistry',
  kubernetes: 'productKubernetes',
  other: 'productOther',
};

const publicCloudProductLabel = (product, t) => (KEYS[product] ? t(KEYS[product]) : product);

export { publicCloudProductLabel };
