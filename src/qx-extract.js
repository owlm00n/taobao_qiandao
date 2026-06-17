#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_KEYWORDS = [
  '116576560',
  'zuiqingfeng',
  '签到',
  'sign',
  'member',
  'vip',
  'shop',
  'mtop',
  'acs.m.taobao.com',
  'h5api.m.taobao.com'
];

const SENSITIVE_HEADER_NAMES = new Set([
  'cookie',
  'authorization',
  'x-sign',
  'x-mini-wua',
  'x-sgext',
  'x-umt',
  'x-uid'
]);

export function extractCandidatesFromQuantumultXDir(rootDir, { keywords = DEFAULT_KEYWORDS, limit = 50 } = {}) {
  const root = path.resolve(rootDir);
  const entriesRoot = findEntriesRoot(root);
  const dirs = fs.readdirSync(entriesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map((entry) => path.join(entriesRoot, entry.name));

  return dirs
    .map((dir) => parseQuantumultXEntry(dir, keywords))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || Number(a.id) - Number(b.id))
    .slice(0, limit);
}

export function parseQuantumultXEntry(dir, keywords = DEFAULT_KEYWORDS) {
  const basic = readIfExists(path.join(dir, 'basic'));
  if (!basic) return null;

  const requestHeadersRaw = readIfExists(path.join(dir, 'request_headers'));
  const requestBody = readIfExists(path.join(dir, 'request_body'));
  const responseBody = readIfExists(path.join(dir, 'response_body'));
  const responseHeadersRaw = readIfExists(path.join(dir, 'response_headers'));

  const url = basic.trim();
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    parsedUrl = null;
  }

  const { method, headers } = parseRawRequestHeaders(requestHeadersRaw);
  const haystack = `${basic}\n${requestHeadersRaw}\n${requestBody}\n${responseBody}`.toLowerCase();
  const matchedKeywords = keywords.filter((keyword) => haystack.includes(keyword.toLowerCase()));

  let score = 0;
  for (const keyword of matchedKeywords) {
    if (keyword === '116576560' || keyword === 'zuiqingfeng' || keyword === '签到') score += 30;
    else if (keyword === 'member' || keyword === 'vip' || keyword === 'sign') score += 8;
    else if (keyword === 'mtop') score += 5;
    else score += 3;
  }

  if (method === 'POST') score += 2;
  if (parsedUrl?.host === 'acs.m.taobao.com' || parsedUrl?.host === 'h5api.m.taobao.com') score += 10;
  if (parsedUrl?.pathname.includes('/h5/')) score += 4;

  return {
    id: path.basename(dir),
    score,
    method,
    url,
    host: parsedUrl?.host || '',
    pathname: parsedUrl?.pathname || '',
    matchedKeywords,
    request: {
      headers: redactHeaders(headers),
      hasBody: Boolean(requestBody),
      bodyBytes: Buffer.byteLength(requestBody),
      bodyPreview: safePreview(requestBody)
    },
    response: {
      headersPreview: safePreview(responseHeadersRaw),
      bodyBytes: Buffer.byteLength(responseBody),
      bodyPreview: safePreview(responseBody)
    }
  };
}

export function parseRawRequestHeaders(raw) {
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const first = lines[0] || '';
  const methodMatch = first.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+/i);
  const method = methodMatch ? methodMatch[1].toUpperCase() : 'GET';
  const headers = {};

  for (const line of lines.slice(methodMatch ? 1 : 0)) {
    const index = line.indexOf(':');
    if (index === -1) continue;
    const name = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    headers[name] = value;
  }

  return { method, headers };
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

function redactValue(value) {
  const text = String(value ?? '');
  if (text.length <= 12) return '<redacted>';
  return `${text.slice(0, 4)}...${text.slice(-4)} <redacted:${text.length}>`;
}

function findEntriesRoot(root) {
  if (hasNumericEntryDirs(root)) return root;

  const children = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== '__MACOSX')
    .map((entry) => path.join(root, entry.name));

  for (const child of children) {
    if (hasNumericEntryDirs(child)) return child;
  }

  throw new Error(`No Quantumult X numeric entry directories found under ${root}`);
}

function hasNumericEntryDirs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .some((entry) => entry.isDirectory() && /^\d+$/.test(entry.name));
}

function readIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

function safePreview(text, max = 300) {
  const printable = String(text || '')
    .replace(/[\x00-\x08\x0E-\x1F\x7F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return printable.length > max ? `${printable.slice(0, max)}...` : printable;
}

function main(argv) {
  const input = argv[0];
  const limit = Number(getArg(argv, '--limit') || 50);
  const minScore = Number(getArg(argv, '--min-score') || 1);

  if (!input || argv.includes('-h') || argv.includes('--help')) {
    console.log(`Usage:
  node src/qx-extract.js <quantumult-x-export-dir> [--limit 50] [--min-score 1]

The tool ranks Quantumult X exported request folders and redacts sensitive headers.
`);
    return;
  }

  const candidates = extractCandidatesFromQuantumultXDir(input, { limit })
    .filter((candidate) => candidate.score >= minScore);

  console.log(JSON.stringify(candidates, null, 2));
}

function getArg(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2));
}
