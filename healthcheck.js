// Docker HEALTHCHECK probe.
// Runs inside the app container on a schedule set in docker-compose.yml.
// Exits 0 if /api/healthz returns 200, exits 1 otherwise.
//
// We use Node rather than wget/curl so the check has the same runtime as the
// app and works on any base image (Alpine, Debian, distroless).

const http = require('http');

const req = http.get(
  'http://127.0.0.1:3000/api/healthz',
  { timeout: 5000 },
  (res) => {
    // Drain the response so Node can clean up cleanly.
    res.resume();
    process.exit(res.statusCode === 200 ? 0 : 1);
  },
);

req.on('error', () => process.exit(1));
req.on('timeout', () => {
  req.destroy();
  process.exit(1);
});
