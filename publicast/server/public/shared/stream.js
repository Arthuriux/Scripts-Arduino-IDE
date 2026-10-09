/**
 * Reconoce enlaces de videos en línea (YouTube, Shorts, TikTok, Vimeo, Facebook, Instagram)
 * y arma la dirección del reproductor incrustado con reproducción automática.
 * Lo usan el servidor, el panel y la página /player/embed.html.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PCStream = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PROVIDERS = {
    youtube: { label: 'YouTube', autoplay: true, endDetect: true },
    tiktok: { label: 'TikTok', autoplay: true, endDetect: false },
    vimeo: { label: 'Vimeo', autoplay: true, endDetect: false },
    facebook: { label: 'Facebook', autoplay: true, endDetect: false },
    instagram: { label: 'Instagram', autoplay: false, endDetect: false },
  };

  /** @returns {{provider:string, id:string, url:string} | null} */
  function parse(input) {
    let u;
    try {
      u = new URL(String(input || '').trim());
    } catch {
      return null;
    }
    if (!/^https?:$/.test(u.protocol)) return null;
    const host = u.hostname.replace(/^(www|m|mobile|music)\./, '');
    const path = u.pathname;
    let m;
    if (host === 'youtu.be' && (m = /^\/([\w-]{6,})/.exec(path))) return { provider: 'youtube', id: m[1], url: u.href };
    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      if (u.searchParams.get('v')) return { provider: 'youtube', id: u.searchParams.get('v'), url: u.href };
      if ((m = /^\/(?:shorts|embed|live|v)\/([\w-]{6,})/.exec(path))) return { provider: 'youtube', id: m[1], url: u.href };
    }
    if (host === 'tiktok.com' && (m = /\/video\/(\d+)/.exec(path))) return { provider: 'tiktok', id: m[1], url: u.href };
    if (host === 'vimeo.com' && (m = /^\/(?:video\/)?(\d+)/.exec(path))) return { provider: 'vimeo', id: m[1], url: u.href };
    if (host === 'player.vimeo.com' && (m = /^\/video\/(\d+)/.exec(path))) return { provider: 'vimeo', id: m[1], url: u.href };
    if ((host === 'facebook.com' || host === 'fb.watch') && /\/(reel|videos|watch|share)/.test(path + u.search)) return { provider: 'facebook', id: '', url: u.href };
    if (host === 'fb.watch') return { provider: 'facebook', id: '', url: u.href };
    if (host === 'instagram.com' && (m = /^\/(?:[\w.]+\/)?(?:reel|reels|p|tv)\/([\w-]+)/.exec(path))) return { provider: 'instagram', id: m[1], url: u.href };
    return null;
  }

  /** Dirección del reproductor oficial (para TikTok, Vimeo, Facebook e Instagram). */
  function embedUrl(info, opts) {
    const mute = opts && opts.mute ? 1 : 0;
    const loop = opts && opts.loop ? 1 : 0;
    switch (info.provider) {
      case 'youtube':
        return `https://www.youtube.com/embed/${info.id}?autoplay=1&mute=${mute}&controls=0&rel=0&playsinline=1&modestbranding=1&iv_load_policy=3`;
      case 'tiktok':
        return `https://www.tiktok.com/player/v1/${info.id}?autoplay=1&loop=${loop}&controls=0&progress_bar=0&play_button=0&volume_control=0&fullscreen_button=0&timestamp=0&music_info=0&description=0&rel=0&native_context_menu=0&closed_caption=0`;
      case 'vimeo':
        return `https://player.vimeo.com/video/${info.id}?autoplay=1&muted=${mute}&loop=${loop}&controls=0&title=0&byline=0&portrait=0&dnt=1`;
      case 'facebook':
        return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(info.url)}&show_text=false&autoplay=true&mute=${mute ? 'true' : 'false'}&allowfullscreen=false`;
      case 'instagram':
        return `https://www.instagram.com/reel/${info.id}/embed/`;
    }
    return info.url;
  }

  /** Página propia que envuelve el reproductor y avisa cuándo termina el video. */
  function wrapperPath(s) {
    const q = new URLSearchParams({ p: s.provider, id: s.id || '', u: s.url || '', mute: s.mute ? '1' : '0' });
    return '/player/embed.html?' + q.toString();
  }

  function thumbnail(info) {
    return info.provider === 'youtube' ? `https://i.ytimg.com/vi/${info.id}/hqdefault.jpg` : null;
  }

  return { PROVIDERS, parse, embedUrl, wrapperPath, thumbnail };
});
