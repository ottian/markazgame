// كل الأصوات مولّدة بالكود (من غير ملفات) + كلام عربي بصوت المتصفح

function noiseBuffer(ctx, secs = 2, brown = false) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * secs, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
  }
  return buf;
}

export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.voice = true;
    this.volume = 0.6;
    this.hornTimer = 3;
    this.gear = 1;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);
    this.samples = {};
    this.sLoops = {};
    this.loadSamples();
    this.white = noiseBuffer(ctx, 2);
    this.brown = noiseBuffer(ctx, 4, true);

    // ---- الموتور: مذبذبين + فلتر ----
    this.eng1 = ctx.createOscillator(); this.eng1.type = 'sawtooth';
    this.eng2 = ctx.createOscillator(); this.eng2.type = 'square';
    this.engFilter = ctx.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.frequency.value = 500; this.engFilter.Q.value = 3;
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    const e2g = ctx.createGain(); e2g.gain.value = 0.4;
    this.eng1.connect(this.engFilter);
    this.eng2.connect(e2g).connect(this.engFilter);
    this.engFilter.connect(this.engGain).connect(this.master);
    this.eng1.start(); this.eng2.start();

    // ---- صريخ الكاوتش ----
    this.screech = this.loop(this.white, 'bandpass', 2200, 8);

    // ---- السارينة ----
    this.siren = ctx.createOscillator(); this.siren.type = 'sawtooth';
    this.siren.frequency.value = 900;
    const sf = ctx.createBiquadFilter(); sf.type = 'lowpass'; sf.frequency.value = 2500;
    this.sirenLfo = ctx.createOscillator(); this.sirenLfo.frequency.value = 0.35;
    const lg = ctx.createGain(); lg.gain.value = 380;
    this.sirenLfo.connect(lg).connect(this.siren.frequency);
    this.sirenGain = ctx.createGain(); this.sirenGain.gain.value = 0;
    this.siren.connect(sf).connect(this.sirenGain).connect(this.master);
    this.siren.start(); this.sirenLfo.start();

    // ---- الجو العام ----
    this.city = this.loop(this.brown, 'lowpass', 500, 0.7);
    this.sea = this.loop(this.white, 'lowpass', 700, 0.5);
    this.seaLfo = ctx.createOscillator(); this.seaLfo.frequency.value = 0.12;
    this.seaLfoGain = ctx.createGain(); this.seaLfoGain.gain.value = 0;
    this.seaLfo.connect(this.seaLfoGain).connect(this.sea.gain.gain);
    this.seaLfo.start();
    this.crowd = this.loop(this.brown, 'bandpass', 900, 1.2);
    const cl = ctx.createOscillator(); cl.frequency.value = 2.7;
    this.crowdLfoGain = ctx.createGain(); this.crowdLfoGain.gain.value = 0;
    cl.connect(this.crowdLfoGain).connect(this.crowd.gain.gain);
    cl.start();
  }

  // ملفات صوت حقيقية (اختياري) في assets/sounds — لو الملف موجود بيتشغّل بدل الصوت المولّد
  async loadSamples() {
    const LOOPS = ['engine', 'siren', 'sea', 'city', 'crowd', 'screech'];
    const ONESHOTS = ['horn', 'crash', 'radio', 'door'];
    await Promise.all([...LOOPS, ...ONESHOTS].map(async (name) => {
      for (const ext of ['mp3', 'ogg', 'wav']) {
        try {
          const r = await fetch(`assets/sounds/${name}.${ext}`);
          if (!r.ok) continue;
          this.samples[name] = await this.ctx.decodeAudioData(await r.arrayBuffer());
          break;
        } catch { /* مش موجود */ }
      }
    }));
    for (const name of LOOPS) {
      if (!this.samples[name]) continue;
      const src = this.ctx.createBufferSource();
      src.buffer = this.samples[name];
      src.loop = true;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      src.connect(gain).connect(this.master);
      src.start(0, Math.random() * src.buffer.duration);
      this.sLoops[name] = { src, gain };
    }
  }

  playSample(name, { vol = 0.5, pan = 0, rate = 1 } = {}) {
    const buf = this.samples?.[name];
    if (!buf || !this.ctx) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    let node = src.connect(g);
    if (this.ctx.createStereoPanner) { const p = this.ctx.createStereoPanner(); p.pan.value = pan; node = node.connect(p); }
    node.connect(this.master);
    src.start();
    return true;
  }

  loop(buffer, type, freq, q) {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain(); g.gain.value = 0;
    src.connect(f).connect(g).connect(this.master);
    src.start(0, Math.random() * buffer.duration);
    return { src, filter: f, gain: g };
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : this.volume;
    if (m && window.speechSynthesis) speechSynthesis.cancel();
  }

  // env: { speed, throttle, siren, skid, seaDist, crowd, active }
  update(dt, env) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, k = 0.08;
    const sp = Math.abs(env.speed);
    // ناقل حركة وهمي: كل سرعة ليها مدى
    const gears = [0, 6, 11, 16, 21, 99];
    while (this.gear < 5 && sp > gears[this.gear]) this.gear++;
    while (this.gear > 1 && sp < gears[this.gear - 1] - 1.5) this.gear--;
    const lo = gears[this.gear - 1], hi = Math.min(gears[this.gear], 28);
    const rpm = 0.25 + 0.75 * Math.min(1, (sp - lo) / Math.max(1, hi - lo)) * (this.gear === 1 ? 1 : 0.85) + (env.throttle ? 0.08 : 0);
    const f = 32 + rpm * 70;
    this.eng1.frequency.setTargetAtTime(f, t, k);
    this.eng2.frequency.setTargetAtTime(f * 0.5, t, k);
    this.engFilter.frequency.setTargetAtTime(300 + rpm * 900 + (env.throttle ? 400 : 0), t, k);
    this.engGain.gain.setTargetAtTime(env.active ? 0.06 + rpm * 0.07 : 0, t, 0.15);

    this.screech.gain.gain.setTargetAtTime(env.active ? Math.min(0.25, env.skid * 0.3) : 0, t, 0.05);
    this.sirenGain.gain.setTargetAtTime(env.siren ? 0.05 : 0, t, 0.05);

    const seaVol = Math.max(0, 1 - env.seaDist / 90);
    this.sea.gain.gain.setTargetAtTime(seaVol * 0.18, t, 0.3);
    this.seaLfoGain.gain.setTargetAtTime(seaVol * 0.12, t, 0.3);
    this.city.gain.gain.setTargetAtTime(0.22 * (1 - seaVol * 0.5), t, 0.3);
    const cr = Math.min(1, env.crowd / 12);
    this.crowd.gain.gain.setTargetAtTime(cr * 0.05, t, 0.3);
    this.crowdLfoGain.gain.setTargetAtTime(cr * 0.025, t, 0.3);

    // لو فيه ملفات حقيقية: نشغّلها ونسكّت المولّد
    const L = this.sLoops;
    const set = (ch, synthGains, vol) => {
      if (!L[ch]) return;
      for (const g of synthGains) g.setTargetAtTime(0, t, 0.05);
      L[ch].gain.gain.setTargetAtTime(vol, t, 0.1);
    };
    if (L.engine) L.engine.src.playbackRate.setTargetAtTime(0.65 + rpm * 1.1, t, 0.08);
    set('engine', [this.engGain.gain], env.active ? 0.25 + rpm * 0.3 : 0);
    set('screech', [this.screech.gain.gain], env.active ? Math.min(0.6, env.skid * 0.7) : 0);
    set('siren', [this.sirenGain.gain], env.siren ? 0.35 : 0);
    set('sea', [this.sea.gain.gain, this.seaLfoGain.gain], seaVol * 0.5);
    set('city', [this.city.gain.gain], 0.35 * (1 - seaVol * 0.5));
    set('crowd', [this.crowd.gain.gain, this.crowdLfoGain.gain], cr * 0.4);

    // كلاكسات بعيدة عشوائية — جو مصر
    this.hornTimer -= dt;
    if (env.active && this.hornTimer <= 0) {
      this.hornTimer = 2 + Math.random() * 6;
      this.honk(Math.random() * 2 - 1, 0.03 + Math.random() * 0.04, Math.random() < 0.5 ? 2 : 1);
    }
  }

  tone(freq, dur, { type = 'square', vol = 0.15, pan = 0, when = 0, slide = 0 } = {}) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const p = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.linearRampToValueAtTime(freq + slide, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    if (p) { p.pan.value = pan; o.connect(g).connect(p).connect(this.master); } else o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  honk(pan = 0, vol = 0.1, times = 1) {
    if (this.samples?.horn) {
      for (let i = 0; i < times; i++) setTimeout(() => this.playSample('horn', { vol: vol * 2.5, pan, rate: 0.85 + Math.random() * 0.35 }), i * 300);
      return;
    }
    const base = 340 + Math.random() * 140;
    for (let i = 0; i < times; i++) {
      this.tone(base, 0.22, { vol, pan, when: i * 0.28 });
      this.tone(base * 1.26, 0.22, { vol: vol * 0.7, pan, when: i * 0.28 });
    }
  }
  horn() {
    if (this.playSample('horn', { vol: 0.6 })) return;
    this.tone(392, 0.4, { vol: 0.14 });
    this.tone(494, 0.4, { vol: 0.1 });
  }

  crash(power = 1) {
    if (!this.ctx) return;
    if (this.playSample('crash', { vol: Math.min(0.9, 0.3 + power * 0.5) })) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.white;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1200;
    const g = this.ctx.createGain();
    const t0 = this.ctx.currentTime;
    g.gain.setValueAtTime(Math.min(0.7, 0.2 + power * 0.4), t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.45);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0, Math.random());
    src.stop(t0 + 0.5);
    this.tone(70, 0.3, { type: 'sine', vol: 0.4, slide: -30 });
  }

  ding() {
    this.tone(880, 0.3, { type: 'sine', vol: 0.2 });
    this.tone(1320, 0.4, { type: 'sine', vol: 0.18, when: 0.12 });
  }

  // نغمة اللاسلكي/الكول سنتر
  radio() {
    if (!this.ctx) return;
    if (this.playSample('radio', { vol: 0.5 })) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.white;
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 1.5;
    const g = this.ctx.createGain();
    const t0 = this.ctx.currentTime;
    g.gain.setValueAtTime(0.12, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.25);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + 0.3);
    for (let i = 0; i < 3; i++) this.tone(1046, 0.1, { type: 'sine', vol: 0.12, when: 0.3 + i * 0.15 });
  }

  // كلام عربي بصوت المتصفح (لو متاح)
  speak(text, { pitch = 1, rate = 1 } = {}) {
    if (!this.voice || this.muted || !window.speechSynthesis) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text.replace(/[^؀-ۿ\s،.!؟0-9a-zA-Z]/g, ''));
      const voices = speechSynthesis.getVoices();
      const v = voices.find((x) => x.lang === 'ar-EG') || voices.find((x) => x.lang.startsWith('ar'));
      if (v) u.voice = v;
      u.lang = v ? v.lang : 'ar-EG';
      u.pitch = pitch;
      u.rate = rate;
      u.volume = Math.min(1, this.volume + 0.3);
      speechSynthesis.speak(u);
    } catch { /* المتصفح مش بيدعم */ }
  }

  // ---------- مطر ورعد ونوارس ----------
  setRain(v) {
    if (!this.ctx) return;
    if (!this.rainCh) this.rainCh = this.loop(this.white, 'bandpass', 3200, 0.5);
    this.rainCh.gain.gain.setTargetAtTime(v * 0.22, this.ctx.currentTime, 0.4);
  }

  thunder() {
    if (!this.ctx) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.brown;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 180;
    const g = this.ctx.createGain();
    const t0 = this.ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.9, t0 + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 3.5);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0, Math.random());
    src.stop(t0 + 3.6);
  }

  seagull(pan = 0) {
    for (let i = 0; i < 3; i++) this.tone(1400 + Math.random() * 300, 0.18, { type: 'sine', vol: 0.05, pan, when: i * 0.22, slide: -500 });
  }

  // ---------- الراديو ----------
  // ٠ مقفول، ١ موسيقى (مولّدة: عود + طبلة على مقام حجاز)، ٢ لاسلكي الكول سنتر
  setRadio(mode) {
    this.radio = mode;
    if (this.ctx && mode === 1 && !this.musicBus) {
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = 0.35;
      this.musicBus.connect(this.master);
      this.nextBeat = this.ctx.currentTime + 0.1;
      this.beat = 0;
      this.melodyPos = 3;
      this.strings = new Map();
    }
    if (this.musicBus) this.musicBus.gain.setTargetAtTime(mode === 1 ? 0.35 : 0, this.ctx.currentTime, 0.3);
    this.chatterTimer = 4;
  }

  // وتر بطريقة Karplus-Strong (صوت قريب من العود)
  pluck(freq, when, vol = 0.5) {
    const key = Math.round(freq);
    let buf = this.strings.get(key);
    if (!buf) {
      const sr = this.ctx.sampleRate, len = Math.floor(sr * 1.6), period = Math.round(sr / freq);
      buf = this.ctx.createBuffer(1, len, sr);
      const d = buf.getChannelData(0);
      const ring = new Float32Array(period).map(() => Math.random() * 2 - 1);
      for (let i = 0; i < len; i++) {
        const j = i % period, n = (j + 1) % period;
        d[i] = ring[j];
        ring[j] = 0.996 * 0.5 * (ring[j] + ring[n]);
      }
      this.strings.set(key, buf);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(g).connect(this.musicBus);
    src.start(when);
  }

  drum(kind, when) {
    const g = this.ctx.createGain();
    if (kind === 'doum') {
      const o = this.ctx.createOscillator();
      o.frequency.setValueAtTime(110, when);
      o.frequency.exponentialRampToValueAtTime(55, when + 0.25);
      g.gain.setValueAtTime(0.7, when);
      g.gain.exponentialRampToValueAtTime(0.001, when + 0.35);
      o.connect(g).connect(this.musicBus);
      o.start(when); o.stop(when + 0.4);
    } else {
      const src = this.ctx.createBufferSource();
      src.buffer = this.white;
      const f = this.ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 2500;
      g.gain.setValueAtTime(kind === 'tak' ? 0.35 : 0.15, when);
      g.gain.exponentialRampToValueAtTime(0.001, when + 0.07);
      src.connect(f).connect(g).connect(this.musicBus);
      src.start(when, Math.random()); src.stop(when + 0.08);
    }
  }

  updateRadio(dt, chatterLines) {
    if (!this.ctx || !this.radio) return;
    if (this.radio === 1 && this.musicBus) {
      // مقسوم: دُم تك - تك دُم - تك -
      const RHYTHM = ['doum', 'tak', null, 'tak', 'doum', null, 'tak', 'ka'];
      const D = 146.83; // ري
      const HIJAZ = [1, 16 / 15, 5 / 4, 4 / 3, 3 / 2, 8 / 5, 16 / 9, 2, 32 / 15, 5 / 2];
      const step = 60 / 104 / 2; // ثُمن
      while (this.nextBeat < this.ctx.currentTime + 0.2) {
        const b = this.beat % 8, t = this.nextBeat;
        if (RHYTHM[b]) this.drum(RHYTHM[b], t);
        // لحن: مشي عشوائي على المقام مع سكتات، وقفلة على الأساس كل ٤ موازير
        if (this.beat % 32 === 31) this.melodyPos = 0;
        if (Math.random() < 0.62) {
          this.melodyPos = Math.max(0, Math.min(HIJAZ.length - 1, this.melodyPos + [-2, -1, -1, 0, 1, 1, 2][Math.floor(Math.random() * 7)]));
          this.pluck(D * HIJAZ[this.melodyPos], t, 0.45);
          if (b === 0) this.pluck(D / 2, t, 0.3); // قرار
        }
        this.nextBeat += step;
        this.beat++;
      }
    } else if (this.radio === 2) {
      this.chatterTimer -= dt;
      if (this.chatterTimer <= 0) {
        this.chatterTimer = 25 + Math.random() * 30;
        this.radioBeep();
        const line = chatterLines[Math.floor(Math.random() * chatterLines.length)];
        setTimeout(() => this.speak(line, { pitch: 0.9, rate: 1.05 }), 500);
      }
    }
  }

  radioBeep() {
    if (!this.ctx) return;
    this.tone(1200, 0.08, { type: 'square', vol: 0.05 });
    this.tone(900, 0.08, { type: 'square', vol: 0.05, when: 0.1 });
  }
}
