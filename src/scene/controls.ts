// ─── CAMERA, ORBIT, GESTURE & KEYBOARD CONTROLS ───
import * as THREE from 'three';
import { sfx } from '../audio/sfx';

export interface SceneControlsInitOptions {
  camera: THREE.PerspectiveCamera;
  globeGroup: THREE.Group;
  container: HTMLElement;
  onSelectTrackIndex?: (screenX: number, screenY: number) => void;
  onHoverChange?: (idx: number) => void;
  onAutopilotChange?: (forcedState?: boolean) => boolean | void;
  onTogglePlayPause?: () => void;
  onSkipNext?: () => void;
  onSkipPrev?: () => void;
  onCloseAllPanels?: () => void;
}

interface GestureEvent extends UIEvent {
  scale?: number;
  rotation?: number;
}

class SceneControls {
  camera!: THREE.PerspectiveCamera;
  globeGroup!: THREE.Group;
  container!: HTMLElement;

  // Camera fly-to state
  isAnimatingCamera: boolean = false;
  isAnimatingGlobe: boolean = false;
  rotStartX: number = 0;
  rotStartY: number = 0;
  rotTargetX: number = 0;
  rotTargetY: number = 0;
  camTargetPos: THREE.Vector3 | null = null;
  camTargetLook: THREE.Vector3 | null = null;
  camAnimStart: number = 0;
  CAM_ANIM_DUR: number = 1200;
  camStartPos: THREE.Vector3 = new THREE.Vector3();
  camStartLook: THREE.Vector3 = new THREE.Vector3();
  currentLookAt: THREE.Vector3 = new THREE.Vector3(0, 0, 0);

  // Interaction & drag state
  isDragging: boolean = false;
  hasDragged: boolean = false;
  dragStartPos: { x: number; y: number } = { x: 0, y: 0 };
  DRAG_THRESHOLD_PX: number = 6;
  prevPos: { x: number; y: number } = { x: 0, y: 0 };
  globeVel: { x: number; y: number } = { x: 0.002, y: 0 };
  activePointers: Map<number, { x: number; y: number }> = new Map();
  initialPinchDist: number = 0;
  initialPinchCamZ: number = 0;

  mouseScreenX: number = -999;
  mouseScreenY: number = -999;
  hoveredIdx: number = -1;
  lastHoveredIdx: number = -1;

  // Callbacks
  onSelectTrackIndex: ((screenX: number, screenY: number) => void) | null = null;
  onHoverChange: ((idx: number) => void) | null = null;
  onAutopilotChange: ((forcedState?: boolean) => boolean | void) | null = null;
  onResetCam: (() => void) | null = null;

  init({
    camera,
    globeGroup,
    container,
    onSelectTrackIndex,
    onHoverChange,
    onAutopilotChange,
    onTogglePlayPause,
    onSkipNext,
    onSkipPrev,
    onCloseAllPanels
  }: SceneControlsInitOptions): void {
    this.camera = camera;
    this.globeGroup = globeGroup;
    this.container = container;
    this.onSelectTrackIndex = onSelectTrackIndex || null;
    this.onHoverChange = onHoverChange || null;
    this.onAutopilotChange = onAutopilotChange || null;

    this.bindPointerEvents();
    this.bindZoomEvents();
    this.bindKeyboardEvents({
      onTogglePlayPause,
      onSkipNext,
      onSkipPrev,
      onCloseAllPanels
    });

    const logoBtn = document.getElementById('logoBtn');
    if (logoBtn) {
      logoBtn.addEventListener('click', () => {
        sfx.play('transition');
        this.resetCamera();
      });
    }
  }

  flyTo(lat: number, lng: number, dist: number = 195): void {
    this.isAnimatingCamera = true;
    this.isAnimatingGlobe = true;
    if (this.onAutopilotChange) {
      this.onAutopilotChange(false);
    }

    // 1. Rotate globe so (lat, lng) faces the front camera along the shortest path
    const targetY = -((lng + 90) * Math.PI) / 180;
    const diffY = (((targetY - this.globeGroup.rotation.y) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
    this.rotStartY = this.globeGroup.rotation.y;
    this.rotTargetY = this.globeGroup.rotation.y + diffY;

    this.rotStartX = this.globeGroup.rotation.x;
    this.rotTargetX = Math.max(-1.65, Math.min(1.4, ((lat - 12) * Math.PI) / 180));

    // 2. Camera stays on the centered axis, simply animating closer along Z
    this.camStartPos.copy(this.camera.position);
    this.camTargetPos = new THREE.Vector3(0, 40, dist);
    this.camStartLook.copy(this.currentLookAt);
    this.camTargetLook = new THREE.Vector3(0, 0, 0);

    this.camAnimStart = performance.now();
  }

  resetCamera(): void {
    this.isAnimatingCamera = true;
    this.isAnimatingGlobe = true;
    this.camStartPos.copy(this.camera.position);
    this.camStartLook.copy(this.currentLookAt);
    this.camTargetPos = new THREE.Vector3(0, 40, 320);
    this.camTargetLook = new THREE.Vector3(0, 0, 0);

    this.rotStartX = this.globeGroup.rotation.x;
    this.rotTargetX = 0.55;
    const diffY = (((-2.20 - this.globeGroup.rotation.y) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
    this.rotStartY = this.globeGroup.rotation.y;
    this.rotTargetY = this.globeGroup.rotation.y + diffY;

    this.camAnimStart = performance.now();

    if (this.onResetCam) {
      this.onResetCam();
    }
  }

  bindPointerEvents(): void {
    window.addEventListener('pointermove', e => {
      this.mouseScreenX = e.clientX;
      this.mouseScreenY = e.clientY;

      if (this.activePointers.has(e.pointerId)) {
        this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }

      if (this.activePointers.size >= 2 && this.initialPinchDist > 0) {
        const pts = Array.from(this.activePointers.values());
        const curDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (curDist > 5) {
          const scale = curDist / this.initialPinchDist;
          this.camera.position.z = this.initialPinchCamZ / scale;
          this.camera.position.z = Math.max(130, Math.min(480, this.camera.position.z));
        }
        return;
      }

      if (!this.isDragging) return;
      const dx = e.clientX - this.prevPos.x;
      const dy = e.clientY - this.prevPos.y;

      const totalDist = Math.hypot(e.clientX - this.dragStartPos.x, e.clientY - this.dragStartPos.y);
      if (totalDist > this.DRAG_THRESHOLD_PX) {
        this.hasDragged = true;
      }

      this.globeGroup.rotation.y += dx * 0.004;
      this.globeGroup.rotation.x += dy * 0.004;
      this.globeGroup.rotation.x = Math.max(-1.65, Math.min(1.4, this.globeGroup.rotation.x));

      this.globeVel = { x: dx * 0.002, y: dy * 0.002 };
      this.prevPos = { x: e.clientX, y: e.clientY };

      if (this.onAutopilotChange) {
        this.onAutopilotChange(false);
      }
    });

    window.addEventListener('pointerdown', e => {
      this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this.activePointers.size >= 2) {
        const pts = Array.from(this.activePointers.values());
        this.initialPinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        this.initialPinchCamZ = this.camera.position.z;
        this.isDragging = false;
        this.hasDragged = true;
        return;
      }

      const target = e.target as HTMLElement | null;
      if (target?.closest('.top-bar, .detail-panel, .player-bar, .info-panel, .search-results, .bottom-bar, .sector-panel')) return;
      this.isDragging = true;
      this.isAnimatingCamera = false;
      this.isAnimatingGlobe = false;
      this.hasDragged = false;
      this.dragStartPos = { x: e.clientX, y: e.clientY };
      this.prevPos = { x: e.clientX, y: e.clientY };
      this.container.style.cursor = 'grabbing';
    });

    const handlePointerEnd = (e: PointerEvent) => {
      this.activePointers.delete(e.pointerId);
      if (this.activePointers.size < 2) {
        this.initialPinchDist = 0;
      }
      if (this.activePointers.size === 0) {
        this.isDragging = false;
        this.container.style.cursor = 'default';
      }
      const totalDist = Math.hypot(e.clientX - this.dragStartPos.x, e.clientY - this.dragStartPos.y);
      if (totalDist > this.DRAG_THRESHOLD_PX) {
        this.hasDragged = true;
      }
      setTimeout(() => { this.hasDragged = false; }, 80);
    };

    window.addEventListener('pointerup', handlePointerEnd);
    window.addEventListener('pointercancel', e => {
      this.activePointers.delete(e.pointerId);
      if (this.activePointers.size < 2) this.initialPinchDist = 0;
      if (this.activePointers.size === 0) {
        this.isDragging = false;
        this.container.style.cursor = 'default';
      }
      this.hasDragged = false;
    });

    window.addEventListener('click', e => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('.top-bar, .detail-panel, .player-bar, .info-panel, .search-results, .sector-panel')) return;

      const clickDist = Math.hypot(e.clientX - this.dragStartPos.x, e.clientY - this.dragStartPos.y);
      if (this.hasDragged || clickDist > this.DRAG_THRESHOLD_PX) {
        this.hasDragged = false;
        return;
      }

      if (this.onSelectTrackIndex) {
        this.onSelectTrackIndex(e.clientX, e.clientY);
      }
    });
  }

  bindZoomEvents(): void {
    window.addEventListener('wheel', e => {
      const target = e.target as HTMLElement | null;
      const inScrollPanel = target?.closest('.detail-panel, .search-results, .info-panel, .sector-panel');
      if (inScrollPanel && !e.ctrlKey) return;

      e.preventDefault();
      this.isAnimatingCamera = false;
      this.isAnimatingGlobe = false;

      if (e.ctrlKey) {
        this.camera.position.z += e.deltaY * 0.8;
      } else {
        this.camera.position.z += e.deltaY * 0.25;
      }
      this.camera.position.z = Math.max(130, Math.min(480, this.camera.position.z));
    }, { passive: false });

    let gestureStartCamZ = 0;
    window.addEventListener('gesturestart' as unknown as keyof WindowEventMap, (e: Event) => {
      e.preventDefault();
      gestureStartCamZ = this.camera.position.z;
    }, { passive: false });

    window.addEventListener('gesturechange' as unknown as keyof WindowEventMap, (e: Event) => {
      e.preventDefault();
      const ge = e as GestureEvent;
      if (gestureStartCamZ && ge.scale) {
        this.camera.position.z = gestureStartCamZ / ge.scale;
        this.camera.position.z = Math.max(130, Math.min(480, this.camera.position.z));
      }
    }, { passive: false });

    window.addEventListener('gestureend' as unknown as keyof WindowEventMap, (e: Event) => {
      e.preventDefault();
    }, { passive: false });
  }

  bindKeyboardEvents({
    onTogglePlayPause,
    onSkipNext,
    onSkipPrev,
    onCloseAllPanels
  }: {
    onTogglePlayPause?: () => void;
    onSkipNext?: () => void;
    onSkipPrev?: () => void;
    onCloseAllPanels?: () => void;
  }): void {
    window.addEventListener('keydown', e => {
      const target = e.target as HTMLElement | null;
      if (target?.tagName === 'INPUT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (onTogglePlayPause) onTogglePlayPause();
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        if (onSkipNext) onSkipNext();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        if (onSkipPrev) onSkipPrev();
      } else if (e.code === 'Enter') {
        if (this.onAutopilotChange) {
          this.onAutopilotChange();
        }
      } else if (e.key === 'v' || e.key === 'V') {
        this.resetCamera();
      } else if (e.code === 'Escape') {
        if (onCloseAllPanels) onCloseAllPanels();
      }
    });
  }

  handleHover(findClosestDot: (mx: number, my: number) => number): void {
    if (this.isDragging || this.mouseScreenX < 0 || this.mouseScreenY < 0) {
      if (this.hoveredIdx !== -1) {
        this.hoveredIdx = -1;
        this.lastHoveredIdx = -1;
        this.container.style.cursor = 'default';
        if (this.onHoverChange) this.onHoverChange(-1);
      }
      return;
    }

    const idx = findClosestDot(this.mouseScreenX, this.mouseScreenY);
    if (idx !== -1) {
      if (idx !== this.lastHoveredIdx) {
        this.lastHoveredIdx = idx;
        this.hoveredIdx = idx;
        this.container.style.cursor = 'pointer';
        sfx.play('hover', 0.15);
        if (this.onHoverChange) this.onHoverChange(idx);
      }
    } else {
      if (this.hoveredIdx !== -1) {
        this.hoveredIdx = -1;
        this.lastHoveredIdx = -1;
        this.container.style.cursor = 'default';
        if (this.onHoverChange) this.onHoverChange(-1);
      }
    }
  }

  update(autoSpin: boolean): void {
    // 1. Globe auto-spin & momentum inertia
    if (autoSpin && !this.isDragging && !this.isAnimatingCamera) {
      this.globeGroup.rotation.y += 0.0005;
    } else if (!this.isDragging && !this.isAnimatingCamera) {
      this.globeGroup.rotation.y += this.globeVel.x;
      this.globeGroup.rotation.x += this.globeVel.y;
      this.globeVel.x *= 0.94;
      this.globeVel.y *= 0.94;
    }

    // 2. Camera and globe animation interpolation
    if (this.isAnimatingCamera && this.camTargetPos && this.camTargetLook) {
      const elapsed = performance.now() - this.camAnimStart;
      const t = Math.min(1, elapsed / this.CAM_ANIM_DUR);
      const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

      if (this.isAnimatingGlobe) {
        this.globeGroup.rotation.x = THREE.MathUtils.lerp(this.rotStartX, this.rotTargetX, ease);
        this.globeGroup.rotation.y = THREE.MathUtils.lerp(this.rotStartY, this.rotTargetY, ease);
      }

      this.camera.position.lerpVectors(this.camStartPos, this.camTargetPos, ease);
      this.currentLookAt.lerpVectors(this.camStartLook, this.camTargetLook, ease);
      this.camera.lookAt(this.currentLookAt);

      if (t >= 1) {
        this.isAnimatingCamera = false;
        this.isAnimatingGlobe = false;
      }
    } else {
      this.camera.lookAt(this.currentLookAt);
    }
  }
}

export const controls = new SceneControls();
