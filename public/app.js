const summaryGrid = document.getElementById('summaryGrid');
const metricsGrid = document.getElementById('metricsGrid');
const activityLog = document.getElementById('activityLog');
const reviewForm = document.getElementById('reviewForm');
const eventsTableBody = document.getElementById('eventsTableBody');
const reviewResultMeta = document.getElementById('reviewResultMeta');
const selectAllEvents = document.getElementById('selectAllEvents');
const deleteSelectedButton = document.getElementById('deleteSelectedButton');
const confirmationBackdrop = document.getElementById('confirmationBackdrop');
const confirmationTitle = document.getElementById('confirmationTitle');
const confirmationMessage = document.getElementById('confirmationMessage');
const confirmationFoundCount = document.getElementById('confirmationFoundCount');
const confirmationDeleteCount = document.getElementById('confirmationDeleteCount');
const confirmCancelButton = document.getElementById('confirmCancelButton');
const confirmProceedButton = document.getElementById('confirmProceedButton');

let currentEvents = [];
let selectedEventIds = {};
let pendingConfirmationResolve = null;

function summarizeValue(value, depth) {
  const currentDepth = depth || 0;

  if (value == null) {
    return value;
  }

  if (typeof value === 'string') {
    return value.length > 280 ? value.slice(0, 277) + '...' : value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    if (currentDepth >= 2) {
      return '[Array(' + value.length + ')]';
    }

    return value.slice(0, 5).map(function (item) {
      return summarizeValue(item, currentDepth + 1);
    }).concat(value.length > 5 ? ['... +' + (value.length - 5) + ' more'] : []);
  }

  if (typeof value === 'object') {
    if (currentDepth >= 2) {
      return '[Object]';
    }

    return Object.keys(value).slice(0, 10).reduce(function (accumulator, key) {
      if (key === 'events' && Array.isArray(value[key])) {
        accumulator.eventCount = value[key].length;
        accumulator.eventSample = value[key].slice(0, 2).map(function (event) {
          return {
            id: event.id,
            kind: event.kind,
            pubkey: event.pubkey,
            created_at: event.created_at,
            content: summarizeContent(event.content)
          };
        });
        return accumulator;
      }

      accumulator[key] = summarizeValue(value[key], currentDepth + 1);
      return accumulator;
    }, {});
  }

  return String(value);
}

function logActivity(title, payload) {
  const timestamp = new Date().toISOString();
  const summarizedPayload = summarizeValue(payload, 0);
  const output = [
    '[' + timestamp + '] ' + title,
    JSON.stringify(summarizedPayload, null, 2)
  ].join('\n');

  activityLog.textContent = (output + '\n\n' + activityLog.textContent).slice(0, 20000);
}

async function apiRequest(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }

  return data;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function summarizeContent(content) {
  const normalized = String(content || '').replace(/\s+/g, ' ').trim();
  return normalized.length > 180 ? normalized.slice(0, 177) + '...' : normalized;
}

function unixToIso(value) {
  if (!value) {
    return '-';
  }

  return new Date(value * 1000).toISOString();
}

function formatCount(value) {
  return Number(value || 0).toLocaleString();
}

function summarizeModerationCounts(result, fallbackCount) {
  const foundCount = Number(
    result.matchedCount != null ? result.matchedCount :
    result.totalIds != null ? result.totalIds :
    result.requestedDeleteCount != null ? result.requestedDeleteCount :
    fallbackCount || 0
  );
  const deleteCount = Number(
    result.wouldDeleteCount != null ? result.wouldDeleteCount :
    result.deletedCount != null && result.deletedCount > 0 ? result.deletedCount :
    result.delete && result.delete.requestedDeleteCount != null ? result.delete.requestedDeleteCount :
    result.requestedDeleteCount != null ? result.requestedDeleteCount :
    foundCount
  );

  return {
    foundCount: foundCount,
    deleteCount: deleteCount
  };
}

function closeConfirmationDialog(answer) {
  if (pendingConfirmationResolve) {
    pendingConfirmationResolve(answer);
    pendingConfirmationResolve = null;
  }

  confirmationBackdrop.hidden = true;
  document.body.classList.remove('dialog-open');
}

function openConfirmationDialog(options) {
  confirmationTitle.textContent = options.title;
  confirmationMessage.textContent = options.message;
  confirmationFoundCount.textContent = formatCount(options.foundCount);
  confirmationDeleteCount.textContent = formatCount(options.deleteCount);
  confirmProceedButton.textContent = options.confirmLabel || 'Yes, delete';
  confirmProceedButton.disabled = !!options.disableConfirm;
  confirmCancelButton.textContent = options.cancelLabel || 'Cancel';
  confirmationBackdrop.hidden = false;
  document.body.classList.add('dialog-open');

  return new Promise(function (resolve) {
    pendingConfirmationResolve = resolve;
  });
}

function renderSummary(summary) {
  const countEntries = [
    ['Total events', summary.counts.total],
    ['Kind 0 profiles', summary.counts.profiles],
    ['Kind 1 notes', summary.counts.notes],
    ['Kind 3 contacts', summary.counts.contacts],
    ['Kind 10002 relay lists', summary.counts.relayLists],
    ['Kind 5 deletions', summary.counts.deletions],
    ['Last 24 hours', summary.counts.last24h],
    ['Last 7 days', summary.counts.last7d]
  ];

  summaryGrid.innerHTML = countEntries.map(function (entry) {
    return [
      '<article class="summary-card">',
      '<span>' + escapeHtml(entry[0]) + '</span>',
      '<strong>' + Number(entry[1] || 0).toLocaleString() + '</strong>',
      '</article>'
    ].join('');
  }).join('');

  const metrics = summary.metrics && !summary.metrics.error ? summary.metrics : { clientMessages: {}, relayMessages: {}, eventsByKind: {} };
  const metricCards = [
    ['Client messages', Object.keys(metrics.clientMessages || {}).length, JSON.stringify(metrics.clientMessages || {})],
    ['Relay messages', Object.keys(metrics.relayMessages || {}).length, JSON.stringify(metrics.relayMessages || {})],
    ['Kinds seen in metrics', Object.keys(metrics.eventsByKind || {}).length, JSON.stringify(metrics.eventsByKind || {})]
  ];

  metricsGrid.innerHTML = metricCards.map(function (entry) {
    return [
      '<article class="metric-card">',
      '<span>' + escapeHtml(entry[0]) + '</span>',
      '<strong>' + Number(entry[1] || 0).toLocaleString() + '</strong>',
      '<div class="mono">' + escapeHtml(entry[2]) + '</div>',
      '</article>'
    ].join('');
  }).join('');

  document.getElementById('relayName').textContent = summary.relayName;
  document.getElementById('relayContainer').textContent = summary.relayContainer;
}

function renderEvents(events, meta) {
  currentEvents = events.slice();
  selectedEventIds = {};
  selectAllEvents.checked = false;
  deleteSelectedButton.disabled = !events.length;
  reviewResultMeta.textContent = meta;

  if (!events.length) {
    eventsTableBody.innerHTML = '<tr><td colspan="6">No events matched the current filter.</td></tr>';
    deleteSelectedButton.disabled = true;
    return;
  }

  eventsTableBody.innerHTML = events.map(function (event) {
    return [
      '<tr>',
      '<td><input type="checkbox" data-event-id="' + escapeHtml(event.id) + '" class="event-selector"></td>',
      '<td class="mono">' + escapeHtml(unixToIso(event.created_at)) + '</td>',
      '<td><span class="pill">' + escapeHtml(event.kind) + '</span></td>',
      '<td class="author-key mono">' + escapeHtml(event.pubkey) + '</td>',
      '<td class="event-id mono">' + escapeHtml(event.id) + '</td>',
      '<td class="content-preview">' + escapeHtml(summarizeContent(event.content)) + '</td>',
      '</tr>'
    ].join('');
  }).join('');
}

function getSelectedEventIds() {
  return Object.keys(selectedEventIds).filter(function (id) {
    return selectedEventIds[id];
  });
}

function readTextareaList(value) {
  return String(value || '')
    .split(/[,\n]/)
    .map(function (item) {
      return item.trim();
    })
    .filter(Boolean);
}

function readNumberList(value) {
  return readTextareaList(value).map(function (item) {
    return Number(item);
  }).filter(function (item) {
    return Number.isInteger(item) && item >= 0;
  });
}

async function refreshHealth() {
  const health = await apiRequest('/api/health');
  document.getElementById('healthStatus').textContent = health.ok ? 'Backend connected' : 'Backend unavailable';
  document.getElementById('nodeVersion').textContent = health.nodeVersion;
}

async function refreshSummary() {
  const summary = await apiRequest('/api/summary');
  renderSummary(summary);
  logActivity('Summary refreshed', summary);
}

async function loadEvents(event) {
  if (event) {
    event.preventDefault();
  }

  const params = new URLSearchParams(new FormData(reviewForm));
  const data = await apiRequest('/api/events?' + params.toString());
  renderEvents(data.events, 'Loaded ' + data.total + ' events with filter ' + JSON.stringify(data.filter));
  logActivity('Events loaded', data);
}

async function postJson(url, payload) {
  const options = arguments[2] || {};
  const data = await apiRequest(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  logActivity(options.logTitle || ('Executed ' + url), data);

  if (options.refreshSummary !== false) {
    await refreshSummary();
  }

  return data;
}

async function runModerationRequest(options) {
  const previewPayload = Object.assign({}, options.payload, { dryRun: true });
  const previewResult = await postJson(options.url, previewPayload, {
    refreshSummary: false,
    logTitle: 'Preview ' + options.label
  });

  if (options.payload.dryRun) {
    return previewResult;
  }

  const counts = summarizeModerationCounts(previewResult, options.fallbackCount);
  const hasMatches = counts.deleteCount > 0;
  const confirmed = await openConfirmationDialog({
    title: hasMatches ? 'Confirm deletion' : 'No matching events found',
    message: hasMatches
      ? 'This action will permanently remove the matched events from the relay. Review the counts before continuing.'
      : 'The preview found no matching events, so nothing will be deleted.',
    foundCount: counts.foundCount,
    deleteCount: counts.deleteCount,
    confirmLabel: hasMatches ? 'Yes, delete' : 'Nothing to delete',
    cancelLabel: hasMatches ? 'Cancel' : 'Close',
    disableConfirm: !hasMatches
  });

  if (!confirmed || !hasMatches) {
    return previewResult;
  }

  return postJson(options.url, Object.assign({}, options.payload, { dryRun: false }), {
    logTitle: 'Executed ' + options.label
  });
}

async function handleAuthorsDelete(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  await runModerationRequest({
    url: '/api/moderation/delete-by-authors',
    label: 'delete by authors',
    payload: {
    authors: readTextareaList(formData.get('authors')),
    dryRun: formData.get('dryRun') === 'on'
    }
  });
}

async function handleKindsDelete(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  await runModerationRequest({
    url: '/api/moderation/delete-by-kinds',
    label: 'delete by kinds',
    payload: {
    kinds: readNumberList(formData.get('kinds')),
    dryRun: formData.get('dryRun') === 'on'
    }
  });
}

async function handleContentDelete(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  await runModerationRequest({
    url: '/api/moderation/delete-matching-content',
    label: 'delete matching content',
    payload: {
    query: formData.get('query'),
    kinds: readTextareaList(formData.get('kinds')).map(function (value) {
      return Number(value);
    }).filter(function (value) {
      return Number.isFinite(value);
    }),
    limit: Number(formData.get('limit')),
    useRegex: formData.get('useRegex') === 'on',
    dryRun: formData.get('dryRun') === 'on'
    }
  });
}

async function handleAgeDelete(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  await runModerationRequest({
    url: '/api/moderation/delete-by-age',
    label: 'delete by age',
    payload: {
    age: formData.get('age'),
    dryRun: formData.get('dryRun') === 'on'
    }
  });
}

async function handleFilterDelete(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  await runModerationRequest({
    url: '/api/moderation/delete-by-filter',
    label: 'delete by raw filter',
    payload: {
    filter: JSON.parse(formData.get('filter')),
    dryRun: formData.get('dryRun') === 'on'
    }
  });
}

async function handleDeleteSelected() {
  const ids = getSelectedEventIds();

  if (!ids.length) {
    return;
  }

  const result = await runModerationRequest({
    url: '/api/moderation/delete-events',
    label: 'delete selected events',
    payload: {
      ids: ids,
      dryRun: false
    },
    fallbackCount: ids.length
  });

  if (result && result.dryRun === false) {
    await loadEvents();
  }
}

function bindEventSelection() {
  eventsTableBody.addEventListener('change', function (event) {
    if (!event.target.classList.contains('event-selector')) {
      return;
    }

    selectedEventIds[event.target.getAttribute('data-event-id')] = event.target.checked;
    deleteSelectedButton.disabled = getSelectedEventIds().length === 0;
  });

  selectAllEvents.addEventListener('change', function () {
    const checked = selectAllEvents.checked;
    Array.prototype.forEach.call(document.querySelectorAll('.event-selector'), function (checkbox) {
      checkbox.checked = checked;
      selectedEventIds[checkbox.getAttribute('data-event-id')] = checked;
    });
    deleteSelectedButton.disabled = !checked;
  });
}

function wireForms() {
  reviewForm.addEventListener('submit', loadEvents);
  document.getElementById('authorsDeleteForm').addEventListener('submit', handleAuthorsDelete);
  document.getElementById('kindsDeleteForm').addEventListener('submit', handleKindsDelete);
  document.getElementById('contentDeleteForm').addEventListener('submit', handleContentDelete);
  document.getElementById('ageDeleteForm').addEventListener('submit', handleAgeDelete);
  document.getElementById('filterDeleteForm').addEventListener('submit', handleFilterDelete);
  document.getElementById('refreshSummaryButton').addEventListener('click', refreshSummary);
  deleteSelectedButton.addEventListener('click', handleDeleteSelected);
  confirmCancelButton.addEventListener('click', function () {
    closeConfirmationDialog(false);
  });
  confirmProceedButton.addEventListener('click', function () {
    if (!confirmProceedButton.disabled) {
      closeConfirmationDialog(true);
    }
  });
  confirmationBackdrop.addEventListener('click', function (event) {
    if (event.target === confirmationBackdrop) {
      closeConfirmationDialog(false);
    }
  });
}

async function bootstrap() {
  bindEventSelection();
  wireForms();

  try {
    await refreshHealth();
    await refreshSummary();
  } catch (error) {
    logActivity('Bootstrap failed', { error: error.message });
    document.getElementById('healthStatus').textContent = error.message;
  }
}

bootstrap();