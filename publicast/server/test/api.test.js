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
  assert.deepEqual(PCSchedule.resolve([{ id: '9', content: 'l:L', priority: 1 }], 'p:D', at('2026-10-05T09:00:00')).keys, ['l:L']);
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
  assert.deepEqual(PCSchedule.resolve([], 'l:X').keys, ['l:X']);
});

test('layouts, videowall e identificación', async () => {
  const lay = await call('POST', '/api/layouts', {
    name: 'Noticiero',
    regions: [
      { type: 'playlist', x: 0, y: 0, w: 75, h: 88, playlistId },
      { type: 'clock', x: 75, y: 0, w: 40, h: 22, clock: { format: '12', font: 'nope' } },
      { type: 'ticker', x: 0, y: 88, w: 100, h: 12, ticker: { text: 'Noticias', opacity: 50, font: 'condensed', size: 5 } },
    ],
  });
  assert.equal(lay.status, 200);
  const [main, clock, ticker] = lay.body.regions;
  assert.equal(main.playlistId, playlistId);
  assert.equal(clock.w, 25); // se recorta para no salir de la pantalla
  assert.equal(clock.clock.format, '12');
  assert.equal(clock.clock.font, 'sans');
  assert.equal(ticker.ticker.opacity, 50);
  assert.equal(ticker.ticker.font, 'condensed');

  const displays = (await call('GET', '/api/displays')).body;
  const d = displays[0];
  assert.equal(d.number, 1);
  const wall = await call('POST', '/api/walls', { name: 'Recepción', rows: 1, cols: 2, content: 'l:' + lay.body.id, cells: [{ row: 0, col: 1, displayId: d.id }] });
  assert.equal(wall.status, 200);
  assert.equal(wall.body.cells.length, 1);

  const man = await player('GET', '/api/player/manifest');
  assert.equal(man.body.wall.cols, 2);
  assert.equal(man.body.wall.col, 1);
  assert.equal(man.body.defaultContent, 'l:' + lay.body.id);
  assert.ok(man.body.layouts[lay.body.id]);
  assert.ok(man.body.playlists[playlistId]);
  assert.equal(man.body.display.number, 1);

  const ws = new WebSocket(base.replace('http', 'ws') + '/ws?key=' + KEY);
  const messages = [];
  ws.on('message', (m) => messages.push(JSON.parse(m)));
  await new Promise((r) => ws.on('open', r));
  const idw = await call('POST', `/api/walls/${wall.body.id}/identify`, {});
  assert.equal(idw.body.delivered, 1);
  const ida = await call('POST', '/api/displays/identify-all', {});
  assert.equal(ida.body.delivered, 1);
  await new Promise((r) => setTimeout(r, 100));
  const ids = messages.filter((m) => m.type === 'identify');
  assert.equal(ids[0].number, 2); // posición en el videowall (fila 1, columna 2)
  assert.match(ids[0].detail, /Recepción/);
  assert.equal(ids[1].number, 1); // número de la pantalla
  ws.close();

  // Programación de un layout dirigida al videowall
  const ev = await call('POST', '/api/schedules', { name: 'Wall', content: 'l:' + lay.body.id, wallIds: [wall.body.id] });
  assert.equal(ev.status, 200);
  const man2 = await player('GET', '/api/player/manifest');
  assert.ok(man2.body.schedules.some((s) => s.content === 'l:' + lay.body.id));

  // Al borrar el layout se limpian el videowall y sus eventos
  assert.equal((await call('DELETE', '/api/layouts/' + lay.body.id)).status, 200);
  const walls = (await call('GET', '/api/walls')).body;
  assert.equal(walls[0].content, '');
  assert.ok(!(await call('GET', '/api/schedules')).body.some((s) => s.content === 'l:' + lay.body.id));
});

test('optimiza videos con ffmpeg y ajusta el rendimiento de la pantalla', async (t) => {
  const { spawnSync } = require('child_process');
  const displays = (await call('GET', '/api/displays')).body;
  const perf = await call('PUT', '/api/displays/' + displays[0].id, { performance: 'lite' });
  assert.equal(perf.body.performance, 'lite');
  assert.equal((await player('GET', '/api/player/manifest')).body.display.performance, 'lite');

  const sys = await call('GET', '/api/system');
  if (!sys.body.ffmpeg || spawnSync('ffmpeg', ['-version']).status !== 0) return t.skip('ffmpeg no disponible');
  const webm = path.join(dataDir, 'clip.webm');
  spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25', '-t', '1', '-c:v', 'libvpx', webm]);
  const fd = new FormData();
  fd.append('files', new Blob([fs.readFileSync(webm)], { type: 'video/webm' }), 'clip.webm');
  const up = await fetch(base + '/api/media/upload', { method: 'POST', body: fd, headers: { cookie } });
  const [vid] = await up.json();
  assert.equal((await call('POST', `/api/media/${vid.id}/optimize`)).status, 200);
  let m;
  for (let i = 0; i < 100; i++) {
    m = (await call('GET', '/api/media')).body.find((x) => x.id === vid.id);
    if (!m.optimizing) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.equal(m.optimized, true, m.optimizeError);
  assert.equal(m.mime, 'video/mp4');
  assert.match(m.file, /\.mp4$/);
  assert.ok(!fs.existsSync(path.join(dataDir, 'media', vid.file)), 'se elimina el archivo original');
  assert.equal((await fetch(base + m.url)).status, 200);
});

test('al eliminar contenido se quita de las listas', async () => {
  assert.equal((await call('DELETE', '/api/media/' + imageId)).status, 200);
  const pls = await call('GET', '/api/playlists');
  assert.equal(pls.body[0].items.length, 1);
});
