'use strict';
// Descarga de videos de YouTube/Reels con un yt-dlp simulado (no depende de Internet)
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'publicast-dl-'));
const stub = path.join(dataDir, process.platform === 'win32' ? 'yt-dlp.cmd' : 'yt-dlp');
fs.writeFileSync(
  path.join(dataDir, 'stub.js'),
  `const a = process.argv.slice(2);
   if (a[0] === '--version') { console.log('2026.01.01'); process.exit(0); }
   const url = a[a.length - 1];
   if (url.includes('robot')) { console.error('ERROR: [youtube] x: Sign in to confirm you’re not a bot'); process.exit(1); }
   const out = a[a.indexOf('-o') + 1].replace('%(ext)s', 'mp4');
   require('fs').writeFileSync(out, Buffer.alloc(4096, 7));
   console.log('Mi video promocional');`
);
fs.writeFileSync(stub, process.platform === 'win32' ? `@node "${path.join(dataDir, 'stub.js')}" %*` : `#!/bin/sh\nexec node "${path.join(dataDir, 'stub.js')}" "$@"\n`);
fs.chmodSync(stub, 0o755);
process.env.YTDLP_PATH = stub;
const { createApp } = require('../src/server');

let server;
let store;
let base;
let cookie = '';
const call = async (method, url, body) => {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  return { status: res.status, body: await res.json().catch(() => null) };
};
const waitIdle = async () => {
  for (let i = 0; i < 100; i++) {
    const list = (await call('GET', '/api/media')).body;
    if (!list.some((m) => m.downloading)) return list;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('la descarga no terminó');
};

before(async () => {
  const { app, db } = createApp({ dataDir, quiet: true });
  store = db;
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  await call('POST', '/api/login', { username: 'admin', password: 'admin' });
  for (let i = 0; i < 50 && !(await call('GET', '/api/system')).body.ytdlp; i++) await new Promise((r) => setTimeout(r, 100));
});

after(() => {
  server.closeAllConnections();
  server.close();
  store.flushSync();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('descarga un video como MP4 y lo agrega a la biblioteca', async () => {
  const r = await call('POST', '/api/media/download', { url: 'https://www.youtube.com/shorts/abcdefghijk' });
  assert.equal(r.status, 200);
  assert.equal(r.body.downloading, true);
  const m = (await waitIdle()).find((x) => x.id === r.body.id);
  assert.equal(m.name, 'Mi video promocional');
  assert.match(m.file, /\.mp4$/);
  assert.equal(m.size, 4096);
  assert.equal((await fetch(base + '/media/' + m.file)).status, 200);
  // Mientras se descarga no se incluye en las listas; ya descargado, sí
  const pl = await call('POST', '/api/playlists', { name: 'P', items: [{ mediaId: m.id }] });
  const prev = (await call('GET', '/api/preview?content=p:' + pl.body.id)).body;
  assert.equal(prev.playlists[pl.body.id].items[0].type, 'video');
});

test('explica en español cuando YouTube pide verificar que no es un robot', async () => {
  const r = await call('POST', '/api/media/download', { url: 'https://youtu.be/robotrobot1' });
  const m = (await waitIdle()).find((x) => x.id === r.body.id);
  assert.match(m.downloadError, /no es un robot/);
  assert.match(m.downloadError, /YTDLP_COOKIES_FROM_BROWSER/);
});
