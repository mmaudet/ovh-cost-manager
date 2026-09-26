/**
 * Tests for the expiry of the OIDC sessions: a session is valid until its
 * expiry time, not until the end of that day, and the cleanup deletes the
 * expired ones.
 */

const Database = require('better-sqlite3');
const sessionStore = require('../server/auth/session-store');

const SECOND = 1000;
const MINUTE = 60 * SECOND;

describe('the expiry of a session', () => {
  let db;

  beforeEach(() => {
    db = new Database(':memory:');
    sessionStore.init(db);
  });

  afterEach(() => db.close());

  // A session whose expiry is maxAge from now: in the past when negative
  const createSession = (maxAge) => sessionStore.create(
    'alice',
    { name: 'Alice' },
    { id_token: 'eyJ.x.y' },
    'op-session-1',
    maxAge
  );

  test('keeps a session that expires in a minute', () => {
    expect(sessionStore.get(createSession(MINUTE))).toMatchObject({ user_id: 'alice' });
  });

  test('refuses a session that expired a minute ago', () => {
    expect(sessionStore.get(createSession(-MINUTE))).toBeUndefined();
  });

  test('refuses a session that expired a second ago', () => {
    expect(sessionStore.get(createSession(-SECOND))).toBeUndefined();
  });

  test('cleanup deletes the expired sessions, and only them', () => {
    createSession(-MINUTE);
    createSession(-SECOND);
    const live = createSession(MINUTE);

    expect(sessionStore.cleanup().changes).toBe(2);
    expect(db.prepare('SELECT sid FROM sessions').all()).toEqual([{ sid: live }]);
  });
});
