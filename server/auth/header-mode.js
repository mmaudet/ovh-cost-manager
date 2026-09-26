/**
 * Header mode, the authentication without OIDC: the SSO reverse proxy
 * (LemonLDAP-NG) authenticates the user and passes it in the Auth-User,
 * Auth-Mail and Auth-CN headers.
 */

// Reads the user from the headers, on every request
function readHeaderUser(req, res, next) {
  const authUser = req.headers['auth-user'];
  req.user = authUser ? {
    id: authUser,
    email: req.headers['auth-mail'] || null,
    name: req.headers['auth-cn'] || authUser,
  } : null;
  next();
}

// Refuses an API request without Auth-User, except the health check. Mounted
// on /api, it runs for every path that reaches an API route: Express matches
// the mount path as it matches the routes, without case and whatever the
// trailing slash. req.path is relative to the mount path.
function requireHeaderUser(req, res, next) {
  if (req.user || req.path === '/health') {
    return next();
  }
  res.status(401).json({ error: 'Authentication required' });
}

/**
 * Mounts header mode on the app, before the API routes.
 *
 * @param {object} app - the Express app
 * @param {object} options
 * @param {boolean} options.required - AUTH_REQUIRED: Auth-User is required on the API
 */
function mountHeaderMode(app, { required }) {
  app.use(readHeaderUser);
  if (required) {
    app.use('/api', requireHeaderUser);
  }
}

module.exports = { mountHeaderMode };
