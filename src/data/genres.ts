import { Track } from '../types/index';

export const TOP_LEVEL_GENRES = [
  'Pop',
  'Rock',
  'Disco',
  'Jazz',
  'Funk',
  'Hip-hop',
  'Folk',
  'Electronic',
] as const;

export type TopLevelGenre = typeof TOP_LEVEL_GENRES[number];

/**
 * Mapping from subgenres to their respective top-level parent genres.
 * Whenever a subgenre is assigned to a track, its top-level parent genre is also included.
 */
export const SUBGENRE_PARENTS: Record<string, TopLevelGenre> = {
  'Citypop': 'Pop',
  'Cantopop': 'Pop',
  'Synth-pop': 'Electronic',
  'Eurodance': 'Electronic',
  'Psychedelic': 'Rock',
  'New Wave': 'Rock',
  'Post-Punk': 'Rock',
  'Punk': 'Rock',
  'Chanson': 'Folk',
  'Soul': 'Funk',
};

/**
 * Resolves up to 3 genres ensuring that any included subgenre always includes its parent top-level genre.
 */
export function resolveGenreHierarchy(genres: string[]): string[] {
  const result: string[] = [];

  for (const g of genres) {
    if (result.length >= 3) break;
    if (result.includes(g)) continue;

    const parent = SUBGENRE_PARENTS[g];
    if (parent) {
      const parentAlready = result.includes(parent);
      const slotsNeeded = parentAlready ? 1 : 2;
      if (result.length + slotsNeeded <= 3) {
        result.push(g);
        if (!parentAlready) {
          result.push(parent);
        }
      }
    } else {
      if (result.length + 1 <= 3) {
        result.push(g);
      }
    }
  }

  return result.slice(0, 3);
}

/**
 * Returns precomputed genres for a track (up to 3).
 * Track genres are precomputed in the catalog data.
 */
export function getTrackGenres(track: Track): string[] {
  return track.genres || [];
}

/**
 * Checks if a track matches a given genre.
 */
export function trackHasGenre(track: Track, genreName: string): boolean {
  const target = genreName.trim().toLowerCase();
  const trackGenres = track.genres || [];
  return trackGenres.some(g => g.toLowerCase() === target);
}
