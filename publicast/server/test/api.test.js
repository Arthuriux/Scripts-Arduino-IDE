'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const { createApp } = require('../src/server');
const PCSchedule = require('../public/shared/schedule');

let server;
let store;
let base;
let cookie = '';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'publicast-test-'));
const KEY = 'k'.repeat(10) + require('crypto').randomBytes(24).toString('hex');

async function call(method, url, body, headers = {}) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', cookie, ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  return { status: res.status, body: await res.json().catch(() => null) };
}
const player = (method, url, body) => call(method, url, body, { Authorization: 'Bearer ' + KEY, cookie: '' });

before(async () => {
  const { app, db, attachWebSocket } = createApp({ dataDir, quiet: true });
  store = db;
  server = http.createServer(app);
  attachWebSocket(server);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
  store.flushSync();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('requiere sesión para la API de administración', async () => {
  assert.equal((await call('GET', '/api/media')).status, 401);
  assert.equal((await call('POST', '/api/login', { username: 'admin', password: 'mal' })).status, 401);
  const ok = await call('POST', '/api/login', { username: 'admin', password: 'admin' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.defaultPassword, true);
});

let imageId;
let playlistId;
test('sube una imagen y crea widgets', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const fd = new FormData();
  fd.append('files', new Blob([png], { type: 'image/png' }), 'promo.png');
  const res = await fetch(base + '/api/media/upload', { method: 'POST', body: fd, headers: { cookie } });
  assert.equal(res.status, 200);
  const [m] = await res.json();
  assert.equal(m.type, 'image');
  assert.equal(m.size, png.length);
  imageId = m.id;
  const file = await fetch(base + '/media/' + m.file);
  assert.equal(file.status, 200);

  const bad = await call('POST', '/api/media/widget', { type: 'web', url: 'javascript:alert(1)' });
  assert.equal(bad.status, 400);
  const text = await call('POST', '/api/media/widget', { type: 'text', text: { title: 'Oferta', body: '2x1' }, duration: 8 });
  assert.equal(text.status, 200);
  const pl = await call('POST', '/api/playlists', {
    name: 'Promos',
    items: [{ mediaId: imageId, duration: 5 }, { mediaId: text.body.id }, { mediaId: 'no-existe' }],
    ticker: { enabled: true, text: 'Hola' },
  });
  assert.equal(pl.status, 200);
  assert.equal(pl.body.items.length, 2);
  playlistId = pl.body.id;
});

test('empareja una pantalla y entrega el manifiesto', async () => {
  const reg = await player('POST', '/api/player/register', { key: KEY, info: { model: 'TV Box' } });
  assert.equal(reg.status, 200);
  assert.equal(reg.body.authorized, false);
  assert.match(reg.body.code, /^\d{6}$/);
  assert.equal((await player('GET', '/api/player/manifest')).status, 403);

  // El reproductor recibe el aviso de autorización por WebSocket
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws?key=' + KEY);
  const messages = [];
  ws.on('message', (m) => messages.push(JSON.parse(m)));
  await new Promise((r) => ws.on('open', r));

  const auth = await call('POST', '/api/displays/authorize', { code: reg.body.code, name: 'Vitrina', defaultPlaylistId: playlistId });
  assert.equal(auth.status, 200);
  const man = await player('GET', '/api/player/manifest');
  assert.equal(man.status, 200);
  assert.equal(man.body.display.name, 'Vitrina');
  assert.equal(man.body.defaultPlaylistId, playlistId);
  assert.equal(man.body.playlists[playlistId].items[0].duration, 5);
  assert.equal(man.body.playlists[playlistId].items[1].duration, 8);
  assert.equal(man.body.files.length, 1);

  const cmd = await call('POST', `/api/displays/${auth.body.id}/command`, { type: 'announce', text: 'Cerramos en 10 min' });
  assert.equal(cmd.body.delivered, 1);
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(messages.some((m) => m.type === 'authorized'));
  assert.ok(messages.some((m) => m.type === 'announce' && m.text === 'Cerramos en 10 min'));
  ws.close();

  const hb = await player('POST', '/api/player/heartbeat', { currentItem: 'promo.png', contentVersion: man.body.version });
  assert.equal(hb.status, 200);
  const st = await player('POST', '/api/player/stats', { records: [{ mediaId: imageId, playlistId, startedAt: new Date().toISOString(), duration: 5 }] });
  assert.equal(st.body.accepted, 1);
  const stats = await call('GET', '/api/stats');
  assert.equal(stats.body.total, 1);
  assert.equal(stats.body.byMedia[0].name, 'promo.png');
});

test('programación con prioridad y validación', async () => {
  assert.equal((await call('POST', '/api/schedules', { playlistId: 'x' })).status, 400);
  assert.equal((await call('POST', '/api/schedules', { playlistId, startTime: '25:00' })).status, 400);
  const s = await call('POST', '/api/schedules', { name: 'Mañanas', playlistId, days: [1, 2, 3], startTime: '08:00', endTime: '12:00', priority: 5 });
  assert.equal(s.status, 200);
  const man = await player('GET', '/api/player/manifest');
  assert.equal(man.body.schedules.length, 1);
});

test('resolución de la programación', () => {
  const at = (s) => new Date(s);
  const base = { playlistId: 'A', priority: 1 };
  // Lunes 2026-10-05 09:00
  assert.ok(PCSchedule.isActive({ ...base, days: [1], startTime: '08:00', endTime: '12:00' }, at('2026-10-05T09:00:00')));
  assert.ok(!PCSchedule.isActive({ ...base, days: [2], startTime: '08:00', endTime: '12:00' }, at('2026-10-05T09:00:00')));
  assert.ok(!PCSchedule.isActive({ ...base, startTime: '08:00', endTime: '12:00' }, at('2026-10-05T12:00:00')));
  // Franja nocturna 22:00-06:00 programada sólo el lunes: activa el martes a las 02:00
  const night = { ...base, days: [1], startTime: '22:00', endTime: '06:00' };
  assert.ok(PCSchedule.isActive(night, at('2026-10-06T02:00:00')));
  assert.ok(!PCSchedule.isActive(night, at('2026-10-07T02:00:00')));
  // Fechas
  assert.ok(!PCSchedule.isActive({ ...base, startDate: '2026-10-06' }, at('2026-10-05T09:00:00')));
  // Prioridad e intercalado
  const r = PCSchedule.resolve(
    [
      { id: '1', playlistId: 'A', priority: 1 },
      { id: '2', playlistId: 'B', priority: 5 },
      { id: '3', playlistId: 'C', priority: 5 },
    ],
    'D',
    at('2026-10-05T09:00:00')
  );
  assert.deepEqual(r.playlistIds, ['B', 'C']);
  assert.deepEqual(PCSchedule.resolve([], 'D').playlistIds, ['D']);
});

test('al eliminar contenido se quita de las listas', async () => {
  assert.equal((await call('DELETE', '/api/media/' + imageId)).status, 200);
  const pls = await call('GET', '/api/playlists');
  assert.equal(pls.body[0].items.length, 1);
});
