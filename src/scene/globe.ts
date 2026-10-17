import * as THREE from 'three';
import { trackMatchesSearch } from '../data/store';
import { Track } from '../types/index';

export const GLOBE_RADIUS = 100;

export function latLngToVector3(lat: number, lng: number, radius: number = GLOBE_RADIUS): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  const x = -(radius * Math.sin(phi) * Math.cos(theta));
  const z = (radius * Math.sin(phi) * Math.sin(theta));
  const y = (radius * Math.cos(phi));
  return new THREE.Vector3(x, y, z);
}

export interface ScreenTrackPos {
  x: number;
  y: number;
  visible: boolean;
}

export interface GlobeVisualsFilter {
  currentStationTracks: Track[];
  rangeYearL: number;
  rangeYearR: number;
  searchQuery: string;
}

class GlobeScene {
  container: HTMLElement | null = null;
  scene!: THREE.Scene;
  camera!: THREE.PerspectiveCamera;
  renderer!: THREE.WebGLRenderer;
  globeGroup!: THREE.Group;

  starfieldMesh: THREE.Points | null = null;
  starMat: THREE.ShaderMaterial | null = null;
  earthMat: THREE.ShaderMaterial | null = null;
  innerAtmosMesh: THREE.Mesh | null = null;
  outerAtmosMesh: THREE.Mesh | null = null;
  bordersMesh: THREE.Mesh | null = null;

  allTracks: Track[] = [];
  N: number = 0;
  basePositions!: Float32Array;
  normals!: Float32Array;
  elevatedPositions!: Float32Array;
  dotHeights!: Float32Array;
  dotsGeo!: THREE.BufferGeometry;
  dotsMat!: THREE.ShaderMaterial;
  dotsMesh!: THREE.Points;

  hoverRing: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial> | null = null;
  activeRing: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial> | null = null;
  activeTrackIdx: number = -1;

  static readonly UP_Z: THREE.Vector3 = new THREE.Vector3(0, 0, 1);
  _ringNormal: THREE.Vector3 = new THREE.Vector3();
  _lastCamPos: THREE.Vector3 = new THREE.Vector3(Infinity, Infinity, Infinity);
  _lastGlobeRot: THREE.Euler = new THREE.Euler(Infinity, Infinity, Infinity);
  _projectionDirty: boolean = true;

  trackScreenPos: ScreenTrackPos[] = [];
  _tmpProjPos: THREE.Vector3 = new THREE.Vector3();
  _tmpNorm: THREE.Vector3 = new THREE.Vector3();
  _tmpCamDir: THREE.Vector3 = new THREE.Vector3();
  _tmpV: THREE.Vector3 = new THREE.Vector3();

  init(containerEl: HTMLElement, tracks: Track[]): void {
    this.container = containerEl;
    this.allTracks = tracks;
    this.N = tracks.length;

    // 1. Scene & Camera
    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 3000);
    this.camera.position.set(0, 40, 320);

    // 2. Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.container.appendChild(this.renderer.domElement);

    // 3. Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
    this.scene.add(ambientLight);

    // 4. Globe Group
    this.globeGroup = new THREE.Group();
    this.globeGroup.rotation.x = 0.55;
    this.globeGroup.rotation.y = -2.20;
    this.scene.add(this.globeGroup);

    // 5. Starfield (hidden by default on dot-grid background, still toggleable)
    this.createStarfield();
    if (this.starfieldMesh) this.starfieldMesh.visible = false;

    // 6. Base Sphere & Geographical Borders
    this.createEarthBase();
    this.loadBorders();

    // 7. Track Dots Particle System
    this.createTrackDots();

    // 8. Marker Rings
    this.createMarkerRings();

    // 9. Screen position cache for picking
    for (let i = 0; i < this.N; i++) {
      this.trackScreenPos.push({ x: 0, y: 0, visible: false });
    }

    // 10. Resize handler
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this._projectionDirty = true;
    });
  }

  createStarfield(): void {
    const count = 18000;
    const geom = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const alphas = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    const speeds = new Float32Array(count);

    // Deep space celestial shell far outside the globe (radius 850 to 2200)
    // Ensures stars are strictly in deep space and completely occluded when behind the globe
    const innerRadius = 850;
    const outerRadius = 2200;

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      const distNorm = Math.pow(Math.random(), 0.55);
      const dist = innerRadius + distNorm * (outerRadius - innerRadius);

      const u = Math.random() * 2 - 1;
      const theta = Math.random() * Math.PI * 2;
      const s = Math.sqrt(Math.max(0, 1 - u * u));

      pos[i3] = dist * s * Math.cos(theta);
      pos[i3 + 1] = dist * s * Math.sin(theta);
      pos[i3 + 2] = dist * u;

      // Realistic stellar brightness and size distribution
      let sz = 2.0 + distNorm * 4.6;
      const r = Math.random();
      if (r < 0.035) sz *= 2.2;
      else if (r < 0.15) sz *= 1.5;
      sizes[i] = sz;

      alphas[i] = 0.55 + Math.random() * 0.42;
      phases[i] = Math.random() * Math.PI * 2;
      speeds[i] = 0.25 + Math.random() * 1.1;

      // Spectral colors: cool silver/white, warm ivory, celestial blue
      const colRand = Math.random();
      if (colRand < 0.62) {
        colors[i3] = 0.86;
        colors[i3 + 1] = 0.89;
        colors[i3 + 2] = 0.95;
      } else if (colRand < 0.84) {
        colors[i3] = 0.98;
        colors[i3 + 1] = 0.93;
        colors[i3 + 2] = 0.82;
      } else {
        colors[i3] = 0.72;
        colors[i3 + 1] = 0.84;
        colors[i3 + 2] = 1.0;
      }
    }

    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geom.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geom.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geom.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    geom.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));

    this.starMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }
      },
      vertexShader: `
        uniform float uTime;
        attribute float aSize;
        attribute float aAlpha;
        attribute float aPhase;
        attribute float aSpeed;
        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          vColor = color;

          // Twinkling pulse
          float t = uTime * aSpeed + aPhase;
          float p1 = sin(t) * 0.5 + 0.5;
          float p2 = sin(t * 1.618 + aPhase) * 0.5 + 0.5;
          float twinkle = mix(p1, p2, 0.35);
          vAlpha = aAlpha * (0.22 + 0.78 * twinkle);

          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = max(aSize * (860.0 / -mv.z), 1.5);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          vec2 coord = gl_PointCoord - vec2(0.5);
          float d = length(coord);
          if (d > 0.5) discard;
          float a = 1.0 - smoothstep(0.12, 0.5, d);
          float core = 1.0 - smoothstep(0.0, 0.22, d);
          vec3 starCol = vColor + vec3(core * 0.45);
          gl_FragColor = vec4(starCol, clamp(max(a * vAlpha, core * 0.95), 0.0, 1.0));
        }
      `,
      transparent: true,
      vertexColors: true,
      depthTest: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false
    });

    this.starfieldMesh = new THREE.Points(geom, this.starMat);
    // Added to globeGroup so starfield rotates synchronously with the globe
    this.globeGroup.add(this.starfieldMesh);
  }

  createEarthBase(): void {
    const earthGeom = new THREE.SphereGeometry(GLOBE_RADIUS, 64, 64);
    this.earthMat = new THREE.ShaderMaterial({
      uniforms: {
        uDark: { value: 0.0 }
      },
      vertexShader: `
        varying vec3 vNormal;
        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform float uDark;
        varying vec3 vNormal;
        void main() {
          vec3 norm = normalize(vNormal);

          // Gradient from top-left to bottom-right
          float grad = clamp((norm.y * 0.65 - norm.x * 0.35) * 0.5 + 0.5, 0.0, 1.0);

          // Light mode: cream to warm pastel orange
          vec3 cream = vec3(0.98, 0.93, 0.85);
          vec3 midOrange = vec3(0.97, 0.72, 0.53);
          vec3 deepOrange = vec3(0.94, 0.54, 0.42);
          vec3 lightCol = mix(deepOrange, midOrange, smoothstep(0.0, 0.55, grad));
          lightCol = mix(lightCol, cream, smoothstep(0.45, 1.0, grad));

          // Dark mode: deep midnight navy to dark abyssal blue gradient
          vec3 topBlue = vec3(0.08, 0.16, 0.30);
          vec3 midBlue = vec3(0.035, 0.075, 0.16);
          vec3 deepNavy = vec3(0.012, 0.025, 0.065);
          vec3 darkCol = mix(deepNavy, midBlue, smoothstep(0.0, 0.55, grad));
          darkCol = mix(darkCol, topBlue, smoothstep(0.45, 1.0, grad));

          gl_FragColor = vec4(mix(lightCol, darkCol, uDark), 1.0);
        }
      `
    });
    const earthMesh = new THREE.Mesh(earthGeom, this.earthMat);
    earthMesh.renderOrder = 0;
    this.globeGroup.add(earthMesh);
  }

  async loadBorders(): Promise<void> {
    try {
      const res = await fetch('/borders_lines.json');
      if (!res.ok) return;
      const lines: [number, number][][] = await res.json();

      const width = 4096;
      const height = 2048;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const scaleX = width / 360;
      const scaleY = height / 180;

      const drawLandmasses = (strokeWidth: number) => {
        ctx.lineWidth = strokeWidth;
        for (let r = 0; r < lines.length; r++) {
          const ring = lines[r];
          if (ring.length < 2) continue;
          ctx.beginPath();
          ctx.moveTo((ring[0][0] + 180) * scaleX, (90 - ring[0][1]) * scaleY);
          for (let i = 1; i < ring.length; i++) {
            ctx.lineTo((ring[i][0] + 180) * scaleX, (90 - ring[i][1]) * scaleY);
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
      };

      // Pass 1: Draw dilated landmass silhouettes
      ctx.globalCompositeOperation = 'source-over';
      drawLandmasses(8.4);

      // Pass 2: Punch out landmass interiors & shared country borders, leaving only coastlines
      ctx.globalCompositeOperation = 'destination-out';
      drawLandmasses(2.0);
      ctx.globalCompositeOperation = 'source-over';

      // Clear equirectangular map seam at ±180° longitude and South Pole edge
      ctx.clearRect(0, 0, 5, height);
      ctx.clearRect(width - 5, 0, 5, height);
      ctx.clearRect(0, height - 5, width, 5);

      const texture = new THREE.CanvasTexture(canvas);
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = true;

      const geom = new THREE.SphereGeometry(GLOBE_RADIUS + 0.15, 64, 64);
      const mat = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: 0.95,
        depthWrite: false
      });
      this.bordersMesh = new THREE.Mesh(geom, mat);
      this.bordersMesh.renderOrder = 1;
      this.globeGroup.add(this.bordersMesh);
    } catch { }
  }

  createTrackDots(): void {
    const N = this.N;
    this.basePositions = new Float32Array(N * 3);
    this.normals = new Float32Array(N * 3);
    this.elevatedPositions = new Float32Array(N * 3);
    const dotColors = new Float32Array(N * 3);
    const dotSizes = new Float32Array(N);
    const dotAlphas = new Float32Array(N);
    this.dotHeights = new Float32Array(N);
    const dotPhases = new Float32Array(N);

    for (let i = 0; i < N; i++) {
      const t = this.allTracks[i];
      const v = latLngToVector3(t.lat, t.lng, GLOBE_RADIUS);
      const i3 = i * 3;
      this.basePositions[i3] = v.x;
      this.basePositions[i3 + 1] = v.y;
      this.basePositions[i3 + 2] = v.z;

      const n = v.clone().normalize();
      this.normals[i3] = n.x;
      this.normals[i3 + 1] = n.y;
      this.normals[i3 + 2] = n.z;

      const h = (t.densityHeight !== undefined && t.densityHeight !== null) ? t.densityHeight : 1.2;
      this.dotHeights[i] = h;
      this.elevatedPositions[i3] = v.x + n.x * h;
      this.elevatedPositions[i3 + 1] = v.y + n.y * h;
      this.elevatedPositions[i3 + 2] = v.z + n.z * h;

      dotColors[i3] = 1.0;
      dotColors[i3 + 1] = 1.0;
      dotColors[i3 + 2] = 1.0;

      dotSizes[i] = 8.2;
      dotAlphas[i] = 1.0;
      dotPhases[i] = Math.random() * Math.PI * 2.0;
    }

    this.dotsGeo = new THREE.BufferGeometry();
    this.dotsGeo.setAttribute('position', new THREE.BufferAttribute(this.basePositions, 3));
    this.dotsGeo.setAttribute('normal', new THREE.BufferAttribute(this.normals, 3));
    this.dotsGeo.setAttribute('color', new THREE.BufferAttribute(dotColors, 3));
    this.dotsGeo.setAttribute('aSize', new THREE.BufferAttribute(dotSizes, 1));
    this.dotsGeo.setAttribute('aAlpha', new THREE.BufferAttribute(dotAlphas, 1));
    this.dotsGeo.setAttribute('aHeight', new THREE.BufferAttribute(this.dotHeights, 1));
    this.dotsGeo.setAttribute('aPhase', new THREE.BufferAttribute(dotPhases, 1));

    const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);

    this.dotsMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: pixelRatio }
      },
      vertexShader: `
        uniform float uTime;
        uniform float uPixelRatio;
        attribute float aSize;
        attribute float aAlpha;
        attribute float aHeight;
        attribute float aPhase;
        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          vColor = color;
          vAlpha = aAlpha;

          vec3 norm = normalize(normal);
          vec3 p = position + norm * aHeight;

          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vec3 viewDir = normalize(-mv.xyz);
          vec3 normView = normalize(normalMatrix * norm);
          float dotView = dot(normView, viewDir);

          gl_PointSize = max(aSize * (220.0 / -mv.z), 6.5) * uPixelRatio;

          // Pull visible front-hemisphere dots slightly toward the camera in depth
          // so flat point sprites never clip into the curved globe/borders, while
          // dots beyond the horizon (dotView <= 0) remain occluded by the globe.
          mv.z += 3.2 * smoothstep(0.0, 0.12, dotView);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          if (vAlpha < 0.05) discard;
          vec2 coord = gl_PointCoord - vec2(0.5);
          float d = length(coord);
          if (d > 0.5) discard;

          vec3 borderCol = vec3(0.118, 0.106, 0.094);
          vec3 fillCol = vColor;

          float borderMix = smoothstep(0.32, 0.36, d);
          vec3 col = mix(fillCol, borderCol, borderMix);

          float edgeAlpha = 1.0 - smoothstep(0.46, 0.50, d);
          gl_FragColor = vec4(col, edgeAlpha * vAlpha);
        }
      `,
      transparent: true,
      vertexColors: true,
      depthWrite: false,
      blending: THREE.NormalBlending
    });

    this.dotsMesh = new THREE.Points(this.dotsGeo, this.dotsMat);
    this.dotsMesh.renderOrder = 2;
    this.globeGroup.add(this.dotsMesh);
  }

  createMarkerRings(): void {
    const createRing = (color: number, radius: number = 1.45, tube: number = 0.14) => {
      const geom = new THREE.TorusGeometry(radius, tube, 16, 32);
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false, depthTest: false });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.renderOrder = 3;
      mesh.visible = false;
      this.globeGroup.add(mesh);
      return mesh;
    };

    this.hoverRing = createRing(0x1E1B18, 1.45, 0.14);
    this.activeRing = createRing(0xE84A3A, 1.9, 0.16);
  }

  setTracks(tracks: Track[]): void {
    this.allTracks = tracks;
    this.N = tracks.length;
    if (this.dotsMesh && this.globeGroup) {
      this.globeGroup.remove(this.dotsMesh);
      this.dotsGeo?.dispose();
      this.dotsMat?.dispose();
    }
    this.createTrackDots();
    this.trackScreenPos = [];
    for (let i = 0; i < this.N; i++) {
      this.trackScreenPos.push({ x: 0, y: 0, visible: false });
    }
    this.activeTrackIdx = -1;
    if (this.activeRing) this.activeRing.visible = false;
    if (this.hoverRing) this.hoverRing.visible = false;
    this._projectionDirty = true;
  }

  positionMarkerRing(ring: THREE.Mesh | null, trackIdx: number): void {
    if (!ring) return;
    if (trackIdx < 0 || trackIdx >= this.N) {
      ring.visible = false;
      return;
    }
    const px = this.basePositions[trackIdx * 3];
    const py = this.basePositions[trackIdx * 3 + 1];
    const pz = this.basePositions[trackIdx * 3 + 2];
    const nx = this.normals[trackIdx * 3];
    const ny = this.normals[trackIdx * 3 + 1];
    const nz = this.normals[trackIdx * 3 + 2];
    const h = this.dotHeights[trackIdx];

    ring.position.set(px + nx * h, py + ny * h, pz + nz * h);
    this._ringNormal.set(nx, ny, nz);
    ring.quaternion.setFromUnitVectors(GlobeScene.UP_Z, this._ringNormal);
  }

  setHoverRing(idx: number): void {
    if (!this.hoverRing) return;
    if (idx !== -1) {
      this.positionMarkerRing(this.hoverRing, idx);
      this.hoverRing.material.color.set(0x1E1B18);
      this.hoverRing.visible = true;
    } else {
      this.hoverRing.visible = false;
    }
  }

  updateGlobeVisuals({ currentStationTracks, rangeYearL, rangeYearR, searchQuery }: GlobeVisualsFilter): Track[] {
    const stationTrackIdSet = new Set(currentStationTracks.map(t => t.id));
    const visibleTracks: Track[] = [];

    const alphaArr = this.dotsGeo.attributes.aAlpha.array as Float32Array;
    const sizeArr = this.dotsGeo.attributes.aSize.array as Float32Array;
    const colorArr = this.dotsGeo.attributes.color.array as Float32Array;

    for (let i = 0; i < this.N; i++) {
      const t = this.allTracks[i];
      const inStation = stationTrackIdSet.has(t.id);
      const matchYear = (t.year >= rangeYearL && t.year <= rangeYearR);
      const isVisible = inStation && matchYear && trackMatchesSearch(t, searchQuery);

      if (isVisible) {
        visibleTracks.push(t);
        alphaArr[i] = 1.0;
        sizeArr[i] = 8.2;
        colorArr[i * 3] = 1.0;
        colorArr[i * 3 + 1] = 0.99;
        colorArr[i * 3 + 2] = 0.97;
      } else {
        alphaArr[i] = inStation ? 0.15 : 0.0;
        sizeArr[i] = 4.8;
        colorArr[i * 3] = 0.95;
        colorArr[i * 3 + 1] = 0.88;
        colorArr[i * 3 + 2] = 0.82;
      }
    }

    this.dotsGeo.attributes.aAlpha.needsUpdate = true;
    this.dotsGeo.attributes.aSize.needsUpdate = true;
    this.dotsGeo.attributes.color.needsUpdate = true;
    this._projectionDirty = true;

    return visibleTracks;
  }

  updateTrackPosition(idx: number, lat: number, lng: number): void {
    if (idx < 0 || idx >= this.N) return;
    const v = latLngToVector3(lat, lng, GLOBE_RADIUS);
    const n = v.clone().normalize();
    const i3 = idx * 3;
    this.basePositions[i3] = v.x;
    this.basePositions[i3 + 1] = v.y;
    this.basePositions[i3 + 2] = v.z;
    this.normals[i3] = n.x;
    this.normals[i3 + 1] = n.y;
    this.normals[i3 + 2] = n.z;
    const h = this.dotHeights[idx];
    this.elevatedPositions[i3] = v.x + n.x * h;
    this.elevatedPositions[i3 + 1] = v.y + n.y * h;
    this.elevatedPositions[i3 + 2] = v.z + n.z * h;
    if (this.dotsGeo) {
      this.dotsGeo.attributes.position.needsUpdate = true;
      this.dotsGeo.attributes.normal.needsUpdate = true;
    }
    if (idx === this.activeTrackIdx && this.activeRing) {
      this.positionMarkerRing(this.activeRing, idx);
    }
    this._projectionDirty = true;
  }

  projectPoints(): void {
    const camPos = this.camera.position;
    const globeRot = this.globeGroup.rotation;
    const sameCamera = camPos.x === this._lastCamPos.x && camPos.y === this._lastCamPos.y && camPos.z === this._lastCamPos.z;
    const sameRotation = globeRot.x === this._lastGlobeRot.x && globeRot.y === this._lastGlobeRot.y && globeRot.z === this._lastGlobeRot.z;

    if (sameCamera && sameRotation && !this._projectionDirty) {
      return;
    }

    this._lastCamPos.copy(camPos);
    this._lastGlobeRot.copy(globeRot);
    this._projectionDirty = false;

    const hw = window.innerWidth * 0.5;
    const hh = window.innerHeight * 0.5;
    const alphaArr = this.dotsGeo.attributes.aAlpha.array as Float32Array;
    const ep = this.elevatedPositions;
    const norm = this.normals;

    for (let i = 0; i < this.N; i++) {
      if (alphaArr[i] < 0.12) {
        this.trackScreenPos[i].visible = false;
        continue;
      }

      const i3 = i * 3;
      this._tmpProjPos.set(ep[i3], ep[i3 + 1], ep[i3 + 2]).applyMatrix4(this.globeGroup.matrixWorld);

      this._tmpNorm.set(norm[i3], norm[i3 + 1], norm[i3 + 2]).applyQuaternion(this.globeGroup.quaternion);
      this._tmpCamDir.subVectors(this.camera.position, this._tmpProjPos).normalize();
      if (this._tmpNorm.dot(this._tmpCamDir) < 0.02) {
        this.trackScreenPos[i].visible = false;
        continue;
      }

      this._tmpV.copy(this._tmpProjPos).project(this.camera);
      if (this._tmpV.z > 1 || this._tmpV.z < -1) {
        this.trackScreenPos[i].visible = false;
      } else {
        this.trackScreenPos[i].x = (this._tmpV.x * hw) + hw;
        this.trackScreenPos[i].y = (-this._tmpV.y * hh) + hh;
        this.trackScreenPos[i].visible = true;
      }
    }
  }

  findClosestDot(mx: number, my: number, maxDistSq: number = 24 * 24): number {
    let best = -1;
    let minD = maxDistSq;
    for (let i = 0; i < this.N; i++) {
      if (!this.trackScreenPos[i].visible) continue;
      const dx = this.trackScreenPos[i].x - mx;
      const dy = this.trackScreenPos[i].y - my;
      const d = dx * dx + dy * dy;
      if (d < minD) {
        minD = d;
        best = i;
      }
    }
    return best;
  }

  toggleBorders(): boolean {
    if (this.bordersMesh) {
      this.bordersMesh.visible = !this.bordersMesh.visible;
      return this.bordersMesh.visible;
    }
    return false;
  }

  toggleStarfield(): boolean {
    if (this.starfieldMesh) {
      const isDark = !this.starfieldMesh.visible;
      this.starfieldMesh.visible = isDark;
      if (this.earthMat) {
        this.earthMat.uniforms.uDark.value = isDark ? 1.0 : 0.0;
      }
      document.body.classList.toggle('dark-mode', isDark);
      return isDark;
    }
    return false;
  }

  setActiveTrack(track: Track | null): void {
    const nextIdx = track ? this.allTracks.findIndex(t => t.id === track.id) : -1;
    if (this.activeTrackIdx !== nextIdx) {
      this.activeTrackIdx = nextIdx;
      if (this.activeRing) {
        if (this.activeTrackIdx !== -1) {
          this.positionMarkerRing(this.activeRing, this.activeTrackIdx);
          this.activeRing.visible = true;
        } else {
          this.activeRing.visible = false;
        }
      }
    }
  }

  render(elapsed: number, activeTrack?: Track | null): void {
    this.dotsMat.uniforms.uTime.value = elapsed;
    if (this.starMat) {
      this.starMat.uniforms.uTime.value = elapsed;
    }
    this.projectPoints();

    if (activeTrack && this.activeTrackIdx === -1) {
      this.setActiveTrack(activeTrack);
    }

    if (this.activeTrackIdx !== -1 && this.activeRing) {
      const pulse = 1.0 + Math.sin(elapsed * 4.5) * 0.15;
      this.activeRing.scale.set(pulse, pulse, 1);
    }

    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    if (this.dotsGeo) this.dotsGeo.dispose();
    if (this.dotsMat) this.dotsMat.dispose();
    if (this.starfieldMesh) {
      this.starfieldMesh.geometry.dispose();
      (this.starfieldMesh.material as THREE.Material).dispose();
    }
    if (this.innerAtmosMesh) {
      this.innerAtmosMesh.geometry.dispose();
      (this.innerAtmosMesh.material as THREE.Material).dispose();
    }
    if (this.outerAtmosMesh) {
      this.outerAtmosMesh.geometry.dispose();
      (this.outerAtmosMesh.material as THREE.Material).dispose();
    }
    if (this.bordersMesh) {
      this.bordersMesh.geometry.dispose();
      const mat = this.bordersMesh.material;
      if (Array.isArray(mat)) {
        mat.forEach(m => m.dispose());
      } else {
        if ('map' in mat && mat.map) {
          (mat.map as THREE.Texture).dispose();
        }
        mat.dispose();
      }
    }
    if (this.hoverRing) {
      this.hoverRing.geometry.dispose();
      this.hoverRing.material.dispose();
    }
    if (this.activeRing) {
      this.activeRing.geometry.dispose();
      this.activeRing.material.dispose();
    }
    if (this.scene) {
      this.scene.traverse(obj => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) {
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach(m => m.dispose());
          } else {
            mesh.material.dispose();
          }
        }
      });
      this.scene.clear();
    }
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      if (this.renderer.domElement && this.renderer.domElement.parentNode) {
        this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
      }
    }
  }
}

export const globe = new GlobeScene();
