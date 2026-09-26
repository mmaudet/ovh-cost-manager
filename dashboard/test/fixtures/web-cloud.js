// Web Cloud services of the synthetic account, as /api/web-cloud/items and
// /api/web-cloud/summary answer for the 12 months ending on a month.

const hosting = {
  name: 'example.com',
  category: 'hosting',
  description: 'Hébergement Pro example.com - 12 mois',
  lineCount: 1,
  firstDate: '2026-03-01',
  lastDate: '2026-03-01',
  total: 71.88,
};

const emailPro = {
  name: 'example.com',
  category: 'email',
  description: 'Email Pro example.com - 2 comptes - 12 mois',
  lineCount: 1,
  firstDate: '2026-09-01',
  lastDate: '2026-09-01',
  total: 47.52,
};

const domainCom = {
  name: 'example.com',
  category: 'domain',
  description: 'Renouvellement du domaine example.com - 1 an',
  lineCount: 1,
  firstDate: '2026-01-05',
  lastDate: '2026-01-05',
  total: 15.99,
};

const domainOrg = {
  name: 'example.org',
  category: 'domain',
  description: 'Renouvellement du domaine example.org - 1 an',
  lineCount: 1,
  firstDate: '2026-09-01',
  lastDate: '2026-09-01',
  total: 12.49,
};

const cdnOption = {
  name: 'example.com',
  category: 'option',
  description: 'Option CDN Basic example.com - 12 mois',
  lineCount: 1,
  firstDate: '2026-09-01',
  lastDate: '2026-09-01',
  total: 11.88,
};

// A domain and its DNS zone share a name: they are two services.
const dnsZone = {
  name: 'example.com',
  category: 'dns_zone',
  description: 'Zone DNS Anycast example.com - 12 mois',
  lineCount: 1,
  firstDate: '2026-09-01',
  lastDate: '2026-09-01',
  total: 1.2,
};

// A credit note: the refund of a mail plan paid before the period.
const mailRefund = {
  name: 'example.org',
  category: 'email',
  description: 'Avoir MX Plan example.org',
  lineCount: 1,
  firstDate: '2026-09-01',
  lastDate: '2026-09-01',
  total: -3,
};

export const webCloud = {
  // Most expensive first, as the server sorts them
  webCloudItems: {
    '2025-10/2026-09': [hosting, emailPro, domainCom, domainOrg, cdnOption, dnsZone, mailRefund],
    '2025-09/2026-08': [hosting, domainCom],
  },
  webCloudSummary: {
    '2025-10/2026-09': {
      domain: { count: 2, total: 28.48 },
      dns_zone: { count: 1, total: 1.2 },
      hosting: { count: 1, total: 71.88 },
      email: { count: 2, total: 44.52 },
      option: { count: 1, total: 11.88 },
      total: 157.96,
    },
    '2025-09/2026-08': {
      domain: { count: 1, total: 15.99 },
      dns_zone: { count: 0, total: 0 },
      hosting: { count: 1, total: 71.88 },
      email: { count: 0, total: 0 },
      option: { count: 0, total: 0 },
      total: 87.87,
    },
  },
};
