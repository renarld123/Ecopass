'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const QRCode = require('qrcode');
const { put: putBlob, get: getBlob, del: delBlob, BlobPreconditionFailedError } = require('@vercel/blob');
const defaults = require('./site-defaults');
const { renderLanding } = require('./landing-renderer');
const { createOperations } = require('./operations');

const ROOT = __dirname;
const envFile = path.join(ROOT, '.env');
try {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch {}
const IS_VERCEL = Boolean(process.env.VERCEL);
const USE_BLOB = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
const STORAGE_ROOT = process.env.STORAGE_ROOT
  ? path.resolve(process.env.STORAGE_ROOT)
  : (IS_VERCEL ? path.join('/tmp', 'ecopass') : ROOT);
const DATA_DIR = path.join(STORAGE_ROOT, 'data');
const CONTENT_FILE = path.join(DATA_DIR, 'site-content.json');
const UPLOAD_DIR = path.join(STORAGE_ROOT, 'uploads');
const REGISTRATION_FILE = path.join(DATA_DIR, 'registrations.json');
const PRIVATE_ID_DIR = path.join(DATA_DIR, 'registration-ids');
const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.createHash('sha256').update(`${ROOT}:ecopass-local`).digest('hex');
const PAYMONGO_SECRET_KEY = process.env.PAYMONGO_SECRET_KEY || '';
const PAYMONGO_WEBHOOK_SECRET = process.env.PAYMONGO_WEBHOOK_SECRET || '';
const PAYMONGO_MODE = PAYMONGO_SECRET_KEY.startsWith('sk_live_') ? 'live' : 'test';
const MAX_BODY = 6 * 1024 * 1024;
const SESSION_TTL = 8 * 60 * 60 * 1000;
const loginAttempts = new Map();
const registrationAttempts = new Map();
let registrationWriteQueue = Promise.resolve();
const operations = createOperations({useBlob:USE_BLOB,dataDir:DATA_DIR,readBlob,putBlob,ConflictError:BlobPreconditionFailedError,readRegistrations});

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml'
};
const IMAGE_TYPES = new Map([['image/jpeg', '.jpg'], ['image/png', '.png'], ['image/webp', '.webp'], ['image/gif', '.gif']]);
const PRIVATE_ID_TYPES = new Map([...IMAGE_TYPES, ['application/pdf', '.pdf']]);
const IMAGE_SLOTS = new Set(['brand.logoImage', 'brand.faviconImage', 'hero.backgroundImage', 'hero.image', 'hero.benefits.0.iconImage', 'hero.benefits.1.iconImage', 'hero.benefits.2.iconImage', 'how.backgroundImage', 'how.phoneImage', 'how.leavesImage', 'how.steps.0.iconImage', 'how.steps.1.iconImage', 'how.steps.2.iconImage', 'destinations.items.0.image', 'destinations.items.1.image', 'destinations.items.2.image', 'impact.backgroundImage', 'impact.emblemImage', 'impact.leavesImage', 'journey.image', 'stories.items.0.avatarImage', 'stories.items.1.avatarImage', 'stories.items.2.avatarImage', 'cta.backgroundImage', 'cta.phoneImage', 'cta.leavesImage']);

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function merge(base, input) {
  if (Array.isArray(base)) return base.map((item, index) => merge(item, Array.isArray(input) ? input[index] : undefined));
  if (base && typeof base === 'object') {
    const out = {};
    for (const key of Object.keys(base)) out[key] = merge(base[key], input && typeof input === 'object' ? input[key] : undefined);
    return out;
  }
  return typeof input === typeof base ? input : base;
}
function cleanText(value, max = 500) { return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max); }
function sanitizeContent(input) {
  const result = merge(clone(defaults), input || {});
  if (result.registration.paymentMethods[2] === 'Bank Transfer') result.registration.paymentMethods[2] = 'Credit/Debit Card';
  if (result.registration.successTitle === 'Registration Successful!') result.registration.successTitle = 'Registration Saved';
  if (result.registration.successDescription === 'Your verified EcoPass is ready. Keep it handy for a smooth arrival and complete payment through your selected method.') result.registration.successDescription = 'A verified QR pass will be issued after payment is confirmed.';
  const walk = value => {
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, walk(child)]));
    return typeof value === 'string' ? cleanText(value, 700) : value;
  };
  return walk(result);
}
async function ensureStorage() {
  if (USE_BLOB) {
    for (const [pathname, initial] of [['data/site-content.json', { ...clone(defaults), updatedAt: new Date().toISOString() }], ['data/registrations.json', []]]) {
      if ((await readBlobJson(pathname)) === null) {
        try {
          await putBlob(pathname, JSON.stringify(initial), { access: 'private', addRandomSuffix: false, allowOverwrite: false, contentType: 'application/json' });
        } catch (error) {
          // A concurrent cold start may have created the file. Never overwrite existing data.
          if ((await readBlobJson(pathname)) === null) throw error;
        }
      }
    }
    return;
  }
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.mkdir(UPLOAD_DIR, { recursive: true });
  await fsp.mkdir(PRIVATE_ID_DIR, { recursive: true });
  try { await fsp.access(CONTENT_FILE); } catch { await writeContent({ ...clone(defaults), updatedAt: new Date().toISOString() }); }
  try { await fsp.access(REGISTRATION_FILE); } catch { await fsp.writeFile(REGISTRATION_FILE, '[]\n', { flag: 'wx' }).catch(() => {}); }
}
async function readBlob(pathname) {
  // Registrations are mutable records: CDN-cached content can carry an obsolete ETag.
  // Compression can change a strong ETag into W/"...", which If-Match rejects.
  // Request the original representation so data and its strong version tag stay paired.
  const result = await getBlob(pathname, { access: 'private', useCache: false, headers: { 'Accept-Encoding': 'identity' } });
  if (!result || result.statusCode !== 200) return null;
  const chunks = [];
  for await (const chunk of result.stream) chunks.push(Buffer.from(chunk));
  return { buffer: Buffer.concat(chunks), contentType: result.blob.contentType, etag: result.blob.etag };
}
async function readBlobJson(pathname) {
  const value = await readBlob(pathname);
  return value ? JSON.parse(value.buffer.toString('utf8')) : null;
}
async function writeBlobJson(pathname, value) {
  await putBlob(pathname, JSON.stringify(value, null, 2), { access: 'private', allowOverwrite: true, contentType: 'application/json' });
}
async function readContent() {
  const content = USE_BLOB ? await readBlobJson('data/site-content.json') : JSON.parse(await fsp.readFile(CONTENT_FILE, 'utf8'));
  if (!content) throw new Error('Saved site content is unavailable');
  return sanitizeContent(content);
}
async function writeContent(content) {
  const next = sanitizeContent(content);
  next.updatedAt = new Date().toISOString();
  if (USE_BLOB) { await writeBlobJson('data/site-content.json', next); return next; }
  const temp = `${CONTENT_FILE}.${process.pid}.tmp`;
  await fsp.writeFile(temp, JSON.stringify(next, null, 2), 'utf8');
  await fsp.rename(temp, CONTENT_FILE);
  return next;
}
function json(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}
function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map(v => v.trim().split('=')).filter(v => v.length === 2));
}
function sign(value) { return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('base64url'); }
function makeSession() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_TTL, nonce: crypto.randomBytes(10).toString('hex') })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}
function authenticated(req) {
  const token = cookies(req).ecopass_admin;
  if (!token) return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;
  const expected = sign(payload);
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > Date.now(); } catch { return false; }
}
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  return origin === `http://${req.headers.host}` || origin === `https://${req.headers.host}`;
}
async function body(req, limit = MAX_BODY) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw Object.assign(new Error('Request is too large'), { status: 413 }); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
async function jsonBody(req) {
  const raw = await body(req, 1024 * 1024);
  try { return JSON.parse(raw.toString('utf8') || '{}'); } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}
function setPath(object, slot, value) {
  const parts = slot.split('.'); let cursor = object;
  for (let i = 0; i < parts.length - 1; i++) cursor = cursor[Number.isInteger(Number(parts[i])) ? Number(parts[i]) : parts[i]];
  cursor[parts.at(-1)] = value;
}
function clientKey(req) { return req.socket.remoteAddress || 'unknown'; }
function loginAllowed(req) {
  const key = clientKey(req), now = Date.now(), recent = (loginAttempts.get(key) || []).filter(t => now - t < 10 * 60 * 1000);
  loginAttempts.set(key, recent); return recent.length < 8;
}
function recordFailure(req) { const key = clientKey(req); loginAttempts.set(key, [...(loginAttempts.get(key) || []), Date.now()]); }
function safeEqual(a, b) {
  const left = crypto.createHash('sha256').update(String(a)).digest();
  const right = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(left, right);
}
function matchesImageType(buffer, type) {
  if (type === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (type === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (type === 'image/gif') return ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'));
  if (type === 'image/webp') return buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  return false;
}
function matchesPrivateIdType(buffer, type) {
  if (type === 'application/pdf') return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  return matchesImageType(buffer, type);
}
function registrationAllowed(req) {
  const key = clientKey(req), now = Date.now(), recent = (registrationAttempts.get(key) || []).filter(time => now - time < 60 * 60 * 1000);
  registrationAttempts.set(key, recent); return recent.length < 20;
}
function recordRegistrationAttempt(req) { const key = clientKey(req); registrationAttempts.set(key, [...(registrationAttempts.get(key) || []), Date.now()]); }
function signIdUpload(payload) { return `${payload}.${sign(`registration-id:${payload}`)}`; }
function verifyIdUpload(token) {
  const [payload, signature] = String(token || '').split('.'); if (!payload || !signature) return null;
  const expected = sign(`registration-id:${payload}`); if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try { const value = JSON.parse(Buffer.from(payload, 'base64url').toString()); return value.exp > Date.now() && /^[a-f0-9-]+\.(?:jpg|png|webp|gif|pdf)$/.test(value.file) ? value : null; } catch { return null; }
}
async function readRegistrations() {
  const value = USE_BLOB ? await readBlobJson('data/registrations.json') : JSON.parse(await fsp.readFile(REGISTRATION_FILE, 'utf8'));
  if (!Array.isArray(value)) throw new Error('Registration storage is missing or invalid');
  return value;
}
async function mutateRegistrations(mutate) {
  if (USE_BLOB) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const stored = await readBlob('data/registrations.json');
      if (!stored?.etag) throw new Error('Registration storage ETag is unavailable');
      const records = JSON.parse(stored.buffer.toString('utf8'));
      if (!Array.isArray(records)) throw new Error('Registration storage is invalid');
      const result = mutate(records);
      try {
        await putBlob('data/registrations.json', JSON.stringify(records, null, 2), { access: 'private', allowOverwrite: true, ifMatch: stored.etag, contentType: 'application/json' });
        return result;
      } catch (error) {
        if (!(error instanceof BlobPreconditionFailedError) || attempt === 7) throw error;
        await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1) + Math.floor(Math.random() * 25)));
      }
    }
  }
  const records = await readRegistrations();
  const result = mutate(records);
  const temp = `${REGISTRATION_FILE}.${process.pid}.tmp`;
  await fsp.writeFile(temp, JSON.stringify(records, null, 2));
  await fsp.rename(temp, REGISTRATION_FILE);
  return result;
}
async function appendRegistration(record) {
  registrationWriteQueue = registrationWriteQueue.catch(() => {}).then(() => mutateRegistrations(records => records.push(record)));
  await registrationWriteQueue;
}
async function updateRegistration(id, apply) {
  registrationWriteQueue = registrationWriteQueue.catch(() => {}).then(() => mutateRegistrations(records => {
    const index = records.findIndex(item => item.id === id);
    if (index < 0) return null;
    records[index] = apply(records[index]);
    return records[index];
  }));
  return registrationWriteQueue;
}
function paymentType(method) { return { GCash: 'gcash', Maya: 'paymaya', 'Credit/Debit Card': 'card' }[method] || null; }
async function paymongoRequest(route, payload) {
  const response = await fetch(`https://api.paymongo.com${route}`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${PAYMONGO_SECRET_KEY}:`).toString('base64')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(result.errors?.[0]?.detail || 'PayMongo checkout could not be created. Please choose another payment option.'), { status: 502 });
  return result;
}
function verifyPaymongoSignature(raw, header, livemode) {
  if (!PAYMONGO_WEBHOOK_SECRET || !header) return false;
  const parts = Object.fromEntries(header.split(',').map(part => part.trim().split('=')).filter(part => part.length === 2));
  if (!/^\d{10}$/.test(parts.t || '') || Math.abs(Date.now() / 1000 - Number(parts.t)) > 5 * 60) return false;
  const sent = livemode ? parts.li : parts.te;
  if (!/^[a-f0-9]{64}$/i.test(sent || '')) return false;
  const expected = crypto.createHmac('sha256', PAYMONGO_WEBHOOK_SECRET).update(`${parts.t}.${raw.toString('utf8')}`).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(sent, 'hex'), Buffer.from(expected, 'hex'));
}
function cleanRegistration(input) {
  const counts = Object.fromEntries(['adult', 'foreign', 'senior', 'child'].map(key => [key, Math.max(0, Math.min(50, Number.parseInt(input?.groups?.[key], 10) || 0))]));
  const stays = ['1D / 0N','2D / 1N','3D / 2N','4D / 3N','5D / 4N','6D / 5N','7D / 6N'];
  const methods = ['GCash','Maya','Credit/Debit Card','Pay at Tourism Office (Cash)','Physical Payment'];
  const date = String(input?.visitDate || ''); const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : null;
  const today = new Date(); today.setUTCHours(0,0,0,0);
  const value = { fullName: cleanText(input?.fullName, 100), address: cleanText(input?.address, 180), contact: cleanText(input?.contact, 30), visitDate: date, stay: stays.includes(input?.stay) ? input.stay : '', groups: counts, paymentMethod: methods.includes(input?.paymentMethod) ? input.paymentMethod : '', idToken: cleanText(input?.idToken, 1000) };
  if (value.fullName.length < 2 || value.address.length < 5 || !/^[+\d][\d\s()-]{6,29}$/.test(value.contact) || !parsedDate || parsedDate < today || !value.stay || !value.paymentMethod || counts.adult + counts.foreign + counts.senior === 0) throw Object.assign(new Error('Please provide complete and valid registration details, including at least one paying or discounted visitor.'), { status: 400 });
  const idUpload = counts.senior > 0 ? verifyIdUpload(value.idToken) : null; if (counts.senior > 0 && !idUpload) throw Object.assign(new Error('A valid ID upload is required for discounted visitors.'), { status: 400 });
  const amount = counts.adult * 50 + counts.foreign * 100 + counts.senior * 25;
  const days = Number.parseInt(value.stay, 10); const validUntil = new Date(parsedDate); validUntil.setUTCDate(validUntil.getUTCDate() + days - 1);
  return { ...value, idFile: idUpload?.file || null, amount, validUntil: validUntil.toISOString().slice(0, 10) };
}
function passIssued(record) { return record.paymentStatus === 'PAID' && record.status === 'ACTIVE'; }
function publicPass(record) { return { id: record.id, fullName: record.fullName, visitDate: record.visitDate, stay: record.stay, validUntil: record.validUntil, groups: record.groups, amount: record.amount, paymentMethod: record.paymentMethod, paymentStatus: record.paymentStatus, paymentSource: record.paymentSource || null, passIssued: passIssued(record), status: record.status, createdAt: record.createdAt }; }
async function passPayload(record, origin) {
  const pass = publicPass(record);
  if (!pass.passIssued) return { ...pass, verifyUrl: null, qrDataUrl: null };
  const verifyUrl = `${origin}/verify/${encodeURIComponent(record.id)}`;
  const qrDataUrl = await QRCode.toDataURL(verifyUrl, { width: 300, margin: 2, color: { dark: '#075d34', light: '#ffffff' }, errorCorrectionLevel: 'M' });
  return { ...pass, verifyUrl, qrDataUrl };
}
function html(res, status, markup) { res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(markup), 'Cache-Control': 'no-store' }); res.end(markup); }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character]); }
function verificationPage(record) {
  if (!record) return '<!doctype html><meta name="viewport" content="width=device-width"><title>EcoPass not found</title><style>body{font:16px Arial;display:grid;place-items:center;min-height:100vh;margin:0;background:#f5f1e8;color:#173b28}.card{max-width:420px;padding:32px;border-radius:22px;background:#fff;text-align:center;box-shadow:0 20px 50px #0002}a{color:#075d34}</style><main class="card"><h1>Pass not found</h1><p>This EcoPass ID could not be verified.</p><a href="/">Return to EcoPass</a></main>';
  if (!passIssued(record)) return '<!doctype html><meta name="viewport" content="width=device-width"><title>EcoPass payment pending</title><style>body{font:16px Arial;display:grid;place-items:center;min-height:100vh;margin:0;background:#f5f1e8;color:#173b28}.card{max-width:420px;padding:32px;border-radius:22px;background:#fff;text-align:center;box-shadow:0 20px 50px #0002}a{color:#075d34}</style><main class="card"><h1>Payment not confirmed</h1><p>This registration is saved, but it is not a verified EcoPass yet.</p><a href="/">Return to EcoPass</a></main>';
  const pass = publicPass(record); const message = record.paymentSource === 'tourism-office' ? 'Payment confirmed at the tourism office' : 'Payment confirmed by PayMongo'; return `<!doctype html><meta name="viewport" content="width=device-width"><title>EcoPass ${escapeHtml(pass.id)}</title><style>body{font:15px Arial;display:grid;place-items:center;min-height:100vh;margin:0;padding:20px;background:#f5f1e8;color:#173b28}.card{width:min(430px,100%);box-sizing:border-box;padding:30px;border-radius:24px;background:#fff;box-shadow:0 20px 55px #0002}.check{display:grid;width:58px;height:58px;margin:auto;border-radius:50%;background:#e5f5e8;color:#075d34;font-size:30px;place-items:center}h1{text-align:center;color:#075d34}.status{text-align:center;color:#4f6659}.row{display:flex;justify-content:space-between;gap:15px;padding:10px 0;border-bottom:1px solid #eee}.row span{color:#77877e}.notice{margin-top:18px;padding:11px;border-radius:10px;background:#fff5d9;color:#745b19;font-size:12px;text-align:center}a{display:block;margin-top:20px;color:#075d34;text-align:center}</style><main class="card"><div class="check">✓</div><h1>Verified EcoPass</h1><p class="status">${escapeHtml(message)}</p><div class="row"><span>Pass ID</span><b>${escapeHtml(pass.id)}</b></div><div class="row"><span>Visitor</span><b>${escapeHtml(pass.fullName)}</b></div><div class="row"><span>Visit date</span><b>${escapeHtml(pass.visitDate)}</b></div><div class="row"><span>Valid until</span><b>${escapeHtml(pass.validUntil)}</b></div><div class="row"><span>Amount</span><b>₱${pass.amount.toFixed(2)}</b></div><div class="notice">${escapeHtml(message)}. Present this QR pass upon arrival.</div><a href="/">Return to EcoPass</a></main>`; }
async function serveFile(res, file, cache = false) {
  try {
    const stat = await fsp.stat(file); if (!stat.isFile()) throw new Error('Not file');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': stat.size, 'Cache-Control': cache ? 'public, max-age=31536000, immutable' : 'no-cache' });
    fs.createReadStream(file).pipe(res);
  } catch { json(res, 404, { error: 'Not found' }); }
}
async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let stage = 'request';
  try {
    if (['/', '/ecopass.html'].includes(url.pathname) && ['GET', 'HEAD'].includes(req.method)) {
      stage = 'landing-content';
      try {
        const [template, content] = await Promise.all([fsp.readFile(path.join(ROOT, 'ecopass.html'), 'utf8'), readContent()]);
        const protocol = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted ? 'https' : 'http';
        const html = renderLanding(template, content, `${protocol}://${req.headers.host}`);
        res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(html) });
        return res.end(req.method === 'HEAD' ? undefined : html);
      } catch {
        const html = '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>EcoPass</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f0e6;color:#075d34;font:16px system-ui}.message{max-width:420px;margin:24px;padding:32px;border-radius:24px;background:white}a{display:inline-block;padding:12px 20px;border-radius:10px;background:#ffb900;color:#173126;text-decoration:none;font-weight:700}</style><main class="message"><h1>We’ll be right back.</h1><p>We couldn’t load EcoPass just now. Please try again in a moment.</p><a href="/">Try again</a></main></html>';
        res.writeHead(503, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store', 'Retry-After': '5' });
        return res.end(req.method === 'HEAD' ? undefined : html);
      }
    }
    if (url.pathname === '/api/payment-config' && req.method === 'GET') return json(res, 200, { paymongoAvailable: Boolean(PAYMONGO_SECRET_KEY && PAYMONGO_WEBHOOK_SECRET), mode: PAYMONGO_MODE });
    if (url.pathname === '/api/paymongo/webhook' && req.method === 'POST') {
      const raw = await body(req, 1024 * 1024);
      let event;
      try { event = JSON.parse(raw.toString('utf8')); } catch { return json(res, 400, { error: 'Invalid webhook payload' }); }
      const payload = event?.data?.attributes || event?.data || {};
      const livemode = Boolean(payload.livemode);
      if (livemode !== (PAYMONGO_MODE === 'live') || !verifyPaymongoSignature(raw, String(req.headers['paymongo-signature'] || ''), livemode)) return json(res, 401, { error: 'Invalid webhook signature' });
      if (payload.type !== 'checkout_session.payment.paid') return json(res, 200, { received: true });
      const session = payload.data;
      const reference = session?.attributes?.reference_number;
      const records = await readRegistrations();
      const record = records.find(item => item.id === reference);
      const paidPayment = session?.attributes?.payments?.find(item => item?.attributes?.status === 'paid' && item?.attributes?.currency === 'PHP' && Number(item?.attributes?.amount) === record?.amount * 100);
      if (!record || record.checkoutSessionId !== session.id || !paidPayment) return json(res, 200, { received: true });
      await updateRegistration(reference, current => current.paymentStatus === 'PAID' ? current : { ...current, paymentStatus: 'PAID', paymentSource: 'paymongo', status: 'ACTIVE', paidAt: new Date().toISOString(), paymongoEventId: event?.data?.id || null });
      return json(res, 200, { received: true });
    }
    if (url.pathname === '/api/content' && req.method === 'GET') return json(res, 200, await readContent());
    if (url.pathname === '/api/booths' && req.method === 'GET') return json(res, 200, {booths:await operations.publicBooths()});
    if (url.pathname === '/health' && req.method === 'GET') return json(res, 200, {
      status: 'ok',
      adminConfigured: Boolean(ADMIN_PASSWORD),
      storage: USE_BLOB ? 'vercel-blob' : 'filesystem',
      persistentStorage: USE_BLOB || !IS_VERCEL
    });
    if (url.pathname === '/api/registration-id' && req.method === 'POST') {
      if (!sameOrigin(req)) return json(res, 403, { error: 'Invalid request origin' });
      if (!registrationAllowed(req)) return json(res, 429, { error: 'Too many registration attempts. Please try again later.' });
      const type = String(req.headers['content-type'] || '').split(';')[0]; if (!PRIVATE_ID_TYPES.has(type)) return json(res, 415, { error: 'Use a JPG, PNG, WebP, GIF, or PDF identification file.' });
      const file = await body(req, 5 * 1024 * 1024); if (file.length < 16 || !matchesPrivateIdType(file, type)) return json(res, 415, { error: 'The identification file is empty or invalid.' });
      const filename = `${crypto.randomUUID()}${PRIVATE_ID_TYPES.get(type)}`;
      if (USE_BLOB) await putBlob(`registration-ids/${filename}`, file, { access: 'private', addRandomSuffix: false, contentType: type });
      else await fsp.writeFile(path.join(PRIVATE_ID_DIR, filename), file, { flag: 'wx' });
      const payload = Buffer.from(JSON.stringify({ file: filename, exp: Date.now() + 60 * 60 * 1000 })).toString('base64url');
      return json(res, 201, { token: signIdUpload(payload) });
    }
    if (url.pathname === '/api/registrations' && req.method === 'POST') {
      stage = 'registration-validation';
      if (!sameOrigin(req)) return json(res, 403, { error: 'Invalid request origin' });
      if (!registrationAllowed(req)) return json(res, 429, { error: 'Too many registration attempts. Please try again later.' });
      const input = cleanRegistration(await jsonBody(req)); recordRegistrationAttempt(req);
      const methodType = paymentType(input.paymentMethod);
      if (methodType && (!PAYMONGO_SECRET_KEY || !PAYMONGO_WEBHOOK_SECRET)) return json(res, 503, { error: 'Online checkout is not available yet. Choose payment at the tourism office or try again later.' });
      const record = { ...input, id: `ECP-${input.visitDate.replaceAll('-', '')}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`, paymentStatus: methodType ? 'PENDING' : 'PAY_AT_OFFICE', status: 'PENDING_PAYMENT', createdAt: new Date().toISOString() };
      delete record.idToken;
      stage = 'registration-storage';
      await appendRegistration(record);
      const protocol = String(req.headers['x-forwarded-proto'] || '').split(',')[0] || 'http'; const origin = `${protocol}://${req.headers.host}`;
      if (methodType) {
        try {
        stage = 'paymongo-checkout';
        const result = await paymongoRequest('/v2/checkout_sessions', { data: { attributes: {
          line_items: [{ name: 'EcoPass Environmental User Fee', amount: record.amount * 100, currency: 'PHP', quantity: 1 }],
          payment_method_types: [methodType],
          success_url: `${origin}/?payment=return&pass=${encodeURIComponent(record.id)}`,
          cancel_url: `${origin}/?payment=cancel&pass=${encodeURIComponent(record.id)}`,
          reference_number: record.id,
          description: `EcoPass visit on ${record.visitDate}`
        } } });
        const session = result.data;
        if (!session?.id || !/^https:\/\/checkout\.paymongo\.com\//.test(session?.attributes?.checkout_url || '')) throw Object.assign(new Error('PayMongo did not provide a valid checkout link.'), { status: 502 });
        stage = 'checkout-storage';
        await updateRegistration(record.id, current => ({ ...current, checkoutSessionId: session.id, checkoutMode: PAYMONGO_MODE }));
        return json(res, 201, { pass: publicPass(record), checkoutUrl: session.attributes.checkout_url });
        } catch (error) {
          await updateRegistration(record.id, current => ({ ...current, paymentStatus: 'CHECKOUT_FAILED' })).catch(() => {});
          throw error;
        }
      }
      return json(res, 201, { pass: publicPass(record), verifyUrl: null, qrDataUrl: null });
    }
    if (url.pathname.startsWith('/api/passes/') && req.method === 'GET') {
      const id = decodeURIComponent(url.pathname.slice('/api/passes/'.length)); const record = (await readRegistrations()).find(item => item.id === id);
      if (!record) return json(res, 404, { error: 'Pass not found' });
      const protocol = String(req.headers['x-forwarded-proto'] || '').split(',')[0] || 'http'; const origin = `${protocol}://${req.headers.host}`;
      return json(res, 200, await passPayload(record, origin));
    }
    if (url.pathname.startsWith('/verify/') && req.method === 'GET') {
      const id = decodeURIComponent(url.pathname.slice('/verify/'.length)); const record = (await readRegistrations()).find(item => item.id === id); return html(res, !record ? 404 : passIssued(record) ? 200 : 403, verificationPage(record));
    }
    if (url.pathname === '/api/admin/session' && req.method === 'GET') return json(res, 200, { authenticated: authenticated(req) });
    if (url.pathname === '/api/admin/login' && req.method === 'POST') {
      if (!sameOrigin(req)) return json(res, 403, { error: 'Invalid request origin' });
      if (!ADMIN_PASSWORD) return json(res, 503, { error: 'Admin access is locked until ADMIN_PASSWORD is configured on the server.' });
      if (!loginAllowed(req)) return json(res, 429, { error: 'Too many attempts. Try again later.' });
      const input = await jsonBody(req);
      if (!safeEqual(input.password, ADMIN_PASSWORD)) { recordFailure(req); return json(res, 401, { error: 'Incorrect password' }); }
      loginAttempts.delete(clientKey(req));
      const secure = String(req.headers['x-forwarded-proto'] || '').includes('https');
      return json(res, 200, { ok: true }, { 'Set-Cookie': `ecopass_admin=${makeSession()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}${secure ? '; Secure' : ''}` });
    }
    if (url.pathname === '/api/admin/logout' && req.method === 'POST') return json(res, 200, { ok: true }, { 'Set-Cookie': 'ecopass_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
    if (url.pathname.startsWith('/api/admin/') && (!authenticated(req) || !sameOrigin(req))) return json(res, 401, { error: 'Authentication required' });
    if (url.pathname === '/api/admin/registrations' && req.method === 'GET') return json(res, 200, await readRegistrations());
    if (url.pathname === '/api/admin/operations' && req.method === 'GET') return json(res, 200, await operations.snapshot());
    if (url.pathname === '/api/admin/booths' && req.method === 'POST') return json(res, 200, await operations.saveBooth(await jsonBody(req)));
    if (url.pathname === '/api/admin/scan' && req.method === 'GET') return json(res, 200, await operations.lookup(url.searchParams.get('code')));
    if (url.pathname === '/api/admin/check-in' && req.method === 'POST') return json(res, 200, await operations.checkIn(await jsonBody(req)));
    if (/^\/api\/admin\/registrations\/[^/]+\/confirm-payment$/.test(url.pathname) && req.method === 'POST') {
      const id = decodeURIComponent(url.pathname.split('/')[4]);
      const record = (await readRegistrations()).find(item => item.id === id);
      if (!record) return json(res, 404, { error: 'Registration not found' });
      if (!['Pay at Tourism Office (Cash)', 'Physical Payment'].includes(record.paymentMethod) || record.paymentStatus !== 'PAY_AT_OFFICE') return json(res, 409, { error: 'Only an unpaid tourism-office registration can be confirmed here.' });
      const confirmed = await updateRegistration(id, current => {
        if (current.paymentStatus !== 'PAY_AT_OFFICE') throw Object.assign(new Error('This payment was already updated. Refresh the dashboard.'), {status:409});
        return {...current,paymentStatus:'PAID',paymentSource:'tourism-office',status:'ACTIVE',paidAt:new Date().toISOString()};
      });
      return json(res, 200, publicPass(confirmed));
    }
    if (url.pathname === '/api/admin/content' && req.method === 'PUT') return json(res, 200, await writeContent(await jsonBody(req)));
    if (url.pathname === '/api/admin/upload' && req.method === 'POST') {
      const slot = url.searchParams.get('slot');
      const type = String(req.headers['content-type'] || '').split(';')[0];
      if (!IMAGE_SLOTS.has(slot)) return json(res, 400, { error: 'Unknown image slot' });
      if (!IMAGE_TYPES.has(type)) return json(res, 415, { error: 'Use a JPG, PNG, WebP, or GIF image' });
      const file = await body(req, 5 * 1024 * 1024);
      if (file.length < 16) return json(res, 400, { error: 'Image file is empty' });
      if (!matchesImageType(file, type)) return json(res, 415, { error: 'The file contents do not match the selected image type' });
      const filename = `${slot.replaceAll('.', '-')}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${IMAGE_TYPES.get(type)}`;
      if (USE_BLOB) await putBlob(`uploads/${filename}`, file, { access: 'private', addRandomSuffix: false, contentType: type });
      else await fsp.writeFile(path.join(UPLOAD_DIR, filename), file, { flag: 'wx' });
      const content = await readContent(); const previous = slot.split('.').reduce((v, key) => v?.[Number.isInteger(Number(key)) ? Number(key) : key], content);
      setPath(content, slot, `/uploads/${filename}`); await writeContent(content);
      if (typeof previous === 'string' && previous.startsWith('/uploads/')) {
        if (USE_BLOB) await delBlob(`uploads/${path.basename(previous)}`).catch(() => {});
        else await fsp.unlink(path.join(UPLOAD_DIR, path.basename(previous))).catch(() => {});
      }
      return json(res, 201, { url: `/uploads/${filename}` });
    }
    if (url.pathname === '/api/admin/image' && req.method === 'DELETE') {
      const slot = url.searchParams.get('slot'); if (!IMAGE_SLOTS.has(slot)) return json(res, 400, { error: 'Unknown image slot' });
      const content = await readContent(); const previous = slot.split('.').reduce((v, key) => v?.[Number.isInteger(Number(key)) ? Number(key) : key], content);
      const fallback = slot.split('.').reduce((v, key) => v?.[Number.isInteger(Number(key)) ? Number(key) : key], defaults);
      setPath(content, slot, fallback); await writeContent(content);
      if (typeof previous === 'string' && previous.startsWith('/uploads/')) {
        if (USE_BLOB) await delBlob(`uploads/${path.basename(previous)}`).catch(() => {});
        else await fsp.unlink(path.join(UPLOAD_DIR, path.basename(previous))).catch(() => {});
      }
      return json(res, 200, { url: fallback });
    }
    if (url.pathname.startsWith('/uploads/')) {
      if (!USE_BLOB) return serveFile(res, path.join(UPLOAD_DIR, path.basename(url.pathname)), true);
      const stored = await getBlob(`uploads/${path.basename(url.pathname)}`, { access: 'private' });
      if (!stored || stored.statusCode !== 200) return json(res, 404, { error: 'Not found' });
      res.writeHead(200, { 'Content-Type': stored.blob.contentType || 'application/octet-stream', 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
      return Readable.fromWeb(stored.stream).pipe(res);
    }
    const routes = { '/': 'ecopass.html', '/ecopass.html': 'ecopass.html', '/admin': 'collections.html', '/admin/': 'collections.html', '/collections': 'collections.html' };
    const requested = routes[url.pathname] || url.pathname.slice(1);
    const publicScript = ['admin.js','landing.js','landing-motion.js','registration-design.js','collections.js','booth-map-scene.js','visitor-map.js'].includes(requested);
    if (!/^[a-zA-Z0-9_-]+\.(html|css|png|jpg|jpeg|webp|gif|svg)$/.test(requested) && !publicScript) return json(res, 404, { error: 'Not found' });
    return serveFile(res, path.join(ROOT, requested));
  } catch (error) {
    const errorId = crypto.randomUUID();
    if (!error.status || error.status >= 500) {
      // Log the stage and code location, never request bodies, credentials or visitor details.
      console.error(JSON.stringify({ event: 'ecopass_request_failed', errorId, stage, path: url.pathname,
        errorType: error.constructor?.name || error.name, stack: String(error.stack || '').split('\n').slice(1, 5).map(line => line.trim()) }));
    }
    return json(res, error.status || 500, { error: error.status ? error.message : `We couldn't complete your request. Please try again shortly. Reference: ${errorId}`, errorId });
  }
}

async function start(port = PORT) {
  await ensureStorage();
  const server = http.createServer(handler);
  return new Promise(resolve => server.listen(port, '0.0.0.0', () => {
    if (!ADMIN_PASSWORD) console.warn('EcoPass admin access is locked: configure ADMIN_PASSWORD to enable dashboard sign-in.');
    resolve(server);
  }));
}
if (require.main === module) start().then(server => console.log(`EcoPass running at http://localhost:${server.address().port}`));
let vercelStorageReady;
async function vercelHandler(req, res) {
  vercelStorageReady ||= ensureStorage().catch(error => {
    vercelStorageReady = undefined;
    throw error;
  });
  await vercelStorageReady;
  return handler(req, res);
}
module.exports = vercelHandler;
Object.assign(module.exports, { start, handler, ensureStorage, sanitizeContent, readContent, writeContent });
