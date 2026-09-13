// ─── OSTALGIE APPLICATION ORCHESTRATOR ───
import * as THREE from 'three';
import './styles/main.css';

import { allTracks, allClusters, stations, state, trackMatchesSearch } from './data/store';
import { globe } from './scene/globe';
import { controls } from './scene/controls';
import { player } from './audio/player';
import { sfx } from './audio/sfx';
import { timeline } from './ui/timeline';
import { panels } from './ui/panels';
import { initIcons } from './ui/icons';
import { Track } from './types/index';

// 1. Initialize Icons
initIcons();

// 2. Setup 3D Scene
const canvasContainer = document.getElementById('canvas-container');
if (!canvasContainer) {
  throw new Error('Canvas container element #canvas-container not found');
}
globe.init(canvasContainer, allTracks);

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
}

// 3. Setup Audio Player
player.init({
  onTrackChange: (track: Track) => {
    globe.setActiveTrack(track);
    if (panels.isDetailOpen() && panels.currentDetailTrackId !== track.id) {
      panels.openDetailPanel(track, allTracks, allClusters, selectTrack);
    }
  },
  onShowDetail: (track: Track) => {
    panels.openDetailPanel(track, allTracks, allClusters, selectTrack);
  }
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
    if (idx !== -1) {
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
  onCloseAllPanels: () => panels.closeAllPanels()
});

controls.onResetCam = () => {
  panels.closeDetailPanel();
};

// 5. Setup Timeline
timeline.init({
  onRangeChange: ({ rangeYearL, rangeYearR }) => {
    state.rangeYearL = rangeYearL;
    state.rangeYearR = rangeYearR;
    syncVisuals();
  }
});

// 6. Setup Stations & Switch Handler
function switchToStation(sid: string): void {
  const station = stations.find(s => s.id === sid);
  if (!station) return;

  state.currentStationId = sid;
  state.currentStationTracks = station.tracks || allTracks;

  // Sound feedback
  sfx.play('switch', 0.35);

  // Update header title
  const headerTitle = document.getElementById('headerTitle');
  if (headerTitle) {
    headerTitle.textContent = sid === 'all' ? 'OSTALGIE' : `OSTALGIE : ${station.genre.toUpperCase()}`;
  }

  // Reset timeline
  timeline.rebuildTimelineBars(state.currentStationTracks);
  timeline.resetRange();

  // Reset & shuffle queue
  player.setQueue(state.currentStationTracks);
  player.shuffleQueue();
  if (player.queue.length > 0) {
    player.playTrack(player.queue[0]);
  }

  // Update stations list UI
  panels.renderStationList(stations, '', state.currentStationId, switchToStation);

  // Reset camera
  controls.resetCamera();

  syncVisuals();
}

// 7. Setup Panels (Detail, Stations, Search, Info)
panels.init({
  stations,
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

// 8. Initial Visuals & Stats
timeline.rebuildTimelineBars(state.currentStationTracks);
timeline.updateRangeUI();
panels.renderStationList(stations, '', state.currentStationId, switchToStation);

// 10. Primary Animation Loop
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

animate();

function cleanup(): void {
  if (animId !== null) {
    cancelAnimationFrame(animId);
    animId = null;
  }
  globe.dispose();
  player.dispose();
  sfx.dispose();
}

window.addEventListener('pagehide', cleanup);
window.addEventListener('beforeunload', cleanup);
