// أصوات مولّدة بالكود (من غير ملفات)
export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);

    // موتور
    this.engine = this.ctx.createOscillator();
    this.engine.type = 'sawtooth';
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 400;
    this.engine.connect(lp).connect(this.engineGain).connect(this.master);
    this.engine.start();

    // سارينة: مذبذب بتردد بيتهز
    this.siren = this.ctx.createOscillator();
    this.siren.type = 'triangle';
    this.siren.frequency.value = 750;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.9;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 220;
    lfo.connect(lfoGain).connect(this.siren.frequency);
    this.sirenGain = this.ctx.createGain();
    this.sirenGain.gain.value = 0;
    this.siren.connect(this.sirenGain).connect(this.master);
    this.siren.start();
    lfo.start();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }

  update(speed, siren) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.engine.frequency.setTargetAtTime(45 + Math.abs(speed) * 4, t, 0.1);
    this.engineGain.gain.setTargetAtTime(0.05 + Math.min(Math.abs(speed) / 30, 1) * 0.08, t, 0.1);
    this.sirenGain.gain.setTargetAtTime(siren ? 0.07 : 0, t, 0.05);
  }

  beep(freq, dur, type = 'square', vol = 0.15) {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = vol;
    g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + dur);
    o.connect(g).connect(this.master);
    o.start();
    o.stop(this.ctx.currentTime + dur);
  }

  horn() {
    this.beep(392, 0.35, 'square', 0.12);
    this.beep(494, 0.35, 'square', 0.08);
  }

  crash(power = 1) {
    if (!this.ctx) return;
    const len = 0.3;
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = Math.min(0.6, 0.15 + power * 0.3);
    src.connect(g).connect(this.master);
    src.start();
  }

  ding() {
    this.beep(880, 0.25, 'sine', 0.2);
    setTimeout(() => this.beep(1320, 0.35, 'sine', 0.18), 120);
  }

  call() {
    for (let i = 0; i < 3; i++) setTimeout(() => this.beep(660, 0.15, 'sine', 0.15), i * 220);
  }
}
