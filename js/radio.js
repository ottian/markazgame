// راديو بمحطات مصرية حقيقية — بث مباشر من سيرفرات المحطات نفسها
// القايمة جاية من قاعدة بيانات Radio Browser المفتوحة (radio-browser.info)

const MIRRORS = ['https://de1.api.radio-browser.info', 'https://de2.api.radio-browser.info', 'https://fi1.api.radio-browser.info', 'https://nl1.api.radio-browser.info'];
const CACHE_KEY = 'markaz_eg_stations';

export class EgyptRadio {
  constructor() {
    this.stations = [];
    this.index = -1;
    this.audio = new Audio();
    this.audio.preload = 'none';
    this.audio.volume = 0.55;
    this.audio.crossOrigin = 'anonymous';
    this.onChange = null;
    this.audio.addEventListener('error', () => { if (this.index >= 0) this.skip(1, true); });
  }

  async load() {
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (c && Date.now() - c.t < 86400000 && c.list.length) { this.stations = c.list; return this.stations; }
    } catch { /* ignore */ }
    for (const m of MIRRORS) {
      try {
        const r = await fetch(`${m}/json/stations/bycountrycodeexact/EG?hidebroken=true&order=clickcount&reverse=true&limit=80`);
        if (!r.ok) continue;
        const list = await r.json();
        const seen = new Set();
        this.stations = list
          .filter((s) => s.url_resolved && s.url_resolved.startsWith('https://') && /mp3|aac/i.test(s.codec || 'mp3'))
          .filter((s) => { const k = s.name.trim().toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
          .slice(0, 25)
          .map((s) => ({ name: s.name.trim().replace(/\s+/g, ' '), url: s.url_resolved, tags: s.tags || '' }));
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), list: this.stations })); } catch { /* ignore */ }
        return this.stations;
      } catch { /* جرّب السيرفر اللي بعده */ }
    }
    return this.stations;
  }

  get current() { return this.index >= 0 ? this.stations[this.index] : null; }

  play(i) {
    if (!this.stations.length) return false;
    this.index = ((i % this.stations.length) + this.stations.length) % this.stations.length;
    this.audio.src = this.current.url;
    this.audio.play().catch(() => this.skip(1, true));
    if (this.onChange) this.onChange(this.current);
    return true;
  }

  skip(dir = 1, auto = false) {
    if (!this.stations.length) return;
    if (auto) this.fails = (this.fails || 0) + 1;
    if (this.fails > this.stations.length) { this.stop(); return; }
    this.play(this.index + dir);
  }

  stop() {
    this.index = -1;
    this.fails = 0;
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
  }

  // صوت الراديو بيوطى لما حد بيتكلم أو السارينة شغّالة
  duck(v) { this.audio.volume = 0.55 * v; }
}
