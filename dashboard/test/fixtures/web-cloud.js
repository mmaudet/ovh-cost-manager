// Web Cloud services of the synthetic account, as /api/web-cloud/items and
// /api/web-cloud/summary answer for the 12 months ending on a month. Each
// service names the account whose bills billed it (#122): the only account of
// the instance, by its NIC handle.

// The account of account.js, Lyon subsidiary in accounts.js
const LYON = 'xx1111-ovh';

const hosting = {
  name: 'example.com',
  account: LYON,
  category: 'hosting',
  description: 'Hébergement Pro example.com - 12 mois',
  lineCount: 1,
  firstDate: '2026-03-01',
  lastDate: '2026-03-01',
  total: 71.88,
};

const emailPro = {
  name: 'example.com',
  account: LYON,
  category: 'email',
  description: 'Email Pro example.com - 2 comptes - 12 mois',
  lineCount: 1,
  firstDate: '2026-09-01',
  lastDate: '2026-09-01',
  total: 47.52,
};

const domainCom = {
  name: 'example.com',
  account: LYON,
  category: 'domain',
  description: 'Renouvellement du domaine example.com - 1 an',
  lineCount: 1,
  firstDate: '2026-01-05',
  lastDate: '2026-01-05',
  total: 15.99,
};

const domainOrg = {
  name: 'example.org',
  account: LYON,
  category: 'domain',
  description: 'Renouvellement du domaine example.org - 1 an',
  lineCount: 1,
  firstDate: '2026-09-01',
  lastDate: '2026-09-01',
  total: 12.49,
};

const cdnOption = {
  name: 'example.com',
  account: LYON,
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
  account: LYON,
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
  account: LYON,
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

// The same services, as the accounts of accounts.js billed them (#122), over the 12 months
// that end on the latest month of each: for all accounts, and for each account, by its id.
// For all accounts, each family costs what it costs above.
//
// Email Pro example.com, billed monthly, moved in July from the account that config.json no
// longer lists to Lyon: a service of each account, each with the months it paid. The domain
// example.org and its mail plan are yy2222-ovh's, and the DNS zone of example.com was renewed
// on a bill that no account claimed, the Unknown account's.

const UNNAMED = 'yy2222-ovh';
const REMOVED = 'zz3333-ovh';

const monthlyEmailPro = { ...emailPro, description: 'Email Pro example.com - 2 comptes - 1 mois' };
const emailProUntilJune = {
  ...monthlyEmailPro,
  account: REMOVED,
  lineCount: 9,
  firstDate: '2025-10-01',
  lastDate: '2026-06-01',
  total: 35.64,
};
const emailProSinceJuly = {
  ...monthlyEmailPro,
  lineCount: 3,
  firstDate: '2026-07-01',
  lastDate: '2026-09-01',
  total: 11.88,
};
const unclaimedDnsZone = {
  ...dnsZone, account: null, firstDate: '2026-07-01', lastDate: '2026-07-01',
};

const unnamedDomainOrg = { ...domainOrg, account: UNNAMED };
const unnamedMailRefund = { ...mailRefund, account: UNNAMED };

// The summary of the services of a period, as /api/web-cloud/summary answers it: the count
// and the cost of each family, [0, 0] for a family not given, and their total
const familiesSummary = (families, total) => ({
  ...Object.fromEntries(['domain', 'dns_zone', 'hosting', 'email', 'option'].map((family) => {
    const [count, cost] = families[family] ?? [0, 0];
    return [family, { count, total: cost }];
  })),
  total,
});

export const webCloudOfSeveralAccounts = {
  // What the page gets for all accounts: the September services of every account, most
  // expensive first, and August's as above, which are Lyon's
  all: {
    webCloudItems: {
      ...webCloud.webCloudItems,
      '2025-10/2026-09': [
        hosting, emailProUntilJune, domainCom, unnamedDomainOrg, emailProSinceJuly, cdnOption,
        unclaimedDnsZone, unnamedMailRefund,
      ],
    },
    webCloudSummary: {
      ...webCloud.webCloudSummary,
      '2025-10/2026-09': familiesSummary({
        domain: [2, 28.48], dns_zone: [1, 1.2], hosting: [1, 71.88], email: [3, 44.52],
        option: [1, 11.88],
      }, 157.96),
    },
  },
  ofAccount: {
    [LYON]: {
      webCloudItems: {
        '2025-10/2026-09': [hosting, domainCom, emailProSinceJuly, cdnOption],
      },
      webCloudSummary: {
        '2025-10/2026-09': familiesSummary({
          domain: [1, 15.99], hosting: [1, 71.88], email: [1, 11.88], option: [1, 11.88],
        }, 111.63),
      },
    },
    [UNNAMED]: {
      webCloudItems: { '2025-10/2026-09': [unnamedDomainOrg, unnamedMailRefund] },
      webCloudSummary: {
        '2025-10/2026-09': familiesSummary({ domain: [1, 12.49], email: [1, -3] }, 9.49),
      },
    },
    // Up to August, its latest month
    [REMOVED]: {
      webCloudItems: { '2025-09/2026-08': [emailProUntilJune] },
      webCloudSummary: { '2025-09/2026-08': familiesSummary({ email: [1, 35.64] }, 35.64) },
    },
    // Up to July, its only month
    unknown: {
      webCloudItems: { '2025-08/2026-07': [unclaimedDnsZone] },
      webCloudSummary: { '2025-08/2026-07': familiesSummary({ dns_zone: [1, 1.2] }, 1.2) },
    },
  },
};
