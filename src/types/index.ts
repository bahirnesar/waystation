export type ImportSource = 'youtube' | 'soundcloud' | 'bandcamp' | 'spotify' | 'apple-music' | 'local';
export type VisualiserLayout = 'clusters' | 'spiral' | 'globe' | 'timeline';
export type ColorMode = 'station' | 'user' | 'genre' | 'source' | 'uniform';
export type RoomMode = 'local' | 'shared' | 'curated';

export interface Track {
  id: string;
  title: string;
  artist: string;
  year: number;
  genre: string;
  genres?: string[];
  city: string;
  country: string;
  lat: number;
  lng: number;
  rawTitle?: string;
  clusterId?: string;
  thumbnail?: string;
  hubLat?: number;
  hubLng?: number;
  densityHeight?: number;
  displayCountry?: string;
  // Multi-source & room fields
  importSource?: ImportSource;
  ytId?: string;
  scUrl?: string;
  bcUrl?: string;
  tralbumId?: string;
  tralbumType?: 't' | 'a';
  spotifyUrl?: string;
  appleMusicUrl?: string;
  localBlobKey?: string;
  stationIds?: string[];
  addedByUserIds?: string[];
  addedAt?: number;
}

export interface LocationHub {
  id: string;
  city: string;
  country: string;
  lat: number;
  lng: number;
  allowedBoundaryNames?: string[];
  patterns?: string[];
}

export interface Cluster extends LocationHub {
  tracks: Track[];
}

export interface Station {
  id: string;
  name: string;
  color?: string;
  createdBy?: string;
  importUrl?: string;
  trackIds?: string[];
  trackCount?: number;
  artistCount?: number;
  tracks?: Track[];
}

export interface UserProfile {
  id: string;
  username: string;
  color: string;
  avatar?: string;
}

export interface NowPlayingState {
  trackId: string;
  title: string;
  artist: string;
  artworkUrl?: string;
  stationId?: string;
  isPlaying: boolean;
  positionMs: number;
  updatedAt: number;
}

export interface UserPresence extends UserProfile {
  online: boolean;
  nowPlaying: NowPlayingState | null;
  listeningToUserId: string | null;
}

export interface RoomState {
  id: string;
  name: string;
  mode: RoomMode;
  readOnly?: boolean;
  createdAt: number;
  stations: Station[];
  tracks: Track[];
  users: UserPresence[];
}

export interface CuratedRoomConfig {
  id: string;
  name: string;
  subtitle: string;
  tag?: string;
  loadDataset: () => Promise<{ stations: Station[]; tracks: Track[] }>;
}

export interface SavedRoomEntry {
  id: string;
  name: string;
  mode: RoomMode;
  trackCount: number;
  stationCount: number;
  lastVisitedAt: number;
}

export type WsClientMessage =
  | { type: 'join'; user: UserProfile }
  | { type: 'now_playing'; nowPlaying: NowPlayingState | null }
  | { type: 'listen_in'; targetUserId: string | null };

export type WsServerMessage =
  | { type: 'presence'; users: UserPresence[] }
  | { type: 'room_mutated'; state: RoomState }
  | { type: 'listen_sync'; hostUserId: string; nowPlaying: NowPlayingState | null }
  | { type: 'listener_joined'; listener: UserProfile };

export interface AppState {
  roomId: string;
  roomMode: RoomMode;
  roomName: string;
  isReadOnly: boolean;
  currentStationId: string;
  currentStationTracks: Track[];
  rangeYearL: number;
  rangeYearR: number;
  searchQuery: string;
  autoSpin: boolean;
}

export interface GenreRecommendationSection {
  genre: string;
  tracks: Track[];
}

export interface TrackRecommendations {
  countryName: string;
  artistTracks: Track[];
  genreSections: GenreRecommendationSection[];
  locationTracks: Track[];
}

export interface RangeChangeEvent {
  rangeYearL: number;
  rangeYearR: number;
}
