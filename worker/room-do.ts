import { DurableObject } from 'cloudflare:workers';
import type {
  RoomState,
  Station,
  Track,
  UserPresence,
  UserProfile,
  WsClientMessage,
  WsServerMessage
} from '../src/types/index';

export interface Env {
  ROOMS: DurableObjectNamespace<WaystationRoom>;
  ASSETS: Fetcher;
}

const STATIC_CURATED_IDS = new Set(['ostalgie']);

export class WaystationRoom extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.initSchema();
  }

  private initSchema(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS room_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS stations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT,
        created_by TEXT,
        import_url TEXT,
        track_ids TEXT NOT NULL DEFAULT '[]',
        sort_order INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS tracks (
        id TEXT PRIMARY KEY,
        canonical_key TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tracks_canonical ON tracks(canonical_key);
      CREATE TABLE IF NOT EXISTS contributors (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        color TEXT NOT NULL,
        avatar TEXT
      );
    `);
  }

  private getMeta(key: string, fallback: string): string {
    const row = this.sql.exec<{ value: string }>('SELECT value FROM room_meta WHERE key = ?', key).toArray()[0];
    return row ? row.value : fallback;
  }

  private setMeta(key: string, value: string): void {
    this.sql.exec(
      'INSERT INTO room_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      value
    );
  }

  private getActiveUsers(): UserPresence[] {
    const users = new Map<string, UserPresence>();
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as UserPresence | null;
      if (att && att.id) {
        users.set(att.id, { ...att, online: true });
      }
    }
    return Array.from(users.values());
  }

  private getRoomState(roomId: string): RoomState {
    const isCurated = STATIC_CURATED_IDS.has(roomId);
    const name = this.getMeta('name', isCurated ? roomId.toUpperCase() : roomId);
    const createdAt = Number(this.getMeta('createdAt', String(Date.now())));

    const stationRows = this.sql
      .exec<{
        id: string;
        name: string;
        color: string | null;
        created_by: string | null;
        import_url: string | null;
        track_ids: string;
      }>('SELECT id, name, color, created_by, import_url, track_ids FROM stations ORDER BY sort_order ASC, rowid ASC')
      .toArray();

    const stations: Station[] = stationRows.map(r => ({
      id: r.id,
      name: r.name,
      color: r.color || undefined,
      createdBy: r.created_by || undefined,
      importUrl: r.import_url || undefined,
      trackIds: JSON.parse(r.track_ids || '[]')
    }));

    const trackRows = this.sql.exec<{ data: string }>('SELECT data FROM tracks').toArray();
    const tracks: Track[] = trackRows.map(r => JSON.parse(r.data));

    return {
      id: roomId,
      name,
      mode: isCurated ? 'curated' : 'shared',
      readOnly: isCurated,
      createdAt,
      stations,
      tracks,
      users: this.getActiveUsers()
    };
  }

  private canonicalKey(t: Partial<Track>): string {
    if (t.ytId) return `yt:${t.ytId}`;
    if (t.scUrl) return `sc:${t.scUrl.split('?')[0].toLowerCase()}`;
    if (t.bcUrl) return `bc:${t.bcUrl.split('?')[0].toLowerCase()}`;
    if (t.spotifyUrl) return `sp:${t.spotifyUrl.split('?')[0].toLowerCase()}`;
    return `meta:${(t.artist || '').trim().toLowerCase()}|||${(t.title || '').trim().toLowerCase()}`;
  }

  private upsertContributor(user?: UserProfile): void {
    if (!user || !user.id) return;
    this.sql.exec(
      `INSERT INTO contributors (id, username, color, avatar)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET username = excluded.username, color = excluded.color, avatar = excluded.avatar`,
      user.id,
      user.username || 'Anon',
      user.color || '#F4977C',
      user.avatar || null
    );
  }

  private upsertTracksInternal(incoming: Track[], stationId?: string, userId?: string): void {
    let stationTrackIds: string[] = [];
    if (stationId && stationId !== 'all') {
      const stRow = this.sql.exec<{ track_ids: string }>('SELECT track_ids FROM stations WHERE id = ?', stationId).toArray()[0];
      if (stRow) {
        stationTrackIds = JSON.parse(stRow.track_ids || '[]');
      }
    }
    const stationTrackSet = new Set(stationTrackIds);

    for (const raw of incoming) {
      const cKey = this.canonicalKey(raw);
      const existingRow = this.sql
        .exec<{ id: string; data: string }>('SELECT id, data FROM tracks WHERE id = ? OR canonical_key = ? LIMIT 1', raw.id, cKey)
        .toArray()[0];

      let finalTrack: Track;
      if (existingRow) {
        const prev = JSON.parse(existingRow.data) as Track;
        const stIds = new Set<string>(prev.stationIds || []);
        if (stationId && stationId !== 'all') stIds.add(stationId);
        for (const sid of raw.stationIds || []) stIds.add(sid);

        const userIds = new Set<string>(prev.addedByUserIds || []);
        if (userId) userIds.add(userId);
        for (const uid of raw.addedByUserIds || []) userIds.add(uid);

        finalTrack = {
          ...prev,
          ...raw,
          id: prev.id,
          stationIds: Array.from(stIds),
          addedByUserIds: Array.from(userIds)
        };
      } else {
        const stIds = new Set<string>(raw.stationIds || []);
        if (stationId && stationId !== 'all') stIds.add(stationId);
        const userIds = new Set<string>(raw.addedByUserIds || []);
        if (userId) userIds.add(userId);

        finalTrack = {
          ...raw,
          id: raw.id || crypto.randomUUID(),
          stationIds: Array.from(stIds),
          addedByUserIds: Array.from(userIds),
          addedAt: raw.addedAt || Date.now()
        };
      }

      this.sql.exec(
        `INSERT INTO tracks (id, canonical_key, data)
         VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
        finalTrack.id,
        cKey,
        JSON.stringify(finalTrack)
      );

      if (stationId && stationId !== 'all' && !stationTrackSet.has(finalTrack.id)) {
        stationTrackSet.add(finalTrack.id);
        stationTrackIds.push(finalTrack.id);
      }
    }

    if (stationId && stationId !== 'all') {
      this.sql.exec('UPDATE stations SET track_ids = ? WHERE id = ?', JSON.stringify(stationTrackIds), stationId);
    }
  }

  private broadcast(msg: WsServerMessage, exclude?: WebSocket): void {
    const payload = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws !== exclude) {
        try {
          ws.send(payload);
        } catch {
          // ignore closed socket
        }
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const roomId = request.headers.get('X-Room-Id') || 'default';

    // WebSocket Upgrade
    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({
        id: '',
        username: 'Wayfarer',
        color: '#F4977C',
        online: true,
        nowPlaying: null,
        listeningToUserId: null
      } satisfies UserPresence);
      return new Response(null, { status: 101, webSocket: client });
    }

    const action = url.pathname.replace(/^\/api\/rooms\/[^/]+/, '') || '/state';

    if (request.method === 'GET' && action === '/health') {
      return Response.json({ ok: true, roomId });
    }

    if (request.method === 'GET' && action === '/state') {
      return Response.json(this.getRoomState(roomId));
    }

    const isCurated = STATIC_CURATED_IDS.has(roomId);

    // Manually curated rooms are strictly read-only for station & track mutations
    if (isCurated && request.method === 'POST') {
      return Response.json({ error: `${roomId} is a curated room (read-only).` }, { status: 403 });
    }

    if (request.method === 'POST' && action === '/init') {
      const body = (await request.json().catch(() => ({}))) as {
        name?: string;
        stations?: Station[];
        tracks?: Track[];
        user?: UserProfile;
      };

      const existingCreated = this.sql.exec('SELECT value FROM room_meta WHERE key = ?', 'createdAt').toArray()[0];
      if (!existingCreated) {
        this.setMeta('createdAt', String(Date.now()));
      }
      if (body.name) {
        this.setMeta('name', body.name);
      } else if (!this.sql.exec('SELECT value FROM room_meta WHERE key = ?', 'name').toArray()[0]) {
        this.setMeta('name', roomId);
      }

      this.upsertContributor(body.user);

      // Ensure default 'all' station exists
      const hasAll = this.sql.exec('SELECT id FROM stations WHERE id = ?', 'all').toArray()[0];
      if (!hasAll) {
        this.sql.exec(
          'INSERT INTO stations (id, name, color, track_ids, sort_order) VALUES (?, ?, ?, ?, ?)',
          'all',
          'All Tracks',
          '#F4977C',
          '[]',
          0
        );
      }

      if (Array.isArray(body.stations)) {
        body.stations.forEach((s, idx) => {
          if (s.id === 'all') return;
          this.sql.exec(
            `INSERT INTO stations (id, name, color, created_by, import_url, track_ids, sort_order)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, track_ids = excluded.track_ids`,
            s.id,
            s.name,
            s.color || '#F4977C',
            s.createdBy || body.user?.id || null,
            s.importUrl || null,
            JSON.stringify(s.trackIds || []),
            idx + 1
          );
        });
      }

      if (Array.isArray(body.tracks) && body.tracks.length > 0) {
        this.upsertTracksInternal(body.tracks, undefined, body.user?.id);
      }

      const state = this.getRoomState(roomId);
      this.broadcast({ type: 'room_mutated', state });
      return Response.json(state);
    }

    if (request.method === 'POST' && action === '/stations') {
      const body = (await request.json()) as {
        op?: 'create' | 'rename' | 'delete';
        station?: Partial<Station>;
        stationId?: string;
        name?: string;
        user?: UserProfile;
      };
      this.upsertContributor(body.user);

      const op = body.op || 'create';
      if (op === 'create' && body.station?.name) {
        const id = body.station.id || `st-${crypto.randomUUID().slice(0, 8)}`;
        const count = this.sql.exec<{ c: number }>('SELECT COUNT(*) as c FROM stations').toArray()[0]?.c || 0;
        this.sql.exec(
          `INSERT INTO stations (id, name, color, created_by, import_url, track_ids, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET name = excluded.name`,
          id,
          body.station.name,
          body.station.color || '#F4977C',
          body.user?.id || body.station.createdBy || null,
          body.station.importUrl || null,
          JSON.stringify(body.station.trackIds || []),
          count + 1
        );
      } else if (op === 'rename' && body.stationId && body.name) {
        if (body.stationId !== 'all') {
          this.sql.exec('UPDATE stations SET name = ? WHERE id = ?', body.name, body.stationId);
        }
      } else if (op === 'delete' && body.stationId) {
        if (body.stationId !== 'all') {
          this.sql.exec('DELETE FROM stations WHERE id = ?', body.stationId);
        }
      }

      const state = this.getRoomState(roomId);
      this.broadcast({ type: 'room_mutated', state });
      return Response.json(state);
    }

    if (request.method === 'POST' && action === '/tracks') {
      const body = (await request.json()) as {
        tracks: Track[];
        stationId?: string;
        user?: UserProfile;
      };
      this.upsertContributor(body.user);

      if (Array.isArray(body.tracks) && body.tracks.length > 0) {
        this.upsertTracksInternal(body.tracks, body.stationId, body.user?.id);
      }

      const state = this.getRoomState(roomId);
      this.broadcast({ type: 'room_mutated', state });
      return Response.json(state);
    }

    if (request.method === 'POST' && action === '/track-patch') {
      const body = (await request.json().catch(() => ({}))) as {
        trackId?: string;
        patch?: Partial<Track>;
      };
      if (body.trackId && body.patch) {
        const row = this.sql
          .exec<{ id: string; canonical_key: string; data: string }>(
            'SELECT id, canonical_key, data FROM tracks WHERE id = ?',
            body.trackId
          )
          .toArray()[0];
        if (row) {
          const track = JSON.parse(row.data) as Track;
          const updatedTrack: Track = { ...track, ...body.patch };
          const cKey = this.canonicalKey(updatedTrack);
          this.sql.exec(
            'UPDATE tracks SET canonical_key = ?, data = ? WHERE id = ?',
            cKey,
            JSON.stringify(updatedTrack),
            body.trackId
          );
        }
      }
      return Response.json({ ok: true });
    }

    return new Response('Not Found', { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      const text = typeof message === 'string' ? message : new TextDecoder().decode(message);
      const data = JSON.parse(text) as WsClientMessage;
      const current = (ws.deserializeAttachment() as UserPresence | null) || {
        id: '',
        username: 'Wayfarer',
        color: '#F4977C',
        online: true,
        nowPlaying: null,
        listeningToUserId: null
      };

      if (data.type === 'join' && data.user) {
        const updated: UserPresence = {
          ...current,
          id: data.user.id,
          username: data.user.username,
          color: data.user.color,
          avatar: data.user.avatar,
          online: true
        };
        ws.serializeAttachment(updated);
        this.upsertContributor(data.user);
        this.broadcast({ type: 'presence', users: this.getActiveUsers() });
      } else if (data.type === 'now_playing') {
        const updated: UserPresence = {
          ...current,
          nowPlaying: data.nowPlaying
        };
        ws.serializeAttachment(updated);
        this.broadcast({ type: 'presence', users: this.getActiveUsers() });

        // Notify any followers listening to this user
        if (updated.id) {
          for (const peerWs of this.ctx.getWebSockets()) {
            const peer = peerWs.deserializeAttachment() as UserPresence | null;
            if (peer && peer.listeningToUserId === updated.id) {
              peerWs.send(
                JSON.stringify({
                  type: 'listen_sync',
                  hostUserId: updated.id,
                  nowPlaying: updated.nowPlaying
                } satisfies WsServerMessage)
              );
            }
          }
        }
      } else if (data.type === 'listen_in') {
        const updated: UserPresence = {
          ...current,
          listeningToUserId: data.targetUserId
        };
        ws.serializeAttachment(updated);
        this.broadcast({ type: 'presence', users: this.getActiveUsers() });

        if (data.targetUserId) {
          for (const peerWs of this.ctx.getWebSockets()) {
            const peer = peerWs.deserializeAttachment() as UserPresence | null;
            if (peer && peer.id === data.targetUserId) {
              peerWs.send(
                JSON.stringify({
                  type: 'listener_joined',
                  listener: { id: updated.id, username: updated.username, color: updated.color, avatar: updated.avatar }
                } satisfies WsServerMessage)
              );
              ws.send(
                JSON.stringify({
                  type: 'listen_sync',
                  hostUserId: peer.id,
                  nowPlaying: peer.nowPlaying
                } satisfies WsServerMessage)
              );
              break;
            }
          }
        }
      }
    } catch {
      // Ignore malformed messages
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      // ignore
    }
    this.broadcast({ type: 'presence', users: this.getActiveUsers() });
  }

  async webSocketError(): Promise<void> {
    this.broadcast({ type: 'presence', users: this.getActiveUsers() });
  }
}

