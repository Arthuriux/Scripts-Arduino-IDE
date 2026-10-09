/* PubliCast — reproductor web (misma lógica que la app Android) */
'use strict';
(function () {
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const PREVIEW = params.get('preview');
  const BASE = location.origin;
  const VERSION = '1.0.0';

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
    sequenceKey: '',
    sequence: [],
    index: 0,
    timer: null,
    current: null,
    activeLayer: 'a',
    stats: [],
    ws: null,
    wsRetry: 1000,
    announceTimer: null,
  };

  function show(id, visible) {
    $(id).classList.toggle('hidden', !visible);
  }
  function setStatus(text) {
    $('status').textContent = text || '';
    show('status', !!text);
  }

  async function request(method, path, body) {
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
    } catch (e) {
      if (e.status === 401 || e.status === 403) return handleUnpaired();
      setStatus('Sin conexión · reproduciendo contenido guardado');
    }
  }

  function handleUnpaired() {
    state.manifest = null;
    store.set('manifest', '');
    clearTimeout(state.timer);
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
        overlay(state.manifest?.display?.name || 'PubliCast', 10);
        break;
      case 'announce':
        announce(msg);
        break;
      case 'clearAnnouncement':
        clearAnnouncement();
        break;
    }
  }

  function overlay(text, seconds) {
    $('overlay').textContent = text;
    show('overlay', true);
    setTimeout(() => show('overlay', false), seconds * 1000);
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

  // ------------------------------------------------------------ reproducción
  /** Calcula la secuencia actual a partir de la programación (o de la lista de vista previa). */
  function currentSequence() {
    const m = state.manifest;
    if (!m) return { key: '', items: [], playlist: null };
    const r = PCSchedule.resolve(m.schedules, m.defaultPlaylistId, new Date());
    const lists = r.playlistIds.map((id) => m.playlists[id]).filter((p) => p && p.items.length);
    if (!lists.length) return { key: '', items: [], playlist: null };
    // Intercalar contenidos cuando hay varias listas con la misma prioridad
    const items = [];
    const max = Math.max(...lists.map((p) => p.items.length));
    for (let i = 0; i < max; i++) lists.forEach((p) => p.items[i] && items.push({ ...p.items[i], playlistId: p.id, playlistName: p.name }));
    return { key: lists.map((p) => p.id).join('+') + '@' + m.version, items, playlist: lists[0] };
  }

  function startPlayback() {
    if (state.started) return;
    state.started = true;
    next();
    setInterval(checkSchedule, 30000);
  }

  function checkSchedule() {
    const seq = currentSequence();
    if (seq.key !== state.sequenceKey) next();
  }

  function next() {
    clearTimeout(state.timer);
    finishStat();
    const seq = currentSequence();
    if (seq.key !== state.sequenceKey) {
      state.sequenceKey = seq.key;
      state.sequence = seq.items;
      state.index = 0;
      applyPlaylistChrome(seq.playlist);
    }
    if (!state.sequence.length) {
      $('idle-name').textContent = state.manifest?.display?.name || 'PubliCast';
      $('idle-msg').textContent = state.manifest ? 'Sin contenido programado en este momento' : 'Conectando con el servidor…';
      show('idle', true);
      clearLayers();
      state.current = null;
      state.timer = setTimeout(next, 15000);
      return;
    }
    show('idle', false);
    const item = state.sequence[state.index % state.sequence.length];
    state.index++;
    // Un único contenido estático: no volver a dibujarlo para evitar parpadeos
    if (state.sequence.length === 1 && state.current && state.current.id === item.id && item.type !== 'video') {
      beginStat(item);
      state.timer = setTimeout(next, (item.duration || 10) * 1000);
      return;
    }
    render(item, seq.playlist || {});
  }

  function applyPlaylistChrome(p) {
    document.body.style.background = p?.background || '#000';
    const t = p?.ticker;
    if (t && t.enabled && t.text) {
      const box = $('ticker');
      const track = $('ticker-track');
      box.style.background = t.bg;
      box.style.color = t.color;
      track.textContent = `${t.text}     •     `.repeat(3);
      show('ticker', true);
      requestAnimationFrame(() => {
        const dist = track.scrollWidth;
        track.style.animation = `ticker ${Math.max(5, dist / (t.speed || 80))}s linear infinite`;
      });
    } else {
      show('ticker', false);
    }
  }

  function clearLayers() {
    ['layer-a', 'layer-b'].forEach((id) => {
      const el = $(id);
      el.className = 'layer';
      el.replaceChildren();
    });
  }

  function render(item, playlist) {
    const inId = state.activeLayer === 'a' ? 'layer-b' : 'layer-a';
    const outId = state.activeLayer === 'a' ? 'layer-a' : 'layer-b';
    const incoming = $(inId);
    const outgoing = $(outId);
    const transition = playlist.transition || 'fade';
    const fit = playlist.fit || 'contain';
    const durationMs = (item.duration || 10) * 1000;
    let el;
    let done = false;
    const advance = () => {
      if (done) return;
      done = true;
      next();
    };

    if (item.type === 'image') {
      el = document.createElement('img');
      el.src = BASE + item.url;
      el.style.objectFit = fit;
      el.onerror = () => setTimeout(advance, 1000);
      state.timer = setTimeout(advance, durationMs);
    } else if (item.type === 'video') {
      el = document.createElement('video');
      el.src = BASE + item.url;
      el.muted = true;
      el.autoplay = true;
      el.playsInline = true;
      el.style.objectFit = fit;
      el.onended = advance;
      el.onerror = () => setTimeout(advance, 1000);
      el.play().catch(() => {});
      // duración 0 = video completo (con límite de seguridad de 3 h)
      state.timer = setTimeout(advance, item.duration > 0 ? durationMs : 3 * 3600 * 1000);
    } else if (item.type === 'web') {
      el = document.createElement('iframe');
      el.src = item.url;
      el.setAttribute('allow', 'autoplay; fullscreen');
      el.setAttribute('referrerpolicy', 'no-referrer');
      state.timer = setTimeout(advance, durationMs);
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
      state.timer = setTimeout(advance, durationMs);
    } else {
      state.timer = setTimeout(advance, 1000);
      return;
    }

    incoming.replaceChildren(el);
    incoming.className = 'layer ' + (transition === 'slide' ? 'slide enter' : transition === 'fade' ? 'fade' : '');
    outgoing.className = 'layer ' + (transition === 'slide' ? 'slide active' : transition === 'fade' ? 'fade active' : 'active');
    // forzar reflow para que la transición se aplique
    void incoming.offsetWidth;
    requestAnimationFrame(() => {
      incoming.classList.remove('enter');
      incoming.classList.add('active');
      outgoing.classList.remove('active');
      if (transition === 'slide') outgoing.classList.add('leave');
      setTimeout(() => {
        if (!outgoing.classList.contains('active')) {
          const v = outgoing.querySelector('video');
          if (v) v.pause();
          outgoing.replaceChildren();
          outgoing.className = 'layer';
        }
      }, 900);
    });
    state.activeLayer = inId === 'layer-a' ? 'a' : 'b';
    state.current = item;
    beginStat(item);
  }

  // ------------------------------------------------------------ estadísticas y latido
  function beginStat(item) {
    state.playing = { item, started: Date.now() };
  }
  function finishStat() {
    const p = state.playing;
    state.playing = null;
    if (!p || PREVIEW) return;
    const secs = Math.round((Date.now() - p.started) / 1000);
    if (secs < 1) return;
    state.stats.push({ mediaId: p.item.mediaId, playlistId: p.item.playlistId, startedAt: new Date(p.started).toISOString(), duration: secs });
  }

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
    try {
      const r = await request('POST', '/api/player/heartbeat', {
        currentItem: state.current?.name || '',
        currentPlaylist: state.current?.playlistName || '',
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
      const res = await fetch('/api/playlists/' + encodeURIComponent(PREVIEW) + '/preview');
      if (!res.ok) throw new Error('No se pudo cargar la vista previa');
      const p = await res.json();
      state.manifest = { version: 0, display: { name: 'Vista previa' }, schedules: [], defaultPlaylistId: p.id, playlists: { [p.id]: p } };
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
