import { LocationHub, Station, Track } from './index';

declare global {
  interface Window {
    LOCATIONS_DATA?: LocationHub[];
    TRACKS_DATA?: Track[];
    STATIONS_DATA?: Station[];
    webkitAudioContext?: typeof AudioContext;
    onYouTubeIframeAPIReady?: () => void;
    YT?: typeof YT;
    SC?: typeof SC;
    onSpotifyIframeApiReady?: (IFrameAPI: SpotifyIframeApi) => void;
  }

  namespace YT {
    enum PlayerState {
      UNSTARTED = -1,
      ENDED = 0,
      PLAYING = 1,
      PAUSED = 2,
      BUFFERING = 3,
      CUED = 5,
    }

    interface PlayerOptions {
      width?: string | number;
      height?: string | number;
      videoId?: string;
      playerVars?: {
        autoplay?: 0 | 1;
        controls?: 0 | 1;
        disablekb?: 0 | 1;
        enablejsapi?: 0 | 1;
        playsinline?: 0 | 1;
        origin?: string;
        [key: string]: unknown;
      };
      events?: {
        onReady?: (event: { target: Player }) => void;
        onStateChange?: (event: { data: PlayerState; target: Player }) => void;
        onError?: (event: { data: number; target: Player }) => void;
      };
    }

    class Player {
      constructor(elementId: string | HTMLElement, options: PlayerOptions);
      playVideo(): void;
      pauseVideo(): void;
      stopVideo(): void;
      seekTo(seconds: number, allowSeekAhead?: boolean): void;
      setVolume(volume: number | string): void;
      getVolume(): number;
      getCurrentTime(): number;
      getDuration(): number;
      loadVideoById(videoId: string | { videoId: string; startSeconds?: number }): void;
      cueVideoById(videoId: string | { videoId: string; startSeconds?: number }): void;
    }
  }

  namespace SC {
    namespace Widget {
      enum Events {
        READY = 'ready',
        PLAY = 'play',
        PAUSE = 'pause',
        FINISH = 'finish',
        SEEK = 'seek',
        ERROR = 'error',
        PLAY_PROGRESS = 'playProgress',
        LOAD_PROGRESS = 'loadProgress'
      }
    }
    function Widget(iframe: string | HTMLIFrameElement): SCWidget;
  }

  interface SCWidget {
    bind(event: string, callback: (...args: any[]) => void): void;
    unbind(event: string): void;
    load(url: string, options?: Record<string, any>): void;
    play(): void;
    pause(): void;
    toggle(): void;
    seekTo(milliseconds: number): void;
    setVolume(volume: number): void;
    getVolume(callback: (volume: number) => void): void;
    getDuration(callback: (duration: number) => void): void;
    getPosition(callback: (position: number) => void): void;
    getSounds(callback: (sounds: any[]) => void): void;
    getCurrentSound(callback: (sound: any) => void): void;
    isPaused(callback: (paused: boolean) => void): void;
  }

  interface SpotifyIframeApi {
    createController(
      element: HTMLElement | null,
      options: { width?: string | number; height?: string | number; uri: string },
      callback: (controller: SpotifyEmbedController) => void
    ): void;
  }

  interface SpotifyEmbedController {
    loadUri(uri: string): void;
    play(): void;
    pause(): void;
    resume(): void;
    togglePlay(): void;
    seek(seconds: number): void;
    destroy(): void;
    addListener(
      event: 'ready' | 'playback_update',
      callback: (data: any) => void
    ): void;
  }
}

export {};
