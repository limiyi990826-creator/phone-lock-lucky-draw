(() => {
  const activeBursts = new WeakMap();
  let audioContext;
  let activeCue;
  let audioRequest = 0;
  let snareBuffer;

  async function primeSound() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;

    try {
      audioContext ??= new AudioContext();
      if (audioContext.state !== 'running') await audioContext.resume();
      return audioContext;
    } catch {
      return null;
    }
  }

  function stopDraw() {
    audioRequest += 1;
    const cue = activeCue;
    activeCue = undefined;
    if (!cue) return;

    const time = cue.audio.currentTime;
    cue.master.gain.setValueAtTime(cue.master.gain.value, time);
    cue.master.gain.linearRampToValueAtTime(0, time + 0.03);
    for (const voice of cue.voices) voice.stop(time + 0.035);
  }

  async function playCue(schedule) {
    stopDraw();
    const request = audioRequest;
    const audio = await primeSound();
    if (audio?.state !== 'running' || request !== audioRequest) return;

    const master = audio.createGain();
    master.gain.value = 0.7;
    master.connect(audio.destination);
    const cue = { audio, master, voices: new Set() };
    activeCue = cue;
    schedule(cue, audio.currentTime + 0.015);
    if (!cue.voices.size) {
      master.disconnect();
      activeCue = undefined;
    }
  }

  function playVoice(cue, source, time, duration, volume, attack) {
    const envelope = cue.audio.createGain();
    envelope.gain.setValueAtTime(0.001, time);
    envelope.gain.exponentialRampToValueAtTime(volume, time + Math.min(attack, duration / 2));
    envelope.gain.exponentialRampToValueAtTime(0.001, time + duration);
    source.connect(envelope).connect(cue.master);
    cue.voices.add(source);
    source.onended = () => {
      source.disconnect();
      envelope.disconnect();
      cue.voices.delete(source);
      if (!cue.voices.size) {
        cue.master.disconnect();
        if (activeCue === cue) activeCue = undefined;
      }
    };
    source.start(time);
    source.stop(time + duration + 0.01);
  }

  function tone(cue, { time, frequency, bends = [], duration, volume, attack = 0.012, type = 'sine' }) {
    const oscillator = cue.audio.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, time);
    for (const [progress, pitch] of bends) {
      oscillator.frequency.exponentialRampToValueAtTime(pitch, time + duration * progress);
    }
    playVoice(cue, oscillator, time, duration, volume, attack);
  }

  const pitch = (note) => 440 * 2 ** ((note - 69) / 12);

  function pluck(cue, time, note, volume, duration = 0.18) {
    const frequency = pitch(note);
    tone(cue, { time, frequency, duration, volume, attack: 0.005, type: 'triangle' });
    tone(cue, { time, frequency: frequency * 2, duration: 0.06, volume: volume * 0.32, attack: 0.003 });
  }

  function snare(cue, time, volume, duration = 0.078) {
    if (!snareBuffer) {
      const sampleRate = cue.audio.sampleRate;
      snareBuffer = cue.audio.createBuffer(1, Math.ceil(sampleRate * 0.13), sampleRate);
      const samples = snareBuffer.getChannelData(0);
      let low = 0;
      let high = 0;
      for (let index = 0; index < samples.length; index += 1) {
        const sample = Math.random() * 2 - 1;
        low += (sample - low) * 0.12;
        high += (sample - high) * 0.66;
        samples[index] = high - low;
      }
    }

    const source = cue.audio.createBufferSource();
    source.buffer = snareBuffer;
    playVoice(cue, source, time, duration, volume, 0.004);
  }

  function beginDraw(durationMs = 9000, elapsedMs = 0) {
    const startedAt = performance.now() - elapsedMs;
    const duration = durationMs / 1000;
    return playCue((cue, now) => {
      const start = now - (performance.now() - startedAt) / 1000;
      function playAt(position, play) {
        const time = start + position * duration;
        if (time >= now - 0.055) play(Math.max(time, now));
      }

      const phrases = [
        [0, 48, 64, 67], [0.109, 43, 62, 65], [0.218, 48, 64, 72],
        [0.327, 45, 64, 69], [0.426, 50, 65, 68], [0.518, 43, 65, 71],
        [0.601, 48, 67, 72], [0.675, 43, 71, 74],
      ];
      phrases.forEach(([position, bass, first, second], index) => {
        const span = (phrases[index + 1]?.[0] ?? 0.75) - position;
        playAt(position, (time) => pluck(cue, time, bass, 0.16, 0.23));
        playAt(position + span * 0.39, (time) => pluck(cue, time, first, 0.105));
        playAt(position + span * 0.72, (time) => pluck(cue, time, second, 0.088, 0.13));
      });

      // The rolls overlap the last plucks, then leave room for the slide and final pause.
      for (let hit = 0; hit < 22; hit += 1) {
        const progress = hit / 21;
        const position = 0.638 + 0.192 * (1.45 * progress - 0.45 * progress ** 2);
        const volume = 0.105 + progress * 0.12 + (hit % 3 === 0 ? 0.065 : 0);
        playAt(position, (time) => snare(cue, time, volume));
      }

      playAt(0.792, (time) => {
        tone(cue, {
          time, frequency: 490, duration: duration * 0.128, volume: 0.095, attack: 0.075,
          bends: [[0.22, 760], [0.34, 670], [0.56, 1150], [0.66, 960], [0.88, 1530], [1, 1330]],
        });
      });
    });
  }

  function playFanfare() {
    return playCue((cue, start) => {
      snare(cue, start, 0.25, 0.105);
      pluck(cue, start, 48, 0.20, 0.31);
      const melody = [[0, 67, 0.17], [0.15, 72, 0.17], [0.28, 75, 0.08], [0.36, 76, 0.17], [0.52, 79, 0.58]];
      melody.forEach(([delay, note, duration]) => {
        const time = start + delay;
        const frequency = pitch(note);
        tone(cue, { time, frequency, duration, volume: 0.16, attack: 0.016, type: 'triangle' });
        tone(cue, { time, frequency, duration: duration * 0.78, volume: 0.025, attack: 0.01, type: 'sawtooth' });
      });
      for (const note of [48, 60, 64, 67]) {
        pluck(cue, start + 0.52, note, 0.058, 0.66);
      }
      tone(cue, {
        time: start + 0.93, frequency: 515, duration: 0.4, volume: 0.083, attack: 0.025,
        bends: [[0.29, 955], [0.53, 630], [0.69, 725], [1, 420]],
      });
    });
  }

  function celebrate(canvas, { sound = false, origin } = {}) {
    if (sound) void playFanfare();
    else stopDraw();
    if (!canvas) return;

    activeBursts.get(canvas)?.();
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (reducedMotion.matches) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    const sparkCount = 24;
    const sparks = Array.from({ length: sparkCount }, (_, index) => {
      const angle = ((index + Math.random() * 0.7) / sparkCount) * Math.PI * 2;
      return {
        dx: Math.cos(angle),
        dy: Math.sin(angle),
        delay: Math.random() * 0.1,
        lifetime: 0.46 + Math.random() * 0.38,
        travel: 45 + Math.random() * 120,
        length: 10 + Math.random() * 34,
        color: index % 3 === 0 ? '#75bbf8' : '#2363c4',
      };
    });

    let width;
    let height;
    let centerX;
    let centerY;
    let halfWidth;
    let halfHeight;
    let frame;
    function resize() {
      const viewport = canvas.getBoundingClientRect();
      const anchor = origin?.getBoundingClientRect();
      ({ width, height } = viewport);
      halfWidth = (anchor?.width ?? 0) / 2;
      halfHeight = (anchor?.height ?? 0) / 2;
      centerX = anchor ? anchor.left + halfWidth - viewport.left : width / 2;
      centerY = anchor ? anchor.top + halfHeight - viewport.top : height / 2;
      const scale = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      context.setTransform(scale, 0, 0, scale, 0, 0);
      context.lineCap = 'round';
    }

    function stop() {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
      context.clearRect(0, 0, width, height);
      activeBursts.delete(canvas);
    }

    const start = performance.now();
    function draw(now) {
      const elapsed = (now - start) / 1000;
      if (elapsed >= 0.95 || reducedMotion.matches) {
        stop();
        return;
      }

      context.clearRect(0, 0, width, height);
      const spread = Math.min(1, width / 700);
      for (const spark of sparks) {
        const progress = (elapsed - spark.delay) / spark.lifetime;
        if (progress < 0 || progress >= 1) continue;

        const edge = Math.min(
          halfWidth / Math.max(0.001, Math.abs(spark.dx)),
          halfHeight / Math.max(0.001, Math.abs(spark.dy)),
        ) + 6;
        const tail = edge + spark.travel * spread * (1 - (1 - progress) ** 3);
        const tip = tail + spark.length * spread * (1 - progress * 0.75);
        const x1 = centerX + spark.dx * tail;
        const y1 = centerY + spark.dy * tail;
        const x2 = centerX + spark.dx * tip;
        const y2 = centerY + spark.dy * tip;
        const gradient = context.createLinearGradient(x1, y1, x2, y2);
        gradient.addColorStop(0, 'transparent');
        gradient.addColorStop(1, spark.color);
        context.globalAlpha = Math.min(progress * 20, (1 - progress) * 1.3, 1);
        context.strokeStyle = gradient;
        context.lineWidth = 1.5;
        context.beginPath();
        context.moveTo(x1, y1);
        context.lineTo(x2, y2);
        context.stroke();
      }
      context.globalAlpha = 1;
      frame = requestAnimationFrame(draw);
    }

    resize();
    if (!width || !height) return;
    window.addEventListener('resize', resize);
    activeBursts.set(canvas, stop);
    frame = requestAnimationFrame(draw);
  }

  window.DrawEffects = { celebrate, primeSound, beginDraw, stopDraw };
})();
