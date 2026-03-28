const path = require('path');
const express = require('express');
const config = require('./config');
const relayService = require('./services/relayService');
const relayRegistry = require('./relayRegistry');

const app = express();

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

function asyncRoute(handler) {
  return function (request, response, next) {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function parseBoolean(value, fallbackValue) {
  if (value === undefined || value === null || value === '') {
    return fallbackValue;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  return String(value).toLowerCase() === 'true';
}

function parseNumberList(input) {
  if (!input) {
    return undefined;
  }

  return String(input)
    .split(',')
    .map(function (value) {
      return Number(String(value).trim());
    })
    .filter(function (value) {
      return Number.isFinite(value);
    });
}

function parseStringList(input) {
  if (!input) {
    return undefined;
  }

  return String(input)
    .split(',')
    .map(function (value) {
      return value.trim();
    })
    .filter(Boolean);
}

function buildReviewFilter(query) {
  const filter = {
    ids: parseStringList(query.ids),
    authors: parseStringList(query.authors),
    kinds: parseNumberList(query.kinds),
    since: query.since ? Number(query.since) : undefined,
    until: query.until ? Number(query.until) : undefined,
    limit: query.limit ? Number(query.limit) : config.reviewLimit
  };

  Object.keys(filter).forEach(function (key) {
    if (filter[key] === undefined || filter[key] === null || filter[key] === '') {
      delete filter[key];
    }
  });

  return filter;
}

async function resolveRelay(request) {
  const relayId = (request.query && request.query.relayId) || (request.body && request.body.relayId);
  const relay = await relayRegistry.getRelayById(relayId);

  if (!relay) {
    const error = new Error('Unknown relay selection');
    error.statusCode = 400;
    throw error;
  }

  return relay;
}

app.get('/api/relays', asyncRoute(async function (request, response) {
  const relays = await relayRegistry.listRelays();
  response.json({
    relays: relays,
    defaultRelayId: relays.length ? relays[0].id : null
  });
}));

app.get('/api/health', asyncRoute(async function (request, response) {
  const relay = await resolveRelay(request);
  response.json({
    ok: true,
    relayId: relay.id,
    relayName: relay.name,
    relayContainer: relay.container,
    relayMetricsUrl: relay.metricsUrl,
    nodeVersion: process.version
  });
}));

app.get('/api/summary', asyncRoute(async function (request, response) {
  const relay = await resolveRelay(request);
  const summary = await relayService.getSummary(relay);
  response.json(summary);
}));

app.get('/api/events', asyncRoute(async function (request, response) {
  const relay = await resolveRelay(request);
  const filter = buildReviewFilter(request.query);
  const result = await relayService.scanEvents(relay, filter, { limit: filter.limit || config.reviewLimit });
  response.json(result);
}));

app.post('/api/moderation/delete-by-authors', asyncRoute(async function (request, response) {
  const relay = await resolveRelay(request);
  const result = await relayService.deleteByAuthors(relay, request.body.authors, parseBoolean(request.body.dryRun, true));
  response.json(result);
}));

app.post('/api/moderation/delete-by-kinds', asyncRoute(async function (request, response) {
  const relay = await resolveRelay(request);
  const result = await relayService.deleteByKinds(relay, request.body.kinds || [], parseBoolean(request.body.dryRun, true));
  response.json(result);
}));

app.post('/api/moderation/delete-by-filter', asyncRoute(async function (request, response) {
  const relay = await resolveRelay(request);
  const result = await relayService.deleteByFilter(relay, request.body.filter || {}, parseBoolean(request.body.dryRun, true));
  response.json(result);
}));

app.post('/api/moderation/delete-by-age', asyncRoute(async function (request, response) {
  const relay = await resolveRelay(request);
  if (!request.body.age) {
    response.status(400).json({ error: 'age is required' });
    return;
  }

  const result = await relayService.deleteByAge(relay, String(request.body.age), parseBoolean(request.body.dryRun, true));
  response.json(result);
}));

app.post('/api/moderation/delete-events', asyncRoute(async function (request, response) {
  const relay = await resolveRelay(request);
  const result = await relayService.deleteByEventIds(relay, request.body.ids || [], parseBoolean(request.body.dryRun, true));
  response.json(result);
}));

app.post('/api/moderation/delete-matching-content', asyncRoute(async function (request, response) {
  const relay = await resolveRelay(request);
  const result = await relayService.deleteMatchingContent(relay, {
    query: request.body.query,
    useRegex: parseBoolean(request.body.useRegex, false),
    dryRun: parseBoolean(request.body.dryRun, true),
    authors: request.body.authors,
    kinds: request.body.kinds,
    since: request.body.since,
    until: request.body.until,
    limit: request.body.limit
  });

  response.json(result);
}));

app.get('*', function (request, response) {
  response.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use(function (error, request, response, next) {
  const statusCode = error.statusCode || 500;

  response.status(statusCode).json({
    error: error.message || 'Internal server error',
    command: error.command,
    details: error.stderr || error.stdout
  });
});

app.listen(config.port, function () {
  console.log('Relay dashboard listening on http://127.0.0.1:' + config.port);
});