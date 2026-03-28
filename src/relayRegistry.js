const { promisify } = require('util');
const { execFile } = require('child_process');
const config = require('./config');

const execFileAsync = promisify(execFile);

let relayCache = null;
let relayCacheExpiresAt = 0;

function buildDefaultRelay() {
  return {
    id: config.relayContainer,
    name: config.relayName,
    container: config.relayContainer,
    metricsUrl: config.relayMetricsUrl,
    binaryPath: config.relayBinaryPath,
    configPath: config.relayConfigPath,
    source: 'default'
  };
}

function parseMetricsUrlFromPorts(ports) {
  const match = String(ports || '').match(/127\.0\.0\.1:(\d+)->7777\/tcp/);

  if (!match) {
    return null;
  }

  return 'http://127.0.0.1:' + match[1] + '/metrics';
}

function normalizeRelayDefinition(definition) {
  if (!definition || !definition.container) {
    return null;
  }

  return {
    id: definition.id || definition.container,
    name: definition.name || definition.container,
    container: definition.container,
    metricsUrl: definition.metricsUrl || config.relayMetricsUrl,
    binaryPath: definition.binaryPath || config.relayBinaryPath,
    configPath: definition.configPath || config.relayConfigPath,
    source: definition.source || 'env'
  };
}

async function discoverDockerRelays() {
  const result = await execFileAsync('docker', ['ps', '--format', '{{.Names}}\t{{.Image}}\t{{.Ports}}'], {
    timeout: 5000,
    maxBuffer: 1024 * 1024
  });

  return String(result.stdout || '')
    .split('\n')
    .map(function (line) {
      return line.trim();
    })
    .filter(Boolean)
    .map(function (line) {
      const parts = line.split('\t');
      return {
        name: parts[0],
        image: parts[1],
        ports: parts.slice(2).join('\t')
      };
    })
    .filter(function (entry) {
      return /strfry/i.test(entry.image || '') || /relay/i.test(entry.name || '');
    })
    .map(function (entry) {
      return {
        id: entry.name,
        name: entry.name,
        container: entry.name,
        metricsUrl: parseMetricsUrlFromPorts(entry.ports) || config.relayMetricsUrl,
        binaryPath: config.relayBinaryPath,
        configPath: config.relayConfigPath,
        source: 'docker'
      };
    });
}

function dedupeRelays(relays) {
  const seen = {};

  return relays.filter(function (relay) {
    if (!relay || !relay.id || seen[relay.id]) {
      return false;
    }

    seen[relay.id] = true;
    return true;
  });
}

async function listRelays() {
  const now = Date.now();

  if (relayCache && relayCacheExpiresAt > now) {
    return relayCache;
  }

  const configuredRelays = config.relayDefinitions.map(normalizeRelayDefinition).filter(Boolean);
  let discoveredRelays = [];

  try {
    discoveredRelays = await discoverDockerRelays();
  } catch (error) {
    discoveredRelays = [];
  }

  relayCache = dedupeRelays([buildDefaultRelay()].concat(configuredRelays).concat(discoveredRelays));
  relayCacheExpiresAt = now + config.relayDiscoveryTtlMs;

  return relayCache;
}

async function getRelayById(relayId) {
  const relays = await listRelays();

  if (!relayId) {
    return relays[0] || buildDefaultRelay();
  }

  return relays.find(function (relay) {
    return relay.id === relayId;
  }) || null;
}

module.exports = {
  listRelays: listRelays,
  getRelayById: getRelayById
};