import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeRequestForFetch,
  redactHeaders,
  summarizeRequest,
  validateCapturedRequest
} from '../src/request-loader.js';
import { normalizeSigninResult } from '../src/signin-runner.js';
import zuiqingfeng from '../src/stores/zuiqingfeng.js';

test('validateCapturedRequest accepts minimal request', () => {
  assert.equal(validateCapturedRequest({ url: 'https://acs.m.taobao.com/h5/foo/1.0/' }), true);
});

test('validateCapturedRequest rejects bad url', () => {
  assert.throws(() => validateCapturedRequest({ url: 'not a url' }), /valid URL/);
});

test('normalizeRequestForFetch urlencodes object body by default', () => {
  const normalized = normalizeRequestForFetch({
    method: 'POST',
    url: 'https://acs.m.taobao.com/h5/foo/1.0/',
    headers: {},
    body: { data: '{"shopId":"116576560"}' }
  });

  assert.equal(normalized.options.method, 'POST');
  assert.match(normalized.options.body, /^data=/);
  assert.equal(normalized.options.headers['content-type'], 'application/x-www-form-urlencoded;charset=UTF-8');
});

test('redactHeaders hides cookies and sign headers', () => {
  const redacted = redactHeaders({
    cookie: 'abcdefghijklmnop',
    'x-sign': '1234567890123456',
    'user-agent': 'UA'
  });

  assert.equal(redacted.cookie, 'abcd...mnop <redacted:16>');
  assert.equal(redacted['x-sign'], '1234...3456 <redacted:16>');
  assert.equal(redacted['user-agent'], 'UA');
});

test('summarizeRequest redacts sensitive headers', () => {
  const summary = summarizeRequest({
    method: 'POST',
    url: 'https://acs.m.taobao.com/h5/foo/1.0/?jsv=2.7.2',
    headers: { cookie: 'abcdefghijklmnop' },
    body: 'data=x'
  });

  assert.equal(summary.method, 'POST');
  assert.equal(summary.host, 'acs.m.taobao.com');
  assert.deepEqual(summary.queryKeys, ['jsv']);
  assert.equal(summary.headers.cookie, 'abcd...mnop <redacted:16>');
  assert.equal(summary.hasBody, true);
});

test('normalizeSigninResult detects success hints', () => {
  const result = normalizeSigninResult({
    status: 200,
    statusText: 'OK',
    headers: {},
    bodyText: '{"ret":["SUCCESS::调用成功"],"data":{"msg":"签到成功"}}',
    store: zuiqingfeng,
    summary: {}
  });

  assert.equal(result.ok, true);
  assert.equal(result.category, 'success_or_already_signed');
});

test('normalizeSigninResult detects risk control', () => {
  const result = normalizeSigninResult({
    status: 302,
    statusText: 'Found',
    headers: { location: 'https://login.taobao.com/member/login.jhtml?x5sec=abc' },
    bodyText: 'x5sec security check',
    store: zuiqingfeng,
    summary: {}
  });

  assert.equal(result.ok, false);
  assert.equal(result.category, 'risk_control');
});
