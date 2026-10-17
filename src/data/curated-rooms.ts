import { CuratedRoomConfig } from '../types/index';
import { ostalgieStations, ostalgieTracks } from './store';

/**
 * Registry of built-in static curated rooms.
 * Add new permanent curated rooms here (either preloaded or fetched from `/curated/<id>.json`).
 * Each entry automatically gets:
 *  - A `/r/<id>` route with instant static dataset loading + live Durable Object WebSocket presence
 *  - A featured card on the Waystation landing modal
 *  - Server-side read-only protection
 */
export const CURATED_ROOMS: CuratedRoomConfig[] = [
  {
    id: 'ostalgie',
    name: 'OSTALGIE',
    tag: 'Featured Archive',
    subtitle: `A Music Archive`,
    loadDataset: async () => ({
      stations: ostalgieStations,
      tracks: ostalgieTracks
    })
  }
];

export const CURATED_ROOM_IDS = new Set<string>(CURATED_ROOMS.map(r => r.id.toLowerCase()));

export function getCuratedRoomConfig(roomId: string): CuratedRoomConfig | undefined {
  const norm = roomId.trim().toLowerCase();
  return CURATED_ROOMS.find(r => r.id.toLowerCase() === norm);
}

export function sanitizeRoomSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^\/?(r\/)?/i, '')
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

