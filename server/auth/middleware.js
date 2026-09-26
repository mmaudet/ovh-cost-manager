/**
 * Authentication Middleware
 */
const sessionStore = require('./session-store');
const { unsignValue } = require('./session-cookie');
const { isHealthCheck } = require('./health');

// The API as Express routes it, without case, /api itself included
const API_PATH = /^\/api(\/|$)/i;

function createAuthMiddleware(config) {
  const cookieName = config.auth?.session?.name || 'ocm.sid';
  const secret = config.auth?.session?.secret;

  return (req, res, next) => {
    // Skip auth if not enabled
    if (!config.auth?.enabled) {
      req.user = null;
      return next();
    }

    // Get session from cookie, when its signature matches
    const sid = unsignValue(req.cookies?.[cookieName], secret, 'session');

    if (sid) {
      const session = sessionStore.get(sid);
      if (session) {
        req.user = {
          id: session.user_id,
          email: session.user_info.email || null,
          name: session.user_info.name || session.user_info.preferred_username || session.user_id
        };
        req.session = session;
        return next();
      }
    }

    req.user = null;

    // Public paths - no auth required
    if (isHealthCheck(req) ||
        req.path.startsWith('/auth/') ||
        req.path === '/logout/backchannel') {
      return next();
    }

    // API routes - return 401, which the dashboard turns into a sign-in,
    // whatever the case of the path
    if (API_PATH.test(req.path)) {
      return res.status(401).json({
        error: 'Authentication required',
        loginUrl: '/auth/login'
      });
    }

    // Page routes - redirect to login
    res.redirect(`/auth/login?returnTo=${encodeURIComponent(req.originalUrl)}`);
  };
}

module.exports = { createAuthMiddleware };
