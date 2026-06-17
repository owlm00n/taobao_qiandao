import fs from 'node:fs';
import path from 'node:path';

const SENSITIVE_HEADER_NAMES = new Set([
  'cookie',
  'authorization',
  'x-sign',
  'x-mini-wua',
  'x-sgext',
  'x-umt',
  'x-uid'
]);

export function loadCapturedRequest(filePath) {
  if (!filePath) {
    throw new Error('Missing request file path. Use --request <path>.');
  }

  const absolutePath = path.resolve(filePath);
  const raw = fs.readFileSync(absolutePath, 'utf8');
  const request = JSON.parse(raw);
  validateCapturedRequest(request, absolutePath);
  return request;
}

export function validateCapturedRequest(request, source = '<memory>') {
  if (!request || typeof request !== 'object') {
    throw new Error(`Invalid request in ${source}: expected JSON object.`);
  }

  if (!request.url || typeof request.url !== 'string') {
    throw new Error(`Invalid request in ${source}: missing string field \"url\".`);
  }

  try {
    // eslint-disable-next-line no-new
    new URL(request.url);
  } catch (error) {
    throw new Error(`Invalid request in ${source}: url is not a valid URL.`);
  }

  const method = request.method || 'GET';
  if (typeof method !== 'string') {
    throw new Error(`Invalid request in ${source}: method must be a string.`);
  }

  if (request.headers !== undefined && (!request.headers || typeof request.headers !== 'object' || Array.isArray(request.headers))) {
    throw new Error(`Invalid request in ${source}: headers must be an object.`);
  }

  if (request.body !== undefined && typeof request.body !== 'string' && typeof request.body !== 'object') {
    throw new Error(`Invalid request in ${source}: body must be a string or object.`);
  }

  return true;
}

export function normalizeRequestForFetch(request) {
  const headers = { ...(request.headers || {}) };
  const method = (request.method || 'GET').toUpperCase();
  let body = request.body;

  if (body && typeof body === 'object') {
    const contentTypeKey = Object.keys(headers).find((key) => key.toLowerCase() === 'content-type');
    const contentType = contentTypeKey ? String(headers[contentTypeKey]).toLowerCase() : '';

    if (contentType.includes('application/json')) {
      body = JSON.stringify(body);
    } else {
      body = new URLSearchParams(body).toString();
      if (!contentTypeKey) {
        headers['content-type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
      }
    }
  }

  return {
    url: request.url,
    options: {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : body
    }
  };
}

export function redactValue(value) {
  if (value === undefined || value === null) return value;
  const text = String(value);
  if (text.length <= 12) return '<redacted>';
  return `${text.slice(0, 4)}...${text.slice(-4)} <redacted:${text.length}>`;
}

export function redactHeaders(headers = {}) {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => {
      const lower = key.toLowerCase();
      if (SENSITIVE_HEADER_NAMES.has(lower) || lower.includes('token') || lower.includes('cookie')) {
        return [key, redactValue(value)];
      }
      return [key, value];
    })
  );
}

export function summarizeRequest(request) {
  const url = new URL(request.url);
  return {
    method: (request.method || 'GET').toUpperCase(),
    host: url.host,
    pathname: url.pathname,
    queryKeys: [...url.searchParams.keys()],
    headers: redactHeaders(request.headers || {}),
    hasBody: request.body !== undefined && request.body !== null && request.body !== ''
  };
}
