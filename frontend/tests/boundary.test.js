/*
 * Architecture guards for the integration boundary (spec section 2).
 *
 * These are static checks over the shipped frontend sources: the rules they protect are
 * structural — no browser mutation in a component, no direct endpoint call, no sample
 * data in a production path — and a structural rule is cheapest to enforce here, where
 * breaking it fails the suite instead of the reviewer's eye.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MESSAGE_TYPES } from '../../backend/shared/constants.js';

const ROOT = resolve(fileURLToPath(import.meta.url), '../../..');
const SCRIPTS = join(ROOT, 'frontend', 'scripts');

/** Every shipped module, minus the offline design fixture, which no production path may reach. */
function productionModules(dir = SCRIPTS, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) productionModules(path, found);
    else if (entry.name.endsWith('.js') && entry.name !== 'mock-data.js') found.push(path);
  }
  return found.sort();
}

const modules = productionModules();
const source = (path) => readFileSync(path, 'utf8');
const relative = (path) => path.split(sep).join('/').replace(`${ROOT}/`, '');
const where = (matches) => matches.map((path) => relative(path)).join(', ');

test('the shipped frontend is made of the modules this project owns', () => {
  assert.ok(modules.length >= 14, `only found ${modules.length} modules`);
  assert.ok(modules.some((path) => relative(path).endsWith('scripts/source.js')));
});

test('no production module imports the sample data fixture', () => {
  const offenders = modules.filter((path) => /from\s+['"][^'"]*mock-data(\.js)?['"]/.test(source(path)));
  assert.deepEqual(offenders, [], `${where(offenders)} imports mock data`);
});

test('the page never calls the inference endpoint itself', () => {
  const offenders = modules.filter((path) => {
    const text = source(path);
    return /\bfetch\s*\(/.test(text) || /XMLHttpRequest/.test(text) || /(127\.0\.0\.1|localhost|:8080|\/v1\/)/.test(text);
  });
  assert.deepEqual(offenders, [], `${where(offenders)} reaches for the network`);
});

test('only the integration boundary talks to the service worker', () => {
  const offenders = modules
    .map((path) => ({ path, hits: /sendMessage|chrome\.runtime\./.test(source(path)) }))
    .filter((entry) => entry.hits)
    .map((entry) => entry.path);
  assert.deepEqual(offenders, [join(SCRIPTS, 'source.js')], `messaging leaked into ${where(offenders)}`);
});

test('no frontend module mutates browser tabs', () => {
  const offenders = modules.filter((path) => /chrome\.(tabs|tabGroups|windows)\b/.test(source(path)));
  assert.deepEqual(offenders, [], `${where(offenders)} touches the tab APIs`);
});

test('the frontend reuses the shared contract instead of importing backend behaviour', () => {
  const offenders = modules.filter((path) => /from\s+['"][^'"]*backend\/(background|tools)\//.test(source(path)));
  assert.deepEqual(offenders, [], `${where(offenders)} imports executable backend code`);
  const boundary = source(join(SCRIPTS, 'source.js'));
  assert.match(boundary, /from\s+['"][^'"]*backend\/shared\/constants/);
});

test('the boundary sends exactly the five documented message types', () => {
  const boundary = source(join(SCRIPTS, 'source.js'));
  assert.deepEqual(Object.keys(MESSAGE_TYPES).sort(), [
    'APPLY_ORGANIZATION',
    'GET_REVIEW_PLAN',
    'GET_STATUS',
    'SCAN_TABS',
    'UPDATE_REVIEW_PLAN',
  ]);
  for (const type of Object.keys(MESSAGE_TYPES)) {
    assert.ok(boundary.includes(`MESSAGE_TYPES.${type}`), `${type} is never sent`);
  }
});

test('the dashboard loads one module graph and no remote scripts', () => {
  const html = readFileSync(join(ROOT, 'frontend', 'dashboard.html'), 'utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((match) => match[0]);
  const remote = scripts.filter((tag) => /src=["']https?:/.test(tag));
  assert.deepEqual(remote, [], 'a remote script would break the no-remote-code property');
  assert.equal(scripts.filter((tag) => tag.includes('type="module"')).length, 1);
  assert.match(html, /<script type="module" src="\.\/scripts\/dashboard\.js">/);
});

test('the dashboard states its data source honestly', () => {
  const html = readFileSync(join(ROOT, 'frontend', 'dashboard.html'), 'utf8');
  const combined = modules.map(source).join('\n');
  assert.doesNotMatch(html, /sample data|demo data/i);
  // The word "demo" only survives where it names the offline fixture module itself.
  const offenders = modules.filter((path) => /\bdemo\b/i.test(source(path)));
  assert.deepEqual(offenders, [], `${where(offenders)} still advertises a demo`);
  assert.match(combined, /APPLY_ORGANIZATION/);
});
