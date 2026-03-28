const path = require('path');

function readNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

module.exports = {
  port: readNumber(process.env.PORT, 3095),
  relayName: process.env.RELAY_NAME || 'OpenResist Discovery Relay',
  relayMetricsUrl: process.env.RELAY_METRICS_URL || 'http://127.0.0.1:7777/metrics',
  relayContainer: process.env.STRFRY_CONTAINER || 'openresist-discovery-relay',
  relayBinaryPath: process.env.STRFRY_BINARY_PATH || '/app/strfry',
  relayConfigPath: process.env.STRFRY_CONFIG_PATH || '/etc/strfry.conf',
  reviewLimit: readNumber(process.env.DEFAULT_REVIEW_LIMIT, 100),
  scanTimeoutMs: readNumber(process.env.STRFRY_SCAN_TIMEOUT_MS, 15000),
  deleteTimeoutMs: readNumber(process.env.STRFRY_DELETE_TIMEOUT_MS, 30000),
  projectRoot: path.resolve(__dirname, '..')
};