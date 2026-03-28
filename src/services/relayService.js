const http = require('http');
const https = require('https');
const { promisify } = require('util');
const { execFile } = require('child_process');
const config = require('../config');

const execFileAsync = promisify(execFile);

function buildDockerArgs(relay, strfryArgs) {
  return [
    'exec',
    relay.container,
    'sh',
    '-lc',
    [
      quoteForShell(relay.binaryPath),
      '--config',
      quoteForShell(relay.configPath)
    ].concat(strfryArgs.map(quoteForShell)).join(' ')
  ];
}

function quoteForShell(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

async function runStrfry(relay, strfryArgs, timeoutMs) {
  const dockerArgs = buildDockerArgs(relay, strfryArgs);

  try {
    const result = await execFileAsync('docker', dockerArgs, {
      timeout: timeoutMs,
      maxBuffer: 20 * 1024 * 1024
    });

    return {
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      command: ['docker'].concat(dockerArgs).join(' ')
    };
  } catch (error) {
    error.command = ['docker'].concat(dockerArgs).join(' ');
    throw error;
  }
}

function normalizeFilter(filter, fallbackLimit) {
  const normalized = Object.assign({}, filter || {});

  if (!normalized.limit && fallbackLimit) {
    normalized.limit = fallbackLimit;
  }

  Object.keys(normalized).forEach(function (key) {
    if (normalized[key] === '' || normalized[key] == null) {
      delete normalized[key];
    }
  });

  return normalized;
}

function splitJsonLines(stdout) {
  return stdout
    .split('\n')
    .map(function (line) {
      return line.trim();
    })
    .filter(Boolean);
}

function parseEvents(stdout) {
  return splitJsonLines(stdout).map(function (line) {
    return JSON.parse(line);
  });
}

function parseCount(stdout) {
  const lines = splitJsonLines(stdout);
  const lastLine = lines[lines.length - 1] || '0';
  const value = Number(lastLine);
  return Number.isFinite(value) ? value : 0;
}

function parseDeleteCount(output) {
  const match = String(output || '').match(/(?:Would delete|Deleted)\s+(\d+)\s+events?/i);
  return match ? Number(match[1]) : 0;
}

function buildDeleteResponse(result, details) {
  const parsedCount = parseDeleteCount((result.stderr || '') + '\n' + (result.stdout || ''));
  const dryRun = !!details.dryRun;

  return Object.assign({
    command: result.command,
    dryRun: dryRun,
    matchedCount: parsedCount,
    wouldDeleteCount: dryRun ? parsedCount : 0,
    deletedCount: dryRun ? 0 : parsedCount,
    stdout: result.stdout,
    stderr: result.stderr
  }, details.extra || {});
}

function parseMetricsText(metricsText) {
  const counters = {
    clientMessages: {},
    relayMessages: {},
    eventsByKind: {}
  };

  metricsText.split('\n').forEach(function (line) {
    const trimmed = line.trim();
    let match;

    if (!trimmed || trimmed.charAt(0) === '#') {
      return;
    }

    match = trimmed.match(/^nostr_client_messages_total\{verb="([^"]+)"\}\s+([0-9.]+)$/);
    if (match) {
      counters.clientMessages[match[1]] = Number(match[2]);
      return;
    }

    match = trimmed.match(/^nostr_relay_messages_total\{verb="([^"]+)"\}\s+([0-9.]+)$/);
    if (match) {
      counters.relayMessages[match[1]] = Number(match[2]);
      return;
    }

    match = trimmed.match(/^nostr_events_total\{kind="([^"]+)"\}\s+([0-9.]+)$/);
    if (match) {
      counters.eventsByKind[match[1]] = Number(match[2]);
    }
  });

  return counters;
}

function fetchText(url) {
  const client = url.indexOf('https://') === 0 ? https : http;

  return new Promise(function (resolve, reject) {
    const request = client.get(url, function (response) {
      let body = '';

      if (response.statusCode && response.statusCode >= 400) {
        reject(new Error('Metrics request failed with status ' + response.statusCode));
        response.resume();
        return;
      }

      response.setEncoding('utf8');
      response.on('data', function (chunk) {
        body += chunk;
      });
      response.on('end', function () {
        resolve(body);
      });
    });

    request.on('error', reject);
    request.setTimeout(5000, function () {
      request.destroy(new Error('Metrics request timed out'));
    });
  });
}

function chunkArray(values, size) {
  const chunks = [];
  let index = 0;

  while (index < values.length) {
    chunks.push(values.slice(index, index + size));
    index += size;
  }

  return chunks;
}

function parseAgeToSeconds(age) {
  const normalized = String(age || '').trim();
  const units = {
    s: 1,
    m: 60,
    h: 60 * 60,
    d: 24 * 60 * 60,
    w: 7 * 24 * 60 * 60,
    M: 30 * 24 * 60 * 60,
    Y: 365 * 24 * 60 * 60
  };
  let total = 0;
  let match;
  let consumed = '';
  const pattern = /(\d+)([smhdwMY]?)/g;

  if (!normalized) {
    throw new Error('An age value is required');
  }

  while ((match = pattern.exec(normalized)) !== null) {
    total += Number(match[1]) * (units[match[2] || 's'] || 1);
    consumed += match[0];
  }

  if (!total || consumed !== normalized) {
    throw new Error('Invalid age format. Use seconds or shorthand values like 12h, 30d, or 1Y');
  }

  return total;
}

async function countEvents(relay, filter) {
  const normalized = normalizeFilter(filter);
  const result = await runStrfry(relay, ['scan', '--count', JSON.stringify(normalized)], config.scanTimeoutMs);

  return {
    count: parseCount(result.stdout),
    stderr: result.stderr,
    command: result.command,
    filter: normalized
  };
}

async function scanEvents(relay, filter, options) {
  const normalized = normalizeFilter(filter, (options && options.limit) || config.reviewLimit);
  const result = await runStrfry(relay, ['scan', JSON.stringify(normalized)], config.scanTimeoutMs);
  const events = parseEvents(result.stdout);

  return {
    events: events,
    total: events.length,
    command: result.command,
    filter: normalized,
    stderr: result.stderr
  };
}

async function deleteByFilter(relay, filter, dryRun) {
  const normalized = normalizeFilter(filter);
  const args = ['delete', '--filter=' + JSON.stringify(normalized)];

  if (dryRun) {
    args.push('--dry-run');
  }

  const result = await runStrfry(relay, args, config.deleteTimeoutMs);

  return buildDeleteResponse(result, {
    dryRun: dryRun,
    extra: {
      filter: normalized
    }
  });
}

async function deleteByAge(relay, age, dryRun) {
  const ageSeconds = parseAgeToSeconds(age);
  const args = ['delete', '--age=' + ageSeconds];

  if (dryRun) {
    args.push('--dry-run');
  }

  const result = await runStrfry(relay, args, config.deleteTimeoutMs);

  return buildDeleteResponse(result, {
    dryRun: dryRun,
    extra: {
      age: age,
      ageSeconds: ageSeconds
    }
  });
}

async function deleteByAuthors(relay, authors, dryRun) {
  const cleanedAuthors = (authors || []).map(function (value) {
    return String(value).trim();
  }).filter(Boolean);

  if (!cleanedAuthors.length) {
    throw new Error('At least one author pubkey is required');
  }

  return deleteByFilter(relay, { authors: cleanedAuthors }, dryRun);
}

async function deleteByKinds(relay, kinds, dryRun) {
  const cleanedKinds = (kinds || []).map(function (value) {
    return Number(value);
  }).filter(function (value) {
    return Number.isInteger(value) && value >= 0;
  });

  if (!cleanedKinds.length) {
    throw new Error('At least one event kind is required');
  }

  return deleteByFilter(relay, { kinds: cleanedKinds }, dryRun);
}

async function deleteByEventIds(relay, ids, dryRun) {
  const cleanedIds = (ids || []).map(function (value) {
    return String(value).trim();
  }).filter(Boolean);

  if (!cleanedIds.length) {
    throw new Error('At least one event id is required');
  }

  const chunks = chunkArray(cleanedIds, 200);
  const results = [];
  let requestedDeleteCount = 0;
  let matchedCount = 0;

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const result = await deleteByFilter(relay, { ids: chunk }, dryRun);
    results.push(result);
    requestedDeleteCount += chunk.length;
    matchedCount += result.matchedCount || 0;
  }

  return {
    totalIds: cleanedIds.length,
    batchCount: results.length,
    dryRun: !!dryRun,
    matchedCount: matchedCount,
    wouldDeleteCount: dryRun ? matchedCount : 0,
    deletedCount: dryRun ? 0 : matchedCount,
    results: results,
    requestedDeleteCount: requestedDeleteCount
  };
}

async function deleteMatchingContent(relay, options) {
  const query = String(options.query || '').trim();
  const isRegex = !!options.useRegex;
  const dryRun = !!options.dryRun;
  const filter = normalizeFilter({
    authors: options.authors,
    kinds: options.kinds,
    since: options.since,
    until: options.until,
    limit: options.limit || 500
  });

  if (!query) {
    throw new Error('A content query is required');
  }

  const scanResult = await scanEvents(relay, filter, { limit: filter.limit || 500 });
  const matcher = isRegex ? new RegExp(query, 'i') : null;
  const matchedEvents = scanResult.events.filter(function (event) {
    const content = String(event.content || '');
    return isRegex ? matcher.test(content) : content.toLowerCase().indexOf(query.toLowerCase()) !== -1;
  });
  const ids = matchedEvents.map(function (event) {
    return event.id;
  });
  const deleteResult = ids.length ? await deleteByEventIds(relay, ids, dryRun) : {
    totalIds: 0,
    batchCount: 0,
    dryRun: dryRun,
    results: [],
    requestedDeleteCount: 0
  };

  return {
    matchedCount: matchedEvents.length,
    matchedIds: ids,
    wouldDeleteCount: dryRun ? deleteResult.requestedDeleteCount : 0,
    deletedCount: dryRun ? 0 : deleteResult.deletedCount,
    sample: matchedEvents.slice(0, 25),
    scan: {
      filter: scanResult.filter,
      total: scanResult.total,
      command: scanResult.command
    },
    delete: deleteResult
  };
}

async function getSummary(relay) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const dayAgoSeconds = nowSeconds - (24 * 60 * 60);
  const weekAgoSeconds = nowSeconds - (7 * 24 * 60 * 60);
  const countJobs = [
    ['total', {}],
    ['profiles', { kinds: [0] }],
    ['notes', { kinds: [1] }],
    ['contacts', { kinds: [3] }],
    ['relayLists', { kinds: [10002] }],
    ['deletions', { kinds: [5] }],
    ['last24h', { since: dayAgoSeconds }],
    ['last7d', { since: weekAgoSeconds }]
  ].map(async function (entry) {
    const result = await countEvents(relay, entry[1]);
    return [entry[0], result.count];
  });

  const metricsJob = fetchText(relay.metricsUrl)
    .then(parseMetricsText)
    .catch(function (error) {
      return { error: error.message };
    });

  const countResults = await Promise.all(countJobs);
  const metrics = await metricsJob;
  const counts = countResults.reduce(function (accumulator, entry) {
    accumulator[entry[0]] = entry[1];
    return accumulator;
  }, {});

  return {
    relayId: relay.id,
    relayName: relay.name,
    relayContainer: relay.container,
    relayMetricsUrl: relay.metricsUrl,
    counts: counts,
    metrics: metrics,
    generatedAt: new Date().toISOString()
  };
}

module.exports = {
  countEvents: countEvents,
  scanEvents: scanEvents,
  deleteByAge: deleteByAge,
  deleteByAuthors: deleteByAuthors,
  deleteByKinds: deleteByKinds,
  deleteByEventIds: deleteByEventIds,
  deleteByFilter: deleteByFilter,
  deleteMatchingContent: deleteMatchingContent,
  getSummary: getSummary
};