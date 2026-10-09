/* PubliCast CMS — Consumo del equipo donde está instalado el servidor */
'use strict';

const fmtUptime = (s) => {
  s = Math.floor(s);
  const d = Math.floor(s / 86400);
  const hh = Math.floor((s % 86400) / 3600);
  const mm = Math.floor((s % 3600) / 60);
  return d ? `${d} d ${hh} h` : hh ? `${hh} h ${mm} min` : `${mm} min`;
};

/** Nivel de uso con texto (el color nunca va solo). */
function level(pct) {
  if (pct >= 90) return { cls: 'crit', label: '⛔ Crítico' };
  if (pct >= 70) return { cls: 'warn', label: '⚠️ Alto' };
  return { cls: '', label: '✅ Normal' };
}

function meterKpi(title, pct, detail) {
  const lv = level(pct);
  return h('div', { class: 'kpi' }, h('span', null, title), h('b', null, pct.toFixed(0) + ' %'), h('div', { class: 'meter ' + lv.cls }, h('div', { style: { width: Math.min(100, pct) + '%' } })), h('small', null, lv.label + ' · ' + detail));
}

/** Gráfico de línea de una serie (0–100 %) con cursor y tooltip. */
function lineChart(points, key, title) {
  const W = 640;
  const H = 220;
  const pad = { l: 36, r: 10, t: 10, b: 24 };
  const wrap = h('div', { class: 'chart' });
  if (points.length < 2) {
    wrap.append(h('div', { class: 'empty' }, 'Recopilando datos… (se toma una muestra cada 5 segundos)'));
    return h('div', { class: 'card' }, h('h2', null, title), wrap);
  }
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const x = (t) => pad.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - pad.l - pad.r);
  const y = (v) => pad.t + (1 - v / 100) * (H - pad.t - pad.b);
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs) => {
    const e = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
    return e;
  };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': title });
  [0, 25, 50, 75, 100].forEach((v) => {
    svg.append(el('line', { class: v ? 'gridl' : 'axis', x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v) }));
    const t = el('text', { class: 'lbl', x: pad.l - 6, y: y(v) + 4, 'text-anchor': 'end' });
    t.textContent = v + '%';
    svg.append(t);
  });
  const timeLbl = (t) => new Date(t).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  [t0, t1].forEach((t, i) => {
    const tx = el('text', { class: 'lbl', x: x(t), y: H - 6, 'text-anchor': i ? 'end' : 'start' });
    tx.textContent = timeLbl(t);
    svg.append(tx);
  });
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p[key]).toFixed(1)}`).join('');
  svg.append(el('path', { class: 'area', d: `${d}L${x(t1)},${y(0)}L${x(t0)},${y(0)}Z` }));
  svg.append(el('path', { class: 'line', d, 'vector-effect': 'non-scaling-stroke' }));
  const cross = el('line', { class: 'cross hidden', y1: pad.t, y2: H - pad.b });
  const dot = el('circle', { class: 'dot hidden', r: 4 });
  svg.append(cross, dot);
  const tip = h('div', { class: 'ctip hidden' });
  wrap.append(svg, tip);
  svg.addEventListener('pointermove', (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = points[0];
    points.forEach((p) => Math.abs(x(p.t) - px) < Math.abs(x(best.t) - px) && (best = p));
    const bx = x(best.t);
    const by = y(best[key]);
    cross.setAttribute('x1', bx);
    cross.setAttribute('x2', bx);
    dot.setAttribute('cx', bx);
    dot.setAttribute('cy', by);
    [cross, dot, tip].forEach((n) => n.classList.remove('hidden'));
    tip.style.left = (bx / W) * r.width + 'px';
    tip.style.top = (by / H) * r.height + 'px';
    tip.textContent = `${new Date(best.t).toLocaleTimeString('es')} · ${best[key].toFixed(1)} %`;
  });
  svg.addEventListener('pointerleave', () => [cross, dot, tip].forEach((n) => n.classList.add('hidden')));
  const last = points[points.length - 1][key];
  const avg = points.reduce((t, p) => t + p[key], 0) / points.length;
  const max = Math.max(...points.map((p) => p[key]));
  return h('div', { class: 'card' }, h('div', { class: 'page-head' }, h('h2', { style: { margin: 0 } }, title), h('span', { class: 'muted' }, `Ahora ${last.toFixed(0)} % · media ${avg.toFixed(0)} % · máximo ${max.toFixed(0)} % (últimos ${Math.round((t1 - t0) / 60000) || 1} min)`)), wrap);
}

pages.servidor = async (main) => {
  const render = async () => {
    const s = await api('GET', '/api/system/stats');
    const memPct = ((s.mem.total - s.mem.free) / s.mem.total) * 100;
    const diskPct = s.disk ? ((s.disk.total - s.disk.free) / s.disk.total) * 100 : null;
    mount(
      main,
      pageHead('Servidor', `Consumo del equipo "${s.hostname}" donde está instalado PubliCast · se actualiza cada 5 s`),
      h(
        'div',
        { class: 'kpis' },
        meterKpi('Procesador (CPU)', s.cpu.usage, `${s.cpu.cores} núcleos`),
        meterKpi('Memoria RAM', memPct, `${fmtBytes(s.mem.total - s.mem.free)} de ${fmtBytes(s.mem.total)}`),
        diskPct === null ? kpi('—', 'Disco') : meterKpi('Disco (carpeta de datos)', diskPct, `libres ${fmtBytes(s.disk.free)} de ${fmtBytes(s.disk.total)}`),
        h('div', { class: 'kpi' }, h('span', null, 'Memoria de PubliCast'), h('b', null, fmtBytes(s.process.rss)), h('small', null, 'proceso Node.js del servidor')),
        h('div', { class: 'kpi' }, h('span', null, 'Contenido almacenado'), h('b', null, fmtBytes(s.storage)), h('small', null, `${s.mediaCount} archivo(s)`)),
        h('div', { class: 'kpi' }, h('span', null, 'Pantallas conectadas'), h('b', null, `${s.displays.online}/${s.displays.total}`), h('small', null, `${s.displays.sockets} conexión(es) en tiempo real`)),
        h('div', { class: 'kpi' }, h('span', null, 'Servidor encendido'), h('b', null, fmtUptime(s.processUptime)), h('small', null, 'equipo: ' + fmtUptime(s.uptime)))
      ),
      h('div', { class: 'grid cols-2' }, lineChart(s.history, 'cpu', 'Uso de CPU'), lineChart(s.history, 'mem', 'Uso de memoria RAM')),
      h(
        'div',
        { class: 'card' },
        h('h2', null, 'Información del equipo'),
        h(
          'dl',
          { class: 'kv' },
          ...[
            ['Equipo', s.hostname],
            ['Sistema', s.platform],
            ['Procesador', `${s.cpu.model} (${s.cpu.cores} núcleos)`],
            ['Node.js', s.node],
            ['Puerto', s.port],
            ['Direcciones para las pantallas', s.network.map((n) => `http://${n.address}:${s.port} (${n.name})`).join(' · ') || '—'],
            ['Carpeta de datos', s.dataDir],
            ['ffmpeg (optimizar videos)', s.ffmpeg ? '✅ Instalado' : '❌ No instalado — winget install ffmpeg'],
          ].flatMap(([k, v]) => [h('dt', null, k), h('dd', null, String(v))])
        )
      )
    );
  };
  await render();
  refreshTimer = setInterval(() => {
    if (!document.querySelector('.chart svg:hover')) render().catch(() => {});
  }, 5000);
};
