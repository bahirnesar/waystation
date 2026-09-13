import { Track, Cluster, TrackRecommendations } from '../types/index';
import { standardizeCountry, getDisplayCountry } from './store';

export function getTrackRecommendations(
  track: Track,
  allTracks: Track[],
  allClusters: Cluster[] = []
): TrackRecommendations {
  const c = allClusters ? allClusters.find(cl => cl.id === track.clusterId) || null : null;
  const canonicalCountry = standardizeCountry(track.country || (c ? c.country : track.city));
  const countryName = getDisplayCountry(track) || canonicalCountry;

  // Other songs from the same artist if available
  const artistKey = (track.artist || '').trim().toLowerCase();
  const seenArtistIds = new Set<string>([track.id]);
  const artistTracks: Track[] = [];
  if (artistKey) {
    for (const t of allTracks) {
      if ((t.artist || '').trim().toLowerCase() === artistKey && !seenArtistIds.has(t.id)) {
        seenArtistIds.add(t.id);
        artistTracks.push(t);
      }
    }
  }

  // Same location tracks (excluding current track and same-artist tracks)
  const isSameLocation = (t: Track): boolean => {
    if (t.country && canonicalCountry && standardizeCountry(t.country) === canonicalCountry) return true;
    if (c && t.clusterId && t.clusterId === c.id) return true;
    if (track.clusterId && t.clusterId && t.clusterId === track.clusterId) return true;
    return false;
  };

  const seenRecoIds = new Set<string>([track.id, ...artistTracks.map(t => t.id)]);
  const locationTracks: Track[] = [];
  for (const t of allTracks) {
    if (!seenRecoIds.has(t.id) && isSameLocation(t)) {
      seenRecoIds.add(t.id);
      locationTracks.push(t);
    }
  }

  // Other songs of the same genre from the same location
  const trackGenre = (track.genre || '').trim().toLowerCase();
  const genreTracks: Track[] = trackGenre
    ? locationTracks.filter(t => (t.genre || '').trim().toLowerCase() === trackGenre)
    : [];

  return {
    countryName,
    artistTracks,
    locationTracks,
    genreTracks
  };
}
