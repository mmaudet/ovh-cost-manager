// The label of a product of the other services card of the Public Cloud tab, as the server
// names the products that no card of their own counts (data/public-cloud-products.js), in the
// page's language (#145). A product the server names since reads as it is written.
const LABELS = {
  volumeBackups: ['Sauvegardes de volumes', 'Volume backups'],
  databases: ['Bases de données', 'Databases'],
  loadBalancers: ['Load balancers', 'Load balancers'],
  floatingIps: ['Floating IP', 'Floating IPs'],
  gateways: ['Gateways', 'Gateways'],
  ai: ['IA', 'AI'],
  credits: ['Crédit Cloud', 'Cloud credit'],
  other: ['Divers', 'Miscellaneous'],
};

const publicCloudProductLabel = (product, language) => {
  const labels = LABELS[product];
  if (!labels) return product;
  return language === 'en' ? labels[1] : labels[0];
};

export { publicCloudProductLabel };
