// The label of a cloud resource kind of a project's current consumption, as the import names
// them from OVH's usage (data/cloud-usage.js), through the page's translations (#145). A kind
// that OVH added since, such as the type of a newer product, reads as OVH writes it.
const KEYS = {
  instance: 'cloudKindInstance',
  instance_monthly: 'cloudKindInstanceMonthly',
  instance_option: 'cloudKindInstanceOption',
  instance_option_monthly: 'cloudKindInstanceOptionMonthly',
  instance_bandwidth: 'cloudKindInstanceBandwidth',
  volume: 'cloudKindVolume',
  snapshot: 'cloudKindSnapshot',
  storage: 'cloudKindStorage',
  kubernetes: 'cloudKindKubernetes',
  rancher: 'cloudKindRancher',
  quantum: 'cloudKindQuantum',
  savings_plan: 'cloudKindSavingsPlan',
  certification_monthly: 'cloudKindCertification',
  registry: 'cloudKindRegistry',
  other: 'cloudKindOther',
};

const cloudKindLabel = (kind, t) => (KEYS[kind] ? t(KEYS[kind]) : kind);

export { cloudKindLabel };
