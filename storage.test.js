'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { BlobPreconditionFailedError } = require('@vercel/blob');

test('registration storage retries real SDK conflicts and preserves existing records', async t => {
  process.env.BLOB_READ_WRITE_TOKEN = 'local-storage-fixture';
  process.env.ADMIN_PASSWORD = 'local-test-admin';
  const sdkPath = require.resolve('@vercel/blob');
  const originalSdk = require.cache[sdkPath];
  const objects = new Map([
    ['data/site-content.json', { text: '{}', version: 1 }],
    ['data/registrations.json', { text: '[]', version: 1 }]
  ]);
  let conflict = true;
  let failReads = false;
  let writes = 0;
  let conditionalAttempts = 0;
  const etag = object => `"revision-${object.version}"`;
  require.cache[sdkPath] = { exports: {
    BlobPreconditionFailedError,
    async get(pathname, options) {
      assert.equal(options.useCache, false, 'Mutable records must bypass the CDN');
      assert.equal(options.headers?.['Accept-Encoding'], 'identity', 'Conditional writes need the strong ETag from an uncompressed read');
      if (failReads) throw new Error('Storage unavailable');
      const object = objects.get(pathname);
      if (!object) return null;
      return { statusCode: 200, stream: new Response(object.text).body,
        blob: { contentType: 'application/json', etag: etag(object) } };
    },
    async put(pathname, text, options) {
      writes++;
      let object = objects.get(pathname);
      if (options.ifMatch) {
        conditionalAttempts++;
        if (conflict) {
          conflict = false;
          object = { text: JSON.stringify([{ id: 'existing-concurrent-registration' }]), version: object.version + 1 };
          objects.set(pathname, object);
        }
        if (etag(object) !== options.ifMatch) throw new BlobPreconditionFailedError();
      }
      if (object && options.allowOverwrite === false) throw new Error('Already exists');
      objects.set(pathname, { text, version: (object?.version || 0) + 1 });
    },
    async del() { throw new Error('Unexpected storage deletion'); }
  } };
  const { start, ensureStorage } = require('./server');
  const server = await start(0);
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    require.cache[sdkPath] = originalSdk;
  });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/registrations`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      fullName: 'Storage Test Visitor', address: 'Sipalay City test fixture', contact: '09000000000',
      visitDate: '2099-12-15', stay: '1D / 0N', groups: { adult: 1 }, paymentMethod: 'Pay at Tourism Office (Cash)'
    })
  });
  assert.equal(response.status, 201);
  assert.equal(conditionalAttempts, 2, 'A real BlobPreconditionFailedError must trigger a fresh read and retry');
  const result = await response.json();
  const records = JSON.parse(objects.get('data/registrations.json').text);
  assert.equal(records.length, 2);
  assert.equal(records[0].id, 'existing-concurrent-registration');
  assert.equal(records[1].id, result.pass.id);
  const previousWrites = writes;
  failReads = true;
  await assert.rejects(ensureStorage(), /Storage unavailable/);
  const unavailablePage = await fetch(`http://127.0.0.1:${server.address().port}/`);
  assert.equal(unavailablePage.status, 503);
  const unavailableHtml = await unavailablePage.text();
  assert.match(unavailableHtml, /Try again/);
  assert.doesNotMatch(unavailableHtml, /ecopass-hero-upload-transparent|Explore responsibly/);
  assert.equal(writes, previousWrites, 'Read failures must never initialize or overwrite data');
  failReads = false;
  objects.set('data/registrations.json', { text: 'invalid JSON', version: 5 });
  await assert.rejects(ensureStorage(), SyntaxError);
  assert.equal(writes, previousWrites, 'Corrupt data must never be replaced by an empty registration list');
});
