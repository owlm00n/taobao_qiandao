import test from 'node:test';
import assert from 'node:assert/strict';

import { candidateToCapturedRequest, extractCandidatesFromHar } from '../src/har-extract.js';

test('extractCandidatesFromHar ranks taobao mtop post request', () => {
  const har = {
    log: {
      entries: [
        {
          request: {
            method: 'GET',
            url: 'https://example.com/foo',
            headers: []
          },
          response: { status: 200, content: { text: '' } }
        },
        {
          request: {
            method: 'POST',
            url: 'https://acs.m.taobao.com/h5/mtop.example.member.sign/1.0/?jsv=2.7.2',
            headers: [{ name: 'cookie', value: 'abc' }],
            postData: { text: 'data={"shopId":"116576560"}', mimeType: 'application/x-www-form-urlencoded' }
          },
          response: { status: 200, content: { text: '{"ret":["SUCCESS::调用成功"]}' } }
        }
      ]
    }
  };

  const candidates = extractCandidatesFromHar(har);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].host, 'acs.m.taobao.com');
  assert.equal(candidates[0].method, 'POST');
});

test('candidateToCapturedRequest converts top candidate', () => {
  const captured = candidateToCapturedRequest({
    method: 'POST',
    url: 'https://acs.m.taobao.com/h5/foo/1.0/',
    headers: [{ name: 'cookie', value: 'abc' }],
    postDataText: 'data=x'
  });

  assert.equal(captured.store, 'zuiqingfeng');
  assert.equal(captured.shopId, '116576560');
  assert.equal(captured.headers.cookie, 'abc');
  assert.equal(captured.body, 'data=x');
});
