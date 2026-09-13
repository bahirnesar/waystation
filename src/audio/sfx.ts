// ─── AUDIO FEEDBACK ENGINE ───

class SoundFx {
  audioCtx: AudioContext | null = null;
  buffers: Record<string, AudioBuffer> = {};
  enabled: boolean = true;

  constructor() {
    this.init();
  }

  init(): void {
    const files: Record<string, string> = {
      hover: '/snd-hover.wav',
      click: '/snd-click.wav',
      transition: '/snd-transition.wav',
      switch: '/snd-sector-switch.wav'
    };

    const load = async () => {
      const AudioCtxConstructor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtxConstructor) return;
      this.audioCtx = new AudioCtxConstructor();

      for (const [key, url] of Object.entries(files)) {
        try {
          const res = await fetch(url);
          if (!res.ok) continue;
          const arrayBuffer = await res.arrayBuffer();
          this.buffers[key] = await this.audioCtx.decodeAudioData(arrayBuffer);
        } catch { }
      }
    };

    window.addEventListener('pointerdown', () => {
      if (!this.audioCtx) load();
      else if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
    }, { once: true });
  }

  play(key: string, vol: number = 0.2): void {
    if (!this.enabled || !this.audioCtx || !this.buffers[key]) return;
    try {
      const source = this.audioCtx.createBufferSource();
      source.buffer = this.buffers[key];
      const gain = this.audioCtx.createGain();
      gain.gain.value = vol;
      source.connect(gain);
      gain.connect(this.audioCtx.destination);
      source.onended = () => {
        source.disconnect();
        gain.disconnect();
      };
      source.start(0);
    } catch { }
  }

  dispose(): void {
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      try {
        this.audioCtx.close();
      } catch { }
      this.audioCtx = null;
    }
  }
}

export const sfx = new SoundFx();
