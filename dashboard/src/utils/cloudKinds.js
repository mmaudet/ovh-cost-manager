// The label of a cloud resource kind of a project's current consumption, as the import names
// them from OVH's usage (data/cloud-usage.js), in the page's language (#145). A kind that OVH
// added since, such as the type of a newer product, reads as OVH writes it.
const LABELS = {
  instance: ['Instances', 'Instances'],
  instance_monthly: ['Instances (forfait mensuel)', 'Instances (monthly plan)'],
  instance_option: ['Options d\'instance', 'Instance options'],
  instance_option_monthly: ['Options d\'instance (forfait mensuel)', 'Instance options (monthly plan)'],
  instance_bandwidth: ['Bande passante des instances', 'Instance bandwidth'],
  volume: ['Volumes', 'Volumes'],
  snapshot: ['Snapshots', 'Snapshots'],
  storage: ['Stockage objet', 'Object storage'],
  kubernetes: ['Kubernetes', 'Kubernetes'],
  rancher: ['Rancher', 'Rancher'],
  quantum: ['Quantum', 'Quantum'],
  savings_plan: ['Savings plans', 'Savings plans'],
  certification_monthly: ['Certifications', 'Certifications'],
  registry: ['Registre', 'Container registry'],
  other: ['Autres', 'Other'],
};

const cloudKindLabel = (kind, language) => {
  const labels = LABELS[kind];
  if (!labels) return kind;
  return language === 'en' ? labels[1] : labels[0];
};

export { cloudKindLabel };
