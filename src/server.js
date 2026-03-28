const path = require('path');
const express = require('express');
const config = require('./config');
const relayService = require('./services/relayService');

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

app.get('/api/health', function (request, response) {
  response.json({
    ok: true,
    relayName: config.relayName,
    relayContainer: config.relayContainer,
    nodeVersion: process.version
  });
});

app.get('/api/summary', asyncRoute(async function (request, response) {
  const summary = await relayService.getSummary();
  response.json(summary);
}));

app.get('/api/events', asyncRoute(async function (request, response) {
  const filter = buildReviewFilter(request.query);
  const result = await relayService.scanEvents(filter, { limit: filter.limit || config.reviewLimit });
  response.json(result);
}));

app.post('/api/moderation/delete-by-authors', asyncRoute(async function (request, response) {
  const result = await relayService.deleteByAuthors(request.body.authors, parseBoolean(request.body.dryRun, true));
  response.json(result);
}));

app.post('/api/moderation/delete-by-filter', asyncRoute(async function (request, response) {
  const result = await relayService.deleteByFilter(request.body.filter || {}, parseBoolean(request.body.dryRun, true));
  response.json(result);
}));

app.post('/api/moderation/delete-by-age', asyncRoute(async function (request, response) {
  if (!request.body.age) {
    response.status(400).json({ error: 'age is required' });
    return;
  }

  const result = await relayService.deleteByAge(String(request.body.age), parseBoolean(request.body.dryRun, true));
  response.json(result);
}));

app.post('/api/moderation/delete-events', asyncRoute(async function (request, response) {
  const result = await relayService.deleteByEventIds(request.body.ids || [], parseBoolean(request.body.dryRun, true));
  response.json(result);
}));

app.post('/api/moderation/delete-matching-content', asyncRoute(async function (request, response) {
  const result = await relayService.deleteMatchingContent({
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