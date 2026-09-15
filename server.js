'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const QRCode = require('qrcode');
const { put: putBlob, get: getBlob, del: delBlob } = require('@vercel/blob');
const defaults = require('./site-defaults');

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
const MAX_BODY = 6 * 1024 * 1024;
const SESSION_TTL = 8 * 60 * 60 * 1000;
const loginAttempts = new Map();
const registrationAttempts = new Map();
let registrationWriteQueue = Promise.resolve();

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
  const walk = value => {
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, walk(child)]));
    return typeof value === 'string' ? cleanText(value, 700) : value;
  };
  return walk(result);
}
async function ensureStorage() {
  if (USE_BLOB) {
    if (!(await readBlobJson('data/site-content.json'))) await writeBlobJson('data/site-content.json', { ...clone(defaults), updatedAt: new Date().toISOString() });
    if (!(await readBlobJson('data/registrations.json'))) await writeBlobJson('data/registrations.json', []);
    return;
  }
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.mkdir(UPLOAD_DIR, { recursive: true });
  await fsp.mkdir(PRIVATE_ID_DIR, { recursive: true });
  try { await fsp.access(CONTENT_FILE); } catch { await writeContent({ ...clone(defaults), updatedAt: new Date().toISOString() }); }
  try { await fsp.access(REGISTRATION_FILE); } catch { await fsp.writeFile(REGISTRATION_FILE, '[]\n', { flag: 'wx' }).catch(() => {}); }
}
async function readBlob(pathname) {
  const result = await getBlob(pathname, { access: 'private' });
  if (!result || result.statusCode !== 200) return null;
  const chunks = [];
  for await (const chunk of result.stream) chunks.push(Buffer.from(chunk));
  return { buffer: Buffer.concat(chunks), contentType: result.blob.contentType, etag: result.blob.etag };
}
async function readBlobJson(pathname) {
  try { const value = await readBlob(pathname); return value ? JSON.parse(value.buffer.toString('utf8')) : null; }
  catch { return null; }
}
async function writeBlobJson(pathname, value) {
  await putBlob(pathname, JSON.stringify(value, null, 2), { access: 'private', allowOverwrite: true, contentType: 'application/json' });
}
async function readContent() {
  try {
    if (USE_BLOB) return sanitizeContent((await readBlobJson('data/site-content.json')) || defaults);
    return sanitizeContent(JSON.parse(await fsp.readFile(CONTENT_FILE, 'utf8')));
  }
  catch { return clone(defaults); }
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
  try {
    const value = USE_BLOB ? await readBlobJson('data/registrations.json') : JSON.parse(await fsp.readFile(REGISTRATION_FILE, 'utf8'));
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}
async function appendRegistration(record) {
  registrationWriteQueue = registrationWriteQueue.then(async () => {
    const records = await readRegistrations(); records.push(record);
    if (USE_BLOB) return writeBlobJson('data/registrations.json', records);
    const temp = `${REGISTRATION_FILE}.${process.pid}.tmp`; await fsp.writeFile(temp, JSON.stringify(records, null, 2)); await fsp.rename(temp, REGISTRATION_FILE);
  });
  await registrationWriteQueue;
}
function cleanRegistration(input) {
  const counts = Object.fromEntries(['adult', 'foreign', 'senior', 'child'].map(key => [key, Math.max(key === 'adult' ? 1 : 0, Math.min(50, Number.parseInt(input?.groups?.[key], 10) || 0))]));
  const stays = ['1D / 0N','2D / 1N','3D / 2N','4D / 3N','5D / 4N','6D / 5N','7D / 6N'];
  const methods = ['GCash','Maya','Bank Transfer','Pay at Tourism Office (Cash)','Physical Payment'];
  const date = String(input?.visitDate || ''); const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : null;
  const today = new Date(); today.setUTCHours(0,0,0,0);
  const value = { fullName: cleanText(input?.fullName, 100), address: cleanText(input?.address, 180), contact: cleanText(input?.contact, 30), visitDate: date, stay: stays.includes(input?.stay) ? input.stay : '', groups: counts, paymentMethod: methods.includes(input?.paymentMethod) ? input.paymentMethod : '', idToken: cleanText(input?.idToken, 1000) };
  if (value.fullName.length < 2 || value.address.length < 5 || !/^[+\d][\d\s()-]{6,29}$/.test(value.contact) || !parsedDate || parsedDate < today || !value.stay || !value.paymentMethod) throw Object.assign(new Error('Please provide complete and valid registration details.'), { status: 400 });
  const idUpload = counts.senior > 0 ? verifyIdUpload(value.idToken) : null; if (counts.senior > 0 && !idUpload) throw Object.assign(new Error('A valid ID upload is required for discounted visitors.'), { status: 400 });
  const amount = counts.adult * 50 + counts.foreign * 100 + counts.senior * 25;
  const days = Number.parseInt(value.stay, 10); const validUntil = new Date(parsedDate); validUntil.setUTCDate(validUntil.getUTCDate() + days - 1);
  return { ...value, idFile: idUpload?.file || null, amount, validUntil: validUntil.toISOString().slice(0, 10) };
}
function publicPass(record) { return { id: record.id, fullName: record.fullName, visitDate: record.visitDate, stay: record.stay, validUntil: record.validUntil, groups: record.groups, amount: record.amount, paymentMethod: record.paymentMethod, paymentStatus: record.paymentStatus, status: record.status, createdAt: record.createdAt }; }
function html(res, status, markup) { res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(markup), 'Cache-Control': 'no-store' }); res.end(markup); }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character]); }
function verificationPage(record) {
  if (!record) return '<!doctype html><meta name="viewport" content="width=device-width"><title>EcoPass not found</title><style>body{font:16px Arial;display:grid;place-items:center;min-height:100vh;margin:0;background:#f5f1e8;color:#173b28}.card{max-width:420px;padding:32px;border-radius:22px;background:#fff;text-align:center;box-shadow:0 20px 50px #0002}a{color:#075d34}</style><main class="card"><h1>Pass not found</h1><p>This EcoPass ID could not be verified.</p><a href="/">Return to EcoPass</a></main>';
  const pass = publicPass(record); return `<!doctype html><meta name="viewport" content="width=device-width"><title>Verified EcoPass ${escapeHtml(pass.id)}</title><style>body{font:15px Arial;display:grid;place-items:center;min-height:100vh;margin:0;padding:20px;background:#f5f1e8;color:#173b28}.card{width:min(430px,100%);box-sizing:border-box;padding:30px;border-radius:24px;background:#fff;box-shadow:0 20px 55px #0002}.check{display:grid;width:58px;height:58px;margin:auto;border-radius:50%;background:#e5f5e8;color:#075d34;font-size:30px;place-items:center}h1{text-align:center;color:#075d34}.status{text-align:center;color:#4f6659}.row{display:flex;justify-content:space-between;gap:15px;padding:10px 0;border-bottom:1px solid #eee}.row span{color:#77877e}.demo{margin-top:18px;padding:11px;border-radius:10px;background:#fff5d9;color:#745b19;font-size:12px;text-align:center}a{display:block;margin-top:20px;color:#075d34;text-align:center}</style><main class="card"><div class="check">✓</div><h1>Verified EcoPass</h1><p class="status">Active registration record</p><div class="row"><span>Pass ID</span><b>${escapeHtml(pass.id)}</b></div><div class="row"><span>Visitor</span><b>${escapeHtml(pass.fullName)}</b></div><div class="row"><span>Visit date</span><b>${escapeHtml(pass.visitDate)}</b></div><div class="row"><span>Valid until</span><b>${escapeHtml(pass.validUntil)}</b></div><div class="row"><span>Amount</span><b>₱${pass.amount.toFixed(2)}</b></div><div class="demo">Payment is in demonstration mode and has not been charged.</div><a href="/">Return to EcoPass</a></main>`; }
async function serveFile(res, file, cache = false) {
  try {
    const stat = await fsp.stat(file); if (!stat.isFile()) throw new Error('Not file');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': stat.size, 'Cache-Control': cache ? 'public, max-age=31536000, immutable' : 'no-cache' });
    fs.createReadStream(file).pipe(res);
  } catch { json(res, 404, { error: 'Not found' }); }
}
async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname === '/api/content' && req.method === 'GET') return json(res, 200, await readContent());
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
      if (!sameOrigin(req)) return json(res, 403, { error: 'Invalid request origin' });
      if (!registrationAllowed(req)) return json(res, 429, { error: 'Too many registration attempts. Please try again later.' });
      const input = cleanRegistration(await jsonBody(req)); recordRegistrationAttempt(req);
      const record = { ...input, id: `ECP-${input.visitDate.replaceAll('-', '')}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`, paymentStatus: 'DEMO_ONLY', status: 'ACTIVE', createdAt: new Date().toISOString() };
      delete record.idToken; await appendRegistration(record);
      const protocol = String(req.headers['x-forwarded-proto'] || '').split(',')[0] || 'http'; const origin = `${protocol}://${req.headers.host}`; const verifyUrl = `${origin}/verify/${encodeURIComponent(record.id)}`;
      const qrDataUrl = await QRCode.toDataURL(verifyUrl, { width: 300, margin: 2, color: { dark: '#075d34', light: '#ffffff' }, errorCorrectionLevel: 'M' });
      return json(res, 201, { pass: publicPass(record), verifyUrl, qrDataUrl });
    }
    if (url.pathname.startsWith('/api/passes/') && req.method === 'GET') {
      const id = decodeURIComponent(url.pathname.slice('/api/passes/'.length)); const record = (await readRegistrations()).find(item => item.id === id); return record ? json(res, 200, publicPass(record)) : json(res, 404, { error: 'Pass not found' });
    }
    if (url.pathname.startsWith('/verify/') && req.method === 'GET') {
      const id = decodeURIComponent(url.pathname.slice('/verify/'.length)); const record = (await readRegistrations()).find(item => item.id === id); return html(res, record ? 200 : 404, verificationPage(record));
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
    const routes = { '/': 'ecopass.html', '/ecopass.html': 'ecopass.html', '/admin': 'admin.html', '/admin/': 'admin.html' };
    const requested = routes[url.pathname] || url.pathname.slice(1);
    if (!requested || requested.includes('..') || path.isAbsolute(requested)) return json(res, 404, { error: 'Not found' });
    return serveFile(res, path.join(ROOT, requested));
  } catch (error) { return json(res, error.status || 500, { error: error.status ? error.message : 'Server error' }); }
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
module.exports = handler;
Object.assign(module.exports, { start, handler, ensureStorage, sanitizeContent, readContent, writeContent });
