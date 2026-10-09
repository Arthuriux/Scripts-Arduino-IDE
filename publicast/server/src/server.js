'use strict';
/**
 * PubliCast CMS — servidor de señalización digital.
 *
 *  - Panel web de administración (/admin)
 *  - API REST para administrar contenido, listas, programación y pantallas
 *  - API para reproductores (Android / web) + WebSocket para cambios en tiempo real
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { WebSocketServer } = require('ws');

const { Store, newId } = require('./db');
const auth = require('./auth');
const PCSchedule = require('../public/shared/schedule');

const PORT = parseInt(process.env.PORT || '8080', 10);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const APK_DIR = path.resolve(process.env.APK_DIR || path.join(__dirname, '..', 'apk'));
const MAX_UPLOAD_MB = parseInt(process.env.MAX_UPLOAD_MB || '2048', 10);
const HEARTBEAT_SECONDS = 60;
const ONLINE_WINDOW_MS = (HEARTBEAT_SECONDS * 2 + 30) * 1000;
const MAX_STATS = 500000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
const VIDEO_EXT = ['.mp4', '.m4v', '.webm', '.mkv', '.mov', '.3gp', '.ts'];

function createApp({ dataDir = DATA_DIR, quiet = false } = {}) {
  const mediaDir = path.join(dataDir, 'media');
  fs.mkdirSync(mediaDir, { recursive: true });
  const db = new Store(path.join(dataDir, 'db.json'));
  const sessions = new auth.Sessions();
  const sockets = new Map(); // displayId -> Set<WebSocket>
  const log = quiet ? () => {} : (...a) => console.log(new Date().toISOString(), ...a);

  // ---------- Usuario administrador inicial ----------
  if (!db.get('users').length) {
    const username = process.env.ADMIN_USER || 'admin';
    const password = process.env.ADMIN_PASSWORD || 'admin';
    db.insert('users', { username, password: auth.hashPassword(password), role: 'admin' });
    log(`Usuario administrador creado: ${username} (cambie la contraseña desde el panel)`);
  }

  const app = express();
  app.disable('x-powered-by');
  // Detrás de un proxy inverso (nginx, Traefik...) defina TRUST_PROXY=1 para registrar la IP real.
  if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : process.env.TRUST_PROXY);
  app.use(express.json({ limit: '2mb' }));
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });

  // ---------- Utilidades ----------
  const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
  const str = (v, max = 500) => (v === undefined || v === null ? '' : String(v).slice(0, max).trim());
  const num = (v, def, min = 0, max = 86400) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def;
  };
  const isHHMM = (v) => v === '' || /^([01]?\d|2[0-3]):[0-5]\d$|^24:00$/.test(v);
  const isYMD = (v) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v);

  function changed(reason) {
    const version = db.bumpVersion();
    broadcast({ type: 'version', version, reason });
    return version;
  }

  function send(displayId, msg) {
    const set = sockets.get(displayId);
    if (!set) return 0;
    const payload = JSON.stringify(msg);
    let n = 0;
    set.forEach((ws) => {
      if (ws.readyState === 1) {
        ws.send(payload);
        n++;
      }
    });
    return n;
  }

  function broadcast(msg) {
    for (const id of sockets.keys()) send(id, msg);
  }

  function isOnline(d) {
    return (sockets.get(d.id)?.size || 0) > 0 || (d.lastSeen && Date.now() - Date.parse(d.lastSeen) < ONLINE_WINDOW_MS);
  }

  function publicDisplay(d) {
    const { keyHash, ...rest } = d;
    const sch = db.get('schedules').filter((s) => !s.displayIds?.length || s.displayIds.includes(d.id));
    const now = PCSchedule.resolve(sch, d.defaultPlaylistId);
    return {
      ...rest,
      online: isOnline(d),
      connected: (sockets.get(d.id)?.size || 0) > 0,
      nowPlaying: now.playlistIds.map((id) => db.find('playlists', id)?.name).filter(Boolean),
      nowSource: now.source,
    };
  }

  function uniqueCode() {
    let code;
    do code = String(crypto.randomInt(100000, 1000000));
    while (db.get('displays').some((d) => d.code === code && !d.authorized));
    return code;
  }

  // ---------- Autenticación de administración ----------
  const loginAttempts = new Map();
  function requireAdmin(req, res, next) {
    const token = auth.parseCookies(req.headers.cookie)[auth.SESSION_COOKIE];
    const s = sessions.get(token);
    if (!s) return bad(res, 'No autenticado', 401);
    const user = db.find('users', s.userId);
    if (!user) return bad(res, 'No autenticado', 401);
    req.user = user;
    next();
  }

  app.post('/api/login', (req, res) => {
    const ip = req.ip;
    const a = loginAttempts.get(ip) || { n: 0, until: 0 };
    if (a.until > Date.now()) return bad(res, 'Demasiados intentos. Espere un minuto.', 429);
    const user = db.get('users').find((u) => u.username === str(req.body?.username, 100));
    if (!user || !auth.verifyPassword(String(req.body?.password || ''), user.password)) {
      a.n += 1;
      if (a.n >= 5) Object.assign(a, { n: 0, until: Date.now() + 60000 });
      loginAttempts.set(ip, a);
      return bad(res, 'Usuario o contraseña incorrectos', 401);
    }
    loginAttempts.delete(ip);
    const token = sessions.create(user.id);
    res.setHeader(
      'Set-Cookie',
      `${auth.SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${auth.SESSION_TTL_MS / 1000}`
    );
    res.json({ username: user.username, defaultPassword: auth.verifyPassword('admin', user.password) });
  });

  app.post('/api/logout', (req, res) => {
    sessions.destroy(auth.parseCookies(req.headers.cookie)[auth.SESSION_COOKIE]);
    res.setHeader('Set-Cookie', `${auth.SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    res.json({ ok: true });
  });

  app.get('/api/me', requireAdmin, (req, res) => {
    res.json({ username: req.user.username, defaultPassword: auth.verifyPassword('admin', req.user.password) });
  });

  app.post('/api/me/password', requireAdmin, (req, res) => {
    const { current, next: pwd } = req.body || {};
    if (!auth.verifyPassword(String(current || ''), req.user.password)) return bad(res, 'La contraseña actual no es correcta');
    if (String(pwd || '').length < 6) return bad(res, 'La nueva contraseña debe tener al menos 6 caracteres');
    db.update('users', req.user.id, { password: auth.hashPassword(String(pwd)) });
    res.json({ ok: true });
  });

  // ---------- Panel ----------
  app.get('/api/dashboard', requireAdmin, (req, res) => {
    const displays = db.get('displays').map(publicDisplay);
    const since = Date.now() - 24 * 3600 * 1000;
    const plays24h = db.get('stats').filter((s) => Date.parse(s.at) >= since).length;
    const storage = db.get('media').reduce((t, m) => t + (m.size || 0), 0);
    res.json({
      version: db.contentVersion,
      counts: {
        displays: displays.length,
        online: displays.filter((d) => d.online && d.authorized).length,
        pending: displays.filter((d) => !d.authorized).length,
        media: db.get('media').length,
        playlists: db.get('playlists').length,
        schedules: db.get('schedules').length,
        plays24h,
        storage,
      },
      displays,
      apkAvailable: fs.existsSync(path.join(APK_DIR, 'publicast-player.apk')),
    });
  });

  // ---------- Biblioteca multimedia ----------
  const upload = multer({
    storage: multer.diskStorage({
      destination: mediaDir,
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 6);
        cb(null, newId() + ext);
      },
    }),
    limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 20 },
    // Sólo extensiones conocidas: evita servir HTML/SVG con scripts desde /media
    fileFilter: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const ok =
        (/^image\//.test(file.mimetype) && IMAGE_EXT.includes(ext)) || (/^video\//.test(file.mimetype) && VIDEO_EXT.includes(ext));
      cb(null, ok);
    },
  });

  function md5File(file) {
    return new Promise((resolve, reject) => {
      const h = crypto.createHash('md5');
      fs.createReadStream(file)
        .on('data', (c) => h.update(c))
        .on('end', () => resolve(h.digest('hex')))
        .on('error', reject);
    });
  }

  app.get('/api/media', requireAdmin, (req, res) => {
    const used = new Map();
    db.get('playlists').forEach((p) =>
      p.items.forEach((i) => used.set(i.mediaId, (used.get(i.mediaId) || 0) + 1))
    );
    res.json(db.get('media').map((m) => ({ ...m, url: m.file ? `/media/${m.file}` : null, usedIn: used.get(m.id) || 0 })));
  });

  app.post('/api/media/upload', requireAdmin, upload.array('files', 20), async (req, res) => {
    const files = req.files || [];
    if (!files.length) return bad(res, 'No se recibió ningún archivo válido (imágenes JPG/PNG/GIF/WebP/BMP o videos MP4/WebM/MKV/MOV)');
    const created = [];
    for (const f of files) {
      const type = f.mimetype.startsWith('video/') ? 'video' : 'image';
      created.push(
        db.insert('media', {
          name: str(Buffer.from(f.originalname, 'latin1').toString('utf8'), 200),
          type,
          file: f.filename,
          mime: f.mimetype,
          size: f.size,
          md5: await md5File(f.path),
          duration: type === 'video' ? 0 : 10,
        })
      );
    }
    log(`Subidos ${created.length} archivo(s)`);
    res.json(created);
  });

  function widgetFields(body, type) {
    if (type === 'web') {
      const url = str(body.url, 2000);
      if (!/^https?:\/\//i.test(url)) throw new Error('La URL debe comenzar con http:// o https://');
      return { url };
    }
    if (type === 'text') {
      return {
        text: {
          title: str(body.text?.title, 300),
          body: str(body.text?.body, 4000),
          bg: str(body.text?.bg, 20) || '#0f172a',
          color: str(body.text?.color, 20) || '#ffffff',
          accent: str(body.text?.accent, 20) || '#f59e0b',
          align: ['left', 'center', 'right'].includes(body.text?.align) ? body.text.align : 'center',
        },
      };
    }
    throw new Error('Tipo de widget no válido');
  }

  app.post('/api/media/widget', requireAdmin, (req, res) => {
    const body = req.body || {};
    const type = body.type;
    try {
      const fields = widgetFields(body, type);
      const name = str(body.name, 200) || (type === 'web' ? fields.url : fields.text.title) || 'Widget';
      res.json(db.insert('media', { name, type, duration: num(body.duration, 15, 1), ...fields }));
    } catch (e) {
      bad(res, e.message);
    }
  });

  app.put('/api/media/:id', requireAdmin, (req, res) => {
    const m = db.find('media', req.params.id);
    if (!m) return bad(res, 'No encontrado', 404);
    const patch = {};
    if (req.body.name !== undefined) patch.name = str(req.body.name, 200) || m.name;
    if (req.body.duration !== undefined) patch.duration = num(req.body.duration, m.duration, 0);
    try {
      if (m.type === 'web' || m.type === 'text') Object.assign(patch, widgetFields({ ...m, ...req.body }, m.type));
    } catch (e) {
      return bad(res, e.message);
    }
    db.update('media', m.id, patch);
    changed('media');
    res.json(db.find('media', m.id));
  });

  app.delete('/api/media/:id', requireAdmin, (req, res) => {
    const m = db.find('media', req.params.id);
    if (!m) return bad(res, 'No encontrado', 404);
    db.get('playlists').forEach((p) => {
      const before = p.items.length;
      p.items = p.items.filter((i) => i.mediaId !== m.id);
      if (p.items.length !== before) db.update('playlists', p.id, { items: p.items });
    });
    db.remove('media', m.id);
    if (m.file) fs.rm(path.join(mediaDir, m.file), { force: true }, () => {});
    changed('media');
    res.json({ ok: true });
  });

  // ---------- Listas de reproducción ----------
  function playlistFields(body) {
    const items = (Array.isArray(body.items) ? body.items : [])
      .filter((i) => db.find('media', i.mediaId))
      .slice(0, 500)
      .map((i) => ({ id: i.id || newId(), mediaId: i.mediaId, duration: num(i.duration, null, 0) }));
    const t = body.ticker || {};
    return {
      name: str(body.name, 200) || 'Lista sin nombre',
      transition: ['fade', 'slide', 'none'].includes(body.transition) ? body.transition : 'fade',
      fit: ['contain', 'cover', 'fill'].includes(body.fit) ? body.fit : 'contain',
      background: str(body.background, 20) || '#000000',
      items,
      ticker: {
        enabled: !!t.enabled,
        text: str(t.text, 2000),
        speed: num(t.speed, 80, 10, 400),
        bg: str(t.bg, 20) || '#b91c1c',
        color: str(t.color, 20) || '#ffffff',
      },
    };
  }

  app.get('/api/playlists', requireAdmin, (req, res) => res.json(db.get('playlists')));

  app.post('/api/playlists', requireAdmin, (req, res) => {
    const p = db.insert('playlists', playlistFields(req.body || {}));
    changed('playlist');
    res.json(p);
  });

  app.put('/api/playlists/:id', requireAdmin, (req, res) => {
    if (!db.find('playlists', req.params.id)) return bad(res, 'No encontrado', 404);
    const p = db.update('playlists', req.params.id, playlistFields(req.body || {}));
    changed('playlist');
    res.json(p);
  });

  app.get('/api/playlists/:id/preview', requireAdmin, (req, res) => {
    const p = db.find('playlists', req.params.id);
    if (!p) return bad(res, 'No encontrado', 404);
    res.json(playlistPayload(p));
  });

  app.delete('/api/playlists/:id', requireAdmin, (req, res) => {
    const id = req.params.id;
    if (!db.remove('playlists', id)) return bad(res, 'No encontrado', 404);
    db.get('schedules')
      .filter((s) => s.playlistId === id)
      .forEach((s) => db.remove('schedules', s.id));
    db.get('displays')
      .filter((d) => d.defaultPlaylistId === id)
      .forEach((d) => db.update('displays', d.id, { defaultPlaylistId: null }));
    changed('playlist');
    res.json({ ok: true });
  });

  // ---------- Programación ----------
  function scheduleFields(body) {
    const playlistId = str(body.playlistId, 50);
    if (!db.find('playlists', playlistId)) throw new Error('Seleccione una lista de reproducción válida');
    const startTime = str(body.startTime, 5);
    const endTime = str(body.endTime, 5);
    const startDate = str(body.startDate, 10);
    const endDate = str(body.endDate, 10);
    if (!isHHMM(startTime) || !isHHMM(endTime)) throw new Error('Formato de hora inválido (HH:MM)');
    if (!isYMD(startDate) || !isYMD(endDate)) throw new Error('Formato de fecha inválido');
    if (startDate && endDate && endDate < startDate) throw new Error('La fecha final es anterior a la inicial');
    return {
      name: str(body.name, 200) || 'Evento',
      playlistId,
      displayIds: (Array.isArray(body.displayIds) ? body.displayIds : []).filter((id) => db.find('displays', id)),
      days: (Array.isArray(body.days) ? body.days : []).map(Number).filter((d) => d >= 0 && d <= 6),
      startTime,
      endTime,
      startDate,
      endDate,
      priority: num(body.priority, 1, 0, 100),
      enabled: body.enabled !== false,
    };
  }

  app.get('/api/schedules', requireAdmin, (req, res) => res.json(db.get('schedules')));

  app.post('/api/schedules', requireAdmin, (req, res) => {
    try {
      const s = db.insert('schedules', scheduleFields(req.body || {}));
      changed('schedule');
      res.json(s);
    } catch (e) {
      bad(res, e.message);
    }
  });

  app.put('/api/schedules/:id', requireAdmin, (req, res) => {
    if (!db.find('schedules', req.params.id)) return bad(res, 'No encontrado', 404);
    try {
      const s = db.update('schedules', req.params.id, scheduleFields(req.body || {}));
      changed('schedule');
      res.json(s);
    } catch (e) {
      bad(res, e.message);
    }
  });

  app.delete('/api/schedules/:id', requireAdmin, (req, res) => {
    if (!db.remove('schedules', req.params.id)) return bad(res, 'No encontrado', 404);
    changed('schedule');
    res.json({ ok: true });
  });

  // ---------- Pantallas ----------
  app.get('/api/displays', requireAdmin, (req, res) => res.json(db.get('displays').map(publicDisplay)));

  app.post('/api/displays/authorize', requireAdmin, (req, res) => {
    const code = str(req.body?.code, 10).replace(/\D/g, '');
    const d = db.get('displays').find((x) => !x.authorized && x.code === code);
    if (!d) return bad(res, 'No hay ninguna pantalla pendiente con ese código', 404);
    const defaultPlaylistId = db.find('playlists', req.body?.defaultPlaylistId) ? req.body.defaultPlaylistId : d.defaultPlaylistId || null;
    db.update('displays', d.id, {
      authorized: true,
      code: null,
      name: str(req.body?.name, 100) || d.name,
      defaultPlaylistId,
    });
    send(d.id, { type: 'authorized' });
    changed('display');
    log(`Pantalla autorizada: ${d.id}`);
    res.json(publicDisplay(db.find('displays', d.id)));
  });

  app.put('/api/displays/:id', requireAdmin, (req, res) => {
    const d = db.find('displays', req.params.id);
    if (!d) return bad(res, 'No encontrado', 404);
    const patch = {};
    if (req.body.name !== undefined) patch.name = str(req.body.name, 100) || d.name;
    if (req.body.defaultPlaylistId !== undefined)
      patch.defaultPlaylistId = db.find('playlists', req.body.defaultPlaylistId) ? req.body.defaultPlaylistId : null;
    if (req.body.orientation !== undefined)
      patch.orientation = ['auto', 'landscape', 'portrait', 'reverseLandscape', 'reversePortrait'].includes(req.body.orientation)
        ? req.body.orientation
        : 'auto';
    if (req.body.location !== undefined) patch.location = str(req.body.location, 200);
    db.update('displays', d.id, patch);
    changed('display');
    res.json(publicDisplay(db.find('displays', d.id)));
  });

  app.delete('/api/displays/:id', requireAdmin, (req, res) => {
    const id = req.params.id;
    if (!db.find('displays', id)) return bad(res, 'No encontrado', 404);
    send(id, { type: 'unpaired' });
    sockets.get(id)?.forEach((ws) => ws.close());
    db.remove('displays', id);
    db.get('schedules').forEach((s) => {
      if (s.displayIds?.includes(id)) db.update('schedules', s.id, { displayIds: s.displayIds.filter((x) => x !== id) });
    });
    res.json({ ok: true });
  });

  function commandPayload(body) {
    const type = body.type;
    if (type === 'reload' || type === 'identify' || type === 'clearAnnouncement') return { type };
    if (type === 'announce') {
      const text = str(body.text, 1000);
      if (!text) throw new Error('Escriba el texto del anuncio');
      return {
        type: 'announce',
        id: newId(),
        text,
        duration: num(body.duration, 30, 5, 86400),
        bg: str(body.bg, 20) || '#dc2626',
        color: str(body.color, 20) || '#ffffff',
        position: ['full', 'top', 'bottom'].includes(body.position) ? body.position : 'full',
      };
    }
    throw new Error('Comando no válido');
  }

  app.post('/api/displays/:id/command', requireAdmin, (req, res) => {
    if (!db.find('displays', req.params.id)) return bad(res, 'No encontrado', 404);
    try {
      const n = send(req.params.id, commandPayload(req.body || {}));
      res.json({ delivered: n });
    } catch (e) {
      bad(res, e.message);
    }
  });

  /** Anuncio inmediato a varias pantallas (o a todas si no se indica ninguna). */
  app.post('/api/announce', requireAdmin, (req, res) => {
    try {
      const msg = commandPayload({ ...(req.body || {}), type: req.body?.type || 'announce' });
      const ids = Array.isArray(req.body?.displayIds) && req.body.displayIds.length ? req.body.displayIds : db.get('displays').map((d) => d.id);
      const delivered = ids.reduce((t, id) => t + (send(id, msg) ? 1 : 0), 0);
      res.json({ delivered, total: ids.length });
    } catch (e) {
      bad(res, e.message);
    }
  });

  // ---------- Estadísticas (prueba de reproducción) ----------
  function filterStats(q) {
    const from = q.from ? Date.parse(q.from) : 0;
    const to = q.to ? Date.parse(q.to) + 24 * 3600 * 1000 : Infinity;
    return db.get('stats').filter((s) => {
      const t = Date.parse(s.at);
      return t >= from && t < to && (!q.displayId || s.displayId === q.displayId);
    });
  }

  app.get('/api/stats', requireAdmin, (req, res) => {
    const rows = filterStats(req.query);
    const byMedia = new Map();
    const byDisplay = new Map();
    rows.forEach((s) => {
      const m = byMedia.get(s.mediaId) || { mediaId: s.mediaId, plays: 0, seconds: 0 };
      m.plays++;
      m.seconds += s.dur || 0;
      byMedia.set(s.mediaId, m);
      const d = byDisplay.get(s.displayId) || { displayId: s.displayId, plays: 0, seconds: 0 };
      d.plays++;
      d.seconds += s.dur || 0;
      byDisplay.set(s.displayId, d);
    });
    const mediaName = (id) => db.find('media', id)?.name || '(eliminado)';
    const displayName = (id) => db.find('displays', id)?.name || '(eliminada)';
    res.json({
      total: rows.length,
      byMedia: [...byMedia.values()].map((m) => ({ ...m, name: mediaName(m.mediaId) })).sort((a, b) => b.plays - a.plays),
      byDisplay: [...byDisplay.values()].map((d) => ({ ...d, name: displayName(d.displayId) })).sort((a, b) => b.plays - a.plays),
    });
  });

  app.get('/api/stats.csv', requireAdmin, (req, res) => {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = ['fecha,pantalla,contenido,lista,segundos'];
    filterStats(req.query).forEach((s) =>
      lines.push(
        [s.at, db.find('displays', s.displayId)?.name, db.find('media', s.mediaId)?.name, db.find('playlists', s.playlistId)?.name, s.dur]
          .map(esc)
          .join(',')
      )
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="prueba-de-reproduccion.csv"');
    res.send('﻿' + lines.join('\n'));
  });

  // ---------- API de reproductores ----------
  function displayFromKey(key) {
    if (!key || String(key).length < 32) return null;
    const h = auth.sha256(key);
    return db.get('displays').find((d) => d.keyHash === h) || null;
  }

  function playerKey(req) {
    const h = req.headers.authorization || '';
    return h.startsWith('Bearer ') ? h.slice(7) : req.headers['x-display-key'];
  }

  function cleanInfo(info) {
    const out = {};
    Object.entries(info || {})
      .slice(0, 20)
      .forEach(([k, v]) => {
        if (['string', 'number', 'boolean'].includes(typeof v)) out[str(k, 40)] = typeof v === 'string' ? str(v, 200) : v;
      });
    return out;
  }

  app.post('/api/player/register', (req, res) => {
    const key = String(req.body?.key || '');
    if (key.length < 32 || key.length > 256) return bad(res, 'Clave de pantalla inválida');
    let d = displayFromKey(key);
    const info = cleanInfo(req.body?.info);
    if (!d) {
      d = db.insert('displays', {
        name: str(req.body?.name, 100) || info.model || 'Pantalla nueva',
        keyHash: auth.sha256(key),
        authorized: false,
        code: uniqueCode(),
        defaultPlaylistId: null,
        orientation: 'auto',
        location: '',
        info,
        lastSeen: new Date().toISOString(),
        ip: req.ip,
      });
      log(`Nueva pantalla pendiente de autorización: código ${d.code}`);
    } else {
      db.update('displays', d.id, { info: { ...d.info, ...info }, lastSeen: new Date().toISOString(), ip: req.ip });
    }
    res.json({ id: d.id, name: d.name, authorized: d.authorized, code: d.authorized ? null : d.code });
  });

  function requirePlayer(req, res, next) {
    const d = displayFromKey(playerKey(req));
    if (!d) return bad(res, 'Pantalla no registrada', 401);
    if (!d.authorized) return res.status(403).json({ error: 'Pendiente de autorización', pending: true, code: d.code });
    req.display = d;
    next();
  }

  /** Lista de reproducción con los datos de cada contenido resueltos (lo que necesita el reproductor). */
  function playlistPayload(p) {
    return {
      id: p.id,
      name: p.name,
      transition: p.transition,
      fit: p.fit,
      background: p.background,
      ticker: p.ticker,
      items: p.items
        .map((it) => {
          const m = db.find('media', it.mediaId);
          if (!m) return null;
          const item = {
            id: it.id,
            mediaId: m.id,
            name: m.name,
            type: m.type,
            duration: it.duration === null || it.duration === undefined ? m.duration : it.duration,
          };
          if (m.file) Object.assign(item, { file: m.file, url: `/media/${m.file}`, size: m.size, md5: m.md5, mime: m.mime });
          if (m.type === 'web') item.url = m.url;
          if (m.type === 'text') item.text = m.text;
          return item;
        })
        .filter(Boolean),
    };
  }

  function buildManifest(d) {
    const schedules = db
      .get('schedules')
      .filter((s) => s.enabled !== false && (!s.displayIds?.length || s.displayIds.includes(d.id)))
      .map(({ id, name, playlistId, days, startTime, endTime, startDate, endDate, priority }) => ({
        id,
        name,
        playlistId,
        days,
        startTime,
        endTime,
        startDate,
        endDate,
        priority,
      }));
    const ids = new Set(schedules.map((s) => s.playlistId));
    if (d.defaultPlaylistId) ids.add(d.defaultPlaylistId);
    const playlists = {};
    const files = new Map();
    ids.forEach((id) => {
      const p = db.find('playlists', id);
      if (!p) return;
      playlists[id] = playlistPayload(p);
      playlists[id].items.forEach((it) => {
        if (it.file) files.set(it.file, { file: it.file, url: it.url, size: it.size, md5: it.md5 });
      });
    });
    return {
      version: db.contentVersion,
      serverTime: new Date().toISOString(),
      display: { id: d.id, name: d.name, orientation: d.orientation || 'auto' },
      defaultPlaylistId: d.defaultPlaylistId && playlists[d.defaultPlaylistId] ? d.defaultPlaylistId : null,
      schedules: schedules.filter((s) => playlists[s.playlistId]),
      playlists,
      files: [...files.values()],
      settings: { heartbeatSeconds: HEARTBEAT_SECONDS, statsEnabled: true },
    };
  }

  app.get('/api/player/manifest', requirePlayer, (req, res) => {
    db.update('displays', req.display.id, { lastSeen: new Date().toISOString(), ip: req.ip });
    res.json(buildManifest(req.display));
  });

  app.post('/api/player/heartbeat', requirePlayer, (req, res) => {
    const b = req.body || {};
    db.update('displays', req.display.id, {
      lastSeen: new Date().toISOString(),
      ip: req.ip,
      status: {
        currentItem: str(b.currentItem, 200),
        currentPlaylist: str(b.currentPlaylist, 200),
        contentVersion: num(b.contentVersion, 0, 0, 1e12),
        cacheReady: !!b.cacheReady,
        error: str(b.error, 500),
      },
      info: { ...req.display.info, ...cleanInfo(b.info) },
    });
    res.json({ version: db.contentVersion, serverTime: new Date().toISOString() });
  });

  app.post('/api/player/stats', requirePlayer, (req, res) => {
    const records = Array.isArray(req.body?.records) ? req.body.records.slice(0, 5000) : [];
    const stats = db.get('stats');
    records.forEach((r) => {
      const at = new Date(r.startedAt || r.at);
      if (isNaN(at)) return;
      stats.push({ displayId: req.display.id, mediaId: str(r.mediaId, 50), playlistId: str(r.playlistId, 50), at: at.toISOString(), dur: num(r.duration, 0) });
    });
    if (stats.length > MAX_STATS) stats.splice(0, stats.length - MAX_STATS);
    db.save();
    res.json({ accepted: records.length });
  });

  // ---------- Archivos estáticos ----------
  app.use('/media', express.static(mediaDir, { maxAge: '30d', immutable: true, fallthrough: false }));
  app.use('/admin', express.static(path.join(PUBLIC_DIR, 'admin')));
  app.use('/player', express.static(path.join(PUBLIC_DIR, 'player')));
  app.use('/shared', express.static(path.join(PUBLIC_DIR, 'shared')));
  app.get('/download/publicast-player.apk', (req, res) => {
    const file = path.join(APK_DIR, 'publicast-player.apk');
    if (!fs.existsSync(file)) return bad(res, 'El APK aún no se ha copiado al servidor (carpeta apk/)', 404);
    res.download(file);
  });
  app.get('/', (req, res) => res.redirect('/admin/'));
  app.get('/api/health', (req, res) => res.json({ ok: true, version: db.contentVersion }));

  app.use('/api', (req, res) => bad(res, 'Ruta no encontrada', 404));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) return bad(res, `Error al subir: ${err.message}`);
    if (err.status === 404 || err.statusCode === 404) return bad(res, 'No encontrado', 404);
    log('Error:', err);
    bad(res, 'Error interno del servidor', 500);
  });

  // ---------- WebSocket para reproductores ----------
  function attachWebSocket(server) {
    const wss = new WebSocketServer({ server, path: '/ws' });
    wss.on('connection', (ws, req) => {
      const url = new URL(req.url, 'http://x');
      const d = displayFromKey(url.searchParams.get('key'));
      if (!d) return ws.close(4001, 'unregistered');
      if (!sockets.has(d.id)) sockets.set(d.id, new Set());
      sockets.get(d.id).add(ws);
      ws.isAlive = true;
      ws.on('pong', () => (ws.isAlive = true));
      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw);
          if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
        } catch {
          /* ignorar */
        }
      });
      ws.on('close', () => {
        sockets.get(d.id)?.delete(ws);
        if (!sockets.get(d.id)?.size) sockets.delete(d.id);
      });
      db.update('displays', d.id, { lastSeen: new Date().toISOString() });
      ws.send(JSON.stringify({ type: 'hello', version: db.contentVersion, authorized: d.authorized }));
    });
    const timer = setInterval(() => {
      wss.clients.forEach((ws) => {
        if (!ws.isAlive) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
      });
      // Mantener "última conexión" de las pantallas conectadas por WebSocket
      for (const id of sockets.keys()) if (db.find('displays', id)) db.find('displays', id).lastSeen = new Date().toISOString();
    }, 30000);
    timer.unref();
    wss.on('close', () => clearInterval(timer));
    return wss;
  }

  return { app, db, attachWebSocket };
}

if (require.main === module) {
  const { app, db, attachWebSocket } = createApp();
  const server = http.createServer(app);
  attachWebSocket(server);
  server.listen(PORT, () => {
    console.log(`\n  PubliCast CMS escuchando en http://localhost:${PORT}`);
    console.log(`  Panel de administración:  http://localhost:${PORT}/admin/`);
    console.log(`  Reproductor web:          http://localhost:${PORT}/player/\n`);
  });
  const shutdown = () => {
    db.flushSync();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { createApp };
