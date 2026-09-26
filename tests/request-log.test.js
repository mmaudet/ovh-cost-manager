const { requestLogLine, blockedOriginLogLine } = require('../server/request-log');

describe('requestLogLine', () => {
  const at = new Date('2026-09-26T10:00:00.000Z');

  it('writes the time, the user, the method and the path', () => {
    expect(requestLogLine({ at, user: 'alice', method: 'GET', path: '/api/months' }))
      .toBe('2026-09-26T10:00:00.000Z ["alice"] GET /api/months');
  });

  it('writes anonymous when nobody is signed in', () => {
    expect(requestLogLine({ at, user: undefined, method: 'GET', path: '/api/health' }))
      .toBe('2026-09-26T10:00:00.000Z ["anonymous"] GET /api/health');
  });

  it('keeps a user id that holds a newline on one line', () => {
    const line = requestLogLine({
      at,
      user: 'mallory\n2026-09-26T10:00:01.000Z [admin] GET /api/forged',
      method: 'GET',
      path: '/api/months',
    });
    expect(line).not.toContain('\n');
    expect(line).toBe(
      '2026-09-26T10:00:00.000Z ["mallory\\n2026-09-26T10:00:01.000Z [admin] GET /api/forged"]'
      + ' GET /api/months',
    );
  });

  it('escapes the controls JSON leaves as they are, such as NEL', () => {
    const line = requestLogLine({ at, user: 'mallory\u0085forged', method: 'GET', path: '/' });
    expect(line).toBe('2026-09-26T10:00:00.000Z ["mallory\\u0085forged"] GET /');
  });
});

describe('blockedOriginLogLine', () => {
  it('names the blocked origin', () => {
    expect(blockedOriginLogLine('https://evil.example'))
      .toBe('CORS: Blocked request from origin: "https://evil.example"');
  });

  it('keeps an origin that holds a control character on one line', () => {
    const line = blockedOriginLogLine('https://evil.example\u0085[admin] forged');
    expect(line).not.toMatch(/[\u0085\n\r]/);
    expect(line).toBe(
      'CORS: Blocked request from origin: "https://evil.example\\u0085[admin] forged"',
    );
  });
});
