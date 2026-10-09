/* PubliCast — reproductor web (misma lógica que la app Android) */
'use strict';
(function () {
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const PREVIEW = params.get('preview');
  const BASE = location.origin;
  const VERSION = '1.1.0';

  const store = {
    get(k) {
      try {
        return localStorage.getItem('publicast.' + k);
      } catch {
        return null;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem('publicast.' + k, v);
      } catch {}
    },
  };

  function displayKey() {
    let key = store.get('key');
    if (!key) {
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      key = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      store.set('key', key);
    }
    return key;
  }

  const state = {
    manifest: null,
    renderKey: null,
    regions: [],
    widgets: [],
    stats: [],
    ws: null,
    wsRetry: 1000,
    announceTimer: null,
    identifyTimer: null,
    clockOffset: 0, // milisegundos que hay que sumar a la hora local para obtener la del servidor
    started: false,
  };

  const serverNow = () => Date.now() + state.clockOffset;

  function show(id, visible) {
    $(id).classList.toggle('hidden', !visible);
  }
  function setStatus(text) {
    $('status').textContent = text || '';
    show('status', !!text);
  }

  async function request(method, path, body) {
    const sent = Date.now();
    const res = await fetch(BASE + path, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + displayKey() },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'HTTP ' + res.status);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    if (data.serverTime) {
      // Sincronía de reloj (necesaria en videowalls): se compensa la mitad del tiempo de ida y vuelta
      const now = Date.now();
      state.clockOffset = Date.parse(data.serverTime) - (sent + now) / 2;
    }
    return data;
  }

  function deviceInfo() {
    return {
      model: 'Navegador web',
      platform: navigator.platform || '',
      userAgent: navigator.userAgent.slice(0, 180),
      resolution: `${screen.width}x${screen.height}`,
      appVersion: VERSION,
    };
  }

  // ------------------------------------------------------------ emparejamiento
  async function register() {
    try {
      const r = await request('POST', '/api/player/register', { key: displayKey(), info: deviceInfo() });
      if (!r.authorized) {
        $('pair-code').textContent = r.code;
        $('pair-server').textContent = 'Servidor: ' + BASE;
        show('pairing', true);
        connectSocket();
        setTimeout(register, 5000);
        return;
      }
      show('pairing', false);
      connectSocket();
      await sync();
      startPlayback();
    } catch (e) {
      setStatus('Sin conexión con el servidor…');
      const cached = store.get('manifest');
      if (cached && !state.manifest) {
        state.manifest = JSON.parse(cached);
        startPlayback();
      }
      setTimeout(register, 10000);
    }
  }

  async function sync() {
    try {
      const m = await request('GET', '/api/player/manifest');
      state.manifest = m;
      store.set('manifest', JSON.stringify(m));
      setStatus('');
      preload(m);
      if (state.started) refresh();
    } catch (e) {
      if (e.status === 401 || e.status === 403) return handleUnpaired();
      setStatus('Sin conexión · reproduciendo contenido guardado');
    }
  }

  function handleUnpaired() {
    state.manifest = null;
    store.set('manifest', '');
    teardown();
    register();
  }

  /** Precarga en la caché del navegador las imágenes y videos para reproducir sin cortes. */
  function preload(m) {
    (m.files || []).forEach((f) => {
      fetch(BASE + f.url, { cache: 'force-cache' }).catch(() => {});
    });
  }

  // ------------------------------------------------------------ WebSocket
  function connectSocket() {
    if (PREVIEW || (state.ws && state.ws.readyState <= 1)) return;
    const url = BASE.replace(/^http/, 'ws') + '/ws?key=' + encodeURIComponent(displayKey());
    const ws = new WebSocket(url);
    state.ws = ws;
    ws.onopen = () => (state.wsRetry = 1000);
    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      handleMessage(msg);
    };
    ws.onclose = () => {
      state.ws = null;
      setTimeout(connectSocket, state.wsRetry);
      state.wsRetry = Math.min(state.wsRetry * 2, 60000);
    };
  }

  function handleMessage(msg) {
    switch (msg.type) {
      case 'hello':
      case 'version':
        if (state.manifest && msg.version !== state.manifest.version) sync();
        break;
      case 'authorized':
        register();
        break;
      case 'unpaired':
        handleUnpaired();
        break;
      case 'reload':
        location.reload();
        break;
      case 'identify':
        identify(msg);
        break;
      case 'announce':
        announce(msg);
        break;
      case 'clearAnnouncement':
        clearAnnouncement();
        break;
    }
  }

  /** Número grande de la pantalla, como "Identificar" en la configuración de pantallas de Windows. */
  function identify(msg) {
    const m = state.manifest;
    $('id-number').textContent = msg.number || m?.display?.number || '?';
    $('id-name').textContent = msg.name || m?.display?.name || '';
    $('id-detail').textContent = msg.detail || '';
    show('identify', true);
    clearTimeout(state.identifyTimer);
    state.identifyTimer = setTimeout(() => show('identify', false), (msg.seconds || 15) * 1000);
  }

  function announce(msg) {
    const el = $('announce');
    el.className = msg.position || 'full';
    el.style.background = msg.bg;
    el.style.color = msg.color;
    $('announce-text').textContent = msg.text;
    clearTimeout(state.announceTimer);
    state.announceTimer = setTimeout(clearAnnouncement, (msg.duration || 30) * 1000);
  }
  function clearAnnouncement() {
    $('announce').className = 'hidden';
  }

  // ------------------------------------------------------------ qué reproducir
  /** Decide el contenido actual: un layout o una o varias listas intercaladas. */
  function currentContent() {
    const m = state.manifest;
    if (!m) return null;
    const r = PCSchedule.resolve(m.schedules, m.defaultContent || m.defaultPlaylistId, new Date(serverNow()));
    const layoutKey = r.keys.find((k) => k.startsWith('l:') && m.layouts?.[k.slice(2)]);
    if (layoutKey) return { key: layoutKey, layout: m.layouts[layoutKey.slice(2)] };
    const lists = r.keys
      .filter((k) => k.startsWith('p:'))
      .map((k) => m.playlists[k.slice(2)])
      .filter((p) => p && p.items.length);
    if (!lists.length) return null;
    return { key: lists.map((p) => 'p:' + p.id).join('+'), lists };
  }

  /** Intercala los contenidos de varias listas con la misma prioridad. */
  function interleave(lists) {
    const items = [];
    const max = Math.max(...lists.map((p) => p.items.length));
    for (let i = 0; i < max; i++) lists.forEach((p) => p.items[i] && items.push({ ...p.items[i], playlistId: p.id, playlistName: p.name }));
    return items;
  }

  function startPlayback() {
    if (state.started) return;
    state.started = true;
    refresh();
    setInterval(refresh, 15000);
  }

  function refresh() {
    const m = state.manifest;
    const content = currentContent();
    const wall = m?.wall;
    const key = content ? `${content.key}@${m.version}|${wall ? `${wall.rows}x${wall.cols}:${wall.row},${wall.col}` : ''}` : '';
    if (key === state.renderKey) return;
    state.renderKey = key;
    build(content, wall);
  }

  function teardown() {
    state.regions.forEach((r) => r.stop());
    state.widgets.forEach((w) => w.stop());
    state.regions = [];
    state.widgets = [];
    $('canvas').replaceChildren();
    state.renderKey = null;
  }

  /** Construye la pantalla: zonas del layout (o una zona a pantalla completa) y videowall. */
  function build(content, wall) {
    teardown();
    const canvas = $('canvas');
    // Videowall: el lienzo mide (columnas × filas) pantallas y cada una muestra su porción
    if (wall) {
      canvas.style.width = wall.cols * 100 + 'vw';
      canvas.style.height = wall.rows * 100 + 'vh';
      canvas.style.transform = `translate(${-wall.col * 100}vw, ${-wall.row * 100}vh)`;
    } else {
      canvas.style.width = '100vw';
      canvas.style.height = '100vh';
      canvas.style.transform = '';
    }
    if (!content) {
      $('idle-name').textContent = state.manifest?.display?.name || 'PubliCast';
      $('idle-msg').textContent = state.manifest ? 'Sin contenido programado en este momento' : 'Conectando con el servidor…';
      show('idle', true);
      return;
    }
    show('idle', false);
    const sync = !!wall;
    if (content.lists) {
      const first = content.lists[0];
      canvas.style.background = first.background || '#000';
      const el = regionEl(canvas, { x: 0, y: 0, w: 100, h: 100, z: 0 });
      state.regions.push(new RegionPlayer(el, interleave(content.lists), first, sync));
      if (first.ticker?.enabled && first.ticker.text) state.widgets.push(PCWidgets.makeTicker(canvas, first.ticker, false));
    } else {
      const l = content.layout;
      canvas.style.background = l.background || '#000';
      l.regions
        .slice()
        .sort((a, b) => a.z - b.z)
        .forEach((r) => {
          const el = regionEl(canvas, r);
          if (r.type === 'ticker' && r.ticker?.text) state.widgets.push(PCWidgets.makeTicker(el, r.ticker, true));
          else if (r.type === 'clock') state.widgets.push(PCWidgets.makeClock(el, r.clock || {}, () => new Date(serverNow())));
          else if (r.type === 'playlist') {
            const p = state.manifest.playlists[r.playlistId];
            if (p && p.items.length) state.regions.push(new RegionPlayer(el, interleave([p]), p, sync));
          }
        });
    }
  }

  function regionEl(canvas, r) {
    const el = document.createElement('div');
    el.className = 'region';
    Object.assign(el.style, { left: r.x + '%', top: r.y + '%', width: r.w + '%', height: r.h + '%', zIndex: r.z || 0 });
    canvas.append(el);
    return el;
  }

  // ------------------------------------------------------------ reproductor de una zona
  /** Estado inicial del contenido que entra y final del que sale (null = corte). */
  const FRAMES = {
    fade: { in: 'none', fade: true },
    slide: { in: 'translateX(100%)', out: 'translateX(-100%)' },
    'slide-right': { in: 'translateX(-100%)', out: 'translateX(100%)' },
    'slide-up': { in: 'translateY(100%)', out: 'translateY(-100%)' },
    'slide-down': { in: 'translateY(-100%)', out: 'translateY(100%)' },
    zoom: { in: 'scale(1.18)', fade: true },
    none: null,
  };
  const durationOf = (item) => (item.duration > 0 ? item.duration : item.type === 'video' ? item.naturalDuration || 30 : 10);

  class RegionPlayer {
    constructor(el, items, playlist, sync) {
      this.el = el;
      this.items = items;
      this.transition = playlist.transition || 'fade';
      this.transitionMs = playlist.transitionDuration || 800;
      this.fit = playlist.fit || 'contain';
      this.sync = sync;
      this.index = 0;
      this.timer = null;
      this.current = null;
      this.playing = null;
      el.style.background = playlist.background || '#000';
      this.layers = [0, 1].map(() => {
        const l = document.createElement('div');
        l.className = 'layer';
        el.append(l);
        return l;
      });
      this.active = 0;
      this.stopped = false;
      this.cleanups = [];
      this.next();
    }

    stop() {
      this.stopped = true;
      clearTimeout(this.timer);
      this.cleanups.splice(0).forEach((f) => f());
      this.finishStat();
      this.layers.forEach((l) => {
        l.querySelector('video')?.pause();
        l.replaceChildren();
      });
    }

    /** En videowall todas las pantallas calculan el mismo contenido a partir de la hora del servidor. */
    syncPosition() {
      const total = this.items.reduce((t, it) => t + durationOf(it), 0);
      let t = (serverNow() / 1000) % total;
      for (let i = 0; i < this.items.length; i++) {
        const d = durationOf(this.items[i]);
        if (t < d) return { index: i, offset: t, remaining: d - t };
        t -= d;
      }
      return { index: 0, offset: 0, remaining: durationOf(this.items[0]) };
    }

    next() {
      if (this.stopped) return;
      clearTimeout(this.timer);
      this.cleanups.splice(0).forEach((f) => f());
      this.finishStat();
      let item;
      let offset = 0;
      let remaining;
      if (this.sync) {
        const p = this.syncPosition();
        item = this.items[p.index];
        offset = p.offset;
        remaining = p.remaining;
      } else {
        item = this.items[this.index % this.items.length];
        this.index++;
      }
      // Un único contenido estático: no se vuelve a dibujar para evitar parpadeos
      if (this.items.length === 1 && this.current && this.current.id === item.id && item.type !== 'video' && item.type !== 'stream') {
        this.beginStat(item);
        this.timer = setTimeout(() => this.next(), (remaining || durationOf(item)) * 1000);
        return;
      }
      this.render(item, offset, remaining);
    }

    render(item, offset, remaining) {
      const incoming = this.layers[1 - this.active];
      const outgoing = this.layers[this.active];
      const transition = this.sync ? 'none' : item.transition || this.transition;
      const waitMs = (remaining || durationOf(item)) * 1000;
      let el;
      let done = false;
      const advance = () => {
        if (done) return;
        done = true;
        this.next();
      };

      if (item.type === 'image') {
        el = document.createElement('img');
        el.src = BASE + item.url;
        el.style.objectFit = this.fit;
        el.onerror = () => setTimeout(advance, 1000);
        this.timer = setTimeout(advance, waitMs);
      } else if (item.type === 'video') {
        el = document.createElement('video');
        el.src = BASE + item.url;
        el.muted = true;
        el.autoplay = true;
        el.playsInline = true;
        el.style.objectFit = this.fit;
        el.onerror = () => setTimeout(advance, 1000);
        if (this.sync) {
          el.addEventListener('loadedmetadata', () => {
            if (offset > 0.5 && offset < el.duration) el.currentTime = offset;
          });
          this.timer = setTimeout(advance, waitMs);
        } else {
          el.onended = advance;
          // duración 0 = video completo (con límite de seguridad de 3 h)
          this.timer = setTimeout(advance, item.duration > 0 ? item.duration * 1000 : 3 * 3600 * 1000);
        }
        el.play().catch(() => {});
      } else if (item.type === 'stream') {
        // Video en línea: la página embed.html avisa con postMessage cuando termina o falla
        el = document.createElement('iframe');
        el.src = BASE + item.url;
        el.setAttribute('allow', 'autoplay; encrypted-media; fullscreen');
        const frame = el;
        const onMsg = (ev) => {
          if (ev.source !== frame.contentWindow || !ev.data || !ev.data.publicast) return;
          if (ev.data.publicast === 'ended' && !(item.duration > 0)) advance();
          if (ev.data.publicast === 'error') setTimeout(advance, 1500);
        };
        window.addEventListener('message', onMsg);
        this.cleanups.push(() => window.removeEventListener('message', onMsg));
        const untilEnd = item.stream?.provider === 'youtube';
        // duración 0 = hasta que termine (YouTube); los demás servicios no avisan: 30 s por defecto
        this.timer = setTimeout(advance, item.duration > 0 ? item.duration * 1000 : untilEnd ? 3 * 3600 * 1000 : 30000);
      } else if (item.type === 'web' || item.type === 'html') {
        el = document.createElement('iframe');
        el.src = item.type === 'html' ? BASE + item.url : item.url;
        el.setAttribute('allow', 'autoplay; fullscreen');
        el.setAttribute('referrerpolicy', 'no-referrer');
        this.timer = setTimeout(advance, waitMs);
      } else if (item.type === 'text') {
        const t = item.text || {};
        el = document.createElement('div');
        el.className = 'text-slide';
        el.style.background = t.bg;
        el.style.color = t.color;
        el.style.textAlign = t.align || 'center';
        const title = document.createElement('div');
        title.className = 't';
        title.style.color = t.accent;
        title.textContent = t.title || '';
        const body = document.createElement('div');
        body.className = 'b';
        body.textContent = t.body || '';
        el.append(title, body);
        this.timer = setTimeout(advance, waitMs);
      } else {
        this.timer = setTimeout(advance, 1000);
        return;
      }

      incoming.replaceChildren(el);
      this.animate(incoming, outgoing, transition);
      this.active = 1 - this.active;
      this.current = item;
      this.beginStat(item);
    }

    /** Transición entre capas: fundido, deslizar en 4 direcciones, zoom o corte. */
    animate(incoming, outgoing, type) {
      const f = FRAMES[type] === undefined ? FRAMES.fade : FRAMES[type];
      const ms = this.transitionMs;
      [incoming, outgoing].forEach((l) => (l.style.transition = 'none'));
      incoming.className = 'layer';
      outgoing.className = 'layer active';
      incoming.style.zIndex = 2;
      outgoing.style.zIndex = 1;
      incoming.style.opacity = f && f.fade ? 0 : 1;
      incoming.style.transform = f ? f.in : 'none';
      outgoing.style.opacity = 1;
      outgoing.style.transform = 'none';
      void incoming.offsetWidth; // fuerza el reflow para que se aplique la transición
      requestAnimationFrame(() => {
        if (f) {
          const tr = `transform ${ms}ms ease, opacity ${ms}ms ease`;
          incoming.style.transition = tr;
          if (f.out) outgoing.style.transition = tr;
        }
        incoming.classList.add('active');
        incoming.style.opacity = 1;
        incoming.style.transform = 'none';
        if (f && f.out) outgoing.style.transform = f.out;
        outgoing.classList.remove('active');
        setTimeout(
          () => {
            if (!outgoing.classList.contains('active')) {
              outgoing.querySelector('video')?.pause();
              outgoing.replaceChildren();
              outgoing.style.opacity = 0;
              outgoing.style.transform = 'none';
            }
          },
          f ? ms + 100 : 50
        );
      });
    }

    beginStat(item) {
      this.playing = { item, started: Date.now() };
    }

    finishStat() {
      const p = this.playing;
      this.playing = null;
      if (!p || PREVIEW) return;
      const secs = Math.round((Date.now() - p.started) / 1000);
      if (secs < 1) return;
      state.stats.push({ mediaId: p.item.mediaId, playlistId: p.item.playlistId, startedAt: new Date(p.started).toISOString(), duration: secs });
    }
  }

  // ------------------------------------------------------------ estadísticas y latido
  async function flushStats() {
    if (!state.stats.length) return;
    const batch = state.stats.splice(0, state.stats.length);
    try {
      await request('POST', '/api/player/stats', { records: batch });
    } catch {
      state.stats.unshift(...batch.slice(-2000));
    }
  }

  async function heartbeat() {
    if (!state.manifest) return;
    const cur = state.regions[0]?.current;
    try {
      const r = await request('POST', '/api/player/heartbeat', {
        currentItem: cur?.name || '',
        currentPlaylist: cur?.playlistName || '',
        contentVersion: state.manifest.version,
        cacheReady: true,
        info: deviceInfo(),
      });
      setStatus('');
      if (r.version !== state.manifest.version) sync();
    } catch (e) {
      if (e.status === 401 || e.status === 403) handleUnpaired();
      else setStatus('Sin conexión · reproduciendo contenido guardado');
    }
    flushStats();
  }

  // ------------------------------------------------------------ inicio
  async function startPreview() {
    try {
      const key = PREVIEW.includes(':') ? PREVIEW : 'p:' + PREVIEW;
      const res = await fetch('/api/preview?content=' + encodeURIComponent(key));
      if (!res.ok) throw new Error('No se pudo cargar la vista previa');
      state.manifest = await res.json();
      startPlayback();
    } catch (e) {
      $('idle-msg').textContent = e.message;
      show('idle', true);
    }
  }

  document.addEventListener('dblclick', () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
  });

  if (PREVIEW) startPreview();
  else {
    register();
    setInterval(heartbeat, 60000);
    setInterval(() => state.manifest && sync(), 15 * 60000);
  }
})();
