import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { extractCandidatesFromQuantumultXDir, parseRawRequestHeaders } from '../src/qx-extract.js';

test('parseRawRequestHeaders parses method and headers', () => {
  const parsed = parseRawRequestHeaders('POST /h5/foo HTTP/1.1\nHost: acs.m.taobao.com\nCookie: secret\n');
  assert.equal(parsed.method, 'POST');
  assert.equal(parsed.headers.Host, 'acs.m.taobao.com');
  assert.equal(parsed.headers.Cookie, 'secret');
});

test('extractCandidatesFromQuantumultXDir ranks target shop request', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qx-export-'));
  const entry = path.join(tmp, '1');
  fs.mkdirSync(entry);
  fs.writeFileSync(path.join(entry, 'basic'), 'https://acs.m.taobao.com/h5/mtop.example.member.sign/1.0/');
  fs.writeFileSync(path.join(entry, 'request_headers'), 'POST /h5/mtop.example.member.sign/1.0/ HTTP/1.1\nHost: acs.m.taobao.com\nCookie: abcdefghijklmnop\n');
  fs.writeFileSync(path.join(entry, 'request_body'), 'data={"shopId":"116576560","action":"sign"}');
  fs.writeFileSync(path.join(entry, 'response_body'), '{"ret":["SUCCESS::调用成功"],"msg":"签到成功"}');

  const candidates = extractCandidatesFromQuantumultXDir(tmp);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].id, '1');
  assert.ok(candidates[0].score > 50);
  assert.deepEqual(candidates[0].matchedKeywords.includes('116576560'), true);
  assert.equal(candidates[0].request.headers.Cookie, 'abcd...mnop <redacted:16>');
});
