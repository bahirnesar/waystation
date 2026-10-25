// ─── UNIFIED MULTI-SOURCE AUDIO PLAYER CONTROLLER ───
import {
  ICON_PLAYER_PLAY,
  ICON_PLAYER_PAUSE,
  ICON_PLAYER_LOADING,
  ICON_MUSIC
} from '../ui/icons';
import { sfx } from './sfx';
import { Track } from '../types/index';
import { getLocalAudioBlob } from '../data/local-blobs';

export type ActiveEngine = 'yt' | 'sc' | 'audio' | 'sp' | 'none';

export interface AudioPlayerInitOptions {
  onTrackChange?: (track: Track) => void;
  onShowDetail?: (track: Track) => void;
  onPlaybackStateChange?: (state: {
    isPlaying: boolean;
    positionMs: number;
    durationMs: number;
    track: Track | null;
  }) => void;
  getRoomId?: () => string;
}

const SILENCE =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

const PLATFORM_COLORS: Record<string, string> = {
  youtube: '#FF0000',
  soundcloud: '#FF5500',
  bandcamp: '#629AA9',
  spotify: '#1DB954',
  'apple-music': '#FC3C44',
  local: '#F4977C'
};

class AudioPlayer {
  // Engine State
  activeEngine: ActiveEngine = 'none';
  loadGeneration: number = 0;
  isPlaying: boolean = false;
  audioVolume: number = 50;
  roomId: string | null = null;
  getRoomIdFn: (() => string) | null = null;

  // Queue & Navigation
  activeTrack: Track | null = null;
  queue: Track[] = [];
  queueIdx: number = 0;
  isShuffle: boolean = false;
  history: Track[] = [];

  // YouTube Engine
  ytPlayer: YT.Player | null = null;
  ytReady: boolean = false;
  ytInitializing: boolean = false;
  ytPendingId: string | null = null;

  // SoundCloud Engine
  scWidget: SCWidget | null = null;
  scReady: boolean = false;
  scPosition: number = 0;
  scDuration: number = 0;

  // HTML5 Audio Engine (Bandcamp, Local, Direct Streams)
  bcAudio: HTMLAudioElement = new Audio();
  audioUnlocked: boolean = false;
  currentBlobUrl: string | null = null;

  // Spotify Engine (IFrame API)
  spController: SpotifyEmbedController | null = null;
  spReady: boolean = false;
  spPosition: number = 0;
  spDuration: number = 0;
  spPendingUri: string | null = null;

  // Progress & Scrubber
  progressInterval: number | null = null;
  private scrubTarget: number = 0;
  private scrubCurrent: number = 0;
  private scrubDragging: boolean = false;
  private scrubFrozen: boolean = false;
  private liveShowTimer: number | null = null;

  // Callbacks
  onTrackChange: ((track: Track) => void) | null = null;
  onShowDetail: ((track: Track) => void) | null = null;
  onPlaybackStateChange:
    | ((state: {
        isPlaying: boolean;
        positionMs: number;
        durationMs: number;
        track: Track | null;
      }) => void)
    | null = null;

  // DOM Elements
  playerArt: HTMLElement | null = null;
  playerTitle: HTMLElement | null = null;
  playerArtist: HTMLElement | null = null;
  playerArtistText: HTMLElement | null = null;
  playerPlatDot: HTMLElement | null = null;
  pPrev: HTMLElement | null = null;
  pToggle: HTMLElement | null = null;
  pNext: HTMLElement | null = null;
  shuffleBtn: HTMLElement | null = null;
  volSlider: HTMLInputElement | null = null;
  volPct: HTMLElement | null = null;
  pProgress: HTMLElement | null = null;
  pBar: HTMLElement | null = null;
  pFill: HTMLElement | null = null;
  pGhost: HTMLElement | null = null;
  pLiveDot: HTMLElement | null = null;
  pLiveTime: HTMLElement | null = null;
  pTooltip: HTMLElement | null = null;
  pHitarea: HTMLElement | null = null;
  pTime: HTMLElement | null = null;
  pDur: HTMLElement | null = null;
  playerLeft: HTMLElement | null = null;

  init(options: AudioPlayerInitOptions = {}): void {
    this.onTrackChange = options.onTrackChange || null;
    this.onShowDetail = options.onShowDetail || null;
    this.onPlaybackStateChange = options.onPlaybackStateChange || null;
    this.getRoomIdFn = options.getRoomId || null;

    this.playerArt = document.getElementById('playerArt');
    this.playerTitle = document.getElementById('playerTitle');
    this.playerArtist = document.getElementById('playerArtist');
    this.playerArtistText = document.getElementById('playerArtistText');
    this.playerPlatDot = document.getElementById('playerPlatDot');
    this.pPrev = document.getElementById('pPrev');
    this.pToggle = document.getElementById('pToggle');
    this.pNext = document.getElementById('pNext');
    this.shuffleBtn = document.getElementById('shuffleBtn');
    this.volSlider = document.getElementById('volSlider') as HTMLInputElement | null;
    this.volPct = document.getElementById('volPct');
    this.pProgress = document.getElementById('pProgress');
    this.pBar = document.getElementById('pBar');
    this.pFill = document.getElementById('pFill');
    this.pGhost = document.getElementById('pGhost');
    this.pLiveDot = document.getElementById('pLiveDot');
    this.pLiveTime = document.getElementById('pLiveTime');
    this.pTooltip = document.getElementById('pTooltip');
    this.pHitarea = document.getElementById('pHitarea');
    this.pTime = document.getElementById('pTime');
    this.pDur = document.getElementById('pDur');
    this.playerLeft = document.getElementById('playerLeft');

    this.bindEvents();
    this.initAudioUnlock();
    this.initYouTube();
    this.initSoundCloud();
    this.initSpotify();
  }

  setRoomId(id: string): void {
    this.roomId = id;
  }

  private getCurrentRoomId(): string {
    if (this.getRoomIdFn) return this.getRoomIdFn();
    return this.roomId || '';
  }

  // ─── AUDIO UNLOCK FOR MOBILE BROWSERS ───
  private initAudioUnlock(): void {
    const unlock = () => {
      if (this.audioUnlocked) return;
      this.bcAudio.src = SILENCE;
      this.bcAudio.volume = 0;
      const p = this.bcAudio.play();
      if (p) {
        p.then(() => {
          this.bcAudio.pause();
          this.bcAudio.volume = this.audioVolume / 100;
          this.bcAudio.removeAttribute('src');
          this.bcAudio.load();
          this.audioUnlocked = true;
        }).catch(() => {});
      }
    };

    ['click', 'pointerup', 'touchend', 'keydown'].forEach(evt => {
      document.addEventListener(evt, unlock, { once: false, capture: true });
    });

    this.bcAudio.addEventListener('ended', () => {
      if (this.activeEngine !== 'audio') return;
      this.setPlayState(false);
      this.skipNext();
    });

    this.bcAudio.addEventListener('timeupdate', () => {
      if (this.activeEngine !== 'audio' || this.scrubDragging) return;
      const cur = this.bcAudio.currentTime * 1000;
      const dur = (this.bcAudio.duration || 0) * 1000;
      if (dur > 0) {
        this.setScrubTarget((cur / dur) * 100);
        if (this.pTime) this.pTime.textContent = this.formatTime(cur / 1000);
        if (this.pDur) this.pDur.textContent = this.formatTime(dur / 1000);
      }
    });

    this.bcAudio.addEventListener('error', () => {
      const src = this.bcAudio.currentSrc || this.bcAudio.src || '';
      if (!src || src.startsWith('data:')) return;
      if (this.activeEngine !== 'audio') return;
      this.setPlayState(false);
      setTimeout(() => this.skipNext(), 1200);
    });
  }

  // ─── YOUTUBE ENGINE ───
  private initYouTube(): void {
    if (this.ytPlayer || this.ytInitializing) return;
    this.ytInitializing = true;

    const init = () => {
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
                this.ytPlayer.setVolume(this.audioVolume);
                if (this.ytPendingId) {
                  const id = this.ytPendingId;
                  this.ytPendingId = null;
                  this.ytPlayer.loadVideoById(id);
                  this.ytPlayer.playVideo();
                }
              }
            },
            onStateChange: (e: { data: YT.PlayerState }) => this.onYouTubeStateChange(e),
            onError: () => {
              this.ytInitializing = false;
              if (this.activeEngine === 'yt') {
                this.setPlayState(false);
                setTimeout(() => this.skipNext(), 1200);
              }
            }
          }
        });
      } catch (err) {
        this.ytInitializing = false;
        console.error('Failed to init YouTube player:', err);
      }
    };

    window.onYouTubeIframeAPIReady = () => init();

    if (typeof window.YT !== 'undefined' && window.YT.Player) {
      init();
    } else {
      const checkInterval = window.setInterval(() => {
        if (typeof window.YT !== 'undefined' && window.YT.Player) {
          clearInterval(checkInterval);
          if (!this.ytPlayer) init();
        }
      }, 100);
    }
  }

  private onYouTubeStateChange(e: { data: YT.PlayerState }): void {
    if (typeof window.YT === 'undefined' || this.activeEngine !== 'yt') return;

    if (e.data === window.YT.PlayerState.PLAYING) {
      this.setPlayState(true);
      const dur = this.ytPlayer?.getDuration() || 0;
      if (dur > 0 && this.pDur) {
        this.pDur.textContent = this.formatTime(dur);
      }
    } else if (e.data === window.YT.PlayerState.PAUSED) {
      this.setPlayState(false);
    } else if (e.data === window.YT.PlayerState.ENDED) {
      this.setPlayState(false);
      this.skipNext();
    }
  }

  // ─── SOUNDCLOUD ENGINE ───
  private initSoundCloud(): void {
    const scFrame = document.getElementById('sc-frame') as HTMLIFrameElement | null;
    if (!scFrame) return;

    const setupWidget = () => {
      if (typeof window.SC === 'undefined' || !window.SC.Widget) {
        setTimeout(setupWidget, 200);
        return;
      }
      try {
        this.scWidget = window.SC.Widget(scFrame);
        this.scWidget.bind(window.SC.Widget.Events.READY, () => {
          this.scReady = true;
          this.scWidget?.setVolume(this.audioVolume);
        });

        this.scWidget.bind(window.SC.Widget.Events.PLAY, () => {
          if (this.activeEngine === 'sc') {
            this.setPlayState(true);
          }
        });

        this.scWidget.bind(window.SC.Widget.Events.PAUSE, () => {
          if (this.activeEngine === 'sc') {
            this.setPlayState(false);
          }
        });

        this.scWidget.bind(window.SC.Widget.Events.FINISH, () => {
          if (this.activeEngine !== 'sc') return;
          this.setPlayState(false);
          this.skipNext();
        });

        this.scWidget.bind(window.SC.Widget.Events.PLAY_PROGRESS, (data: any) => {
          if (this.activeEngine !== 'sc' || this.scrubDragging) return;
          this.scPosition = data.currentPosition || 0;
          const dur = this.scDuration || data.duration || 0;
          if (dur > 0) {
            this.setScrubTarget((this.scPosition / dur) * 100);
            if (this.pTime) this.pTime.textContent = this.formatTime(this.scPosition / 1000);
          }
        });

        this.scWidget.bind(window.SC.Widget.Events.ERROR, () => {
          if (this.activeEngine !== 'sc') return;
          this.setPlayState(false);
          if (this.playerArtistText) {
            this.playerArtistText.textContent = 'Track unavailable';
          }
          setTimeout(() => this.skipNext(), 1200);
        });
      } catch (err) {
        console.warn('SoundCloud Widget init error:', err);
      }
    };

    setupWidget();
  }

  // ─── SPOTIFY ENGINE (IFRAME API) ───
  private initSpotify(): void {
    window.onSpotifyIframeApiReady = (IFrameAPI: SpotifyIframeApi) => {
      const el = document.getElementById('spotify-embed');
      if (!el) return;
      IFrameAPI.createController(
        el,
        { width: '100%', height: '80', uri: 'spotify:track:4cOdK2wGLETKBW3PvgPWqT' },
        (controller: SpotifyEmbedController) => {
          this.spController = controller;
          controller.addListener('ready', () => {
            this.spReady = true;
            if (this.spPendingUri) {
              const uri = this.spPendingUri;
              this.spPendingUri = null;
              this.spController?.loadUri(uri);
              this.spController?.play();
            }
          });

          controller.addListener('playback_update', (e: any) => {
            if (this.activeEngine !== 'sp') return;
            const d = e.data || {};
            this.spPosition = d.position || 0;
            this.spDuration = d.duration || 0;
            const isPlaying = !d.isPaused && !d.isBuffering;

            if (this.spDuration > 0 && !this.scrubDragging) {
              this.setScrubTarget((this.spPosition / this.spDuration) * 100);
              if (this.pTime) this.pTime.textContent = this.formatTime(this.spPosition / 1000);
              if (this.pDur) this.pDur.textContent = this.formatTime(this.spDuration / 1000);
            }

            if (isPlaying !== this.isPlaying) {
              this.setPlayState(isPlaying);
            }

            // Track finished detection: paused near end
            if (d.isPaused && this.spDuration > 1000 && this.spPosition >= this.spDuration - 1000) {
              this.setPlayState(false);
              this.skipNext();
            }
          });
        }
      );
    };
  }

  // ─── ENGINE SWITCHING & PLAYBACK ───
  private pauseOtherEngines(target: ActiveEngine): void {
    if (target !== 'yt' && this.ytPlayer && this.ytReady) {
      try {
        this.ytPlayer.pauseVideo();
      } catch {}
    }
    if (target !== 'sc' && this.scWidget && this.scReady) {
      try {
        this.scWidget.pause();
      } catch {}
    }
    if (target !== 'audio') {
      try {
        this.bcAudio.pause();
      } catch {}
    }
    if (target !== 'sp' && this.spController && this.spReady) {
      try {
        this.spController.pause();
      } catch {}
    }
  }

  private setPlayState(playing: boolean): void {
    this.isPlaying = playing;
    if (this.pToggle) {
      this.pToggle.innerHTML = playing ? ICON_PLAYER_PAUSE : ICON_PLAYER_PLAY;
    }
    if (playing) {
      this.startProgressPolling();
    } else {
      this.stopProgressPolling();
    }
    this.broadcastPlaybackState();
  }

  private broadcastPlaybackState(): void {
    if (this.onPlaybackStateChange) {
      this.onPlaybackStateChange({
        isPlaying: this.isPlaying,
        positionMs: this.getCurrentTimeMs(),
        durationMs: this.getDurationMs(),
        track: this.activeTrack
      });
    }
  }

  playTrack(track: Track, fromHistory: boolean = false): void {
    if (!fromHistory && this.activeTrack && this.activeTrack.id !== track.id) {
      this.history.push(this.activeTrack);
      if (this.history.length > 100) this.history.shift();
    }

    const idx = this.queue.findIndex(t => t.id === track.id);
    if (idx !== -1) this.queueIdx = idx;

    this.activeTrack = track;
    this.loadGeneration++;
    const currentGen = this.loadGeneration;

    this.updateMetadata(track);
    this.resetScrub();
    this.showLoadingButton();

    if (this.onTrackChange) {
      this.onTrackChange(track);
    }

    // Determine target engine based on track metadata
    const src = track.importSource || this.inferSource(track);

    if (src === 'soundcloud' && track.scUrl) {
      this.playWithSoundCloud(track, currentGen);
    } else if (
      src === 'bandcamp' ||
      track.bcUrl ||
      track.tralbumId ||
      track.importSource === 'local' ||
      track.localBlobKey ||
      track.importSource === 'bandcamp'
    ) {
      this.playWithAudio(track, currentGen);
    } else if ((src === 'spotify' || src === 'apple-music') && !track.ytId) {
      this.resolveAndPlayYouTube(track, currentGen);
    } else {
      // Default: YouTube engine (curated tracks or resolved ytId)
      this.playWithYouTube(track, currentGen);
    }
  }

  private inferSource(track: Track): string {
    if (track.scUrl) return 'soundcloud';
    if (track.bcUrl || track.tralbumId) return 'bandcamp';
    if (track.localBlobKey) return 'local';
    if (track.spotifyUrl) return 'spotify';
    if (track.appleMusicUrl) return 'apple-music';
    return 'youtube';
  }

  // Engine 1: YouTube
  private playWithYouTube(track: Track, gen: number): void {
    this.activeEngine = 'yt';
    this.pauseOtherEngines('yt');

    const videoId = track.ytId || track.id;
    if (this.ytPlayer && this.ytReady) {
      if (this.loadGeneration !== gen) return;
      this.ytPlayer.loadVideoById(videoId);
      this.ytPlayer.playVideo();
      this.setPlayState(true);
    } else {
      this.ytPendingId = videoId;
      this.initYouTube();
    }
  }

  // Engine 2: SoundCloud
  private playWithSoundCloud(track: Track, gen: number): void {
    this.activeEngine = 'sc';
    this.pauseOtherEngines('sc');
    this.scPosition = 0;
    this.scDuration = 0;

    if (!this.scWidget) {
      this.initSoundCloud();
    }

    if (!this.scWidget) {
      setTimeout(() => this.skipNext(), 1200);
      return;
    }

    this.scReady = false;
    this.scWidget.pause();
    this.scWidget.load(track.scUrl!, {
      auto_play: true,
      hide_related: true,
      show_comments: false,
      show_user: false,
      show_reposts: false,
      show_teaser: false,
      visual: false,
      callback: () => {
        if (this.loadGeneration !== gen) return;
        this.scReady = true;
        this.scWidget?.play();
        this.scWidget?.getDuration((dur: number) => {
          if (this.loadGeneration !== gen) return;
          this.scDuration = dur;
          if (this.pDur) this.pDur.textContent = this.formatTime(dur / 1000);
        });
      }
    });
  }

  // Engine 3: HTML5 Audio (Bandcamp, Local Blobs, Direct Streams)
  private async playWithAudio(track: Track, gen: number): Promise<void> {
    this.activeEngine = 'audio';
    this.pauseOtherEngines('audio');

    // Revoke previous blob URL if any
    if (this.currentBlobUrl) {
      URL.revokeObjectURL(this.currentBlobUrl);
      this.currentBlobUrl = null;
    }

    this.bcAudio.pause();
    this.bcAudio.removeAttribute('src');
    this.bcAudio.load();

    // 1. Local Audio Blob
    if (track.localBlobKey) {
      try {
        const blob = await getLocalAudioBlob(track.localBlobKey);
        if (this.loadGeneration !== gen) return;
        if (blob) {
          this.currentBlobUrl = URL.createObjectURL(blob);
          this.bcAudio.src = this.currentBlobUrl;
          await this.bcAudio.play();
          this.setPlayState(true);
          return;
        }
      } catch (e) {
        console.warn('Failed to load local audio blob:', e);
      }
    }

    // 2. Direct Stream URL
    if ((track as any).streamUrl) {
      this.bcAudio.src = (track as any).streamUrl;
      try {
        await this.bcAudio.play();
        if (this.loadGeneration === gen) this.setPlayState(true);
      } catch {
        if (this.loadGeneration === gen) setTimeout(() => this.skipNext(), 1200);
      }
      return;
    }

    // 3. Bandcamp Stream Resolution (/api/bc-stream)
    let bcParams = '';
    if (track.bcUrl) {
      bcParams = `url=${encodeURIComponent(track.bcUrl)}`;
    } else if (track.tralbumId) {
      if (track.tralbumType === 'a') {
        bcParams = `album_id=${encodeURIComponent(track.tralbumId)}`;
      } else {
        bcParams = `track_id=${encodeURIComponent(track.tralbumId)}`;
      }
    }

    if (!bcParams) {
      // Fallback: try resolving on YouTube
      this.resolveAndPlayYouTube(track, gen);
      return;
    }

    try {
      const res = await fetch(`/api/bc-stream?${bcParams}`);
      const data = (await res.json()) as { streamUrl?: string; error?: string };
      if (this.loadGeneration !== gen) return;

      if (data.streamUrl) {
        this.bcAudio.src = data.streamUrl;
        try {
          await this.bcAudio.play();
          if (this.loadGeneration === gen) this.setPlayState(true);
        } catch {
          // Fallback to CORS stream pipe if direct playback fails
          if (this.loadGeneration !== gen) return;
          this.bcAudio.src = `/api/stream-pipe?url=${encodeURIComponent(data.streamUrl)}`;
          try {
            await this.bcAudio.play();
            if (this.loadGeneration === gen) this.setPlayState(true);
          } catch {
            if (this.loadGeneration === gen) setTimeout(() => this.skipNext(), 1200);
          }
        }
      } else {
        // Stream URL not resolved, fallback to YouTube resolver
        this.resolveAndPlayYouTube(track, gen);
      }
    } catch {
      if (this.loadGeneration === gen) {
        this.resolveAndPlayYouTube(track, gen);
      }
    }
  }

  // Engine 4: Spotify / Apple Music / Fallback via YouTube Resolver
  private async resolveAndPlayYouTube(track: Track, gen: number): Promise<void> {
    if (this.playerArtistText) {
      this.playerArtistText.textContent = 'Resolving track audio...';
    }

    const query = track.artist ? `${track.artist} - ${track.title}` : track.title;
    const roomId = this.getCurrentRoomId();
    let url = `/api/yt-resolve?q=${encodeURIComponent(query)}`;
    if (roomId && track.id) {
      url += `&roomId=${encodeURIComponent(roomId)}&trackId=${encodeURIComponent(track.id)}`;
    }

    try {
      const res = await fetch(url);
      const data = (await res.json()) as { ok?: boolean; ytId?: string };
      if (this.loadGeneration !== gen) return;

      if (data.ok && data.ytId) {
        track.ytId = data.ytId;
        if (this.playerArtistText) {
          this.playerArtistText.textContent = track.artist;
        }
        this.playWithYouTube(track, gen);
      } else {
        if (this.playerArtistText) {
          this.playerArtistText.textContent = 'Track audio unavailable';
        }
        this.setPlayState(false);
        setTimeout(() => this.skipNext(), 1500);
      }
    } catch (err) {
      console.warn('YouTube resolution error:', err);
      if (this.loadGeneration === gen) {
        this.setPlayState(false);
        setTimeout(() => this.skipNext(), 1500);
      }
    }
  }

  // ─── UNIFIED CONTROLS ───
  togglePlayPause(): void {
    if (!this.activeTrack && this.queue.length > 0) {
      this.playTrack(this.queue[0]);
      return;
    }
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  play(): void {
    if (this.activeEngine === 'yt' && this.ytPlayer && this.ytReady) {
      this.ytPlayer.playVideo();
      this.setPlayState(true);
    } else if (this.activeEngine === 'sc' && this.scWidget && this.scReady) {
      this.scWidget.play();
      this.setPlayState(true);
    } else if (this.activeEngine === 'audio') {
      this.bcAudio.play().then(() => this.setPlayState(true)).catch(() => {});
    } else if (this.activeEngine === 'sp' && this.spController && this.spReady) {
      this.spController.resume();
      this.setPlayState(true);
    }
  }

  pause(): void {
    if (this.activeEngine === 'yt' && this.ytPlayer && this.ytReady) {
      this.ytPlayer.pauseVideo();
    } else if (this.activeEngine === 'sc' && this.scWidget && this.scReady) {
      this.scWidget.pause();
    } else if (this.activeEngine === 'audio') {
      this.bcAudio.pause();
    } else if (this.activeEngine === 'sp' && this.spController && this.spReady) {
      this.spController.pause();
    }
    this.setPlayState(false);
  }

  skipNext(): void {
    if (!this.queue.length) return;
    if (this.isShuffle) {
      this.queueIdx = Math.floor(Math.random() * this.queue.length);
    } else {
      this.queueIdx = (this.queueIdx + 1) % this.queue.length;
    }
    this.playTrack(this.queue[this.queueIdx]);
  }

  skipPrev(): void {
    const curMs = this.getCurrentTimeMs();
    if (this.activeTrack && curMs > 3000) {
      this.seekToMs(0);
      return;
    }
    const prev = this.history.pop();
    if (prev) {
      this.playTrack(prev, true);
    } else if (this.activeTrack) {
      this.seekToMs(0);
    }
  }

  seekToMs(ms: number): void {
    if (this.activeEngine === 'yt' && this.ytPlayer && this.ytReady) {
      this.ytPlayer.seekTo(ms / 1000, true);
    } else if (this.activeEngine === 'sc' && this.scWidget && this.scReady) {
      this.scWidget.seekTo(ms);
    } else if (this.activeEngine === 'audio') {
      this.bcAudio.currentTime = ms / 1000;
    } else if (this.activeEngine === 'sp' && this.spController && this.spReady) {
      this.spController.seek(Math.round(ms / 1000));
    }

    const dur = this.getDurationMs();
    if (dur > 0) {
      const pct = (ms / dur) * 100;
      this.scrubCurrent = pct;
      this.scrubTarget = pct;
      if (this.pFill) this.pFill.style.width = `${pct}%`;
      if (this.pTime) this.pTime.textContent = this.formatTime(ms / 1000);
    }

    this.broadcastPlaybackState();
  }

  getCurrentTimeMs(): number {
    if (this.activeEngine === 'yt' && this.ytPlayer && this.ytReady) {
      return (this.ytPlayer.getCurrentTime() || 0) * 1000;
    }
    if (this.activeEngine === 'sc') {
      return this.scPosition;
    }
    if (this.activeEngine === 'audio') {
      return (this.bcAudio.currentTime || 0) * 1000;
    }
    if (this.activeEngine === 'sp') {
      return this.spPosition;
    }
    return 0;
  }

  getDurationMs(): number {
    if (this.activeEngine === 'yt' && this.ytPlayer && this.ytReady) {
      return (this.ytPlayer.getDuration() || 0) * 1000;
    }
    if (this.activeEngine === 'sc') {
      return this.scDuration;
    }
    if (this.activeEngine === 'audio') {
      return (this.bcAudio.duration || 0) * 1000;
    }
    if (this.activeEngine === 'sp') {
      return this.spDuration;
    }
    return 0;
  }

  getVolume(): number {
    return this.audioVolume;
  }

  setVolume(val: number): void {
    this.audioVolume = Math.max(0, Math.min(100, val));
    if (this.volSlider) this.volSlider.value = String(this.audioVolume);
    if (this.volPct) this.volPct.textContent = `${this.audioVolume}%`;

    if (this.ytPlayer && this.ytReady) {
      this.ytPlayer.setVolume(this.audioVolume);
    }
    if (this.scWidget && this.scReady) {
      this.scWidget.setVolume(this.audioVolume);
    }
    this.bcAudio.volume = this.audioVolume / 100;
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
    this.shuffleBtn?.classList.add('active');
  }

  // ─── SCRUBBER & UI POLLING ───
  private startProgressPolling(): void {
    this.stopProgressPolling();
    this.progressInterval = window.setInterval(() => {
      if (!this.isPlaying || this.scrubDragging) return;
      const cur = this.getCurrentTimeMs();
      const dur = this.getDurationMs();

      if (dur > 0) {
        this.setScrubTarget((cur / dur) * 100);
        if (this.pTime) this.pTime.textContent = this.formatTime(cur / 1000);
        if (this.pDur) this.pDur.textContent = this.formatTime(dur / 1000);
      }
    }, 300);
  }

  private stopProgressPolling(): void {
    if (this.progressInterval !== null) {
      clearInterval(this.progressInterval);
      this.progressInterval = null;
    }
  }

  private setScrubTarget(pct: number): void {
    if (this.scrubFrozen && pct > 0) this.scrubFrozen = false;
    if (!this.scrubFrozen) {
      this.scrubTarget = pct;
      this.tickScrub();
    }
  }

  private resetScrub(): void {
    this.scrubTarget = 0;
    this.scrubCurrent = 0;
    this.scrubFrozen = true;
    if (this.pFill) this.pFill.style.width = '0%';
    if (this.pTime) this.pTime.textContent = '0:00';
    if (this.pDur) this.pDur.textContent = '0:00';
  }

  private tickScrub(): void {
    if (this.scrubDragging || !this.pFill) return;
    const diff = this.scrubTarget - this.scrubCurrent;
    if (Math.abs(diff) < 0.05) {
      this.scrubCurrent = this.scrubTarget;
    } else {
      const factor = diff < 0 ? 0.35 : 0.25;
      this.scrubCurrent += diff * factor;
    }
    this.pFill.style.width = `${this.scrubCurrent}%`;
  }

  private showLoadingButton(): void {
    if (this.pToggle) {
      this.pToggle.innerHTML = ICON_PLAYER_LOADING;
    }
  }

  private updateMetadata(track: Track): void {
    // Artwork
    if (this.playerArt) {
      const artUrl = track.thumbnail || (track as any).artworkUrl;
      if (artUrl) {
        const img = document.createElement('img');
        img.className = 'player-art';
        img.src = artUrl.replace('-t500x500', '-t200x200');
        img.alt = track.title || '';
        img.id = 'playerArt';
        this.playerArt.replaceWith(img);
        this.playerArt = img;
      } else {
        if (this.playerArt.tagName === 'IMG') {
          const ph = document.createElement('div');
          ph.className = 'player-art-placeholder';
          ph.id = 'playerArt';
          ph.innerHTML = ICON_MUSIC;
          this.playerArt.replaceWith(ph);
          this.playerArt = ph;
        }
      }
    }

    if (this.playerTitle) this.playerTitle.textContent = track.title;
    if (this.playerArtistText) this.playerArtistText.textContent = track.artist;

    // Platform dot color
    const src = track.importSource || this.inferSource(track);
    if (this.playerPlatDot) {
      this.playerPlatDot.style.background = PLATFORM_COLORS[src] || PLATFORM_COLORS.youtube;
    }
    if (this.playerArtist) {
      this.playerArtist.classList.add('has-dot');
    }
  }

  private bindEvents(): void {
    if (this.pToggle) {
      this.pToggle.addEventListener('click', () => this.togglePlayPause());
    }
    if (this.pNext) {
      this.pNext.addEventListener('click', () => {
        sfx.play('click');
        this.skipNext();
      });
    }
    if (this.pPrev) {
      this.pPrev.addEventListener('click', () => {
        sfx.play('click');
        this.skipPrev();
      });
    }

    if (this.shuffleBtn) {
      this.shuffleBtn.addEventListener('click', () => {
        this.isShuffle = !this.isShuffle;
        this.shuffleBtn?.classList.toggle('active', this.isShuffle);
        sfx.play('switch');
      });
    }

    if (this.volSlider) {
      this.volSlider.addEventListener('input', e => {
        const val = Number((e.target as HTMLInputElement).value);
        this.setVolume(val);
      });
    }

    this.bindScrubberEvents();

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

  private bindScrubberEvents(): void {
    if (!this.pHitarea || !this.pBar) return;

    const hitarea = this.pHitarea;
    const bar = this.pBar;

    const pctFromEvent = (e: PointerEvent | MouseEvent): number => {
      const r = bar.getBoundingClientRect();
      return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    };

    const updateTooltip = (_e: MouseEvent, pct: number) => {
      if (!this.pTooltip) return;
      const dur = this.getDurationMs();
      const timeSec = (dur * pct) / 1000;
      this.pTooltip.textContent = this.formatTime(timeSec);
      const r = bar.getBoundingClientRect();
      this.pTooltip.style.left = `${pct * r.width}px`;
    };

    const showLiveIndicator = () => {
      if (this.pGhost) this.pGhost.style.display = 'block';
      if (this.liveShowTimer) clearTimeout(this.liveShowTimer);
      this.liveShowTimer = window.setTimeout(() => {
        if (this.pLiveDot) this.pLiveDot.style.opacity = '1';
        if (this.pLiveTime) this.pLiveTime.style.opacity = '1';
        this.liveShowTimer = null;
      }, 150);
    };

    const hideLiveIndicator = () => {
      if (this.liveShowTimer) {
        clearTimeout(this.liveShowTimer);
        this.liveShowTimer = null;
      }
      if (this.pGhost) this.pGhost.style.display = 'none';
      if (this.pLiveDot) this.pLiveDot.style.opacity = '0';
      if (this.pLiveTime) this.pLiveTime.style.opacity = '0';
    };

    hitarea.addEventListener('mousemove', e => {
      if (this.scrubDragging) return;
      const pct = pctFromEvent(e);
      updateTooltip(e, pct);
    });

    hitarea.addEventListener('pointerdown', e => {
      const dur = this.getDurationMs();
      if (!dur) return;
      e.preventDefault();
      hitarea.setPointerCapture(e.pointerId);
      this.scrubDragging = true;
      const pct = pctFromEvent(e);
      this.pProgress?.classList.add('player-progress--dragging');
      showLiveIndicator();
      updateTooltip(e, pct);
      if (this.pFill) this.pFill.style.width = `${pct * 100}%`;
      this.scrubCurrent = pct * 100;
      this.scrubTarget = pct * 100;
    });

    hitarea.addEventListener('pointermove', e => {
      if (!this.scrubDragging) return;
      const pct = pctFromEvent(e);
      updateTooltip(e, pct);
      if (this.pFill) this.pFill.style.width = `${pct * 100}%`;
      this.scrubCurrent = pct * 100;
      this.scrubTarget = pct * 100;
    });

    const finishDrag = (e: PointerEvent) => {
      if (!this.scrubDragging) return;
      const pct = pctFromEvent(e);
      this.scrubDragging = false;
      this.pProgress?.classList.remove('player-progress--dragging');
      hideLiveIndicator();
      const dur = this.getDurationMs();
      if (dur > 0) {
        this.seekToMs(dur * pct);
      }
    };

    hitarea.addEventListener('pointerup', finishDrag);
    hitarea.addEventListener('lostpointercapture', () => {
      if (this.scrubDragging) {
        this.scrubDragging = false;
        this.pProgress?.classList.remove('player-progress--dragging');
        hideLiveIndicator();
      }
    });
  }

  formatTime(sec: number): string {
    const s = Math.floor(sec);
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}:${rem < 10 ? '0' : ''}${rem}`;
  }

  dispose(): void {
    this.stopProgressPolling();
    if (this.ytPlayer) {
      try {
        (this.ytPlayer as any).destroy?.();
      } catch {}
      this.ytPlayer = null;
    }
    if (this.bcAudio) {
      this.bcAudio.pause();
      this.bcAudio.removeAttribute('src');
    }
    if (this.currentBlobUrl) {
      URL.revokeObjectURL(this.currentBlobUrl);
      this.currentBlobUrl = null;
    }
  }
}

export const player = new AudioPlayer();
