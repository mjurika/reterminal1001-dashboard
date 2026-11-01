import { weatherIcon, dropIcon } from './icons.js';

const params = new URLSearchParams(location.search);
const $ = (sel) => document.querySelector(sel);

/** Slovak number formatting: decimal comma, real minus sign. */
const num = (v, digits = 0) =>
  v === null || v === undefined ? '–' : v.toFixed(digits).replace('.', ',').replace(/^-/, '−').replace(/^−0(,0+)?$/, '0$1');
const deg = (v) => `${num(v)}°`;

function bind(name, html) {
  document.querySelectorAll(`[data-bind="${name}"]`).forEach((el) => (el.innerHTML = html));
}

function renderTop(data) {
  bind('weekday', data.local.weekday);
  bind('date', data.local.date);
  bind('station', data.station.id);

  const m = data.metar;
  if (!m) {
    bind('metarTime', 'bez dát');
    bind('metarTemp', '–');
    return;
  }
  $('#metar').classList.toggle('stale', m.stale);
  bind('metarTime', m.obsTimeLocal);
  bind('metarTemp', deg(m.tempC));
  bind('metarRh', `${m.rh} %`);
  bind('metarWind', m.windKmh === 0 ? 'bezvetrie' : `${m.windDir} ${m.windKmh} km/h`);
  bind('metarGust', m.gustKmh ? `nárazy ${m.gustKmh} km/h` : '');
}

function renderHours(hours) {
  $('#hours').innerHTML = hours
    .map((h) => {
      const mm = h.precipMm ?? 0;
      return `<div class="hour">
        <div class="t">${h.label}</div>
        ${weatherIcon(h.code, h.isDay, 52)}
        <div class="temp">${deg(h.tempC)}</div>
        <div class="prob">${dropIcon(18)}${h.precipProb ?? '–'} %</div>
        <div class="amt ${mm < 0.05 ? 'zero' : ''}">${num(mm, 1)} mm</div>
      </div>`;
    })
    .join('');
}

function renderDays(days) {
  $('#days').innerHTML = days
    .map(
      (d) => `<div class="day">
        ${weatherIcon(d.code, true, 68)}
        <div>
          <div class="name"><b>${d.weekday}</b> ${d.label}</div>
          <div class="minmax"><span class="min">${deg(d.tMin)}</span> / ${deg(d.tMax)}</div>
          <div class="rain">${dropIcon(20)}${d.precipProb ?? '–'} %${d.precipMm >= 0.1 ? ` · ${num(d.precipMm, 1)} mm` : ''}</div>
        </div>
      </div>`,
    )
    .join('');
}

function renderFooter(data) {
  const models = [...new Set([...data.models.hourly, ...data.models.daily])].join(' + ');
  $('#footer').innerHTML = `<span>Aktualizované ${data.local.time} · ${models}</span><span>Open-Meteo · NOAA AWC</span>`;
}

function renderHoles(layout, mode) {
  const demo = {
    clock: () => {
      const d = new Date();
      return `<span>${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}</span>`;
    },
    indoor: () => '<span>22,4°</span><span>48 %</span>',
    battery: () => '<span>78 %</span>',
  };
  $('#holes').innerHTML = Object.entries(layout.holes)
    .map(([name, r]) => {
      const content = mode === 'demo' && demo[name] ? demo[name]() : '';
      return `<div class="hole ${name} ${mode === 'demo' ? 'demo' : ''}" data-hole="${name}"
        style="left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px">${content}</div>`;
    })
    .join('');
}

async function main() {
  const dataUrl = params.get('data') ?? '../data.json';
  const [data, layout] = await Promise.all([
    fetch(dataUrl, { cache: 'no-store' }).then((r) => r.json()),
    fetch('../layout.json', { cache: 'no-store' }).then((r) => r.json()),
  ]);

  document.body.classList.toggle('bw', params.get('bw') === '1');
  document.body.classList.toggle('holes-outline', params.get('holes') === 'outline');

  renderTop(data);
  renderHours(data.hours);
  renderDays(data.days);
  renderFooter(data);
  renderHoles(layout, params.get('holes'));

  await document.fonts.ready;
  document.body.dataset.ready = '1'; // signal for src/render.ts
}

main().catch((err) => {
  document.body.dataset.ready = 'error';
  document.body.dataset.error = String(err);
  console.error(err);
});
