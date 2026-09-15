'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('checkout requires a matching signed payment before issuing a paid pass', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ecopass-payment-test-'));
  process.env.STORAGE_ROOT = directory;
  process.env.BLOB_READ_WRITE_TOKEN = '';
  process.env.PAYMONGO_SECRET_KEY = 'sk_test_local_fixture';
  process.env.PAYMONGO_WEBHOOK_SECRET = 'local-webhook-fixture';
  const originalFetch = global.fetch;
  let nextCheckoutError = false;
  const sessions = [];
  global.fetch = async (url, options) => {
    if (String(url).startsWith('https://api.paymongo.com/')) {
      assert.equal(String(url), 'https://api.paymongo.com/v2/checkout_sessions');
      assert.equal(options.headers.Authorization, `Basic ${Buffer.from('sk_test_local_fixture:').toString('base64')}`);
      if (nextCheckoutError) {
        nextCheckoutError = false;
        return Response.json({ errors: [{ detail: 'Test checkout rejected' }] }, { status: 422 });
      }
      const attributes = JSON.parse(options.body).data.attributes;
      const id = `cs_test_${sessions.length + 1}`;
      sessions.push({ id, attributes });
      return Response.json({ data: { id, attributes: { checkout_url: `https://checkout.paymongo.com/${id}` } } });
    }
    return originalFetch(url, options);
  };
  const server = await require('./server').start(0);
  t.after(async () => {
    global.fetch = originalFetch;
    await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (route, value, headers = {}) => fetch(base + route, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value)
  });
  const registration = { fullName: 'Local Test Visitor', address: 'Sipalay City test fixture', contact: '09000000000',
    visitDate: '2099-12-15', stay: '1D / 0N', groups: { adult: 2, foreign: 0, senior: 0, child: 0 } };
  for (const [method, type] of [['GCash', 'gcash'], ['Maya', 'paymaya'], ['Credit/Debit Card', 'card']]) {
    const response = await post('/api/registrations', { ...registration, paymentMethod: method });
    assert.equal(response.status, 201);
    const result = await response.json();
    assert.equal(result.pass.paymentStatus, 'PENDING');
    assert.deepEqual(sessions.at(-1).attributes.payment_method_types, [type]);
    assert.equal(sessions.at(-1).attributes.line_items[0].amount, 10000);
    assert.equal(sessions.at(-1).attributes.reference_number, result.pass.id);
  }
  const session = sessions[0];
  const reference = session.attributes.reference_number;
  const event = { data: { id: 'evt_test_paid', attributes: { type: 'checkout_session.payment.paid', livemode: false,
    data: { id: session.id, attributes: { reference_number: reference,
      payments: [{ attributes: { status: 'paid', currency: 'PHP', amount: 10000 } }] } } } } };
  const signed = (value, secret = process.env.PAYMONGO_WEBHOOK_SECRET) => {
    const timestamp = Math.floor(Date.now() / 1000);
    const digest = crypto.createHmac('sha256', secret).update(`${timestamp}.${JSON.stringify(value)}`).digest('hex');
    return { 'paymongo-signature': `t=${timestamp},te=${digest},li=` };
  };
  const readPass = async () => (await fetch(`${base}/api/passes/${reference}`)).json();
  assert.equal((await post('/api/paymongo/webhook', event)).status, 401);
  assert.equal((await post('/api/paymongo/webhook', event, signed(event, 'wrong-secret'))).status, 401);
  assert.equal((await readPass()).paymentStatus, 'PENDING');
  const wrongAmount = structuredClone(event);
  wrongAmount.data.attributes.data.attributes.payments[0].attributes.amount = 1;
  assert.equal((await post('/api/paymongo/webhook', wrongAmount, signed(wrongAmount))).status, 200);
  assert.equal((await readPass()).paymentStatus, 'PENDING');
  const wrongSession = structuredClone(event);
  wrongSession.data.attributes.data.id = 'cs_someone_else';
  await post('/api/paymongo/webhook', wrongSession, signed(wrongSession));
  assert.equal((await readPass()).paymentStatus, 'PENDING');
  assert.equal((await post('/api/paymongo/webhook', event, signed(event))).status, 200);
  const paid = await readPass();
  assert.equal(paid.paymentStatus, 'PAID');
  assert.equal(paid.status, 'ACTIVE');
  assert.match(paid.qrDataUrl, /^data:image\/png;base64,/);
  assert.equal((await post('/api/paymongo/webhook', event, signed(event))).status, 200);
  assert.equal((await readPass()).id, reference);
  nextCheckoutError = true;
  assert.equal((await post('/api/registrations', { ...registration, paymentMethod: 'GCash' })).status, 502);
  const stored = JSON.parse(await fs.readFile(path.join(directory, 'data/registrations.json'), 'utf8'));
  assert.equal(stored.length, 4);
  assert.equal(stored.at(-1).paymentStatus, 'CHECKOUT_FAILED');
  assert.equal(stored.filter(record => record.paymentStatus === 'PAID').length, 1);
});
