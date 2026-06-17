#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_HOST_KEYWORDS = ['taobao.com', 'tmall.com'];
const DEFAULT_PATH_KEYWORDS = ['sign', 'member', 'vip', 'mission', 'benefit', 'point', 'task', 'mtop'];

export function extractCandidatesFromHar(har, {
  hostKeywords = DEFAULT_HOST_KEYWORDS,
  pathKeywords = DEFAULT_PATH_KEYWORDS,
  limit = 20
} = {}) {
  const entries = har?.log?.entries;
  if (!Array.isArray(entries)) {
    throw new Error('Invalid HAR: missing log.entries array.');
  }

  return entries
    .map((entry) => toCandidate(entry))
    .filter(Boolean)
    .map((candidate) => ({ ...candidate, score: scoreCandidate(candidate, hostKeywords, pathKeywords) }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function candidateToCapturedRequest(candidate) {
  return {
    name: 'zuiqingfeng sign-in request extracted from HAR; please verify before use',
    store: 'zuiqingfeng',
    shopId: '116576560',
    capturedAt: new Date().toISOString(),
    method: candidate.method,
    url: candidate.url,
    headers: Object.fromEntries(candidate.headers.map(({ name, value }) => [name, value])),
    body: candidate.postDataText || undefined
  };
}

function toCandidate(entry) {
  const request = entry?.request;
  if (!request?.url) return null;

  let parsed;
  try {
    parsed = new URL(request.url);
  } catch {
    return null;
  }

  return {
    method: request.method || 'GET',
    url: request.url,
    host: parsed.host,
    pathname: parsed.pathname,
    query: parsed.search,
    headers: Array.isArray(request.headers) ? request.headers : [],
    postDataText: request.postData?.text || '',
    mimeType: request.postData?.mimeType || '',
    responseStatus: entry.response?.status,
    responsePreview: entry.response?.content?.text?.slice?.(0, 500) || ''
  };
}

function scoreCandidate(candidate, hostKeywords, pathKeywords) {
  const haystack = `${candidate.host} ${candidate.pathname} ${candidate.query} ${candidate.postDataText} ${candidate.responsePreview}`.toLowerCase();
  let score = 0;

  for (const keyword of hostKeywords) {
    if (haystack.includes(keyword.toLowerCase())) score += 10;
  }
  for (const keyword of pathKeywords) {
    if (haystack.includes(keyword.toLowerCase())) score += 3;
  }
  if (candidate.method.toUpperCase() === 'POST') score += 2;
  if (candidate.host === 'acs.m.taobao.com' || candidate.host === 'h5api.m.taobao.com') score += 8;
  if (candidate.pathname.includes('/h5/')) score += 4;
  if (candidate.postDataText.includes('116576560') || candidate.url.includes('116576560')) score += 20;

  return score;
}

function main(argv) {
  const input = argv[0];
  const output = getArg(argv, '--output');
  const limit = Number(getArg(argv, '--limit') || 20);

  if (!input || argv.includes('-h') || argv.includes('--help')) {
    console.log(`Usage:
  node src/har-extract.js <capture.har> [--output config/zuiqingfeng.request.json] [--limit 20]

The tool prints ranked Taobao/Tmall request candidates. With --output, it writes the top candidate as captured request JSON.
`);
    return;
  }

  const har = JSON.parse(fs.readFileSync(input, 'utf8'));
  const candidates = extractCandidatesFromHar(har, { limit });

  console.log(JSON.stringify(candidates.map((candidate, index) => ({
    index,
    score: candidate.score,
    method: candidate.method,
    host: candidate.host,
    pathname: candidate.pathname,
    responseStatus: candidate.responseStatus,
    hasBody: Boolean(candidate.postDataText)
  })), null, 2));

  if (output) {
    if (!candidates.length) {
      throw new Error('No candidate request found; cannot write output.');
    }
    const capturedRequest = candidateToCapturedRequest(candidates[0]);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(capturedRequest, null, 2)}\n`);
    console.error(`Wrote top candidate to ${output}`);
  }
}

function getArg(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2));
}
