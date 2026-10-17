import { SavedRoomEntry, UserProfile } from '../types/index';

const PROFILE_KEY = 'waystation_user_profile_v2';
const SAVED_ROOMS_KEY = 'waystation_saved_rooms_v1';

const ANON_ADJ = [
  'Deadly', 'Curious', 'Piercing', 'Voracious', 'Silent', 'Phantom', 'Wandering', 'Lucid',
  'Feral', 'Burning', 'Frozen', 'Distant', 'Hollow', 'Radiant', 'Cryptic', 'Spectral',
  'Drifting', 'Restless', 'Neon', 'Fractured', 'Obsidian', 'Velvet', 'Gilded', 'Prismatic',
  'Twilight', 'Volatile', 'Crimson', 'Lunar', 'Solar', 'Ethereal', 'Savage', 'Wistful',
  'Arcane', 'Vivid', 'Sonic', 'Ashen', 'Molten', 'Shifting', 'Pale', 'Electric'
];

const ANON_NOUN = [
  'Phantom', 'Comet', 'Gamma', 'Kin', 'Specter', 'Signal', 'Nova', 'Echo',
  'Orbit', 'Shade', 'Flare', 'Pulse', 'Glitch', 'Wisp', 'Haze', 'Static',
  'Vertex', 'Moth', 'Ember', 'Rune', 'Abyss', 'Prism', 'Shard', 'Bloom',
  'Frost', 'Cipher', 'Ghost', 'Nerve', 'Flux', 'Tide', 'Spark', 'Drift',
  'Apex', 'Void', 'Crow', 'Lotus', 'Grain', 'Thorn', 'Veil', 'Byte'
];

export const USER_COLORS = [
  '#F4977C',
  '#F7B587',
  '#6EC6B8',
  '#7CA8F4',
  '#C58AF9',
  '#F28B82',
  '#81C995',
  '#FDD663'
];

export function getAnonName(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  }
  const a = ANON_ADJ[Math.abs(h) % ANON_ADJ.length];
  const n = ANON_NOUN[Math.abs(h >> 8) % ANON_NOUN.length];
  return `${a} ${n}`;
}

export function generateRoomSlug(): string {
  const a = ANON_ADJ[Math.floor(Math.random() * ANON_ADJ.length)].toLowerCase();
  const n = ANON_NOUN[Math.floor(Math.random() * ANON_NOUN.length)].toLowerCase();
  const num = Math.floor(10 + Math.random() * 90);
  return `${a}-${n}-${num}`;
}

export function getUserProfile(): UserProfile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as UserProfile;
      if (parsed.id) return { ...parsed, username: parsed.username ?? '' };
    }
  } catch {
    // fallback below
  }

  const id = `u-${crypto.randomUUID().slice(0, 12)}`;
  const profile: UserProfile = {
    id,
    username: '',
    color: USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)]
  };
  saveUserProfile(profile);
  return profile;
}

export function saveUserProfile(profile: UserProfile): void {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // ignore storage errors
  }
}

export function getSavedRooms(): SavedRoomEntry[] {
  try {
    const raw = localStorage.getItem(SAVED_ROOMS_KEY);
    if (raw) {
      const list = JSON.parse(raw) as SavedRoomEntry[];
      if (Array.isArray(list)) return list;
    }
  } catch {
    // ignore
  }
  return [];
}

export function saveRoomBookmark(entry: SavedRoomEntry): SavedRoomEntry[] {
  const list = getSavedRooms().filter(r => r.id !== entry.id);
  list.unshift(entry);
  try {
    localStorage.setItem(SAVED_ROOMS_KEY, JSON.stringify(list.slice(0, 30)));
  } catch {
    // ignore
  }
  return list;
}

export function removeRoomBookmark(roomId: string): SavedRoomEntry[] {
  const list = getSavedRooms().filter(r => r.id !== roomId);
  try {
    localStorage.setItem(SAVED_ROOMS_KEY, JSON.stringify(list));
  } catch {
    // ignore
  }
  return list;
}

export function isRoomBookmarked(roomId: string): boolean {
  return getSavedRooms().some(r => r.id === roomId);
}

