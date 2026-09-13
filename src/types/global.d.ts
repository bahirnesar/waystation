import { LocationHub, Station, Track } from './index';

declare global {
  interface Window {
    LOCATIONS_DATA?: LocationHub[];
    TRACKS_DATA?: Track[];
    STATIONS_DATA?: Station[];
    webkitAudioContext?: typeof AudioContext;
    onYouTubeIframeAPIReady?: () => void;
    YT?: typeof YT;
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
}

export {};
