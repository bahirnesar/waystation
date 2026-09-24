import { Track, Cluster, TrackRecommendations, GenreRecommendationSection } from '../types/index';
import { standardizeCountry, getDisplayCountry } from './store';
import { getTrackGenres, trackHasGenre } from './genres';

const RUSSIAN_REGIONS = new Set<string>([
  'Tatarstan', 'Bashkortostan', 'Dagestan', 'Chuvashia', 'Mari El',
  'Buryatia', 'Komi Republic', 'Chechnya', 'Tuva', 'Altai Republic',
  'Khakassia', 'Adygea', 'Ingushetia', 'Yakutia'
]);

const USSR_REPUBLICS = new Set<string>([
  'Russia', 'Ukraine', 'Belarus', 'Uzbekistan', 'Kazakhstan', 'Georgia',
  'Azerbaijan', 'Lithuania', 'Moldova', 'Latvia', 'Kyrgyzstan', 'Tajikistan',
  'Armenia', 'Turkmenistan', 'Estonia', 'Abkhazia', 'Karakalpakstan', 'Crimea'
]);

export interface TrackGeo {
  baseCountry: string;
  widerRegions: string[];
}

export function resolveTrackGeo(track: Track): TrackGeo {
  const c = (track.country || '').trim();
  const cl = (track.clusterId || '').trim().toLowerCase();
  const city = (track.city || '').trim();

  let baseCountry = '';
  const widerRegions = new Set<string>();

  // 1. USSR check (Republics, Autonomous Regions, and post-split entities)
  const ussrMatch = c.match(/^(.+?)\s*\(USSR\)$/i) || c.match(/^Soviet Union \((.+?)\)$/i);
  if (ussrMatch) {
    const reg = ussrMatch[1].trim();
    baseCountry = reg;
    widerRegions.add('USSR');
    if (RUSSIAN_REGIONS.has(reg)) {
      widerRegions.add('Russia');
    }
    if (reg === 'Karakalpakstan') widerRegions.add('Uzbekistan');
    if (reg === 'Abkhazia') widerRegions.add('Georgia');
  } else if (
    cl === 'russia' || cl === 'leningrad' || cl === 'sochi' || cl === 'pervouralsk' ||
    cl === 'ukraine' || cl === 'odessa' || cl === 'crimea' || cl === 'belarus' ||
    cl === 'uzbekistan' || cl === 'kazakhstan' || cl === 'georgia' || cl === 'azerbaijan' ||
    cl === 'lithuania' || cl === 'moldova' || cl === 'latvia' || cl === 'kyrgyzstan' ||
    cl === 'tajikistan' || cl === 'armenia' || cl === 'turkmenistan' || cl === 'estonia' ||
    cl === 'abkhazia' || cl === 'karakalpakstan' || cl === 'tatarstan' || cl === 'bashkortostan' ||
    cl === 'dagestan' || cl === 'chechnya' || cl === 'chuvashia' || cl === 'buryatia' ||
    cl === 'mari_el' || cl === 'yakutia' || cl === 'tuva' || cl === 'altai' ||
    cl === 'khakassia' || cl === 'komi' || cl === 'adygea' || cl === 'ingushetia' || cl === 'gagauzia'
  ) {
    widerRegions.add('USSR');
    if (cl === 'russia' || cl === 'leningrad' || cl === 'sochi' || cl === 'pervouralsk') {
      baseCountry = 'Russia';
    } else if (cl === 'ukraine' || cl === 'odessa') {
      baseCountry = 'Ukraine';
    } else if (cl === 'crimea') {
      baseCountry = 'Crimea';
      widerRegions.add('Ukraine');
    } else if (cl === 'gagauzia') {
      baseCountry = 'Gagauzia';
      widerRegions.add('Moldova');
    } else if (cl === 'karakalpakstan') {
      baseCountry = 'Karakalpakstan';
      widerRegions.add('Uzbekistan');
    } else if (cl === 'abkhazia') {
      baseCountry = 'Abkhazia';
      widerRegions.add('Georgia');
    } else {
      const formatted = cl.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      baseCountry = formatted;
      if (RUSSIAN_REGIONS.has(formatted)) {
        widerRegions.add('Russia');
      }
    }
  } else if (USSR_REPUBLICS.has(c) || RUSSIAN_REGIONS.has(c)) {
    baseCountry = c;
    widerRegions.add('USSR');
    if (RUSSIAN_REGIONS.has(c)) {
      widerRegions.add('Russia');
    }
  }

  // 2. Yugoslavia check
  const yugoMatch = c.match(/^Yugoslavia\s*\((.+?)\)$/i);
  if (yugoMatch) {
    baseCountry = yugoMatch[1].trim();
    widerRegions.add('Yugoslavia');
  } else if (c === 'Yugoslavia' || cl === 'yugoslavia') {
    widerRegions.add('Yugoslavia');
    if (/belgrade|beograd/i.test(city)) baseCountry = 'Serbia';
    else if (/zagreb/i.test(city)) baseCountry = 'Croatia';
    else if (/ljubljana/i.test(city)) baseCountry = 'Slovenia';
    else if (/sarajevo/i.test(city)) baseCountry = 'Bosnia and Herzegovina';
    else if (/skopje/i.test(city)) baseCountry = 'North Macedonia';
    else baseCountry = 'Serbia';
  } else if (c === 'Kosovo' || cl === 'kosovo') {
    baseCountry = 'Kosovo';
    widerRegions.add('Yugoslavia');
  } else if (['Croatia', 'Serbia', 'Slovenia', 'Bosnia and Herzegovina', 'North Macedonia', 'Montenegro'].includes(c)) {
    baseCountry = c;
    widerRegions.add('Yugoslavia');
  } else if (['croatia', 'serbia', 'slovenia', 'bosnia', 'macedonia'].includes(cl)) {
    widerRegions.add('Yugoslavia');
    if (cl === 'croatia') baseCountry = 'Croatia';
    else if (cl === 'serbia') baseCountry = 'Serbia';
    else if (cl === 'slovenia') baseCountry = 'Slovenia';
    else if (cl === 'bosnia') baseCountry = 'Bosnia and Herzegovina';
    else if (cl === 'macedonia') baseCountry = 'North Macedonia';
  }

  // 3. Czechoslovakia check
  if (c.includes('Czechoslovakia') || cl === 'czechoslovakia' || cl === 'slovakia' || c === 'Slovakia' || c === 'Czech Republic') {
    widerRegions.add('Czechoslovakia');
    if (c === 'Czechoslovakia (Slovakia)' || cl === 'slovakia' || c === 'Slovakia' || /bratislava/i.test(city)) {
      baseCountry = 'Slovakia';
    } else {
      baseCountry = 'Czech Republic';
    }
  }

  // 4. Germany check
  if (c.includes('German') || cl === 'east_germany' || cl === 'germany' || c === 'GDR (East Germany)') {
    widerRegions.add('Germany');
    if (c === 'GDR (East Germany)' || cl === 'east_germany' || /east berlin/i.test(city)) {
      baseCountry = 'East Germany';
    } else {
      baseCountry = 'Germany';
    }
  }

  // 5. Denmark / Faroe Islands
  if (c.includes('Faroe') || cl === 'faroe') {
    baseCountry = 'Faroe Islands';
    widerRegions.add('Denmark');
  } else if (c === 'Denmark' || cl === 'denmark') {
    baseCountry = 'Denmark';
    widerRegions.add('Denmark');
  }

  // 6. Algeria / Kabylia
  if (c.includes('Kabylia') || cl === 'kabylia') {
    baseCountry = 'Kabylia';
    widerRegions.add('Algeria');
  } else if (c === 'Algeria' || cl === 'algeria') {
    baseCountry = 'Algeria';
    widerRegions.add('Algeria');
  }

  // 7. France / Réunion
  if (c.includes('Réunion') || cl === 'reunion') {
    baseCountry = 'Réunion';
    widerRegions.add('France');
  } else if (c === 'France' || cl === 'france') {
    baseCountry = 'France';
    widerRegions.add('France');
  }

  // 8. Finland / Åland Islands
  if (c.includes('Åland') || cl === 'aland') {
    baseCountry = 'Åland Islands';
    widerRegions.add('Finland');
  } else if (c === 'Finland' || cl === 'finland') {
    baseCountry = 'Finland';
    widerRegions.add('Finland');
  }

  // 9. Moldova / Gagauzia
  if (c.includes('Gagauzia') || cl === 'gagauzia') {
    baseCountry = 'Gagauzia';
    widerRegions.add('Moldova');
    widerRegions.add('USSR');
  } else if (c.includes('Moldova') || cl === 'moldova') {
    baseCountry = 'Moldova';
    widerRegions.add('Moldova');
    widerRegions.add('USSR');
  }

  if (!baseCountry) {
    baseCountry = c || cl || 'Unknown';
  }

  return { baseCountry, widerRegions: Array.from(widerRegions) };
}

export function getTrackRecommendations(
  track: Track,
  allTracks: Track[],
  allClusters: Cluster[] = []
): TrackRecommendations {
  const c = allClusters ? allClusters.find(cl => cl.id === track.clusterId) || null : null;
  const canonicalCountry = standardizeCountry(track.country || (c ? c.country : track.city));
  const countryName = getDisplayCountry(track) || canonicalCountry;
  const trackGeo = resolveTrackGeo(track);

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

  const seenRecoIds = new Set<string>([track.id, ...artistTracks.map(t => t.id)]);
  const exactLocationTracks: Track[] = [];
  const widerRegionTracks: Track[] = [];

  for (const t of allTracks) {
    if (seenRecoIds.has(t.id)) continue;

    const tGeo = resolveTrackGeo(t);

    // Exact country / location match (including pre-split & post-split equivalents)
    const isExact = (
      (track.clusterId && t.clusterId && track.clusterId === t.clusterId) ||
      (c && t.clusterId && t.clusterId === c.id) ||
      (trackGeo.baseCountry && tGeo.baseCountry && trackGeo.baseCountry.toLowerCase() === tGeo.baseCountry.toLowerCase()) ||
      (t.country && canonicalCountry && standardizeCountry(t.country) === canonicalCountry)
    );

    if (isExact) {
      exactLocationTracks.push(t);
      continue;
    }

    // Wider region match (e.g. other Soviet republics, other Yugoslav republics, etc.)
    const sharesWiderRegion = (
      trackGeo.widerRegions.length > 0 &&
      tGeo.widerRegions.length > 0 &&
      trackGeo.widerRegions.some(r => tGeo.widerRegions.includes(r))
    );

    if (sharesWiderRegion) {
      widerRegionTracks.push(t);
    }
  }

  // Prioritize tracks that share more specific wider regions if applicable (e.g., Tatarstan shares Russia & USSR)
  if (trackGeo.widerRegions.length > 1 && widerRegionTracks.length > 1) {
    widerRegionTracks.sort((a, b) => {
      const geoA = resolveTrackGeo(a);
      const geoB = resolveTrackGeo(b);
      const matchCountA = trackGeo.widerRegions.filter(r => geoA.widerRegions.includes(r)).length;
      const matchCountB = trackGeo.widerRegions.filter(r => geoB.widerRegions.includes(r)).length;
      return matchCountB - matchCountA;
    });
  }

  // Tier 2: 'More {genre} from location' up to 10 tracks for each listed genre
  const trackGenres = getTrackGenres(track);
  const genreSections: GenreRecommendationSection[] = [];

  for (const genre of trackGenres) {
    const matchingTracks: Track[] = [];

    // Exact country/location tracks first
    for (const t of exactLocationTracks) {
      if (matchingTracks.length >= 10) break;
      if (!seenRecoIds.has(t.id) && trackHasGenre(t, genre)) {
        seenRecoIds.add(t.id);
        matchingTracks.push(t);
      }
    }

    // Wider region tracks if fewer than 10 tracks found
    if (matchingTracks.length < 10) {
      for (const t of widerRegionTracks) {
        if (matchingTracks.length >= 10) break;
        if (!seenRecoIds.has(t.id) && trackHasGenre(t, genre)) {
          seenRecoIds.add(t.id);
          matchingTracks.push(t);
        }
      }
    }

    if (matchingTracks.length > 0) {
      genreSections.push({ genre, tracks: matchingTracks });
    }
  }

  // Tier 3: If the previous recommendation options do not provide enough tracks,
  // include 'More from location' track recommendations.
  const totalPreviousTracks = artistTracks.length + genreSections.reduce((acc, s) => acc + s.tracks.length, 0);
  const locationTracks: Track[] = [];

  const MIN_RECOMMENDED_TOTAL = 10;
  if (totalPreviousTracks < MIN_RECOMMENDED_TOTAL) {
    // Fill from remaining exact location tracks
    for (const t of exactLocationTracks) {
      if (locationTracks.length >= 10) break;
      if (!seenRecoIds.has(t.id)) {
        seenRecoIds.add(t.id);
        locationTracks.push(t);
      }
    }

    // Fill from remaining wider region tracks
    if (locationTracks.length < 10) {
      for (const t of widerRegionTracks) {
        if (locationTracks.length >= 10) break;
        if (!seenRecoIds.has(t.id)) {
          seenRecoIds.add(t.id);
          locationTracks.push(t);
        }
      }
    }
  }

  return {
    countryName,
    artistTracks,
    genreSections,
    locationTracks
  };
}
