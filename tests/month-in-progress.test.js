/**
 * The month in progress (CONTEXT.md, #216), which the months list marks, on the server started in
 * a child process over a database that the test seeds: the month of today, while a recurring
 * service, one that the bills of each of the three months before charged, has no bill line in
 * it. OVHcloud bills some accounts early in the month, others late: the mark goes as soon as the
 * import stores the bill of each recurring service. The bills are dated from the real date (see
 * support/month-in-progress.js). And the pure function that chooses the candidate month (#258).
 */

const {
  LYON, PARIS, UNKNOWN_ACCOUNT, project,
} = require('./support/accounts');
const {
  DAY_OF_TODAY, MONTH_BEFORE, MONTH_OF_TODAY, MONTHS_BEFORE, TWO_MONTHS_BEFORE, billOf,
} = require('./support/month-in-progress');
const { startOcm } = require('./support/ocm-server');
const { chooseCandidateMonth } = require('../data/month-in-progress');

// The one month that can be in progress (#258): the month of today once the account shown has a
// bill in it, and until then the month before, as some bills of a month land once the next one
// has begun
describe('chooseCandidateMonth (#258)', () => {
  test('chooses the month of today once the account shown has a bill in it', () => {
    expect(chooseCandidateMonth('2026-10', true)).toBe('2026-10');
    expect(chooseCandidateMonth('2027-01', true)).toBe('2027-01');
  });

  test('chooses the month before while the month of today has no bill', () => {
    expect(chooseCandidateMonth('2026-10', false)).toBe('2026-09');
    // In January, December of the year before
    expect(chooseCandidateMonth('2027-01', false)).toBe('2026-12');
  });
});

// The months of an answer of /api/months, the latest first, and the months that it marks in
// progress, with their mark
const monthsOf = ({ body }) => body.map(({ value }) => value);
const marksOf = ({ body }) => body
  .filter((month) => 'inProgress' in month)
  .map(({ value, inProgress }) => [value, inProgress]);

// A single account, billed early in the month for its Public Cloud project, and late for its
// dedicated server: the bill of the month of today charged the project, and the one that will
// charge the server has not come yet. Every NIC handle, identifier and amount is made up.
const PROJECT = 'project-production';
const SERVER = 'ns3000001.ip-203-0-113.eu';
function seedLateServerBill(db) {
  db.accounts.upsert({ nic: LYON, currency: 'EUR' });
  project(db, PROJECT, 'Production', LYON);
  MONTHS_BEFORE.forEach((month, index) => {
    billOf(db, `FR10${index}1`, LYON, `${month}-01`, [[PROJECT, 'cloud_project', 600]]);
    billOf(db, `FR10${index}2`, LYON, `${month}-25`, [[SERVER, 'dedicated_server', 200]]);
  });
  billOf(db, 'FR1031', LYON, `${MONTH_OF_TODAY}-01`, [[PROJECT, 'cloud_project', 610]]);
}

describe('GET /api/months: the month in progress (#216)', () => {
  describe('with a single account', () => {
    let ocm;

    beforeAll(async () => {
      ocm = await startOcm(() => ({}), { seed: seedLateServerBill });
    }, 30000);

    afterAll(async () => {
      await ocm?.stop();
    });

    test('marks the month of today, and no other, while a recurring service has no bill line in it',
      async () => {
        const answer = await ocm.get('/api/months');

        expect(answer.status).toBe(200);
        expect(monthsOf(answer)).toEqual([MONTH_OF_TODAY, ...[...MONTHS_BEFORE].reverse()]);
        expect(marksOf(answer)).toEqual([[MONTH_OF_TODAY, true]]);
      });

    // Read when the server reads the bills: no re-import, nor any restart
    test('no longer marks it once the import stores the bill of each recurring service',
      async () => {
        const inProgress = await ocm.get('/api/months');

        // The bill of the server comes today, and the import stores it
        ocm.write((db) => billOf(db, 'FR1032', LYON, DAY_OF_TODAY, [
          [SERVER, 'dedicated_server', 200],
        ]));

        const complete = await ocm.get('/api/months');
        expect(marksOf(complete)).toEqual([]);
        // The months as a single-account installation listed them before, which only the mark
        // of the month in progress tells apart
        expect(inProgress.body).toEqual([
          { ...complete.body[0], inProgress: true }, ...complete.body.slice(1),
        ]);
      });
  });

  // A service is recurring when the bills of each of the three months before charged it: the
  // month of today may not bill the others yet, or ever
  describe('with services that the months before billed once or twice', () => {
    let ocm;

    // A single account, whose bill of the month of today charged its Public Cloud project, billed
    // every month; not its domain, renewed for a year last month, nor the setup of its server,
    // paid once two months ago, nor its VPS, ordered two months ago
    function seedServicesNotRecurring(db) {
      db.accounts.upsert({ nic: LYON, currency: 'EUR' });
      project(db, PROJECT, 'Production', LYON);
      [...MONTHS_BEFORE, MONTH_OF_TODAY].forEach((month, index) => {
        billOf(db, `FR10${index}1`, LYON, `${month}-01`, [[PROJECT, 'cloud_project', 600]]);
      });
      billOf(db, 'FR1012', LYON, `${TWO_MONTHS_BEFORE}-12`, [
        [SERVER, 'dedicated_server', 99],
        ['vps-0a1b2c3d.vps.ovh.net', 'vps', 12],
      ]);
      billOf(db, 'FR1022', LYON, `${MONTH_BEFORE}-12`, [
        ['example.com', 'domain', 15],
        ['vps-0a1b2c3d.vps.ovh.net', 'vps', 12],
      ]);
    }

    beforeAll(async () => {
      ocm = await startOcm(() => ({}), { seed: seedServicesNotRecurring });
    }, 30000);

    afterAll(async () => {
      await ocm?.stop();
    });

    test('keeps nothing in progress for a yearly service, a one-off or a service ordered since',
      async () => {
        const answer = await ocm.get('/api/months');

        expect(monthsOf(answer)[0]).toBe(MONTH_OF_TODAY);
        expect(marksOf(answer)).toEqual([]);
      });
  });

  // As the months list does (#115), the mark follows the account parameter: the recurring
  // services of the account asked, those of the Unknown account for `unknown`, and those of
  // every account without it, any of which keeps the month in progress
  describe('with several accounts', () => {
    let ocm;

    // Lyon, billed late for its dedicated server, whose bill of the month of today has not come
    // yet; Paris, and the Unknown account, whose bills of the month of today charged each of
    // their services. Each account has a bill in the month of today, which the months list
    // then lists for it.
    function seedAccounts(db) {
      db.accounts.upsert({ nic: LYON, currency: 'EUR', name: 'Lyon subsidiary' });
      db.accounts.upsert({ nic: PARIS, currency: 'EUR' });
      project(db, 'project-lyon', 'Lyon', LYON);
      project(db, 'project-paris', 'Paris', PARIS);
      [...MONTHS_BEFORE, MONTH_OF_TODAY].forEach((month, index) => {
        billOf(db, `FR1${index}01`, LYON, `${month}-01`, [['project-lyon', 'cloud_project', 600]]);
        billOf(db, `FR2${index}01`, PARIS, `${month}-01`, [
          ['project-paris', 'cloud_project', 400],
        ]);
        billOf(db, `FR0${index}01`, null, `${month}-01`, [
          ['ns3000004.ip-203-0-113.eu', 'dedicated_server', 80],
        ]);
      });
      MONTHS_BEFORE.forEach((month, index) => {
        billOf(db, `FR1${index}02`, LYON, `${month}-25`, [[SERVER, 'dedicated_server', 200]]);
      });
    }

    beforeAll(async () => {
      ocm = await startOcm(() => ({}), { seed: seedAccounts });
    }, 30000);

    afterAll(async () => {
      await ocm?.stop();
    });

    test('marks it for the account asked while one of its recurring services lacks a bill line',
      async () => {
        expect(marksOf(await ocm.get(`/api/months?account=${LYON}`)))
          .toEqual([[MONTH_OF_TODAY, true]]);
      });

    test.each([
      ['an account', PARIS],
      ['the Unknown account', UNKNOWN_ACCOUNT],
    ])('does not mark it for %s whose every recurring service it billed', async (_, account) => {
      const answer = await ocm.get(`/api/months?account=${account}`);

      expect(monthsOf(answer)[0]).toBe(MONTH_OF_TODAY);
      expect(marksOf(answer)).toEqual([]);
    });

    test('marks it with all accounts shown while any account lacks the bill of a recurring service',
      async () => {
        expect(marksOf(await ocm.get('/api/months'))).toEqual([[MONTH_OF_TODAY, true]]);
      });
  });

  // The Unknown account's rows, stored before the accounts, have recurring services of their own
  // (ADR 0002)
  describe('with the Unknown account billed late', () => {
    let ocm;

    // Lyon, whose bills of the month of today charged each of its services, and the Unknown
    // account, whose bill of the month of today charged its domain, and not yet its dedicated
    // server, which the three months before billed
    function seedUnknownAccountLate(db) {
      db.accounts.upsert({ nic: LYON, currency: 'EUR', name: 'Lyon subsidiary' });
      project(db, 'project-lyon', 'Lyon', LYON);
      [...MONTHS_BEFORE, MONTH_OF_TODAY].forEach((month, index) => {
        billOf(db, `FR1${index}01`, LYON, `${month}-01`, [['project-lyon', 'cloud_project', 600]]);
        billOf(db, `FR0${index}01`, null, `${month}-01`, [['example.com', 'domain', 15]]);
      });
      MONTHS_BEFORE.forEach((month, index) => {
        billOf(db, `FR0${index}02`, null, `${month}-25`, [
          ['ns3000004.ip-203-0-113.eu', 'dedicated_server', 80],
        ]);
      });
    }

    beforeAll(async () => {
      ocm = await startOcm(() => ({}), { seed: seedUnknownAccountLate });
    }, 30000);

    afterAll(async () => {
      await ocm?.stop();
    });

    test('marks it for the Unknown account, and with all accounts shown, not for another account',
      async () => {
        expect(marksOf(await ocm.get(`/api/months?account=${UNKNOWN_ACCOUNT}`)))
          .toEqual([[MONTH_OF_TODAY, true]]);
        expect(marksOf(await ocm.get('/api/months'))).toEqual([[MONTH_OF_TODAY, true]]);
        expect(marksOf(await ocm.get(`/api/months?account=${LYON}`))).toEqual([]);
      });
  });

  // A recurring service is a service by its identifier and its account, as a bill line belongs
  // to the account of its bill (ADR 0002); but it lacks no bill once any account's bill of the
  // month of today charges its identifier (#214)
  describe('with a service moved to another account', () => {
    let ocm;

    // Lyon rented the dedicated server until last month, and Paris since: the bill of the month
    // of today that charged it is Paris's. Both accounts' bills of the month of today charged
    // their Public Cloud projects.
    function seedMovedServer(db) {
      db.accounts.upsert({ nic: LYON, currency: 'EUR' });
      db.accounts.upsert({ nic: PARIS, currency: 'EUR' });
      project(db, 'project-lyon', 'Lyon', LYON);
      project(db, 'project-paris', 'Paris', PARIS);
      [...MONTHS_BEFORE, MONTH_OF_TODAY].forEach((month, index) => {
        billOf(db, `FR1${index}01`, LYON, `${month}-01`, [['project-lyon', 'cloud_project', 600]]);
        billOf(db, `FR2${index}01`, PARIS, `${month}-01`, [
          ['project-paris', 'cloud_project', 400],
        ]);
      });
      MONTHS_BEFORE.forEach((month, index) => {
        billOf(db, `FR1${index}02`, LYON, `${month}-25`, [[SERVER, 'dedicated_server', 200]]);
      });
      billOf(db, 'FR2032', PARIS, `${MONTH_OF_TODAY}-01`, [[SERVER, 'dedicated_server', 200]]);
    }

    beforeAll(async () => {
      ocm = await startOcm(() => ({}), { seed: seedMovedServer });
    }, 30000);

    afterAll(async () => {
      await ocm?.stop();
    });

    test('keeps nothing in progress for the account it moved from, nor with all accounts shown',
      async () => {
        expect(marksOf(await ocm.get(`/api/months?account=${LYON}`))).toEqual([]);
        expect(marksOf(await ocm.get('/api/months'))).toEqual([]);
        // For Paris, billed once, it is no recurring service
        expect(marksOf(await ocm.get(`/api/months?account=${PARIS}`))).toEqual([]);
      });
  });
});
