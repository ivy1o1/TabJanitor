import test from 'node:test';
import assert from 'node:assert/strict';
import { readConfig, validateEndpoint } from '../background/ai-client.js';
import { ERROR_CODES } from '../shared/constants.js';

function expectConfigMissing(value, hint) {
  assert.throws(
    () => validateEndpoint(value),
    (error) => {
      assert.equal(error.code, ERROR_CODES.CONFIG_MISSING);
      return true;
    },
    hint || String(value),
  );
}

test('loopback endpoints are accepted on any port', () => {
  assert.equal(validateEndpoint('http://127.0.0.1:8080'), 'http://127.0.0.1:8080');
  assert.equal(validateEndpoint('http://localhost:1234'), 'http://localhost:1234');
  assert.equal(validateEndpoint('http://127.0.0.1'), 'http://127.0.0.1');
});

test('non-loopback endpoints are rejected because the model path is local-only', () => {
  for (const value of [
    'https://api.openai.com',
    'http://192.168.1.20:8080',
    'http://10.0.0.5:11434',
    'http://host.docker.internal:8080',
    'https://inference.example.com/v1',
    'http://my-lan-server:8080',
    'http://[::1]:8080',
    'http://0.0.0.0:8080',
  ]) {
    expectConfigMissing(value);
  }
});

test('the rejection message is actionable and names the allowed hosts', () => {
  assert.throws(
    () => validateEndpoint('http://192.168.1.20:8080'),
    (error) => {
      assert.equal(error.code, ERROR_CODES.CONFIG_MISSING);
      assert.match(error.message, /127\.0\.0\.1 or localhost/);
      assert.deepEqual(error.details.allowedHosts, ['127.0.0.1', 'localhost']);
      assert.equal(error.details.hostname, '192.168.1.20');
      return true;
    },
  );
});

test('malformed and unsafe endpoint values stay rejected', () => {
  expectConfigMissing('');
  expectConfigMissing(null);
  expectConfigMissing('not-a-url');
  expectConfigMissing('ftp://127.0.0.1:8080');
  expectConfigMissing('https://127.0.0.1:8080');
  expectConfigMissing('http://user:pass@127.0.0.1:8080');
  expectConfigMissing('http://127.0.0.1:8080/v1');
});

test('a remote endpoint stored in configuration is rejected before any request', async () => {
  const chromeRef = {
    storage: { local: { get: async () => ({ 'tabjanitor.config': { inferenceEndpoint: 'https://cloud.example.com' } }) } },
  };
  await assert.rejects(() => readConfig({ chromeRef }), (error) => {
    assert.equal(error.code, ERROR_CODES.CONFIG_MISSING);
    return true;
  });
});
