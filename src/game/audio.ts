/**
 * Procedural Web Audio API synthesizer for paintball sound effects.
 * Zero external audio files — 100% real-time pneumatic & tactile audio synthesis.
 */
export class PaintballAudio {
  private ctx: AudioContext | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  public muted = false;

  private ensureContext(): AudioContext | null {
    if (this.muted) return null;
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    if (!this.noiseBuffer && this.ctx) {
      const length = Math.floor(this.ctx.sampleRate * 0.4);
      const buf = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < length; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      this.noiseBuffer = buf;
    }
    return this.ctx;
  }

  public unlock(): void {
    this.ensureContext();
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
  }

  /** Crisp pneumatic paintball marker "thwip-pop" with ±8% pitch variation */
  public playShot(isPlayer: boolean, distanceFactor = 1): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.noiseBuffer) return;

    const vol = (isPlayer ? 0.22 : 0.09) * Math.max(0.15, Math.min(1, distanceFactor));
    if (vol < 0.012) return;

    const now = ctx.currentTime;
    const pitchVar = 0.92 + Math.random() * 0.16;

    // Pneumatic bolt pop (short frequency drop)
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(290 * pitchVar, now);
    osc.frequency.exponentialRampToValueAtTime(72 * pitchVar, now + 0.065);
    oscGain.gain.setValueAtTime(vol, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
    osc.connect(oscGain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.075);

    // Compressed air puff (bandpassed noise)
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1650 * pitchVar, now);
    filter.Q.value = 1.8;

    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(vol * 0.8, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);

    noise.connect(filter).connect(nGain).connect(ctx.destination);
    noise.start(now);
    noise.stop(now + 0.06);
  }

  /** Wet gelatin paintball splat on bunker or player */
  public playSplat(heavy = false, volumeScale = 1): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.noiseBuffer) return;

    const vol = (heavy ? 0.24 : 0.12) * Math.max(0.15, Math.min(1, volumeScale));
    const now = ctx.currentTime;
    const pitchVar = 0.9 + Math.random() * 0.2;

    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime((heavy ? 900 : 1250) * pitchVar, now);
    filter.frequency.exponentialRampToValueAtTime(340, now + 0.09);
    filter.Q.value = 2.4;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (heavy ? 0.13 : 0.08));

    noise.connect(filter).connect(gain).connect(ctx.destination);
    noise.start(now);
    noise.stop(now + 0.14);

    if (heavy) {
      const thump = ctx.createOscillator();
      const tGain = ctx.createGain();
      thump.type = 'sine';
      thump.frequency.setValueAtTime(165, now);
      thump.frequency.exponentialRampToValueAtTime(52, now + 0.11);
      tGain.gain.setValueAtTime(vol * 0.9, now);
      tGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      thump.connect(tGain).connect(ctx.destination);
      thump.start(now);
      thump.stop(now + 0.13);
    }
  }

  /** Tag-out elimination chime + paint burst */
  public playTagOut(isPlayerKiller: boolean): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    this.playSplat(true, isPlayerKiller ? 1.15 : 0.65);

    if (!isPlayerKiller) return;
    const now = ctx.currentTime;
    const notes = [523.25, 659.25];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + idx * 0.055);
      g.gain.setValueAtTime(0.14, now + idx * 0.055);
      g.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.055 + 0.14);
      osc.connect(g).connect(ctx.destination);
      osc.start(now + idx * 0.055);
      osc.stop(now + idx * 0.055 + 0.15);
    });
  }

  /** Tactical dash whoosh */
  public playDash(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.noiseBuffer) return;
    const now = ctx.currentTime;

    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1800, now);
    filter.frequency.exponentialRampToValueAtTime(260, now + 0.18);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

    noise.connect(filter).connect(g).connect(ctx.destination);
    noise.start(now);
    noise.stop(now + 0.22);
  }

  /** HPA Hopper reload hiss & rattle */
  public playReload(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.noiseBuffer) return;
    const now = ctx.currentTime;

    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(2600, now);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.08, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    noise.connect(filter).connect(g).connect(ctx.destination);
    noise.start(now);
    noise.stop(now + 0.25);
  }

  /** Flag grabbed / returned / captured musical stingers */
  public playFlagEvent(type: 'pickup' | 'return' | 'capture', friendlyPositive: boolean): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    let freqs: number[];
    if (type === 'capture') {
      freqs = friendlyPositive ? [392.0, 493.88, 587.33, 783.99] : [311.13, 277.18, 233.08];
    } else if (type === 'pickup') {
      freqs = friendlyPositive ? [440, 554.37, 659.25] : [349.23, 311.13];
    } else {
      freqs = [493.88, 659.25];
    }

    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type === 'capture' ? 'sawtooth' : 'triangle';

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1800;

      const start = now + i * 0.085;
      const dur = type === 'capture' && i === freqs.length - 1 ? 0.45 : 0.16;
      osc.frequency.setValueAtTime(f, start);
      g.gain.setValueAtTime(0.11, start);
      g.gain.exponentialRampToValueAtTime(0.001, start + dur);

      osc.connect(filter).connect(g).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + dur + 0.02);
    });
  }

  /** Heavy suppressor burst windup telegraph cue */
  public playWindupTelegraph(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(340, now);
    osc.frequency.exponentialRampToValueAtTime(680, now + 0.22);
    g.gain.setValueAtTime(0.07, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    osc.connect(g).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.25);
  }

  /** Air-drop powerup landing thud + shimmering beacon chime */
  public playPowerupSpawn(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [587.33, 880.0];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.06);
      g.gain.setValueAtTime(0.08, now + idx * 0.06);
      g.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.06 + 0.22);
      osc.connect(g).connect(ctx.destination);
      osc.start(now + idx * 0.06);
      osc.stop(now + idx * 0.06 + 0.24);
    });
  }

  /** Satisfying ascending power-on chord when collecting a field powerup */
  public playPowerupCollect(isPlayer: boolean): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const vol = isPlayer ? 0.13 : 0.055;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      const t0 = now + idx * 0.048;
      osc.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.18);
      osc.connect(g).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.2);
    });
  }

  /** Juicy paint-bomb splash cannon detonation */
  public playSplashExplosion(volumeScale = 1): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.noiseBuffer) return;
    const now = ctx.currentTime;
    const vol = 0.22 * Math.max(0.2, Math.min(1, volumeScale));

    const osc = ctx.createOscillator();
    const oGain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(210, now);
    osc.frequency.exponentialRampToValueAtTime(46, now + 0.19);
    oGain.gain.setValueAtTime(vol, now);
    oGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc.connect(oGain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.22);

    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1100, now);
    filter.frequency.exponentialRampToValueAtTime(260, now + 0.17);
    filter.Q.value = 1.6;
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(vol * 0.9, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    noise.connect(filter).connect(nGain).connect(ctx.destination);
    noise.start(now);
    noise.stop(now + 0.2);
  }

  /** Concussive electric EMP Stun Shockwave pulse */
  public playStunShockwave(isLocal: boolean): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.noiseBuffer) return;
    const now = ctx.currentTime;
    const vol = isLocal ? 0.24 : 0.12;

    // Deep concussive bass drop
    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(190, now);
    sub.frequency.exponentialRampToValueAtTime(38, now + 0.36);
    subGain.gain.setValueAtTime(vol * 1.1, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
    sub.connect(subGain).connect(ctx.destination);
    sub.start(now);
    sub.stop(now + 0.4);

    // Electric resonant sweep
    const zap = ctx.createOscillator();
    const zapGain = ctx.createGain();
    zap.type = 'sawtooth';
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1400, now);
    filter.frequency.exponentialRampToValueAtTime(240, now + 0.34);
    filter.Q.value = 3.2;
    zap.frequency.setValueAtTime(620, now);
    zap.frequency.exponentialRampToValueAtTime(135, now + 0.34);
    zapGain.gain.setValueAtTime(vol * 0.65, now);
    zapGain.gain.exponentialRampToValueAtTime(0.001, now + 0.36);
    zap.connect(filter).connect(zapGain).connect(ctx.destination);
    zap.start(now);
    zap.stop(now + 0.38);

    // High-frequency static crackle
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(2200, now);
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(vol * 0.55, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    noise.connect(hp).connect(nGain).connect(ctx.destination);
    noise.start(now);
    noise.stop(now + 0.26);
  }

  /** Crisp 2-note readiness chime when 2 kills unlock Stun Shockwave */
  public playStunReady(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [659.25, 987.77];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      const t0 = now + idx * 0.065;
      osc.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.11, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.2);
      osc.connect(g).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.22);
    });
  }
}
