/**
 * Procedural audio for Polderland.
 *
 * One AudioContext for the whole page, created lazily on the first user
 * gesture and never replaced — restarting a scenario reuses it rather than
 * leaking a new context each time (browsers cap these at a handful per tab).
 * Music and effects run through separate gain buses so they can be muted
 * independently, and both settings persist.
 */

import { loadSettings, saveSettings } from './SaveGame.js';

const rnd = (a, b) => a + Math.random() * (b - a);

/** Headroom on the master bus; mute ramps to zero and back to this. */
const MASTER_GAIN = 0.9;

/** D4. Everything in the music is relative to this. */
const ROOT = 293.66;
/** D dorian. The raised sixth is what keeps it off a lament. */
const DORIAN = [0, 2, 3, 5, 7, 9, 10, 12, 14, 15, 17, 19];
/** The chord under the tune: root, fifth, octave, major tenth. */
const VOICING = [0, 7, 12, 16];

/**
 * The tunes.
 *
 * These are written out note by note, which is the whole point. The engine
 * used to pick each note by stepping a random distance through the scale,
 * and that is why it never sounded like music: a listener never heard the
 * same phrase twice, so no phrase ever became a melody. Repetition is not
 * a shortcut to a tune, it IS the tune — you cannot hum something you have
 * never heard before.
 *
 * Each is in AABB, the form every estampie, branle, saltarello and jig is
 * built on: a four-bar phrase, said twice, answered by a second four-bar
 * phrase, said twice. Bars 0-3 are the A phrase, 4-7 the B.
 *
 * A bar is a list of [scale degree, length in eighths]; six eighths to the
 * 6/8 bar. Degrees index DORIAN, so 0 is the tonic and 7 the octave above.
 * `chords` gives each bar's harmony in semitones from the tonic.
 */
const TUNES = [
  {
    // Around the polder: an arpeggio up, answered by a stepwise walk down.
    bars: [
      [[0, 1], [2, 1], [4, 1], [3, 1], [2, 1], [0, 1]],
      [[1, 1], [2, 1], [3, 1], [4, 2], [2, 1]],
      [[4, 1], [5, 1], [6, 1], [7, 1], [6, 1], [4, 1]],
      [[5, 1], [3, 2], [4, 3]],
      [[7, 1], [7, 1], [6, 1], [5, 1], [4, 1], [3, 1]],
      [[4, 1], [5, 1], [4, 1], [2, 2], [1, 1]],
      [[0, 1], [4, 1], [4, 1], [3, 1], [2, 1], [3, 1]],
      [[2, 1], [1, 2], [0, 3]],
    ],
    chords: [0, -2, 3, 0, -2, 0, -2, 0],
  },
  {
    // The miller's jig: a hammered repeated note, then a wide happy leap.
    bars: [
      [[4, 1], [4, 1], [4, 1], [3, 1], [4, 1], [5, 1]],
      [[6, 1], [5, 1], [4, 1], [3, 2], [2, 1]],
      [[0, 1], [2, 1], [4, 1], [7, 1], [4, 1], [2, 1]],
      [[3, 1], [2, 2], [0, 3]],
      [[7, 2], [6, 1], [5, 2], [4, 1]],
      [[5, 1], [6, 1], [7, 1], [6, 1], [5, 1], [4, 1]],
      [[3, 1], [4, 1], [5, 1], [4, 1], [3, 1], [2, 1]],
      [[1, 1], [2, 2], [0, 3]],
    ],
    chords: [0, 5, -2, 0, 3, -2, 0, 0],
  },
  {
    // Sea-wind reel: the most driving of the three, all running eighths.
    bars: [
      [[0, 1], [0, 1], [2, 1], [4, 1], [2, 1], [0, 1]],
      [[3, 1], [2, 1], [1, 1], [2, 1], [3, 1], [4, 1]],
      [[5, 1], [4, 1], [3, 1], [4, 1], [5, 1], [6, 1]],
      [[7, 3], [4, 3]],
      [[7, 1], [6, 1], [5, 1], [6, 1], [7, 1], [4, 1]],
      [[5, 1], [4, 1], [3, 1], [2, 1], [3, 1], [4, 1]],
      [[2, 1], [3, 1], [4, 1], [5, 1], [4, 1], [3, 1]],
      [[2, 1], [1, 1], [0, 4]],
    ],
    chords: [0, -2, 3, 0, -2, 3, -2, 0],
  },
];

/** A A B B: the phrase order the tunes above are written for. */
const FORM = [0, 1, 2, 3, 0, 1, 2, 3, 4, 5, 6, 7, 4, 5, 6, 7];

/**
 * Moods. Tempo lives here rather than globally because, unlike a day
 * cycle that flips every few seconds, the weather changes rarely enough
 * that the track can afford to change speed with it.
 *
 * `drop` is the chance of a melody note being left out, which is how the
 * danger moods thin the same tunes into something less like a party
 * without needing tunes of their own.
 */
const MOODS = {
  calm: {
    bpm: 144, lp: 5400,
    tabor: [1, 0, 0.45, 0.95, 0, 0.5], jingle: 0.028,
    bass: 0.09, strum: 0.042, drone: 0.02,
    mel: 0.075, drop: 0, pipe: true, bell: 0.045,
  },
  tense: {
    bpm: 132, lp: 2600,
    tabor: [1, 0, 0.4, 0.9, 0, 0.6], jingle: 0,
    bass: 0.085, strum: 0.036, drone: 0.05,
    mel: 0.06, drop: 0.2, pipe: true, bell: 0.06,
  },
  storm: {
    bpm: 120, lp: 1500,
    tabor: [1, 0.5, 0, 1, 0.5, 0.7], jingle: 0,
    bass: 0.09, strum: 0.03, drone: 0.075,
    mel: 0.045, drop: 0.45, pipe: false, bell: 0,
  },
};

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicBus = null;
    this.sfxBus = null;

    const s = loadSettings();
    this.musicVolume = s.musicVolume;
    this.sfxVolume = s.sfxVolume;
    this.muted = s.muted;

    this.musicPlaying = false;
    this.musicTimer = null;
    // Whether a scene wants music at all, kept apart from whether it is
    // actually running: muting tears the voices down to stop burning a
    // phone battery on audio nobody can hear, and unmuting has to know
    // whether to bring them back.
    this.musicWanted = false;
    this.muteHalt = null;
    this.nodes = new Set();
    this.bar = 0;
    this.tuneIdx = 0;
    this.nextBarTime = 0;
    this.mood = 'calm';
    this.unlocked = false;
    // The music room, built on first play; and the plucked-string
    // buffers, cached per pitch because the model is too slow per note.
    this.musLp = null;
    this.musDry = null;
    this.musWet = null;
    this.musNoise = null;
    this.vinyl = null;
    this.ks = {};
  }

  /** Must be called from inside a user-gesture handler. */
  unlock() {
    this.ensure();
    this.unlocked = true;
  }

  ensure() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return false;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : MASTER_GAIN;
      this.master.connect(this.ctx.destination);

      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = this.musicVolume;
      this.musicBus.connect(this.master);

      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = this.sfxVolume;
      this.sfxBus.connect(this.master);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return true;
  }

  /** Called when the page is hidden, so a backgrounded tab goes quiet. */
  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended' && this.unlocked) this.ctx.resume();
  }

  setMusicVolume(v) {
    this.musicVolume = v;
    if (this.musicBus) this.musicBus.gain.value = v;
    saveSettings({ musicVolume: v });
  }

  setSfxVolume(v) {
    this.sfxVolume = v;
    if (this.sfxBus) this.sfxBus.gain.value = v;
    saveSettings({ sfxVolume: v });
  }

  /**
   * Mute rides on the master bus rather than zeroing the two volumes, so
   * unmuting restores exactly the mix the player had set rather than some
   * default — and the settings sliders keep showing their real positions
   * while muted. Ramped rather than switched: cutting a gain to zero
   * mid-waveform is a click.
   */
  setMuted(v) {
    // Callers include a slider's onChange, which fires on every pixel of a
    // drag; without this it would rewrite storage a hundred times a swipe.
    if (v === this.muted) return v;
    this.muted = v;
    saveSettings({ muted: v });
    if (this.master && this.ctx) {
      const now = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setValueAtTime(this.master.gain.value, now);
      this.master.gain.linearRampToValueAtTime(v ? 0 : MASTER_GAIN, now + 0.08);
    }
    if (this.muteHalt) {
      clearTimeout(this.muteHalt);
      this.muteHalt = null;
    }
    if (v) {
      // Let the fade finish before tearing the voices down: stopping an
      // oscillator mid-note at full amplitude is a click, and the whole
      // point of muting is to not hear anything.
      this.muteHalt = setTimeout(() => {
        this.muteHalt = null;
        if (this.muted) this.haltMusic();
      }, 220);
    } else if (this.musicWanted) {
      this.startMusic();
    }
    return v;
  }

  toggleMuted() {
    return this.setMuted(!this.muted);
  }

  /* ==============================================================
     MUSIC — Dutch medieval lo-fi. Nothing is sampled; every voice is
     built from oscillators and noise at runtime.

     The architecture is lifted from the Cuban lo-fi engine in the
     soldecuba project — separate music bus with its own low-pass and
     convolution room, a lookahead scheduler accumulating in
     AudioContext time, per-hit velocity and micro-timing, and a vinyl
     layer over the top. What changes here is the voicing.

     Why lo-fi and not a clean consort: synthesising a convincing
     shawm or vielle is genuinely hard, and a nearly-good one sounds
     worse than no attempt. Lo-fi production — soft attacks,
     everything under a low-pass, a generous room, crackle — is built
     around imperfect sources, so it flatters synthesis instead of
     exposing it. It also happens to suit the subject: a big stone
     reverb is what a Dutch church sounds like.

     The mode is D dorian throughout. Dorian is the medieval mode and,
     unlike aeolian, its raised sixth keeps it from reading as a
     lament — this is a game about working land, not mourning it. The
     drone underneath is an open fifth, which is what medieval harmony
     actually is; the triads above it are the modern concession.
  ============================================================== */

  setMood(mood) {
    if (mood === this.mood) return;
    this.mood = mood;
  }

  /**
   * The music room: a low-pass the mood opens and closes, and a long
   * convolution reverb standing in for a stone nave. Built once.
   */
  ensureMusicRoom() {
    if (this.musLp) return;
    const A = this.ctx;
    this.musDry = A.createGain();
    this.musDry.connect(this.musicBus);
    this.musLp = A.createBiquadFilter();
    this.musLp.type = 'lowpass';
    this.musLp.frequency.value = 1800;
    this.musLp.Q.value = 0.3;
    this.musLp.connect(this.musDry);

    // A low room with a wooden floor and people in it — not a nave. A long
    // tail is death for a dance tune: it smears every note into the next
    // until the rhythm, which is the entire point, stops being audible.
    const n = Math.floor(A.sampleRate * 0.9);
    const ir = A.createBuffer(2, n, A.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        lp = lp * 0.55 + (Math.random() * 2 - 1) * 0.45;
        d[i] = lp * (1 - i / n) ** 3.2 * (c ? 0.9 : 1);
      }
    }
    const cv = A.createConvolver();
    cv.buffer = ir;
    const wlp = A.createBiquadFilter();
    wlp.type = 'lowpass';
    wlp.frequency.value = 2800;
    const wg = A.createGain();
    wg.gain.value = 0.9;
    this.musWet = A.createGain();
    this.musWet.connect(wlp);
    wlp.connect(cv);
    cv.connect(wg);
    wg.connect(this.musicBus);

    // One brown-noise buffer, reused by every breathy or struck voice.
    const len = A.sampleRate * 3;
    const buf = A.createBuffer(1, len, A.sampleRate);
    const d = buf.getChannelData(0);
    let v = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      v = (v + 0.021 * w) / 1.021;
      d[i] = v * 3.4;
    }
    this.musNoise = buf;
  }

  /** Pan, then out to the room: how every voice below reaches the bus. */
  musPath(node, pan, wet) {
    const A = this.ctx;
    let out = node;
    if (A.createStereoPanner) {
      const p = A.createStereoPanner();
      p.pan.value = pan || 0;
      node.connect(p);
      out = p;
    }
    out.connect(this.musLp);
    const w = A.createGain();
    w.gain.value = wet;
    out.connect(w);
    w.connect(this.musWet);
  }

  /**
   * Vinyl crackle and hum. The single cheapest thing that makes
   * synthesis read as a recording rather than as a synthesiser.
   */
  vinylOn() {
    if (!this.ctx || this.vinyl) return;
    const A = this.ctx;
    const SR = A.sampleRate;
    const L = Math.floor(SR * 6);
    const b = A.createBuffer(2, L, SR);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < L; i++) {
        lp = lp * 0.86 + (Math.random() * 2 - 1) * 0.14;
        let x = lp * 0.25;
        if (Math.random() < 0.00055) x += (Math.random() * 2 - 1) * 0.85;
        d[i] = x;
      }
    }
    this.vinyl = A.createBufferSource();
    this.vinyl.buffer = b;
    this.vinyl.loop = true;
    const hp = A.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1300;
    const g = A.createGain();
    g.gain.value = 0.018;
    this.vinyl.connect(hp);
    hp.connect(g);
    g.connect(this.musDry);
    this.vinyl.start();
  }

  vinylOff() {
    if (this.vinyl) {
      try { this.vinyl.stop(); } catch { /* already stopped */ }
      this.vinyl = null;
    }
  }

  /* ---------- voices ---------- */

  /**
   * The drone: an open fifth on two detuned sawtooths under a heavy
   * low-pass, drifting slowly in pitch the way a hurdy-gurdy wheel
   * does. Medieval harmony is a drone with things happening over it;
   * this is the bed everything else sits on.
   */
  mDrone(freq, time, dur, gain) {
    const A = this.ctx;
    const g = A.createGain();
    const lp = A.createBiquadFilter();
    lp.type = 'lowpass';
    // Brighter than the 620Hz this used to sit under: the drone was reading
    // as a muffled sub-bass moan rather than an open-fifth bagpipe drone.
    lp.frequency.value = 850;
    lp.Q.value = 1.1;
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(gain, time + 0.5);
    g.gain.setValueAtTime(gain, time + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0004, time + dur);
    lp.connect(g);
    [freq, freq * 1.4983, freq * 0.5].forEach((f, k) => {
      const o = A.createOscillator();
      o.type = k === 2 ? 'triangle' : 'sawtooth';
      o.frequency.value = f;
      o.detune.value = rnd(-9, 9);
      // The wheel is never quite steady.
      const drift = A.createOscillator();
      const dg = A.createGain();
      drift.frequency.value = 0.13 + k * 0.07;
      dg.gain.value = 3.5;
      drift.connect(dg);
      dg.connect(o.detune);
      o.connect(lp);
      o.start(time);
      o.stop(time + dur + 0.3);
      drift.start(time);
      drift.stop(time + dur + 0.3);
      this.track(o);
      this.track(drift);
    });
    this.musPath(g, 0, 0.22);
  }

  /**
   * Psaltery: a plucked string by physical model rather than stacked
   * sines, because a real string's harmonics each decay at their own
   * rate and summing sines cannot reproduce that. Buffers cached per
   * pitch — the model is too expensive to run per note.
   */
  ksBuffer(freq) {
    const key = Math.round(freq * 4);
    if (this.ks[key]) return this.ks[key];
    const A = this.ctx;
    const SR = A.sampleRate;
    const N = Math.max(8, Math.round(SR / freq));
    const L = Math.floor(SR * 1.6);
    const b = A.createBuffer(1, L, SR);
    const d = b.getChannelData(0);
    const line = new Float32Array(N);
    let lp = 0;
    // A quill, not a fingertip: brighter excitation than a guitar.
    for (let i = 0; i < N; i++) {
      lp = lp * 0.35 + (Math.random() * 2 - 1) * 0.65;
      line[i] = lp;
    }
    let p = 0;
    let prev = 0;
    for (let i = 0; i < L; i++) {
      const x = line[p];
      const y = (x + prev) * 0.5 * 0.994;
      prev = x;
      line[p] = y;
      p = (p + 1) % N;
      d[i] = y;
    }
    let peak = 0;
    for (let i = 0; i < L; i++) {
      d[i] *= (1 - i / L) ** 1.6;
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
    }
    if (peak > 0) for (let i = 0; i < L; i++) d[i] /= peak;
    this.ks[key] = b;
    return b;
  }

  mPsaltery(freq, time, dur, gain, bright) {
    const A = this.ctx;
    const s = A.createBufferSource();
    s.buffer = this.ksBuffer(freq);
    const lp = A.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = bright;
    lp.Q.value = 0.6;
    const g = A.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(gain, time + 0.008);
    g.gain.setValueAtTime(gain, time + dur * 0.5);
    g.gain.exponentialRampToValueAtTime(0.0004, time + dur);
    s.connect(lp);
    lp.connect(g);
    this.musPath(g, rnd(-0.3, 0.3), 0.52);
    s.start(time);
    s.stop(time + dur + 0.1);
    this.track(s);
  }

  /**
   * The pipe that carries the tune. A triangle body with a sawtooth edge
   * over it: a pure triangle is a recorder heard through a wall, and the
   * sawtooth is the reed buzz that lets a melody carry across a room with
   * people in it. The attack is fast on purpose — a dance tune needs each
   * note to land ON the beat, and the old 90ms swell meant every note
   * arrived slightly late and slightly apologetic.
   */
  mPipe(freq, time, dur, gain) {
    const A = this.ctx;
    const g = A.createGain();
    const lp = A.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.min(7200, freq * 5.5);
    lp.Q.value = 1.3;
    [['triangle', 1], ['sawtooth', 0.26]].forEach(([type, amp]) => {
      const o = A.createOscillator();
      const og = A.createGain();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = rnd(-6, 6);
      og.gain.value = amp;
      o.connect(og);
      og.connect(lp);
      o.start(time);
      o.stop(time + dur + 0.08);
      this.track(o);
    });
    // Vibrato only on notes long enough to hold one; on a running eighth
    // it is inaudible and costs two nodes.
    if (dur > 0.3) {
      const vib = A.createOscillator();
      const vg = A.createGain();
      vib.frequency.value = 5.2;
      vg.gain.setValueAtTime(0, time);
      vg.gain.linearRampToValueAtTime(6, time + dur * 0.6);
      vib.connect(vg);
      vg.connect(lp.detune);
      vib.start(time); vib.stop(time + dur + 0.08);
      this.track(vib);
    }
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(gain, time + 0.016);
    g.gain.setValueAtTime(gain, time + dur * 0.72);
    g.gain.exponentialRampToValueAtTime(0.0004, time + dur);
    lp.connect(g);
    this.musPath(g, rnd(-0.12, 0.12), 0.2);
  }

  /**
   * The bass, plucked on the two dotted-quarter beats: root, then fifth.
   * This alternation is the oom-pah every dance band on earth runs on,
   * and it is what the old sustained drone was standing in the way of —
   * a held note tells you nothing about where the beat is.
   */
  mBass(freq, time, dur, gain) {
    const A = this.ctx;
    const s = A.createBufferSource();
    s.buffer = this.ksBuffer(freq);
    const lp = A.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1100;
    const g = A.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(gain, time + 0.006);
    g.gain.setValueAtTime(gain, time + dur * 0.4);
    g.gain.exponentialRampToValueAtTime(0.0004, time + dur);
    s.connect(lp);
    lp.connect(g);
    this.musPath(g, 0, 0.12);
    s.start(time);
    s.stop(time + dur + 0.05);
    this.track(s);
  }

  /**
   * A cittern chord struck across the strings on the off-beat. The 12ms
   * stagger between courses is not a flourish — it is what makes it read
   * as one hand hitting four strings rather than four notes agreeing to
   * start together.
   */
  mStrum(rootFreq, time, gain, bright) {
    VOICING.forEach((s, k) => {
      this.mPsaltery(rootFreq * 2 ** (s / 12), time + k * 0.012,
        0.4, gain * (1 - k * 0.08), bright);
    });
  }

  /** Tambourine jingles, for the off-beat. Pure tavern. */
  mJingle(time, gain) {
    this.mNoise(time, 0.085, gain, 5400, 0.8, 'highpass', rnd(-0.35, 0.35), 0.16);
  }

  mNoise(time, dur, gain, freq, q, type, pan, wet) {
    const A = this.ctx;
    const s = A.createBufferSource();
    s.buffer = this.musNoise;
    s.loop = true;
    s.playbackRate.value = 0.8 + Math.random() * 0.5;
    const f = A.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = A.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(gain, time + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0004, time + dur);
    s.connect(f); f.connect(g);
    this.musPath(g, pan, wet);
    s.start(time, Math.random() * 2);
    s.stop(time + dur + 0.15);
    this.track(s);
  }

  /**
   * Tabor: the little drum a medieval piper hung off one arm. A short
   * pitched thump for the head and a rattle of noise for the snare
   * across it. The pitch drop is deliberately small — a long sweep
   * smears the band the drone lives in and turns the mix to mud.
   */
  mTabor(time, vel, deep) {
    const A = this.ctx;
    const o = A.createOscillator();
    const g = A.createGain();
    const hz = deep ? 96 : 150;
    o.type = 'sine';
    o.frequency.setValueAtTime(hz, time);
    o.frequency.setTargetAtTime(hz * 0.82, time, 0.05);
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(vel, time + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0004, time + (deep ? 0.3 : 0.16));
    o.connect(g);
    this.musPath(g, deep ? 0 : -0.12, 0.2);
    o.start(time); o.stop(time + 0.5);
    this.track(o);
    this.mNoise(time, deep ? 0.05 : 0.035, vel * 0.5, deep ? 900 : 1900, 1.3,
      'bandpass', 0.08, 0.26);
  }

  /**
   * A church bell: struck metal is inharmonic, so the partials are
   * deliberately not a harmonic series — that ratio set is what makes
   * it a bell rather than an organ pipe. Rare, and only on a downbeat.
   */
  mBell(freq, time, gain) {
    const A = this.ctx;
    [[0.5, 0.5], [1, 1], [1.183, 0.5], [1.506, 0.36], [2, 0.3], [2.66, 0.14]]
      .forEach(([ratio, amp]) => {
        const o = A.createOscillator();
        const g = A.createGain();
        o.type = 'sine';
        o.frequency.value = freq * ratio;
        o.detune.value = rnd(-5, 5);
        const dur = 3.4 / (0.6 + ratio);
        g.gain.setValueAtTime(0, time);
        g.gain.linearRampToValueAtTime(gain * amp, time + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0003, time + dur);
        o.connect(g);
        this.musPath(g, 0.16, 0.7);
        o.start(time); o.stop(time + dur + 0.1);
        this.track(o);
      });
  }

  /* ---------- arrangement ---------- */

  startMusic() {
    this.musicWanted = true;
    if (this.muted) return;
    if (!this.ensure() || this.musicPlaying) return;
    this.ensureMusicRoom();
    this.musicPlaying = true;
    this.bar = 0;
    this.tuneIdx = Math.floor(Math.random() * TUNES.length);
    this.vinylOn();
    const now = this.ctx.currentTime;
    this.nextBarTime = now + 0.14;
    this.schedule();
  }

  stopMusic() {
    this.musicWanted = false;
    if (this.muteHalt) {
      clearTimeout(this.muteHalt);
      this.muteHalt = null;
    }
    this.haltMusic();
  }

  /** Tear the voices down without forgetting that a scene wanted music. */
  haltMusic() {
    this.musicPlaying = false;
    if (this.musicTimer) {
      clearTimeout(this.musicTimer);
      this.musicTimer = null;
    }
    this.vinylOff();
    for (const n of this.nodes) {
      try { n.stop(); } catch { /* already stopped */ }
    }
    this.nodes.clear();
  }

  /**
   * Lookahead scheduler. The bar start time is ACCUMULATED in
   * AudioContext time rather than re-derived from currentTime each
   * callback: setTimeout is only accurate to tens of milliseconds and
   * browsers throttle it, and re-anchoring every bar turns that jitter
   * straight into audible tempo wobble. Queueing well ahead also rides
   * through a throttled tab.
   */
  schedule() {
    if (!this.musicPlaying || !this.ctx) return;
    if (this.ctx.state !== 'running') {
      this.musicTimer = setTimeout(() => this.schedule(), 300);
      return;
    }
    const now = this.ctx.currentTime;
    if (this.nextBarTime < now - 0.4) this.nextBarTime = now + 0.05;
    let guard = 0;
    while (this.nextBarTime < now + 1.8 && guard++ < 6) {
      this.nextBarTime += this.scheduleBar(this.nextBarTime);
    }
    this.musicTimer = setTimeout(() => this.schedule(), 140);
  }

  /**
   * Lay out one bar starting exactly at `t`; return its length so the
   * caller can advance without drift.
   *
   * 6/8: six eighths to the bar, felt as two dotted-quarter beats.
   * Compound time is what makes a tune read as medieval without any
   * costume — it is the metre of the estampie and the carol, and it
   * lilts on its own without needing swing applied to it.
   */
  scheduleBar(t) {
    const M = MOODS[this.mood] || MOODS.calm;
    const eighth = 60 / M.bpm / 2;
    const bar = eighth * 6;
    if (this.musLp) this.musLp.frequency.setTargetAtTime(M.lp, t, 1.2);

    const slot = FORM[this.bar % FORM.length];
    const tune = TUNES[this.tuneIdx];
    const chordRoot = ROOT * 2 ** (tune.chords[slot] / 12);

    // Bass: root on beat one, fifth on beat two. The two dotted-quarter
    // beats of the bar, and the spine of the whole thing.
    this.mBass(chordRoot / 2, t, eighth * 2.7, M.bass);
    this.mBass((chordRoot * 1.4983) / 2, t + eighth * 3, eighth * 2.7, M.bass * 0.86);

    // Strums land on the third and sixth eighths — the off-beat of each
    // dotted-quarter. Between the bass on the beat and the strum off it,
    // the bar swings on its own without any swing being applied to it.
    if (M.strum) {
      [2, 5].forEach((i) => {
        this.mStrum(chordRoot, t + i * eighth + rnd(-0.006, 0.006),
          M.strum * rnd(0.85, 1.1), rnd(2400, 3400));
      });
    }

    // A quiet drone for glue, well under the band rather than over it.
    if (M.drone && this.bar % 2 === 0) {
      this.mDrone(ROOT / 2, t, bar * 2.05, M.drone);
    }

    // Tabor.
    for (let i = 0; i < 6; i++) {
      if (!M.tabor[i]) continue;
      this.mTabor(t + i * eighth + rnd(-0.006, 0.006),
        rnd(0.1, 0.15) * M.tabor[i], i === 0 || i === 3);
    }
    if (M.jingle) {
      [2, 5].forEach((i) => {
        if (Math.random() < 0.75) this.mJingle(t + i * eighth + rnd(-0.008, 0.008), M.jingle);
      });
    }

    // The tune, as written.
    let off = 0;
    for (const [deg, len] of tune.bars[slot]) {
      const tt = t + off * eighth;
      const first = off === 0;
      off += len;
      if (M.drop && Math.random() < M.drop) continue;
      const f = ROOT * 2 ** (DORIAN[deg] / 12);
      // A grace note flicked in above a long note: the ornament every
      // piper puts there, and most of what separates a played tune from
      // a typed one. Never on the first note of a bar, which would have
      // to be scheduled before the bar itself starts.
      if (len >= 2 && !first && Math.random() < 0.35) {
        const gf = ROOT * 2 ** (DORIAN[Math.min(deg + 1, DORIAN.length - 1)] / 12);
        this.mPipe(gf, tt - eighth * 0.13, eighth * 0.12, M.mel * 0.65);
      }
      // Slightly short of its full length, so notes articulate instead of
      // running into one another.
      const dur = eighth * len * 0.9;
      if (M.pipe) this.mPipe(f, tt, dur, M.mel * rnd(0.92, 1.08));
      else this.mPsaltery(f, tt, dur, M.mel, rnd(2200, 3200));
    }

    // A bell at the top of the form, where a phrase turns over.
    if (M.bell && this.bar % FORM.length === 0 && Math.random() < 0.5) {
      this.mBell(ROOT * 2, t, M.bell);
    }

    this.bar++;
    // A new tune each time the form comes round, so sixteen bars never
    // becomes the whole soundtrack.
    if (this.bar % FORM.length === 0 && TUNES.length > 1) {
      this.tuneIdx = (this.tuneIdx + 1 + Math.floor(Math.random() * (TUNES.length - 1)))
        % TUNES.length;
    }
    return bar;
  }

  track(node) {
    this.nodes.add(node);
    node.onended = () => this.nodes.delete(node);
  }

  /* ==============================================================
     EFFECTS
  ============================================================== */

  blip(freq, dur, type = 'square', gain = 0.12, slideTo = null) {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    osc.connect(g); g.connect(this.sfxBus);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  /** Filtered noise, the basis of wind, rain and water sounds. */
  noise(dur, { filter = 900, q = 1, gain = 0.1, sweep = null, type = 'lowpass' } = {}) {
    if (!this.ensure()) return null;
    const t = this.ctx.currentTime;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.setValueAtTime(filter, t);
    filt.Q.value = q;
    if (sweep) filt.frequency.exponentialRampToValueAtTime(sweep, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(filt); filt.connect(g); g.connect(this.sfxBus);
    src.start(t);
    return src;
  }

  click() { this.blip(760, 0.05, 'square', 0.07, 520); }
  hover() { this.blip(980, 0.025, 'sine', 0.035); }
  deny() { this.blip(190, 0.16, 'sawtooth', 0.09, 120); }

  build() {
    this.blip(440, 0.07, 'square', 0.08);
    setTimeout(() => this.blip(660, 0.09, 'square', 0.07), 70);
    this.noise(0.14, { filter: 2200, gain: 0.05 });
  }

  dig() { this.noise(0.3, { filter: 1400, sweep: 400, gain: 0.09 }); }
  splash() { this.noise(0.45, { filter: 2600, sweep: 500, gain: 0.11 }); }
  coin() { this.blip(1180, 0.06, 'square', 0.05); setTimeout(() => this.blip(1560, 0.08, 'square', 0.045), 55); }

  /** A rising three-note alarm for storm warnings. */
  alarm() {
    [392, 523, 392].forEach((f, i) => setTimeout(() => this.blip(f, 0.3, 'square', 0.09), i * 260));
  }

  /** Low rumble plus a long gust when a dike gives way. */
  breach() {
    this.noise(1.6, { filter: 420, sweep: 90, gain: 0.22 });
    this.blip(90, 1.1, 'sawtooth', 0.14, 45);
  }

  thunder() {
    this.noise(1.9, { filter: 300, sweep: 70, gain: 0.18 });
  }

  victory() {
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.blip(f, 0.34, 'triangle', 0.12), i * 150));
  }

  defeat() {
    [392, 330, 262, 196].forEach((f, i) => setTimeout(() => this.blip(f, 0.5, 'sawtooth', 0.1), i * 240));
  }
}

export const Audio = new AudioEngine();

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) Audio.suspend();
    else Audio.resume();
  });
}
