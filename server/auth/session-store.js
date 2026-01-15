/**
 * SQLite Session Store for OIDC authentication
 * Supports back-channel logout by tracking user_id (sub claim)
 */
const { v4: uuidv4 } = require('uuid');

let db = null;

function init(database) {
  db = database;

  // Create sessions table if not exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      oidc_sid TEXT,
      id_token TEXT,
      user_info TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Migration: add oidc_sid column if missing (for existing databases)
  try {
    db.exec('ALTER TABLE sessions ADD COLUMN oidc_sid TEXT');
  } catch (e) {
    // Column already exists
  }

  // Create indexes (after migration to ensure column exists)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_oidc_sid ON sessions(oidc_sid);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  `);
}

function create(userId, userInfo, tokens, oidcSid, maxAge) {
  const sid = uuidv4();
  const expiresAt = new Date(Date.now() + maxAge).toISOString();

  db.prepare(`
    INSERT INTO sessions (sid, user_id, oidc_sid, id_token, user_info, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    sid,
    userId,
    oidcSid || null,
    tokens.id_token || null,
    JSON.stringify(userInfo),
    expiresAt
  );

  return sid;
}

function get(sid) {
  const row = db.prepare(`
    SELECT * FROM sessions
    WHERE sid = ? AND expires_at > datetime('now')
  `).get(sid);

  if (row) {
    row.user_info = JSON.parse(row.user_info);
  }
  return row;
}

function remove(sid) {
  const row = db.prepare('SELECT id_token FROM sessions WHERE sid = ?').get(sid);
  db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
  return row?.id_token;
}

function deleteByUserId(userId) {
  const result = db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  return result.changes;
}

function deleteByOidcSid(oidcSid) {
  const result = db.prepare('DELETE FROM sessions WHERE oidc_sid = ?').run(oidcSid);
  return result.changes;
}

function cleanup() {
  return db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
}

module.exports = {
  init,
  create,
  get,
  remove,
  deleteByUserId,
  deleteByOidcSid,
  cleanup
};
