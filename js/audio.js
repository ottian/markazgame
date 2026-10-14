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
    const base = 340 + Math.random() * 140;
    for (let i = 0; i < times; i++) {
      this.tone(base, 0.22, { vol, pan, when: i * 0.28 });
      this.tone(base * 1.26, 0.22, { vol: vol * 0.7, pan, when: i * 0.28 });
    }
  }
  horn() {
    this.tone(392, 0.4, { vol: 0.14 });
    this.tone(494, 0.4, { vol: 0.1 });
  }

  crash(power = 1) {
    if (!this.ctx) return;
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
}
