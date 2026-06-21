import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { analyzeNetworkLog } from '../src/web-capture.js';

test('analyzeNetworkLog ranks mtop shop sign request', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'web-capture-'));
  const log = path.join(tmp, 'network.jsonl');
  fs.writeFileSync(log, [
    JSON.stringify({
      type: 'request',
      id: '1',
      method: 'POST',
      url: 'https://h5api.m.taobao.com/h5/mtop.example.member.sign/1.0/',
      resourceType: 'xhr',
      postData: 'data={"shopId":"116576560","action":"sign"}'
    }),
    JSON.stringify({
      type: 'response',
      id: '1',
      status: 200,
      url: 'https://h5api.m.taobao.com/h5/mtop.example.member.sign/1.0/',
      bodyPreview: '{"ret":["SUCCESS::调用成功"]}'
    })
  ].join('\n') + '\n');

  const summary = analyzeNetworkLog(log, []);
  assert.equal(summary.totalRequests, 1);
  assert.equal(summary.totalResponses, 1);
  assert.equal(summary.candidates[0].id, '1');
  assert.ok(summary.candidates[0].score > 30);
  assert.ok(summary.candidates[0].matchedKeywords.includes('116576560'));
});
