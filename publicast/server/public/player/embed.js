/* Envuelve el reproductor de YouTube/TikTok/Vimeo/Facebook con reproducción automática y
   avisa al reproductor de PubliCast (web o Android) cuando el video termina o falla. */
'use strict';
(function () {
  const q = new URLSearchParams(location.search);
  const info = { provider: q.get('p'), id: q.get('id') || '', url: q.get('u') || '' };
  let mute = q.get('mute') === '1';
  const msg = document.getElementById('msg');

  /** Aviso al reproductor: Android (puente JavaScript) y navegador (postMessage). */
  function notify(event, detail) {
    try {
      if (window.PubliCastBridge) window.PubliCastBridge.event(event, String(detail || ''));
    } catch (e) {}
    try {
      parent.postMessage({ publicast: event, detail: detail || '' }, '*');
    } catch (e) {}
  }

  if (info.provider === 'youtube' && info.id) {
    window.onYouTubeIframeAPIReady = function () {
      let started = false;
      const player = new YT.Player('v', {
        videoId: info.id,
        host: 'https://www.youtube.com',
        playerVars: { autoplay: 1, mute: mute ? 1 : 0, controls: 0, rel: 0, playsinline: 1, modestbranding: 1, iv_load_policy: 3, fs: 0, disablekb: 1, origin: location.origin },
        events: {
          onReady: (e) => {
            msg.textContent = '';
            if (mute) e.target.mute();
            e.target.playVideo();
            notify('duration', Math.round(e.target.getDuration() || 0));
            // Si el navegador bloquea el audio automático, se reintenta en silencio
            setTimeout(() => {
              if (!started) {
                e.target.mute();
                e.target.playVideo();
              }
            }, 2500);
          },
          onStateChange: (e) => {
            if (e.data === YT.PlayerState.PLAYING) started = true;
            if (e.data === YT.PlayerState.ENDED) notify('ended');
          },
          onError: (e) => {
            // 101/150: el dueño no permite incrustarlo · 100: eliminado o privado
            msg.textContent = 'Este video no se puede reproducir incrustado (código ' + e.data + ').';
            notify('error', 'youtube ' + e.data);
          },
        },
      });
      window.__player = player;
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => {
      msg.textContent = 'Sin conexión con YouTube';
      notify('error', 'offline');
    };
    document.head.append(s);
  } else if (info.provider && window.PCStream) {
    const f = document.createElement('iframe');
    f.allow = 'autoplay; encrypted-media; picture-in-picture';
    f.src = PCStream.embedUrl(info, { mute, loop: true });
    f.onload = () => (msg.textContent = '');
    document.getElementById('v').replaceWith(f);
  } else {
    msg.textContent = 'Enlace de video no válido';
    notify('error', 'invalid');
  }
})();
