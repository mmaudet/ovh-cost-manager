/**
 * Serves an Express app on a free local port for a test, and sends it raw
 * requests: the path goes as written, like curl --path-as-is, so that a test can
 * send the path variants a browser or a proxy would normalise.
 */
const http = require('http');

async function serve(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    request: (method, path, headers = {}) => send(port, method, path, headers),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

// Resolves with the status, the headers and the body as text
function send(port, method, path, headers) {
  return new Promise((resolve, reject) => {
    const options = { host: '127.0.0.1', port, method, path, headers, agent: false };
    const req = http.request(options, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

module.exports = { serve };
