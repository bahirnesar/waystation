import {
  NowPlayingState,
  RoomMode,
  RoomState,
  Station,
  Track,
  WsClientMessage,
  WsServerMessage
} from '../types/index';
import { getCuratedRoomConfig, sanitizeRoomSlug } from './curated-rooms';
import { generateRoomSlug, getUserProfile } from './identity';

export type RoomStateListener = (state: RoomState) => void;

export interface RoomAdapter {
  readonly roomId: string;
  readonly mode: RoomMode;
  readonly isReadOnly: boolean;
  getState(): RoomState;
  load(): Promise<RoomState>;
  createStation(name: string, color?: string): Promise<Station>;
  renameStation(stationId: string, name: string): Promise<void>;
  deleteStation(stationId: string): Promise<void>;
  addTracksToStation(stationId: string, tracks: Track[]): Promise<void>;
  restoreSnapshot(snapshot: { stations: Station[]; tracks: Track[] }): Promise<void>;
  updateNowPlaying(nowPlaying: NowPlayingState | null): void;
  listenIn(targetUserId: string | null): void;
  publishToSharedRoom(customName?: string): Promise<string>;
  subscribe(listener: RoomStateListener): () => void;
  dispose(): void;
}

const IDB_NAME = 'waystation_local_db';
const IDB_STORE = 'rooms';
const LOCAL_ROOM_KEY = 'local_room_v1';

function openLocalDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
      if (!db.objectStoreNames.contains('audio_blobs')) {
        db.createObjectStore('audio_blobs');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetRoom(key: string): Promise<RoomState | null> {
  try {
    const db = await openLocalDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve((req.result as RoomState) || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function idbSetRoom(key: string, state: RoomState): Promise<void> {
  try {
    const db = await openLocalDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(state, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Fallback to localStorage if IndexedDB is unavailable
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {
      // ignore
    }
  }
}

function connectRoomWebSocket(
  roomId: string,
  onServerMessage: (msg: WsServerMessage) => void
): { send: (msg: WsClientMessage) => void; close: () => void } {
  let ws: WebSocket | null = null;
  let closed = false;
  let reconnectTimer: number | null = null;

  const connect = () => {
    if (closed) return;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/ws/room/${encodeURIComponent(roomId)}`;
    try {
      ws = new WebSocket(url);
      ws.onopen = () => {
        const user = getUserProfile();
        ws?.send(JSON.stringify({ type: 'join', user } satisfies WsClientMessage));
      };
      ws.onmessage = ev => {
        try {
          const msg = JSON.parse(String(ev.data)) as WsServerMessage;
          onServerMessage(msg);
        } catch {
          // ignore
        }
      };
      ws.onclose = () => {
        if (!closed) {
          reconnectTimer = window.setTimeout(connect, 2500);
        }
      };
    } catch {
      // ignore offline
    }
  };

  connect();

  return {
    send(msg: WsClientMessage) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      }
    },
    close() {
      closed = true;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      try {
        ws?.close();
      } catch {
        // ignore
      }
    }
  };
}

function getTrackCanonicalKey(t: Partial<Track>): string {
  if (t.ytId) return `yt:${t.ytId}`;
  if (t.scUrl) return `sc:${t.scUrl.split('?')[0].toLowerCase().replace(/\/$/, '')}`;
  if (t.bcUrl) return `bc:${t.bcUrl.split('?')[0].toLowerCase().replace(/\/$/, '')}`;
  if (t.spotifyUrl) return `sp:${t.spotifyUrl.split('?')[0].toLowerCase().replace(/\/$/, '')}`;
  if (t.appleMusicUrl) return `am:${t.appleMusicUrl.split('?')[0].toLowerCase().replace(/\/$/, '')}`;
  if (t.localBlobKey) return `local:${t.localBlobKey}`;
  return `meta:${(t.artist || '').trim().toLowerCase()}|||${(t.title || '').trim().toLowerCase()}`;
}

/**
 * LocalRoomAdapter — 100% client-side personal room stored in IndexedDB (`/local`).
 * Starts clean so the user can build their own stations, while Ostalgie lives permanently at `/r/ostalgie`.
 */
export class LocalRoomAdapter implements RoomAdapter {
  readonly roomId = 'local';
  readonly mode = 'local' as const;
  readonly isReadOnly = false;

  private state: RoomState;
  private listeners = new Set<RoomStateListener>();

  constructor() {
    const user = getUserProfile();
    this.state = {
      id: 'local',
      name: 'Local Waystation',
      mode: 'local',
      readOnly: false,
      createdAt: Date.now(),
      stations: [{ id: 'all', name: 'All Tracks', trackIds: [] }],
      tracks: [],
      users: [{ ...user, online: true, nowPlaying: null, listeningToUserId: null }]
    };
  }

  getState(): RoomState {
    return this.state;
  }

  async load(): Promise<RoomState> {
    const saved = await idbGetRoom(LOCAL_ROOM_KEY);
    const user = getUserProfile();
    if (saved && Array.isArray(saved.stations) && Array.isArray(saved.tracks)) {
      this.state = {
        ...saved,
        id: 'local',
        mode: 'local',
        readOnly: false,
        users: [{ ...user, online: true, nowPlaying: null, listeningToUserId: null }]
      };
    } else {
      await idbSetRoom(LOCAL_ROOM_KEY, this.state);
    }
    this.emit();
    return this.state;
  }

  private async persistAndEmit(): Promise<void> {
    await idbSetRoom(LOCAL_ROOM_KEY, this.state);
    this.emit();
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.state);
  }

  async createStation(name: string, color = '#F4977C'): Promise<Station> {
    const user = getUserProfile();
    const st: Station = {
      id: `st-${crypto.randomUUID().slice(0, 8)}`,
      name: name.trim() || 'Untitled Station',
      color,
      createdBy: user.id,
      trackIds: []
    };
    this.state.stations = [...this.state.stations, st];
    await this.persistAndEmit();
    return st;
  }

  async renameStation(stationId: string, name: string): Promise<void> {
    if (stationId === 'all') return;
    this.state.stations = this.state.stations.map(s =>
      s.id === stationId ? { ...s, name: name.trim() || s.name } : s
    );
    await this.persistAndEmit();
  }

  async deleteStation(stationId: string): Promise<void> {
    if (stationId === 'all') return;
    this.state.stations = this.state.stations.filter(s => s.id !== stationId);
    await this.persistAndEmit();
  }

  async addTracksToStation(stationId: string, incoming: Track[]): Promise<void> {
    const user = getUserProfile();
    const byId = new Map<string, Track>();
    const byKey = new Map<string, Track>();

    for (const t of this.state.tracks) {
      byId.set(t.id, t);
      const cKey = getTrackCanonicalKey(t);
      byKey.set(cKey, t);
      if (t.artist && t.title) {
        byKey.set(`meta:${t.artist.trim().toLowerCase()}|||${t.title.trim().toLowerCase()}`, t);
      }
    }

    const stationTrackIds = new Set<string>();
    if (stationId !== 'all') {
      const currentStation = this.state.stations.find(s => s.id === stationId);
      for (const tid of currentStation?.trackIds || []) stationTrackIds.add(tid);
    }

    for (const raw of incoming) {
      const cKey = getTrackCanonicalKey(raw);
      const metaKey = raw.artist && raw.title
        ? `meta:${raw.artist.trim().toLowerCase()}|||${raw.title.trim().toLowerCase()}`
        : cKey;

      const existing = (raw.id ? byId.get(raw.id) : undefined) || byKey.get(cKey) || byKey.get(metaKey);

      if (existing) {
        const stSet = new Set(existing.stationIds || []);
        if (stationId !== 'all') stSet.add(stationId);
        for (const sid of raw.stationIds || []) stSet.add(sid);

        const uSet = new Set(existing.addedByUserIds || []);
        uSet.add(user.id);
        for (const uid of raw.addedByUserIds || []) uSet.add(uid);

        const updated: Track = {
          ...existing,
          ...raw,
          id: existing.id,
          thumbnail: raw.thumbnail || existing.thumbnail,
          ytId: raw.ytId || existing.ytId,
          scUrl: raw.scUrl || existing.scUrl,
          bcUrl: raw.bcUrl || existing.bcUrl,
          spotifyUrl: raw.spotifyUrl || existing.spotifyUrl,
          appleMusicUrl: raw.appleMusicUrl || existing.appleMusicUrl,
          localBlobKey: raw.localBlobKey || existing.localBlobKey,
          stationIds: Array.from(stSet),
          addedByUserIds: Array.from(uSet)
        };
        byId.set(existing.id, updated);
        byKey.set(cKey, updated);
        if (stationId !== 'all') stationTrackIds.add(existing.id);
      } else {
        const id = raw.id || crypto.randomUUID();
        const created: Track = {
          ...raw,
          id,
          stationIds: stationId !== 'all' ? [stationId] : [],
          addedByUserIds: [user.id],
          addedAt: raw.addedAt || Date.now()
        };
        byId.set(id, created);
        byKey.set(cKey, created);
        if (raw.artist && raw.title) {
          byKey.set(`meta:${raw.artist.trim().toLowerCase()}|||${raw.title.trim().toLowerCase()}`, created);
        }
        if (stationId !== 'all') stationTrackIds.add(id);
      }
    }

    this.state.tracks = Array.from(byId.values());
    if (stationId !== 'all') {
      this.state.stations = this.state.stations.map(s => {
        if (s.id !== stationId) return s;
        return { ...s, trackIds: Array.from(stationTrackIds) };
      });
    }
    await this.persistAndEmit();
  }

  async restoreSnapshot(snapshot: { stations: Station[]; tracks: Track[] }): Promise<void> {
    this.state.stations = snapshot.stations.map(s => ({ ...s, trackIds: [...(s.trackIds || [])] }));
    this.state.tracks = snapshot.tracks.map(t => ({
      ...t,
      stationIds: [...(t.stationIds || [])],
      addedByUserIds: [...(t.addedByUserIds || [])]
    }));
    await this.persistAndEmit();
  }

  updateNowPlaying(nowPlaying: NowPlayingState | null): void {
    const user = getUserProfile();
    this.state.users = [{ ...user, online: true, nowPlaying, listeningToUserId: null }];
    this.emit();
  }

  listenIn(): void {
    // No-op in single-user local room
  }

  async publishToSharedRoom(customName?: string): Promise<string> {
    const slug = generateRoomSlug();
    const user = getUserProfile();
    const res = await fetch(`/api/rooms/${encodeURIComponent(slug)}/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: customName || this.state.name || slug,
        stations: this.state.stations,
        tracks: this.state.tracks,
        user
      })
    });
    if (!res.ok) {
      throw new Error(`Failed to publish room (${res.status})`);
    }
    return slug;
  }

  subscribe(listener: RoomStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.listeners.clear();
  }
}

/**
 * SharedRoomAdapter — Connects to a Cloudflare Durable Object room (`/r/:roomId`).
 * Handles both:
 *  - Group 2: Shared URL Rooms (`mode: 'shared'`, editable SQLite rooms)
 *  - Group 3: Manually Curated Rooms from `CURATED_ROOMS` (`mode: 'curated'`, e.g. `/r/ostalgie`)
 */
export class SharedRoomAdapter implements RoomAdapter {
  readonly roomId: string;
  readonly mode: RoomMode;
  readonly isReadOnly: boolean;

  private state: RoomState;
  private listeners = new Set<RoomStateListener>();
  private wsConn: { send: (msg: WsClientMessage) => void; close: () => void } | null = null;

  constructor(roomId: string) {
    this.roomId = sanitizeRoomSlug(roomId) || 'default';
    const curated = getCuratedRoomConfig(this.roomId);
    this.mode = curated ? 'curated' : 'shared';
    this.isReadOnly = Boolean(curated);
    const user = getUserProfile();

    this.state = {
      id: this.roomId,
      name: curated ? curated.name : this.roomId,
      mode: this.mode,
      readOnly: this.isReadOnly,
      createdAt: Date.now(),
      stations: [{ id: 'all', name: 'All Tracks', trackIds: [] }],
      tracks: [],
      users: [{ ...user, online: true, nowPlaying: null, listeningToUserId: null }]
    };
  }

  getState(): RoomState {
    return this.state;
  }

  async load(): Promise<RoomState> {
    const curated = getCuratedRoomConfig(this.roomId);
    if (curated) {
      const dataset = await curated.loadDataset();
      this.state = {
        ...this.state,
        id: curated.id,
        name: curated.name,
        mode: 'curated',
        readOnly: true,
        stations: dataset.stations,
        tracks: dataset.tracks
      };
    } else {
      try {
        const res = await fetch(`/api/rooms/${encodeURIComponent(this.roomId)}/state`);
        if (res.ok) {
          const remote = (await res.json()) as RoomState;
          if (!remote.stations || remote.stations.length === 0) {
            const initRes = await fetch(`/api/rooms/${encodeURIComponent(this.roomId)}/init`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: this.roomId, user: getUserProfile() })
            });
            if (initRes.ok) {
              this.state = (await initRes.json()) as RoomState;
            }
          } else {
            this.state = remote;
          }
        }
      } catch {
        // Offline fallback keeps initial skeleton
      }
    }

    this.wsConn = connectRoomWebSocket(this.roomId, msg => {
      if (msg.type === 'presence') {
        this.state = { ...this.state, users: msg.users };
        this.emit();
      } else if (msg.type === 'room_mutated' && !curated) {
        this.state = msg.state;
        this.emit();
      }
    });

    this.emit();
    return this.state;
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.state);
  }

  async createStation(name: string, color = '#F4977C'): Promise<Station> {
    if (this.isReadOnly) throw new Error('Curated room is read-only');
    const st: Station = {
      id: `st-${crypto.randomUUID().slice(0, 8)}`,
      name: name.trim() || 'Untitled Station',
      color,
      createdBy: getUserProfile().id,
      trackIds: []
    };
    const res = await fetch(`/api/rooms/${encodeURIComponent(this.roomId)}/stations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'create', station: st, user: getUserProfile() })
    });
    if (res.ok) {
      this.state = (await res.json()) as RoomState;
      this.emit();
    }
    return st;
  }

  async renameStation(stationId: string, name: string): Promise<void> {
    if (this.isReadOnly || stationId === 'all') return;
    const res = await fetch(`/api/rooms/${encodeURIComponent(this.roomId)}/stations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'rename', stationId, name, user: getUserProfile() })
    });
    if (res.ok) {
      this.state = (await res.json()) as RoomState;
      this.emit();
    }
  }

  async deleteStation(stationId: string): Promise<void> {
    if (this.isReadOnly || stationId === 'all') return;
    const res = await fetch(`/api/rooms/${encodeURIComponent(this.roomId)}/stations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'delete', stationId, user: getUserProfile() })
    });
    if (res.ok) {
      this.state = (await res.json()) as RoomState;
      this.emit();
    }
  }

  async addTracksToStation(stationId: string, tracks: Track[]): Promise<void> {
    if (this.isReadOnly) return;
    const res = await fetch(`/api/rooms/${encodeURIComponent(this.roomId)}/tracks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stationId, tracks, user: getUserProfile() })
    });
    if (res.ok) {
      this.state = (await res.json()) as RoomState;
      this.emit();
    }
  }

  async restoreSnapshot(snapshot: { stations: Station[]; tracks: Track[] }): Promise<void> {
    if (this.isReadOnly) return;
    const res = await fetch(`/api/rooms/${encodeURIComponent(this.roomId)}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stations: snapshot.stations,
        tracks: snapshot.tracks,
        user: getUserProfile()
      })
    });
    if (res.ok) {
      this.state = (await res.json()) as RoomState;
      this.emit();
    }
  }

  updateNowPlaying(nowPlaying: NowPlayingState | null): void {
    this.wsConn?.send({ type: 'now_playing', nowPlaying });
  }

  listenIn(targetUserId: string | null): void {
    this.wsConn?.send({ type: 'listen_in', targetUserId });
  }

  async publishToSharedRoom(): Promise<string> {
    return this.roomId;
  }

  subscribe(listener: RoomStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.wsConn?.close();
    this.listeners.clear();
  }
}

