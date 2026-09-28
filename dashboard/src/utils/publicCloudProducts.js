// The label of a Public Cloud product without a card of its own (CONTEXT.md), as the server
// names them (data/public-cloud-products.js), through the page's translations: the products of
// the other services card, and those of a project's detail (#145). A product the server names
// since reads as it is written.
const KEYS = {
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
