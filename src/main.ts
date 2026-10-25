// ─── WAYSTATION APPLICATION ORCHESTRATOR ───
import * as THREE from 'three';
import './styles/main.css';

import { allTracks, allClusters, stations, state, trackMatchesSearch, applyRoomStateToStore } from './data/store';
import { getCuratedRoomConfig } from './data/curated-rooms';
import { LocalRoomAdapter, RoomAdapter, SharedRoomAdapter } from './data/room-adapter';
import { globe } from './scene/globe';
import { controls } from './scene/controls';
import { player } from './audio/player';
import { sfx } from './audio/sfx';
import { panels } from './ui/panels';
import { landing } from './ui/landing';
import { initIcons } from './ui/icons';
import { RoomState, Track } from './types/index';

const initStartTime = performance.now();

// 1. Initialize Icons
initIcons();

// 2. Setup 3D Scene
const canvasContainer = document.getElementById('canvas-container');
if (!canvasContainer) {
  throw new Error('Canvas container element #canvas-container not found');
}
globe.init(canvasContainer, allTracks);

let activeAdapter: RoomAdapter | null = null;
let unsubscribeAdapter: (() => void) | null = null;

function getRoomDisplayName(): string {
  const curated = getCuratedRoomConfig(state.roomId);
  if (curated) return curated.name.toUpperCase();
  if (state.roomMode === 'local') return 'PRIVATE SESSION';
  return state.roomId.toUpperCase();
}

function updateHeaderTitle(): void {
  const headerTitle = document.getElementById('headerTitle');
  if (headerTitle) {
    headerTitle.textContent = 'WAYSTATION';
  }

  const roomViewTitle = document.getElementById('roomViewTitle');
  if (!roomViewTitle) return;
  const station = stations.find(s => s.id === state.currentStationId);
  const roomName = getRoomDisplayName();
  if (!station || state.currentStationId === 'all') {
    roomViewTitle.textContent = roomName;
  } else {
    roomViewTitle.textContent = `${roomName} : ${station.name.toUpperCase()}`;
  }
}

function syncVisuals(): void {
  const visible = globe.updateGlobeVisuals({
    currentStationTracks: state.currentStationTracks,
    rangeYearL: state.rangeYearL,
    rangeYearR: state.rangeYearR,
    searchQuery: state.searchQuery
  });
  panels.updateFilteredStats(visible);
}

// Helper to select and play a track
function selectTrack(track?: Track | null): void {
  if (!track) return;

  globe.setActiveTrack(track);

  controls.flyTo(track.lat || 0, track.lng || 0, 195);
  panels.openDetailPanel(track, allTracks, allClusters, selectTrack);
  player.playTrack(track);

  activeAdapter?.updateNowPlaying({
    trackId: track.id,
    title: track.title,
    artist: track.artist,
    artworkUrl: track.thumbnail,
    stationId: state.currentStationId,
    isPlaying: true,
    positionMs: 0,
    updatedAt: Date.now()
  });
}

// 3. Setup Audio Player
player.init({
  onTrackChange: (track: Track) => {
    globe.setActiveTrack(track);
    if (panels.isDetailOpen() && panels.currentDetailTrackId !== track.id) {
      panels.openDetailPanel(track, allTracks, allClusters, selectTrack);
    }
    activeAdapter?.updateNowPlaying({
      trackId: track.id,
      title: track.title,
      artist: track.artist,
      artworkUrl: track.thumbnail,
      stationId: state.currentStationId,
      isPlaying: true,
      positionMs: 0,
      updatedAt: Date.now()
    });
  },
  onShowDetail: (track: Track) => {
    panels.openDetailPanel(track, allTracks, allClusters, selectTrack);
  },
  onPlaybackStateChange: (playback) => {
    if (playback.track) {
      activeAdapter?.updateNowPlaying({
        trackId: playback.track.id,
        title: playback.track.title,
        artist: playback.track.artist,
        artworkUrl: playback.track.thumbnail,
        stationId: state.currentStationId,
        isPlaying: playback.isPlaying,
        positionMs: Math.round(playback.positionMs),
        updatedAt: Date.now()
      });
    }
  },
  getRoomId: () => activeAdapter?.roomId || state.roomId
});
player.setQueue(state.currentStationTracks);

// 4. Setup Controls
controls.init({
  camera: globe.camera,
  globeGroup: globe.globeGroup,
  container: canvasContainer,
  onSelectTrackIndex: (screenX: number, screenY: number) => {
    const hitIdx = globe.findClosestDot(screenX, screenY);
    if (hitIdx !== -1) {
      sfx.play('click', 0.4);
      selectTrack(allTracks[hitIdx]);
    }
  },
  onHoverChange: (idx: number) => {
    globe.setHoverRing(idx);
    if (idx !== -1 && allTracks[idx]) {
      const sp = globe.trackScreenPos[idx];
      panels.showTooltip(allTracks[idx], sp.x, sp.y);
    } else {
      panels.hideTooltip();
    }
  },
  onAutopilotChange: (forcedState?: boolean) => {
    if (forcedState !== undefined) {
      state.autoSpin = forcedState;
    } else {
      state.autoSpin = !state.autoSpin;
    }
    panels.setAutopilot(state.autoSpin);
    return state.autoSpin;
  },
  onTogglePlayPause: () => player.togglePlayPause(),
  onSkipNext: () => player.skipNext(),
  onSkipPrev: () => player.skipPrev(),
  onCloseAllPanels: () => {
    panels.closeAllPanels();
    landing.close();
  },
  onToggleBorders: () => panels.toggleBorders(),
  onToggleStarfield: () => panels.toggleStarfield(),
  onToggleSounds: () => panels.toggleSounds()
});

controls.onResetCam = () => {
  panels.closeDetailPanel();
};

// 5. Setup Stations & Switch Handler
function switchToStation(sid: string): void {
  const station = stations.find(s => s.id === sid);
  if (!station) return;

  state.currentStationId = sid;
  state.currentStationTracks = station.tracks || allTracks;

  sfx.play('switch', 0.35);
  updateHeaderTitle();

  player.setQueue(state.currentStationTracks);
  player.shuffleQueue();
  if (player.queue.length > 0) {
    player.playTrack(player.queue[0]);
  }

  panels.renderStationList(stations, '', state.currentStationId, switchToStation);
  controls.resetCamera();
  syncVisuals();
}

// 6. Setup Panels (Detail, Stations, Search, Info)
panels.init({
  stations: () => stations,
  currentStationId: () => state.currentStationId,
  onSelectStation: switchToStation,
  onSelectTrack: selectTrack,
  onSearchChange: (query: string) => {
    state.searchQuery = query;

    if (!query) {
      panels.closeSearchResults();
    } else {
      const matches = state.currentStationTracks.filter(t => trackMatchesSearch(t, query));
      panels.renderSearchResults(matches);
    }

    syncVisuals();
  },
  onToggleAutopilot: () => {
    state.autoSpin = !state.autoSpin;
    return state.autoSpin;
  },
  onToggleBorders: () => globe.toggleBorders(),
  onToggleStarfield: () => globe.toggleStarfield(),
  onToggleSounds: () => {
    sfx.enabled = !sfx.enabled;
    return sfx.enabled;
  },
  onResetCam: () => controls.resetCamera()
});

// 7. Room Routing & Adapter Lifecycle
function handleRoomStateUpdate(room: RoomState, rebuildScene = false): void {
  const prevCount = allTracks.length;
  const prevRoomId = state.roomId;
  applyRoomStateToStore(room);

  if (rebuildScene || prevCount !== allTracks.length || prevRoomId !== room.id) {
    globe.setTracks(allTracks);
  }

  updateHeaderTitle();
  landing.updateTopBarStatus(room);
  panels.renderStationList(stations, '', state.currentStationId, switchToStation);
  player.setQueue(state.currentStationTracks);
  syncVisuals();
}

async function mountRoute(pathname: string, pushHistory = false): Promise<void> {
  if (pushHistory && window.location.pathname !== pathname) {
    window.history.pushState({}, '', pathname);
  }

  let targetAdapter: RoomAdapter;
  let showLanding = false;

  if (pathname === '/local') {
    targetAdapter = new LocalRoomAdapter();
  } else {
    const match = pathname.match(/^\/r\/([^/]+)$/i);
    if (match) {
      targetAdapter = new SharedRoomAdapter(decodeURIComponent(match[1]));
    } else {
      // Root '/' opens the Landing Modal on top of the permanent Ostalgie room backdrop
      targetAdapter = new SharedRoomAdapter('ostalgie');
      showLanding = true;
    }
  }

  if (showLanding) {
    landing.open();
  } else {
    landing.close();
  }

  if (
    !activeAdapter ||
    activeAdapter.roomId !== targetAdapter.roomId ||
    activeAdapter.mode !== targetAdapter.mode
  ) {
    unsubscribeAdapter?.();
    activeAdapter?.dispose();
    activeAdapter = targetAdapter;
    player.setRoomId(activeAdapter.roomId);

    const initialRoom = await activeAdapter.load();
    handleRoomStateUpdate(initialRoom, true);

    unsubscribeAdapter = activeAdapter.subscribe(updatedRoom => {
      handleRoomStateUpdate(updatedRoom, false);
    });
  } else {
    landing.updateTopBarStatus(activeAdapter.getState());
  }
}

landing.init({
  onNavigate: (path: string) => {
    void mountRoute(path, true);
  },
  onPublishLocalRoom: async () => {
    if (!activeAdapter || activeAdapter.mode !== 'local') return;
    const slug = await activeAdapter.publishToSharedRoom();
    await mountRoute(`/r/${slug}`, true);
  }
});

window.addEventListener('popstate', () => {
  void mountRoute(window.location.pathname, false);
});

// Boot initial route and open the landing page modal on initial load
void mountRoute(window.location.pathname, false);
landing.open();

// 8. Primary Animation Loop
const clock = new THREE.Clock();
const findClosestDotCallback = (mx: number, my: number) => globe.findClosestDot(mx, my);

let animId: number | null = null;

function animate(): void {
  animId = requestAnimationFrame(animate);

  controls.update(state.autoSpin);
  controls.handleHover(findClosestDotCallback);

  const elapsed = clock.getElapsedTime();
  globe.render(elapsed);
}

function dismissLoadingScreen(): void {
  const loader = document.getElementById('loading-screen');
  if (!loader) return;

  const minDisplayTime = 400;
  const elapsed = performance.now() - initStartTime;
  const delay = Math.max(0, minDisplayTime - elapsed);

  setTimeout(() => {
    loader.classList.add('fade-out');
    loader.addEventListener('transitionend', () => {
      loader.remove();
    }, { once: true });
    setTimeout(() => {
      if (loader.parentNode) loader.remove();
    }, 800);
  }, delay);
}

animate();

// Double requestAnimationFrame ensures the WebGL scene and UI have rendered before fading the loading screen
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    dismissLoadingScreen();
  });
});

function cleanup(): void {
  if (animId !== null) {
    cancelAnimationFrame(animId);
    animId = null;
  }
  unsubscribeAdapter?.();
  activeAdapter?.dispose();
  globe.dispose();
  player.dispose();
  sfx.dispose();
}

window.addEventListener('pagehide', cleanup);
window.addEventListener('beforeunload', cleanup);
