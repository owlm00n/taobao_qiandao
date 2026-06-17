import { normalizeRequestForFetch, summarizeRequest } from './request-loader.js';

export async function runCapturedSignin(request, store, { dryRun = false, timeoutMs = 30000 } = {}) {
  const summary = summarizeRequest(request);

  if (store?.expectedHosts?.length && !store.expectedHosts.includes(summary.host)) {
    summary.warning = `Host ${summary.host} is not in expected host list for ${store.name}. This may still be OK if Taobao changed the endpoint.`;
  }

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      store: store?.name,
      summary
    };
  }

  const { url, options } = normalizeRequestForFetch(request);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      redirect: 'manual',
      signal: controller.signal
    });

    const text = await response.text();
    return normalizeSigninResult({
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      bodyText: text,
      store,
      summary
    });
  } finally {
    clearTimeout(timer);
  }
}

export function normalizeSigninResult({ status, statusText, headers, bodyText, store, summary }) {
  const bodyPreview = bodyText.length > 2000 ? `${bodyText.slice(0, 2000)}...<truncated:${bodyText.length}>` : bodyText;
  const lowerBody = bodyText.toLowerCase();

  let category = 'unknown';
  let message = 'Unable to determine sign-in result from response. Please inspect bodyPreview.';

  if (includesAny(bodyText, store?.successHints || [])) {
    category = 'success_or_already_signed';
    message = 'Response looks like sign-in succeeded or has already been signed.';
  } else if (includesAny(bodyText, store?.expiredHints || [])) {
    category = 'login_expired';
    message = 'Response looks like login/session token expired. Re-capture cookie/request from Taobao App.';
  } else if (includesAny(bodyText, store?.riskHints || []) || lowerBody.includes('captcha')) {
    category = 'risk_control';
    message = 'Response looks like Taobao risk control/captcha was triggered.';
  } else if (status >= 300 && status < 400) {
    category = 'redirect';
    message = 'Request was redirected. This often means login expired or risk control.';
  } else if (status >= 400) {
    category = 'http_error';
    message = `HTTP error ${status} ${statusText}.`;
  }

  return {
    ok: category === 'success_or_already_signed',
    category,
    message,
    http: {
      status,
      statusText,
      location: headers.location
    },
    store: store?.name,
    summary,
    bodyPreview
  };
}

function includesAny(text, hints) {
  return hints.some((hint) => text.includes(hint));
}
