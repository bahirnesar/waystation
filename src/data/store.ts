// ─── DATA STORE & NORMALIZATION ───
import { Track, Cluster, Station, AppState, LocationHub, RoomState } from '../types/index';
import { TOP_LEVEL_GENRES, getTrackGenres, trackHasGenre } from './genres';

// Raw inputs from window globals (Permanent Ostalgie Archive)
const rawLocations: LocationHub[] = window.LOCATIONS_DATA || [];
export const rawTracks: Track[] = window.TRACKS_DATA || [];
const rawStations: Station[] = window.STATIONS_DATA || [];

// Maps for lookups
export const locationMap = new Map<string, LocationHub>();
rawLocations.forEach(loc => locationMap.set(loc.id, loc));

export const ostalgieTracks: Track[] = rawTracks;
export const ostalgieTrackMap = new Map<string, Track>();
ostalgieTracks.forEach(t => ostalgieTrackMap.set(t.id, t));

// Mutable active room references (defaults to Ostalgie until RoomAdapter loads)
export let allTracks: Track[] = ostalgieTracks;
export const trackMap = new Map<string, Track>(ostalgieTrackMap);

export function standardizeCountry(name?: string): string {
  if (!name) return '';
  const m = name.match(/^Soviet Union \((.+)\)$/i);
  return m ? `${m[1]} (USSR)` : name;
}

const RUSSIAN_REGIONS = new Set<string>([
  'Tatarstan', 'Bashkortostan', 'Dagestan', 'Chuvashia', 'Mari El',
  'Buryatia', 'Komi Republic', 'Chechnya', 'Tuva', 'Altai Republic',
  'Khakassia', 'Adygea', 'Ingushetia', 'Yakutia'
]);

export function getDisplayCountry(track?: Track | string | null): string {
  if (!track) return '';
  const country = typeof track === 'string' ? track : (track.country || track.city || '');
  const year = typeof track === 'object' ? (track.year || 0) : 0;
  const city = typeof track === 'object' ? (track.city || '') : '';
  const y = Number(year) || 0;

  // USSR
  const ussrMatch = country.match(/^(.+?)\s*\(USSR\)$/i);
  if (ussrMatch) {
    const region = ussrMatch[1].trim();
    if (y >= 1992) {
      if (region === 'Russia') return 'Russia';
      if (RUSSIAN_REGIONS.has(region)) return `${region} (Russia)`;
      if (region === 'Abkhazia') return 'Abkhazia';
      if (region === 'Karakalpakstan') return 'Karakalpakstan (Uzbekistan)';
      return region;
    }
    return country;
  }

  // Yugoslavia
  const yugoMatch = country.match(/^Yugoslavia\s*\((.+?)\)$/i);
  if (yugoMatch) {
    const rep = yugoMatch[1].trim();
    if (y >= 1992) {
      return rep;
    }
    return country;
  }
  if (country === 'Yugoslavia') {
    if (y >= 1992) {
      if (city && /belgrade|beograd/i.test(city)) return 'Serbia';
      if (city && /zagreb/i.test(city)) return 'Croatia';
      if (city && /ljubljana/i.test(city)) return 'Slovenia';
      if (city && /sarajevo/i.test(city)) return 'Bosnia and Herzegovina';
      if (city && /skopje/i.test(city)) return 'North Macedonia';
      return 'Serbia';
    }
    return country;
  }

  // Czechoslovakia 
  if (country === 'Czechoslovakia (Slovakia)') {
    if (y >= 1993) return 'Slovakia';
    return country;
  }
  if (country === 'Czechoslovakia') {
    if (y >= 1993) {
      if (city && /bratislava/i.test(city)) return 'Slovakia';
      return 'Czech Republic';
    }
    return country;
  }

  // GDR (East Germany)
  if (country === 'GDR (East Germany)' || country === 'East Germany') {
    if (y >= 1991) return 'Germany';
    return country;
  }

  return country;
}

// Hydrate track metadata (defaults from cluster location)
allTracks.forEach(t => {
  if (t.clusterId && locationMap.has(t.clusterId)) {
    const loc = locationMap.get(t.clusterId)!;
    if (!t.city) t.city = loc.city;
    if (!t.country) t.country = loc.country;
    if (t.hubLat === undefined) t.hubLat = loc.lat;
    if (t.hubLng === undefined) t.hubLng = loc.lng;
  }
  if (t.country) t.country = standardizeCountry(t.country);
  t.displayCountry = getDisplayCountry(t);
  t.genres = getTrackGenres(t);
});

// Hydrate clusters
export const allClusters: Cluster[] = rawLocations.map(loc => {
  const clusterTracks = allTracks.filter(t => t.clusterId === loc.id);
  return {
    ...loc,
    country: standardizeCountry(loc.country),
    tracks: clusterTracks
  };
});

export function escapeHtml(str?: unknown): string {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[m] || m);
}

/*
// Redundant, dot distribution is now pre-computed 
export function pseudoRandom(seedStr: string): number {
  let hash = 0;
  for (let i = 0; i < seedStr.length; i++) {
    hash = ((hash << 5) - hash) + seedStr.charCodeAt(i);
    hash |= 0;
  }
  return (Math.abs(Math.sin(hash)) * 10000) % 1;
}

(function ensureRadialSpread() {
  const cityGroups: Record<string, Track[]> = {};
  allTracks.forEach(t => {
    const key = t.city || t.clusterId || 'default';
    if (!cityGroups[key]) cityGroups[key] = [];
    cityGroups[key].push(t);
  });

  Object.values(cityGroups).forEach(tracks => {
    if (tracks.length <= 1) return;
    const cLat = tracks[0].hubLat ?? tracks[0].lat;
    const cLng = tracks[0].hubLng ?? tracks[0].lng;
    const cosLat = Math.abs(Math.cos(cLat * Math.PI / 180)) > 0.1 ? Math.cos(cLat * Math.PI / 180) : 0.6;
    const maxR = Math.min(7.5, 0.6 + 0.55 * Math.sqrt(tracks.length));

    tracks.forEach((t, i) => {
      const isUnpositioned = (t.lat === undefined || t.lng === undefined || (!t.hubLat && i > 0 && Math.abs(t.lat - cLat) < 0.0001));
      if (isUnpositioned) {
        const u = (i + 1) / (tracks.length + 1);
        const r = maxR * Math.pow(u, 1.25);
        const theta = i * 137.5 * (Math.PI / 180);
        if (cLat <= -85) {
          t.lat = Math.max(-90, Math.min(-70, -90 + r));
          t.lng = ((theta * 180 / Math.PI) + 180) % 360 - 180;
        } else {
          t.lat = cLat + r * Math.cos(theta);
          t.lng = cLng + (r * Math.sin(theta)) / cosLat;
        }
        t.hubLat = cLat;
        t.hubLng = cLng;
      }

      if (!t.densityHeight) {
        const dist = Math.hypot(t.lat - cLat, (t.lng - cLng) * cosLat);
        const normD = min(1.0, dist / maxR);
        const densityRatio = tracks.length > 1 ? Math.log(tracks.length) / Math.log(127) : 0;
        const densityFactor = densityRatio * (1.0 - 0.65 * normD);

        const hMin = 0.1 + 1.2 * densityFactor;
        const hMax = 0.35 + 8.5 * Math.pow(densityFactor, 1.1);
        const rnd = pseudoRandom(t.id || t.title || String(i));
        t.densityHeight = Number((hMin + rnd * (hMax - hMin)).toFixed(3));
      }
    });
  });
})();

function min(a: number, b: number): number {
  return a < b ? a : b;
}
*/

export function trackMatchesSearch(t: Track, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return t.title.toLowerCase().includes(q) ||
    t.artist.toLowerCase().includes(q) ||
    t.city.toLowerCase().includes(q) ||
    t.country.toLowerCase().includes(q) ||
    (t.displayCountry ? t.displayCountry.toLowerCase().includes(q) : false) ||
    t.genre.toLowerCase().includes(q) ||
    (t.genres ? t.genres.some(g => g.toLowerCase().includes(q)) : false);
}

// 5. Hydrate Ostalgie stations (from explicit trackIds for custom stations, or derived by genre)
export const ostalgieStations: Station[] = (rawStations.length ? rawStations : [
  { id: 'all', name: 'All Tracks' },
  ...TOP_LEVEL_GENRES.map(name => ({ id: name.toLowerCase(), name }))
]).map(s => {
  const stTracks = s.trackIds?.length
    ? s.trackIds.map(id => ostalgieTrackMap.get(id)).filter((t): t is Track => Boolean(t))
    : (s.tracks || (s.id === 'all' ? ostalgieTracks : ostalgieTracks.filter(t => trackHasGenre(t, s.name))));

  const uniqueArtists = new Set(stTracks.map(t => (t.artist || '').trim().toLowerCase()));

  return {
    ...s,
    tracks: stTracks,
    trackCount: stTracks.length,
    artistCount: uniqueArtists.size
  };
});

export let stations: Station[] = ostalgieStations;

const defaultStation = stations.find(s => s.id === 'all') || stations[0];
const validYears = allTracks.map(t => t.year).filter((y): y is number => typeof y === 'number' && y > 1900);

export const state: AppState = {
  roomId: 'ostalgie',
  roomMode: 'shared',
  roomName: 'OSTALGIE',
  isReadOnly: true,
  currentStationId: defaultStation?.id || 'all',
  currentStationTracks: defaultStation?.tracks || allTracks,
  rangeYearL: validYears.length ? Math.min(...validYears) : 1967,
  rangeYearR: validYears.length ? Math.max(...validYears) : 2005,
  searchQuery: '',
  autoSpin: true
};

/**
 * Hydrate active store state from a RoomState snapshot (LocalRoomAdapter or SharedRoomAdapter).
 */
export function applyRoomStateToStore(room: RoomState): void {
  // Normalize tracks
  const hydratedTracks = room.tracks.map((t, idx) => {
    if (t.lat === undefined || t.lng === undefined) {
      // Deterministic Fibonacci sphere fallback for imported tracks without geo coords
      const phi = Math.acos(1 - (2 * (idx + 0.5)) / Math.max(1, room.tracks.length));
      const theta = Math.PI * (1 + Math.sqrt(5)) * idx;
      t.lat = 90 - (phi * 180) / Math.PI;
      t.lng = ((theta * 180) / Math.PI) % 360 - 180;
    }
    if (!t.genres) t.genres = getTrackGenres(t);
    if (!t.displayCountry) t.displayCountry = getDisplayCountry(t);
    return t;
  });

  allTracks = hydratedTracks;
  trackMap.clear();
  for (const t of allTracks) {
    trackMap.set(t.id, t);
  }

  const rawRoomStations = room.stations.length
    ? room.stations
    : [{ id: 'all', name: 'All Tracks', trackIds: [] }];

  const hasAll = rawRoomStations.some(s => s.id === 'all');
  const fullStationList = hasAll
    ? rawRoomStations
    : [{ id: 'all', name: 'All Tracks', trackIds: [] }, ...rawRoomStations];

  stations = fullStationList.map(s => {
    let stTracks: Track[];
    if (s.id === 'all') {
      stTracks = allTracks;
    } else if (s.tracks && s.tracks.length > 0 && room.readOnly) {
      stTracks = s.tracks;
    } else if (s.trackIds && s.trackIds.length > 0) {
      stTracks = s.trackIds.map(id => trackMap.get(id)).filter((t): t is Track => Boolean(t));
    } else {
      stTracks = allTracks.filter(t => t.stationIds?.includes(s.id) || trackHasGenre(t, s.name));
    }
    const uniqueArtists = new Set(stTracks.map(t => (t.artist || '').trim().toLowerCase()));
    return {
      ...s,
      tracks: stTracks,
      trackCount: stTracks.length,
      artistCount: uniqueArtists.size
    };
  });

  state.roomId = room.id;
  state.roomMode = room.mode;
  state.roomName = room.name;
  state.isReadOnly = Boolean(room.readOnly);

  const activeSt = stations.find(s => s.id === state.currentStationId) || stations[0];
  state.currentStationId = activeSt?.id || 'all';
  state.currentStationTracks = activeSt?.tracks || allTracks;

  const yrs = allTracks.map(t => t.year).filter((y): y is number => typeof y === 'number' && y > 1900);
  state.rangeYearL = yrs.length ? Math.min(...yrs) : 1900;
  state.rangeYearR = yrs.length ? Math.max(...yrs) : 2030;
}
