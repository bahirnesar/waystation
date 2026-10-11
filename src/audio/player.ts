// ─── AUDIO PLAYER CONTROLLER ───
import { ICON_PLAYER_PLAY, ICON_PLAYER_PAUSE } from '../ui/icons';
import { sfx } from './sfx';
import { Track } from '../types/index';

export interface AudioPlayerInitOptions {
  onTrackChange?: (track: Track) => void;
  onShowDetail?: (track: Track) => void;
}

class AudioPlayer {
  ytPlayer: YT.Player | null = null;
  ytReady: boolean = false;
  ytInitializing: boolean = false;
  isPlaying: boolean = false;
  progressInterval: number | null = null;

  activeTrack: Track | null = null;
  queue: Track[] = [];
  queueIdx: number = 0;
  isShuffle: boolean = false;
  history: Track[] = [];

  // Callbacks
  onTrackChange: ((track: Track) => void) | null = null;
  onShowDetail: ((track: Track) => void) | null = null;

  // DOM Elements
  playerArt: HTMLElement | null = null;
  playerTitle: HTMLElement | null = null;
  playerArtistText: HTMLElement | null = null;
  pPrev: HTMLElement | null = null;
  pToggle: HTMLElement | null = null;
  pNext: HTMLElement | null = null;
  shuffleBtn: HTMLElement | null = null;
  volSlider: HTMLInputElement | null = null;
  volPct: HTMLElement | null = null;
  pBar: HTMLElement | null = null;
  pFill: HTMLElement | null = null;
  pTime: HTMLElement | null = null;
  pDur: HTMLElement | null = null;
  playerLeft: HTMLElement | null = null;

  init({ onTrackChange, onShowDetail }: AudioPlayerInitOptions = {}): void {
    this.onTrackChange = onTrackChange || null;
    this.onShowDetail = onShowDetail || null;

    this.playerArt = document.getElementById('playerArt');
    this.playerTitle = document.getElementById('playerTitle');
    this.playerArtistText = document.getElementById('playerArtistText');
    this.pPrev = document.getElementById('pPrev');
    this.pToggle = document.getElementById('pToggle');
    this.pNext = document.getElementById('pNext');
    this.shuffleBtn = document.getElementById('shuffleBtn');
    this.volSlider = document.getElementById('volSlider') as HTMLInputElement | null;
    this.volPct = document.getElementById('volPct');
    this.pBar = document.getElementById('pBar');
    this.pFill = document.getElementById('pFill');
    this.pTime = document.getElementById('pTime');
    this.pDur = document.getElementById('pDur');
    this.playerLeft = document.getElementById('playerLeft');

    this.bindEvents();
    this.initYouTube();
  }

  bindEvents(): void {
    if (this.pToggle) {
      this.pToggle.addEventListener('click', () => this.togglePlayPause());
    }
    if (this.pNext) {
      this.pNext.addEventListener('click', () => { sfx.play('click'); this.skipNext(); });
    }
    if (this.pPrev) {
      this.pPrev.addEventListener('click', () => { sfx.play('click'); this.skipPrev(); });
    }

    if (this.shuffleBtn) {
      this.shuffleBtn.addEventListener('click', () => {
        this.isShuffle = !this.isShuffle;
        if (this.shuffleBtn) {
          this.shuffleBtn.style.color = this.isShuffle ? 'var(--accent)' : 'var(--text-muted)';
        }
        sfx.play('switch');
      });
    }

    if (this.volSlider) {
      this.volSlider.addEventListener('input', e => {
        const val = (e.target as HTMLInputElement).value;
        if (this.volPct) this.volPct.textContent = `${val}%`;
        if (this.ytPlayer && this.ytReady) this.ytPlayer.setVolume(val);
      });
    }

    if (this.pBar) {
      this.pBar.addEventListener('click', e => {
        if (!this.ytPlayer || !this.pBar) return;
        const rect = this.pBar.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const dur = this.ytPlayer.getDuration() || 0;
        if (dur > 0) {
          this.ytPlayer.seekTo(dur * ratio, true);
          if (this.pFill) this.pFill.style.width = `${ratio * 100}%`;
        }
      });
    }

    const showDetailHandler = () => {
      if (this.activeTrack) {
        sfx.play('click');
        if (this.onShowDetail) this.onShowDetail(this.activeTrack);
      }
    };

    if (this.playerLeft) {
      this.playerLeft.style.cursor = 'pointer';
      this.playerLeft.title = 'Show track recommendations';
      this.playerLeft.addEventListener('click', showDetailHandler);
    }

    const playerInfo = document.getElementById('playerInfo');
    if (playerInfo) {
      playerInfo.title = 'Show track recommendations';
      playerInfo.addEventListener('click', showDetailHandler);
    }
  }

  initYouTube(): void {
    if (this.ytPlayer || this.ytInitializing) return;
    this.ytInitializing = true;

    const initPlayer = () => {
      if (this.ytPlayer) return;
      if (typeof window.YT === 'undefined' || !window.YT.Player) return;

      try {
        this.ytPlayer = new window.YT.Player('yt-frame', {
          height: '240',
          width: '320',
          playerVars: {
            autoplay: 1,
            controls: 0,
            disablekb: 1,
            enablejsapi: 1,
            playsinline: 1,
            origin: window.location.origin
          },
          events: {
            onReady: () => {
              this.ytReady = true;
              this.ytInitializing = false;
              if (this.ytPlayer) {
                this.ytPlayer.setVolume(50);
                if (this.activeTrack) {
                  this.ytPlayer.loadVideoById(this.activeTrack.id);
                  this.ytPlayer.playVideo();
                }
              }
            },
            onStateChange: (e: { data: YT.PlayerState }) => this.onPlayerStateChange(e),
            onError: () => {
              this.ytInitializing = false;
              setTimeout(() => this.skipNext(), 1200);
            }
          }
        });
      } catch (err) {
        this.ytInitializing = false;
        console.error('Failed to initialize YouTube Player:', err);
      }
    };

    window.onYouTubeIframeAPIReady = () => initPlayer();

    if (typeof window.YT !== 'undefined' && window.YT.Player) {
      initPlayer();
    } else {
      const ytCheckInterval = window.setInterval(() => {
        if (typeof window.YT !== 'undefined' && window.YT.Player) {
          clearInterval(ytCheckInterval);
          if (!this.ytPlayer) initPlayer();
        }
      }, 100);
    }
  }

  onPlayerStateChange(e: { data: YT.PlayerState }): void {
    if (typeof window.YT === 'undefined') return;
    if (e.data === window.YT.PlayerState.PLAYING) {
      this.isPlaying = true;
      if (this.pToggle) this.pToggle.innerHTML = ICON_PLAYER_PAUSE;
      this.startProgressPolling();
    } else if (e.data === window.YT.PlayerState.PAUSED) {
      this.isPlaying = false;
      if (this.pToggle) this.pToggle.innerHTML = ICON_PLAYER_PLAY;
      this.stopProgressPolling();
    } else if (e.data === window.YT.PlayerState.ENDED) {
      this.isPlaying = false;
      if (this.pToggle) this.pToggle.innerHTML = ICON_PLAYER_PLAY;
      this.stopProgressPolling();
      this.skipNext();
    }
  }

  updateMetadata(track: Track): void {
    if (this.playerArt) this.playerArt.innerHTML = `<img class="player-art" src="${track.thumbnail}" alt="">`;
    if (this.playerTitle) this.playerTitle.textContent = track.title;
    if (this.playerArtistText) this.playerArtistText.textContent = track.artist;
  }

  playTrack(track: Track, fromHistory: boolean = false): void {
    if (!fromHistory && this.activeTrack && this.activeTrack.id !== track.id) {
      this.history.push(this.activeTrack);
      if (this.history.length > 100) this.history.shift();
    }
    // Keep queue position in sync so sequential skipping continues from here
    const idx = this.queue.findIndex(t => t.id === track.id);
    if (idx !== -1) this.queueIdx = idx;

    this.activeTrack = track;
    this.updateMetadata(track);

    if (this.ytReady && this.ytPlayer) {
      this.ytPlayer.loadVideoById(track.id);
      this.ytPlayer.playVideo();
    } else if (!this.ytPlayer) {
      this.initYouTube();
    }

    if (this.onTrackChange) {
      this.onTrackChange(track);
    }
  }

  togglePlayPause(): void {
    if (!this.activeTrack && this.queue.length) {
      this.playTrack(this.queue[0]);
      return;
    }
    if (!this.ytPlayer) return;
    if (this.isPlaying) this.ytPlayer.pauseVideo();
    else this.ytPlayer.playVideo();
  }

  skipNext(): void {
    if (!this.queue.length) return;
    if (this.isShuffle) this.queueIdx = Math.floor(Math.random() * this.queue.length);
    else this.queueIdx = (this.queueIdx + 1) % this.queue.length;
    this.playTrack(this.queue[this.queueIdx]);
  }

  skipPrev(): void {
    // Standard behaviour: if a few seconds in, restart the current track
    const cur = this.ytPlayer && this.ytReady ? this.ytPlayer.getCurrentTime() || 0 : 0;
    if (this.activeTrack && cur > 3) {
      this.ytPlayer!.seekTo(0, true);
      return;
    }
    const prev = this.history.pop();
    if (prev) {
      this.playTrack(prev, true);
    } else if (this.activeTrack && this.ytPlayer && this.ytReady) {
      this.ytPlayer.seekTo(0, true);
    }
  }

  setQueue(tracks: Track[], startImmediate: boolean = false): void {
    this.queue = [...tracks];
    this.queueIdx = 0;
    if (startImmediate && this.queue.length > 0) {
      this.playTrack(this.queue[0]);
    }
  }

  shuffleQueue(): void {
    for (let i = this.queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
    }
    this.queueIdx = 0;
    this.isShuffle = true;
    if (this.shuffleBtn) this.shuffleBtn.style.color = 'var(--accent)';
  }

  startProgressPolling(): void {
    this.stopProgressPolling();
    this.progressInterval = window.setInterval(() => {
      if (!this.ytPlayer || !this.isPlaying) return;
      const cur = this.ytPlayer.getCurrentTime() || 0;
      const dur = this.ytPlayer.getDuration() || 0;
      if (dur > 0) {
        const pct = (cur / dur) * 100;
        if (this.pFill) this.pFill.style.width = `${pct}%`;
        if (this.pTime) this.pTime.textContent = this.formatTime(cur);
        if (this.pDur) this.pDur.textContent = this.formatTime(dur);
      }
    }, 350);
  }

  stopProgressPolling(): void {
    if (this.progressInterval !== null) {
      clearInterval(this.progressInterval);
      this.progressInterval = null;
    }
  }

  formatTime(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  dispose(): void {
    this.stopProgressPolling();
    if (this.ytPlayer) {
      try {
        (this.ytPlayer as any).destroy?.();
      } catch { }
      this.ytPlayer = null;
    }
  }
}

export const player = new AudioPlayer();
