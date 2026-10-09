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

  // ---------- Migración de datos de versiones anteriores ----------
  (function migrate() {
    let next = Math.max(0, ...db.get('displays').map((d) => d.number || 0)) + 1;
    db.get('displays').forEach((d) => {
      if (d.defaultContent === undefined) d.defaultContent = d.defaultPlaylistId ? 'p:' + d.defaultPlaylistId : '';
      if (d.authorized && !d.number) d.number = next++;
    });
    // Una optimización interrumpida por un reinicio del servidor no debe quedar "en curso"
    db.get('media').forEach((m) => {
      if (m.optimizing) m.optimizing = false;
    });
    db.get('schedules').forEach((s) => {
      if (!s.content && s.playlistId) s.content = 'p:' + s.playlistId;
      if (!s.wallIds) s.wallIds = [];
    });
    db.save();
  })();

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

  // ---------- Contenidos: 'p:<id>' = lista de reproducción, 'l:<id>' = layout ----------
  function contentRecord(key) {
    if (!key || typeof key !== 'string') return null;
    if (key.startsWith('p:')) return db.find('playlists', key.slice(2));
    if (key.startsWith('l:')) return db.find('layouts', key.slice(2));
    return null;
  }
  const validContent = (key) => (contentRecord(key) ? key : '');
  const contentName = (key) => {
    const r = contentRecord(key);
    return r ? (key.startsWith('l:') ? '🧩 ' : '') + r.name : '';
  };

  /** Videowall al que pertenece la pantalla (y su celda). */
  function wallOf(displayId) {
    for (const w of db.get('walls')) {
      const cell = w.cells.find((c) => c.displayId === displayId);
      if (cell) return { wall: w, cell };
    }
    return null;
  }

  function schedulesFor(d) {
    const w = wallOf(d.id);
    return db.get('schedules').filter((s) => {
      if (s.enabled === false) return false;
      const dIds = s.displayIds || [];
      const wIds = s.wallIds || [];
      if (!dIds.length && !wIds.length) return true;
      return dIds.includes(d.id) || (w && wIds.includes(w.wall.id));
    });
  }

  /** Contenido por defecto: el del videowall (si tiene) o el de la propia pantalla. */
  function defaultContentFor(d) {
    const w = wallOf(d.id);
    return validContent(w?.wall.content) || validContent(d.defaultContent);
  }

  function publicDisplay(d) {
    const { keyHash, ...rest } = d;
    const now = PCSchedule.resolve(schedulesFor(d), defaultContentFor(d));
    const w = wallOf(d.id);
    return {
      ...rest,
      online: isOnline(d),
      connected: (sockets.get(d.id)?.size || 0) > 0,
      nowPlaying: now.keys.map(contentName).filter(Boolean),
      nowSource: now.source,
      wall: w ? { id: w.wall.id, name: w.wall.name, row: w.cell.row, col: w.cell.col } : null,
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
        layouts: db.get('layouts').length,
        walls: db.get('walls').length,
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
    const oldNatural = m.naturalDuration;
    // Metadatos que detecta el panel al cargar el video (duración real y resolución)
    if (m.type === 'video') {
      if (req.body.naturalDuration !== undefined) patch.naturalDuration = num(req.body.naturalDuration, 0, 0, 86400 * 7);
      if (req.body.width !== undefined) patch.width = num(req.body.width, 0, 0, 20000);
      if (req.body.height !== undefined) patch.height = num(req.body.height, 0, 0, 20000);
    }
    try {
      if (m.type === 'web' || m.type === 'text') Object.assign(patch, widgetFields({ ...m, ...req.body }, m.type));
    } catch (e) {
      return bad(res, e.message);
    }
    const onlyMeta = Object.keys(patch).every((k) => ['naturalDuration', 'width', 'height'].includes(k));
    db.update('media', m.id, patch);
    if (!onlyMeta || (patch.naturalDuration !== undefined && patch.naturalDuration !== oldNatural)) changed('media');
    res.json(db.find('media', m.id));
  });

  // ---------- Optimización de videos para TV Box / Fire TV (requiere ffmpeg) ----------
  const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
  let ffmpegOk = false;
  require('child_process')
    .spawn(FFMPEG, ['-version'], { stdio: 'ignore' })
    .on('error', () => (ffmpegOk = false))
    .on('close', (code) => (ffmpegOk = code === 0));
  const optimizeQueue = [];
  let optimizing = false;

  app.get('/api/system', requireAdmin, (req, res) => res.json({ ffmpeg: ffmpegOk }));

  app.post('/api/media/:id/optimize', requireAdmin, (req, res) => {
    const m = db.find('media', req.params.id);
    if (!m || m.type !== 'video') return bad(res, 'Seleccione un video', 404);
    if (!ffmpegOk)
      return bad(res, 'ffmpeg no está instalado en el servidor. En Windows: "winget install ffmpeg" (o descárguelo de ffmpeg.org) y reinicie el servidor.');
    if (m.optimizing) return bad(res, 'Este video ya se está optimizando', 409);
    db.update('media', m.id, { optimizing: true, optimizeError: '' });
    optimizeQueue.push(m.id);
    runOptimizeQueue();
    res.json({ queued: optimizeQueue.length });
  });

  /** Convierte a MP4 H.264 ≤1080p con "faststart": el formato que mejor decodifica cualquier TV Box. */
  function runOptimizeQueue() {
    if (optimizing || !optimizeQueue.length) return;
    const m = db.find('media', optimizeQueue.shift());
    if (!m || !m.file) return runOptimizeQueue();
    optimizing = true;
    const input = path.join(mediaDir, m.file);
    const outName = newId() + '.mp4';
    const output = path.join(mediaDir, outName);
    const args = [
      '-y', '-i', input,
      '-vf', "scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2",
      '-c:v', 'libx264', '-profile:v', 'high', '-level', '4.1', '-preset', 'veryfast', '-crf', '23',
      '-maxrate', '8M', '-bufsize', '16M', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', output,
    ];
    log(`Optimizando video "${m.name}"…`);
    const proc = require('child_process').spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr = (stderr + d).slice(-2000)));
    const finish = async (ok, err) => {
      optimizing = false;
      const cur = db.find('media', m.id);
      if (!cur) {
        fs.rm(output, { force: true }, () => {});
      } else if (ok) {
        const size = fs.statSync(output).size;
        const md5 = await md5File(output);
        const old = cur.file;
        db.update('media', m.id, { file: outName, mime: 'video/mp4', size, md5, optimizing: false, optimized: true, width: 0, height: 0 });
        if (old && old !== outName) fs.rm(path.join(mediaDir, old), { force: true }, () => {});
        changed('media');
        log(`Video optimizado: "${m.name}" (${Math.round(size / 1048576)} MB)`);
      } else {
        fs.rm(output, { force: true }, () => {});
        db.update('media', m.id, { optimizing: false, optimizeError: err || 'Error de ffmpeg' });
        log(`No se pudo optimizar "${m.name}": ${err}`);
      }
      runOptimizeQueue();
    };
    proc.on('error', (e) => finish(false, e.message));
    proc.on('close', (code) => (code === 0 ? finish(true) : finish(false, stderr.split('\n').filter(Boolean).slice(-2).join(' ').slice(0, 300))));
  }

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

  // ---------- Estilos de cintillo y reloj ----------
  const FONTS = ['sans', 'condensed', 'light', 'black', 'serif', 'mono', 'casual', 'cursive'];
  const dec = (v, def, min, max) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n * 10) / 10)) : def;
  };
  function tickerFields(t = {}) {
    return {
      text: str(t.text, 2000),
      speed: num(t.speed, 80, 10, 400),
      bg: str(t.bg, 20) || '#b91c1c',
      color: str(t.color, 20) || '#ffffff',
      font: FONTS.includes(t.font) ? t.font : 'sans',
      size: dec(t.size, 4.4, 1, 30), // altura de la letra en % de la pantalla
      opacity: num(t.opacity, 100, 0, 100), // opacidad del fondo
      position: t.position === 'top' ? 'top' : 'bottom',
      bold: t.bold !== false,
    };
  }
  function clockFields(c = {}) {
    return {
      format: c.format === '12' ? '12' : '24',
      seconds: !!c.seconds,
      date: c.date !== false,
      font: FONTS.includes(c.font) ? c.font : 'sans',
      size: dec(c.size, 8, 1, 50),
      color: str(c.color, 20) || '#ffffff',
      bg: str(c.bg, 20) || '#000000',
      opacity: num(c.opacity, 60, 0, 100),
      align: ['left', 'center', 'right'].includes(c.align) ? c.align : 'center',
    };
  }

  // ---------- Listas de reproducción ----------
  function playlistFields(body) {
    const items = (Array.isArray(body.items) ? body.items : [])
      .filter((i) => db.find('media', i.mediaId))
      .slice(0, 500)
      .map((i) => ({ id: i.id || newId(), mediaId: i.mediaId, duration: num(i.duration, null, 0) }));
    return {
      name: str(body.name, 200) || 'Lista sin nombre',
      transition: ['fade', 'slide', 'none'].includes(body.transition) ? body.transition : 'fade',
      fit: ['contain', 'cover', 'fill'].includes(body.fit) ? body.fit : 'contain',
      background: str(body.background, 20) || '#000000',
      items,
      ticker: { enabled: !!body.ticker?.enabled, ...tickerFields(body.ticker) },
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
    removeContentRefs('p:' + id);
    db.get('layouts').forEach((l) => {
      if (l.regions.some((r) => r.playlistId === id))
        db.update('layouts', l.id, { regions: l.regions.map((r) => (r.playlistId === id ? { ...r, playlistId: null } : r)) });
    });
    changed('playlist');
    res.json({ ok: true });
  });

  /** Quita las referencias a un contenido eliminado (eventos, pantallas y videowalls). */
  function removeContentRefs(key) {
    db.get('schedules')
      .filter((s) => PCSchedule.contentKey(s) === key)
      .forEach((s) => db.remove('schedules', s.id));
    db.get('displays')
      .filter((d) => d.defaultContent === key)
      .forEach((d) => db.update('displays', d.id, { defaultContent: '', defaultPlaylistId: null }));
    db.get('walls')
      .filter((w) => w.content === key)
      .forEach((w) => db.update('walls', w.id, { content: '' }));
  }

  // ---------- Layouts (pantalla dividida en zonas) ----------
  function layoutFields(body) {
    const regions = (Array.isArray(body.regions) ? body.regions : []).slice(0, 20).map((r, i) => {
      const type = ['playlist', 'ticker', 'clock'].includes(r.type) ? r.type : 'playlist';
      const x = dec(r.x, 0, 0, 100);
      const y = dec(r.y, 0, 0, 100);
      const region = {
        id: str(r.id, 30) || newId(),
        name: str(r.name, 100) || `Zona ${i + 1}`,
        type,
        x,
        y,
        w: dec(r.w, 100, 1, 100 - x),
        h: dec(r.h, 100, 1, 100 - y),
        z: num(r.z, i, 0, 100),
      };
      if (type === 'playlist') region.playlistId = db.find('playlists', r.playlistId) ? r.playlistId : null;
      if (type === 'ticker') region.ticker = tickerFields(r.ticker);
      if (type === 'clock') region.clock = clockFields(r.clock);
      return region;
    });
    return {
      name: str(body.name, 200) || 'Layout sin nombre',
      orientation: body.orientation === 'portrait' ? 'portrait' : 'landscape',
      background: str(body.background, 20) || '#000000',
      regions,
    };
  }

  app.get('/api/layouts', requireAdmin, (req, res) => res.json(db.get('layouts')));
  app.post('/api/layouts', requireAdmin, (req, res) => {
    const l = db.insert('layouts', layoutFields(req.body || {}));
    changed('layout');
    res.json(l);
  });
  app.put('/api/layouts/:id', requireAdmin, (req, res) => {
    if (!db.find('layouts', req.params.id)) return bad(res, 'No encontrado', 404);
    const l = db.update('layouts', req.params.id, layoutFields(req.body || {}));
    changed('layout');
    res.json(l);
  });
  app.delete('/api/layouts/:id', requireAdmin, (req, res) => {
    if (!db.remove('layouts', req.params.id)) return bad(res, 'No encontrado', 404);
    removeContentRefs('l:' + req.params.id);
    changed('layout');
    res.json({ ok: true });
  });

  /** Vista previa de una lista o layout con el mismo formato que el manifiesto. */
  app.get('/api/preview', requireAdmin, (req, res) => {
    const key = str(req.query.content, 60);
    if (!contentRecord(key)) return bad(res, 'No encontrado', 404);
    const playlists = {};
    const layouts = {};
    collectContent(key, playlists, layouts);
    res.json({ version: 0, display: { name: 'Vista previa' }, defaultContent: key, schedules: [], playlists, layouts, files: [] });
  });

  // ---------- Videowalls ----------
  function wallFields(body, id) {
    const rows = num(body.rows, 1, 1, 8);
    const cols = num(body.cols, 2, 1, 8);
    const seen = new Set();
    const cells = (Array.isArray(body.cells) ? body.cells : [])
      .map((c) => ({ row: num(c.row, 0, 0, rows - 1), col: num(c.col, 0, 0, cols - 1), displayId: str(c.displayId, 50) }))
      .filter((c) => c.row < rows && c.col < cols && db.find('displays', c.displayId))
      .filter((c) => {
        const k = `${c.row},${c.col}`;
        if (seen.has(k) || seen.has(c.displayId)) return false;
        seen.add(k);
        seen.add(c.displayId);
        return true;
      });
    // Una pantalla sólo puede pertenecer a un videowall
    db.get('walls').forEach((w) => {
      if (w.id === id) return;
      const keep = w.cells.filter((c) => !seen.has(c.displayId));
      if (keep.length !== w.cells.length) db.update('walls', w.id, { cells: keep });
    });
    return { name: str(body.name, 100) || 'Videowall', rows, cols, cells, content: validContent(body.content) };
  }

  app.get('/api/walls', requireAdmin, (req, res) => res.json(db.get('walls')));
  app.post('/api/walls', requireAdmin, (req, res) => {
    const w = db.insert('walls', wallFields(req.body || {}, null));
    changed('wall');
    res.json(w);
  });
  app.put('/api/walls/:id', requireAdmin, (req, res) => {
    if (!db.find('walls', req.params.id)) return bad(res, 'No encontrado', 404);
    const w = db.update('walls', req.params.id, wallFields(req.body || {}, req.params.id));
    changed('wall');
    res.json(w);
  });
  app.delete('/api/walls/:id', requireAdmin, (req, res) => {
    if (!db.remove('walls', req.params.id)) return bad(res, 'No encontrado', 404);
    db.get('schedules').forEach((s) => {
      if (s.wallIds?.includes(req.params.id)) db.update('schedules', s.id, { wallIds: s.wallIds.filter((x) => x !== req.params.id) });
    });
    changed('wall');
    res.json({ ok: true });
  });

  /** Muestra en cada pantalla del videowall su posición (1, 2, 3…) como "Identificar" de Windows. */
  app.post('/api/walls/:id/identify', requireAdmin, (req, res) => {
    const w = db.find('walls', req.params.id);
    if (!w) return bad(res, 'No encontrado', 404);
    let delivered = 0;
    w.cells.forEach((c) => {
      const d = db.find('displays', c.displayId);
      delivered += send(c.displayId, {
        type: 'identify',
        number: c.row * w.cols + c.col + 1,
        name: d?.name || '',
        detail: `${w.name} · fila ${c.row + 1}, columna ${c.col + 1}`,
        seconds: num(req.body?.seconds, 15, 3, 120),
      })
        ? 1
        : 0;
    });
    res.json({ delivered, total: w.cells.length });
  });

  // ---------- Programación ----------
  function scheduleFields(body) {
    const content = validContent(str(body.content, 60) || (body.playlistId ? 'p:' + body.playlistId : ''));
    if (!content) throw new Error('Seleccione una lista de reproducción o un layout válido');
    const startTime = str(body.startTime, 5);
    const endTime = str(body.endTime, 5);
    const startDate = str(body.startDate, 10);
    const endDate = str(body.endDate, 10);
    if (!isHHMM(startTime) || !isHHMM(endTime)) throw new Error('Formato de hora inválido (HH:MM)');
    if (!isYMD(startDate) || !isYMD(endDate)) throw new Error('Formato de fecha inválido');
    if (startDate && endDate && endDate < startDate) throw new Error('La fecha final es anterior a la inicial');
    return {
      name: str(body.name, 200) || 'Evento',
      content,
      playlistId: content.startsWith('p:') ? content.slice(2) : null,
      displayIds: (Array.isArray(body.displayIds) ? body.displayIds : []).filter((id) => db.find('displays', id)),
      wallIds: (Array.isArray(body.wallIds) ? body.wallIds : []).filter((id) => db.find('walls', id)),
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
    const defaultContent =
      validContent(req.body?.defaultContent) || (req.body?.defaultPlaylistId ? validContent('p:' + req.body.defaultPlaylistId) : '') || d.defaultContent || '';
    db.update('displays', d.id, {
      authorized: true,
      code: null,
      name: str(req.body?.name, 100) || d.name,
      defaultContent,
      defaultPlaylistId: defaultContent.startsWith('p:') ? defaultContent.slice(2) : null,
      number: d.number || nextDisplayNumber(),
    });
    send(d.id, { type: 'authorized' });
    changed('display');
    log(`Pantalla autorizada: ${d.id}`);
    res.json(publicDisplay(db.find('displays', d.id)));
  });

  function nextDisplayNumber() {
    return Math.max(0, ...db.get('displays').map((x) => x.number || 0)) + 1;
  }

  app.put('/api/displays/:id', requireAdmin, (req, res) => {
    const d = db.find('displays', req.params.id);
    if (!d) return bad(res, 'No encontrado', 404);
    const patch = {};
    if (req.body.name !== undefined) patch.name = str(req.body.name, 100) || d.name;
    if (req.body.defaultContent !== undefined) {
      patch.defaultContent = validContent(req.body.defaultContent);
      patch.defaultPlaylistId = patch.defaultContent.startsWith('p:') ? patch.defaultContent.slice(2) : null;
    }
    if (req.body.number !== undefined) patch.number = num(req.body.number, d.number, 1, 9999);
    if (req.body.orientation !== undefined)
      patch.orientation = ['auto', 'landscape', 'portrait', 'reverseLandscape', 'reversePortrait'].includes(req.body.orientation)
        ? req.body.orientation
        : 'auto';
    if (req.body.location !== undefined) patch.location = str(req.body.location, 200);
    if (req.body.performance !== undefined) patch.performance = ['auto', 'lite', 'high'].includes(req.body.performance) ? req.body.performance : 'auto';
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
    db.get('walls').forEach((w) => {
      if (w.cells.some((c) => c.displayId === id)) db.update('walls', w.id, { cells: w.cells.filter((c) => c.displayId !== id) });
    });
    res.json({ ok: true });
  });

  function commandPayload(body) {
    const type = body.type;
    if (type === 'reload' || type === 'clearAnnouncement') return { type };
    if (type === 'identify') return { type, seconds: num(body.seconds, 15, 3, 120) };
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

  /** Datos que muestra "Identificar": número grande de la pantalla, como en Windows. */
  function identifyPayload(d, seconds) {
    const w = wallOf(d.id);
    return {
      type: 'identify',
      number: d.number || 0,
      name: d.name,
      detail: w ? `${w.wall.name} · fila ${w.cell.row + 1}, columna ${w.cell.col + 1}` : d.location || '',
      seconds,
    };
  }

  app.post('/api/displays/identify-all', requireAdmin, (req, res) => {
    const seconds = num(req.body?.seconds, 15, 3, 120);
    const list = db.get('displays').filter((d) => d.authorized);
    const delivered = list.reduce((t, d) => t + (send(d.id, identifyPayload(d, seconds)) ? 1 : 0), 0);
    res.json({ delivered, total: list.length });
  });

  app.post('/api/displays/:id/command', requireAdmin, (req, res) => {
    const d = db.find('displays', req.params.id);
    if (!d) return bad(res, 'No encontrado', 404);
    try {
      let msg = commandPayload(req.body || {});
      if (msg.type === 'identify') msg = identifyPayload(d, msg.seconds);
      const n = send(req.params.id, msg);
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
      ticker: { enabled: !!p.ticker?.enabled, ...tickerFields(p.ticker) },
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
          if (m.type === 'video' && m.naturalDuration) item.naturalDuration = m.naturalDuration;
          if (m.type === 'web') item.url = m.url;
          if (m.type === 'text') item.text = m.text;
          return item;
        })
        .filter(Boolean),
    };
  }

  /** Añade al manifiesto un contenido y todo lo que necesita (listas de las zonas de un layout). */
  function collectContent(key, playlists, layouts) {
    const r = contentRecord(key);
    if (!r) return;
    if (key.startsWith('p:')) {
      playlists[r.id] = playlistPayload(r);
      return;
    }
    layouts[r.id] = { id: r.id, name: r.name, orientation: r.orientation, background: r.background, regions: r.regions };
    r.regions.forEach((reg) => {
      if (reg.type === 'playlist' && reg.playlistId) {
        const p = db.find('playlists', reg.playlistId);
        if (p) playlists[p.id] = playlistPayload(p);
      }
    });
  }

  function buildManifest(d) {
    const schedules = schedulesFor(d).map(({ id, name, days, startTime, endTime, startDate, endDate, priority, ...s }) => {
      const content = PCSchedule.contentKey(s);
      return {
        id,
        name,
        content,
        playlistId: content.startsWith('p:') ? content.slice(2) : null, // compatibilidad con la app 1.0
        days,
        startTime,
        endTime,
        startDate,
        endDate,
        priority,
      };
    });
    const defaultContent = defaultContentFor(d);
    const keys = new Set(schedules.map((s) => s.content));
    if (defaultContent) keys.add(defaultContent);
    const playlists = {};
    const layouts = {};
    keys.forEach((k) => collectContent(k, playlists, layouts));
    const files = new Map();
    Object.values(playlists).forEach((p) =>
      p.items.forEach((it) => {
        if (it.file) files.set(it.file, { file: it.file, url: it.url, size: it.size, md5: it.md5 });
      })
    );
    const w = wallOf(d.id);
    return {
      version: db.contentVersion,
      serverTime: new Date().toISOString(),
      display: { id: d.id, name: d.name, number: d.number || 0, orientation: d.orientation || 'auto', performance: d.performance || 'auto' },
      wall: w
        ? { id: w.wall.id, name: w.wall.name, rows: w.wall.rows, cols: w.wall.cols, row: w.cell.row, col: w.cell.col }
        : null,
      defaultContent,
      defaultPlaylistId: defaultContent.startsWith('p:') ? defaultContent.slice(2) : null,
      schedules: schedules.filter((s) => contentRecord(s.content)),
      playlists,
      layouts,
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
    // Los errores del servidor HTTP (p. ej. puerto ocupado) se gestionan en server.on('error')
    wss.on('error', () => {});
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
  const HOST = process.env.HOST || '0.0.0.0'; // todas las interfaces de red
  server.listen(PORT, HOST, () => {
    // Direcciones IPv4 de la red local: son las que hay que escribir en los dispositivos
    const lan = Object.entries(require('os').networkInterfaces())
      .flatMap(([name, list]) => (list || []).map((i) => ({ name, ...i })))
      .filter((i) => (i.family === 'IPv4' || i.family === 4) && !i.internal);
    console.log(`\n  PubliCast CMS escuchando en el puerto ${PORT}`);
    console.log(`  Panel de administración:  http://localhost:${PORT}/admin/`);
    if (lan.length) {
      console.log('\n  Dirección para la app Android / otros equipos de la red:');
      lan.forEach((i) => console.log(`    http://${i.address}:${PORT}    (${i.name})`));
    } else {
      console.log('\n  No se detectó ninguna red local: conecte el equipo a la red.');
    }
    console.log('');
  });
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') console.error(`\n  El puerto ${PORT} ya está en uso. Cierre el otro programa o use otro puerto (set PORT=8081).\n`);
    else console.error(e);
    process.exit(1);
  });
  const shutdown = () => {
    db.flushSync();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { createApp };
