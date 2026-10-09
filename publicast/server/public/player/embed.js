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
    // En la app Android (puente presente) no hay bloqueo de audio automático: el sonido se respeta siempre.
    const inApp = !!window.PubliCastBridge;
    window.onYouTubeIframeAPIReady = function () {
      let mutedByBrowser = false; // el navegador bloqueó el audio y hubo que silenciar para poder reproducir
      let ended = false;
      const player = new YT.Player('v', {
        videoId: info.id,
        host: 'https://www.youtube.com',
        playerVars: { autoplay: 1, mute: mute ? 1 : 0, controls: 0, rel: 0, playsinline: 1, modestbranding: 1, iv_load_policy: 3, fs: 0, disablekb: 1, origin: location.origin },
        events: {
          onReady: (e) => {
            const p = e.target;
            msg.textContent = '';
            applySound(p);
            p.playVideo();
            notify('duration', Math.round(p.getDuration() || 0));
            // Sólo si el video NO arrancó (ni siquiera está cargando) es que el navegador bloqueó
            // la reproducción con sonido: se reintenta en silencio. Nunca dentro de la app Android.
            setTimeout(() => {
              const st = p.getPlayerState();
              const S = YT.PlayerState;
              if (ended || st === S.PLAYING || st === S.BUFFERING || st === S.ENDED) return;
              if (!mute && !inApp) {
                mutedByBrowser = true;
                p.mute();
              }
              p.playVideo();
            }, 4000);
            // Vigilante: mantiene el sonido elegido y reanuda si el video se pausa solo
            setInterval(() => {
              if (ended) return;
              const st = p.getPlayerState();
              if (!mute && !mutedByBrowser && p.isMuted()) applySound(p);
              if (st === YT.PlayerState.PAUSED || st === YT.PlayerState.CUED) p.playVideo();
            }, 2000);
          },
          onStateChange: (e) => {
            if (e.data === YT.PlayerState.PLAYING && !mute && !mutedByBrowser) applySound(e.target);
            if (e.data === YT.PlayerState.ENDED) {
              ended = true;
              notify('ended');
              // Si la duración configurada es mayor que el video, vuelve a empezar
              setTimeout(() => {
                ended = false;
                e.target.seekTo(0);
                e.target.playVideo();
              }, 800);
            }
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

    function applySound(p) {
      if (mute) {
        p.mute();
      } else {
        p.unMute();
        p.setVolume(100);
      }
    }

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
