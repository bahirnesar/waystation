import type { Env } from './room-do';
import type { ImportSource } from '../src/types/index';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Range, Authorization',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges'
};

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const BANDCAMP_HEADERS = {
  'User-Agent': 'curl/8.7.1',
  'Accept': '*/*'
};

export interface NormalizedImportTrack {
  id: string;
  title: string;
  artist: string;
  year: number;
  duration?: number;
  artworkUrl?: string;
  thumbnail?: string;
  importSource: ImportSource;
  ytId?: string;
  ytUrl?: string;
  scUrl?: string;
  bcUrl?: string;
  tralbumId?: string;
  tralbumType?: 't' | 'a';
  trackUrl?: string;
  spotifyUrl?: string;
  appleMusicUrl?: string;
}

export interface ImportResponsePayload {
  ok: boolean;
  source?: ImportSource;
  playlistTitle?: string;
  tracks?: NormalizedImportTrack[];
  error?: string;
}

function parseDurationSeconds(str?: string | number): number | undefined {
  if (typeof str === 'number') {
    return Math.round(str > 10000 ? str / 1000 : str);
  }
  if (!str) return undefined;
  const s = String(str).trim();
  // Format MM:SS or HH:MM:SS
  const parts = s.split(':').map(Number);
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  const num = Number(s);
  if (!isNaN(num)) return Math.round(num > 10000 ? num / 1000 : num);
  return undefined;
}

function cleanTitleAndArtist(rawTitle: string, defaultArtist = 'Unknown Artist'): { title: string; artist: string } {
  let title = rawTitle.trim();
  let artist = defaultArtist.trim();

  // Strip common YouTube fluff: (Official Video), [Official Audio], (Lyrics), etc.
  title = title
    .replace(/(\(|\[)(Official (Music )?Video|Official Audio|Lyric Video|Audio|Lyrics|Visualizer|HD|4K Remaster)(\)|\])/gi, '')
    .trim();

  // Check for "Artist - Title" pattern
  const sepIdx = title.indexOf(' - ');
  if (sepIdx > 0) {
    artist = title.slice(0, sepIdx).trim();
    title = title.slice(sepIdx + 3).trim();
  }

  // Remove quotes around title
  title = title.replace(/^["'“]+|["'”]+$/g, '').trim();

  return {
    title: title || rawTitle,
    artist: artist || defaultArtist
  };
}

/**
 * YouTube parser: handles playlists and single videos
 */
async function importYouTube(targetUrl: string): Promise<ImportResponsePayload> {
  const parsed = new URL(targetUrl);
  const listId = parsed.searchParams.get('list');
  let videoId = parsed.searchParams.get('v');

  if (!videoId && parsed.hostname === 'youtu.be') {
    videoId = parsed.pathname.slice(1).split('?')[0];
  }

  const currentYear = new Date().getFullYear();

  // 1. YouTube Playlist Import
  if (listId) {
    try {
      const browseRes = await fetch('https://www.youtube.com/youtubei/v1/browse?prettyPrint=false', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': USER_AGENT
        },
        body: JSON.stringify({
          context: {
            client: {
              clientName: 'WEB',
              clientVersion: '2.20240101.00.00',
              hl: 'en',
              gl: 'US'
            }
          },
          browseId: `VL${listId}`
        })
      });

      if (browseRes.ok) {
        const data = (await browseRes.json()) as any;
        const pageTitle =
          data.header?.pageHeaderRenderer?.pageTitle ||
          data.metadata?.playlistMetadataRenderer?.title ||
          data.header?.playlistHeaderRenderer?.title?.runs?.[0]?.text ||
          data.header?.playlistHeaderRenderer?.title?.simpleText ||
          'YouTube Playlist';

        const rawItems =
          data.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]
            ?.itemSectionRenderer?.contents ||
          data.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]
            ?.playlistVideoListRenderer?.contents ||
          [];

        const tracks: NormalizedImportTrack[] = [];

        for (const item of rawItems) {
          // Modern YouTube Web lockupViewModel
          if (item.lockupViewModel) {
            const vm = item.lockupViewModel;
            const vid = vm.contentId;
            if (!vid) continue;
            const rawT = vm.metadata?.lockupMetadataViewModel?.title?.content || 'Unknown Title';
            const channel =
              vm.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts?.[0]
                ?.text?.content || 'YouTube Artist';
            const { title, artist } = cleanTitleAndArtist(rawT, channel);

            const thumbSources = vm.contentImage?.thumbnailViewModel?.image?.sources;
            const thumb = thumbSources && thumbSources.length ? thumbSources[thumbSources.length - 1].url : `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;

            // Parse duration from accessibility label
            const a11yLabel = vm.rendererContext?.accessibilityContext?.label || '';
            const matchMins = a11yLabel.match(/(\d+)\s*minute/);
            const matchSecs = a11yLabel.match(/(\d+)\s*second/);
            let duration: number | undefined;
            if (matchMins || matchSecs) {
              const m = matchMins ? parseInt(matchMins[1], 10) : 0;
              const s = matchSecs ? parseInt(matchSecs[1], 10) : 0;
              duration = m * 60 + s;
            }

            tracks.push({
              id: `imp-yt-${vid}`,
              title,
              artist,
              year: currentYear,
              duration,
              artworkUrl: thumb,
              thumbnail: thumb,
              importSource: 'youtube',
              ytId: vid,
              ytUrl: `https://www.youtube.com/watch?v=${vid}`
            });
          } else if (item.playlistVideoRenderer) {
            // Classic YouTube playlistVideoRenderer
            const pvr = item.playlistVideoRenderer;
            const vid = pvr.videoId;
            if (!vid) continue;
            const rawT = pvr.title?.runs?.[0]?.text || pvr.title?.simpleText || 'Unknown Title';
            const channel = pvr.shortBylineText?.runs?.[0]?.text || 'YouTube Artist';
            const { title, artist } = cleanTitleAndArtist(rawT, channel);
            const thumb = pvr.thumbnail?.thumbnails?.slice(-1)[0]?.url || `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
            const duration = pvr.lengthSeconds ? parseInt(pvr.lengthSeconds, 10) : undefined;

            tracks.push({
              id: `imp-yt-${vid}`,
              title,
              artist,
              year: currentYear,
              duration,
              artworkUrl: thumb,
              thumbnail: thumb,
              importSource: 'youtube',
              ytId: vid,
              ytUrl: `https://www.youtube.com/watch?v=${vid}`
            });
          }
        }

        if (tracks.length > 0) {
          return {
            ok: true,
            source: 'youtube',
            playlistTitle: pageTitle,
            tracks
          };
        }
      }
    } catch (e: any) {
      console.warn('YouTube playlist browse error:', e?.message);
    }
  }

  // 2. Single YouTube Video fallback (via oEmbed)
  if (videoId) {
    try {
      const oEmbedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`;
      const res = await fetch(oEmbedUrl);
      if (res.ok) {
        const data = (await res.json()) as any;
        const { title, artist } = cleanTitleAndArtist(data.title || 'Unknown Title', data.author_name || 'YouTube Artist');
        const thumb = data.thumbnail_url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

        return {
          ok: true,
          source: 'youtube',
          playlistTitle: title,
          tracks: [
            {
              id: `imp-yt-${videoId}`,
              title,
              artist,
              year: currentYear,
              artworkUrl: thumb,
              thumbnail: thumb,
              importSource: 'youtube',
              ytId: videoId,
              ytUrl: `https://www.youtube.com/watch?v=${videoId}`
            }
          ]
        };
      }
    } catch (e: any) {
      console.warn('YouTube oEmbed error:', e?.message);
    }
  }

  return {
    ok: false,
    error: 'Could not extract YouTube playlist or video metadata'
  };
}

/**
 * Spotify parser: extracts tracks from playlists, albums, and tracks
 */
async function importSpotify(targetUrl: string): Promise<ImportResponsePayload> {
  const parsed = new URL(targetUrl);
  // Match /playlist/:id, /album/:id, /track/:id
  const match = parsed.pathname.match(/\/(playlist|album|track)\/([a-zA-Z0-9]+)/);
  if (!match) {
    return { ok: false, error: 'Invalid Spotify URL format. Expected playlist, album, or track URL.' };
  }

  const kind = match[1];
  const spotifyId = match[2];
  const embedUrl = `https://open.spotify.com/embed/${kind}/${spotifyId}`;

  try {
    const res = await fetch(embedUrl, {
      headers: { 'User-Agent': USER_AGENT }
    });
    if (!res.ok) {
      return { ok: false, error: `Spotify embed request failed (${res.status})` };
    }

    const html = await res.text();
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!nextDataMatch) {
      return { ok: false, error: 'Could not parse Spotify embed data' };
    }

    const nextData = JSON.parse(nextDataMatch[1]);
    const entity = nextData.props?.pageProps?.state?.data?.entity;
    if (!entity) {
      return { ok: false, error: 'Spotify entity not found in page payload' };
    }

    const playlistTitle = entity.name || entity.title || 'Spotify Playlist';
    const releaseYear = entity.releaseDate?.isoString ? new Date(entity.releaseDate.isoString).getFullYear() : new Date().getFullYear();
    const coverArt = entity.coverArt?.sources?.[0]?.url || undefined;

    const tracks: NormalizedImportTrack[] = [];

    if (Array.isArray(entity.trackList) && entity.trackList.length > 0) {
      for (const t of entity.trackList) {
        const trackUri = t.uri || '';
        const trackId = trackUri.replace('spotify:track:', '') || t.id || Math.random().toString(36).slice(2, 10);
        const title = t.title || t.name || 'Unknown Title';
        const artist = t.subtitle || (Array.isArray(t.artists) ? t.artists.map((a: any) => a.name).join(', ') : 'Unknown Artist');
        const duration = t.duration ? Math.round(t.duration / 1000) : undefined;
        const spUrl = `https://open.spotify.com/track/${trackId}`;

        tracks.push({
          id: `imp-sp-${trackId}`,
          title,
          artist,
          year: releaseYear,
          duration,
          artworkUrl: coverArt,
          thumbnail: coverArt,
          importSource: 'spotify',
          spotifyUrl: spUrl
        });
      }
    } else {
      // Single track
      const title = entity.name || entity.title || 'Unknown Title';
      const artist = Array.isArray(entity.artists) ? entity.artists.map((a: any) => a.name).join(', ') : (entity.subtitle || 'Unknown Artist');
      const duration = entity.duration ? Math.round(entity.duration / 1000) : undefined;
      const spUrl = `https://open.spotify.com/track/${spotifyId}`;

      tracks.push({
        id: `imp-sp-${spotifyId}`,
        title,
        artist,
        year: releaseYear,
        duration,
        artworkUrl: coverArt,
        thumbnail: coverArt,
        importSource: 'spotify',
        spotifyUrl: spUrl
      });
    }

    return {
      ok: true,
      source: 'spotify',
      playlistTitle,
      tracks
    };
  } catch (e: any) {
    return { ok: false, error: `Spotify import error: ${e.message}` };
  }
}

/**
 * Bandcamp parser: extracts albums and tracks via data-tralbum and JSON-LD
 */
async function importBandcamp(targetUrl: string): Promise<ImportResponsePayload> {
  try {
    const res = await fetch(targetUrl, {
      headers: BANDCAMP_HEADERS
    });
    if (!res.ok) {
      return { ok: false, error: `Bandcamp page request failed (${res.status})` };
    }

    const html = await res.text();
    const parsedUrl = new URL(targetUrl);
    const host = parsedUrl.hostname;

    let tralbumData: any = null;
    const tralbumMatch = html.match(/data-tralbum="([^"]+)"/);
    if (tralbumMatch) {
      try {
        const raw = tralbumMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
        tralbumData = JSON.parse(raw);
      } catch (e) {
        console.warn('Failed to parse data-tralbum:', e);
      }
    }

    if (!tralbumData) {
      const scriptMatch = html.match(/var TralbumData = ({[\s\S]*?});/);
      if (scriptMatch) {
        try {
          tralbumData = JSON.parse(scriptMatch[1]);
        } catch (e) {
          // ignore
        }
      }
    }

    if (!tralbumData) {
      return { ok: false, error: 'Could not extract Bandcamp album or track data' };
    }

    const artist = tralbumData.artist || 'Bandcamp Artist';
    const albumTitle = tralbumData.current?.title || tralbumData.album_title || 'Bandcamp Album';
    const releaseDate = tralbumData.current?.release_date;
    const year = releaseDate ? new Date(releaseDate).getFullYear() : new Date().getFullYear();
    const artId = tralbumData.art_id;
    const artworkUrl = artId ? `https://f4.bcbits.com/img/a${artId}_10.jpg` : undefined;

    const tracks: NormalizedImportTrack[] = [];
    const trackinfo = Array.isArray(tralbumData.trackinfo) ? tralbumData.trackinfo : [];

    if (trackinfo.length > 0) {
      for (const t of trackinfo) {
        const trackTitle = t.title || 'Unknown Title';
        const trackArtist = t.artist || artist;
        const trackId = String(t.id || t.track_id || Math.random().toString(36).slice(2, 10));
        const duration = t.duration ? Math.round(t.duration) : undefined;
        let trackUrl = targetUrl;
        if (t.title_link) {
          trackUrl = t.title_link.startsWith('http') ? t.title_link : `https://${host}${t.title_link}`;
        }

        tracks.push({
          id: `imp-bc-${trackId}`,
          title: trackTitle,
          artist: trackArtist,
          year,
          duration,
          artworkUrl,
          thumbnail: artworkUrl,
          importSource: 'bandcamp',
          bcUrl: trackUrl,
          trackUrl,
          tralbumId: String(tralbumData.id || trackId),
          tralbumType: (tralbumData.current?.type === 'track' ? 't' : 'a')
        });
      }
    } else {
      // Single track fallback
      tracks.push({
        id: `imp-bc-${tralbumData.id || Math.random().toString(36).slice(2, 10)}`,
        title: albumTitle,
        artist,
        year,
        artworkUrl,
        thumbnail: artworkUrl,
        importSource: 'bandcamp',
        bcUrl: targetUrl,
        trackUrl: targetUrl,
        tralbumId: String(tralbumData.id || ''),
        tralbumType: 't'
      });
    }

    return {
      ok: true,
      source: 'bandcamp',
      playlistTitle: albumTitle,
      tracks
    };
  } catch (e: any) {
    return { ok: false, error: `Bandcamp import error: ${e.message}` };
  }
}

/**
 * SoundCloud parser: handles sets/playlists and single tracks via hydration and oEmbed
 */
async function importSoundCloud(targetUrl: string): Promise<ImportResponsePayload> {
  try {
    let oEmbedData: any = null;
    try {
      const oEmbedRes = await fetch(
        `https://soundcloud.com/oembed?url=${encodeURIComponent(targetUrl)}&format=json`
      );
      if (oEmbedRes.ok) {
        oEmbedData = await oEmbedRes.json();
      }
    } catch {
      // ignore
    }

    const pageRes = await fetch(targetUrl, {
      headers: { 'User-Agent': USER_AGENT }
    });

    const currentYear = new Date().getFullYear();

    if (pageRes.ok) {
      const html = await pageRes.text();
      const hydrationMatch = html.match(/window\.__sc_hydration\s*=\s*(\[[\s\S]*?\]);\s*<\/script>/);

      if (hydrationMatch) {
        try {
          const arr = JSON.parse(hydrationMatch[1]);
          const playlistItem = arr.find((x: any) => x.hydratable === 'playlist' || (x.data && Array.isArray(x.data.tracks)));

          if (playlistItem?.data?.tracks && playlistItem.data.tracks.length > 0) {
            const playlistTitle = playlistItem.data.title || oEmbedData?.title || 'SoundCloud Playlist';
            const defaultArtist = playlistItem.data.user?.username || oEmbedData?.author_name || 'SoundCloud Artist';
            const tracks: NormalizedImportTrack[] = [];

            for (const t of playlistItem.data.tracks) {
              const rawT = t.title || 'Unknown Title';
              const channel = t.user?.username || defaultArtist;
              const { title, artist } = cleanTitleAndArtist(rawT, channel);
              const duration = t.duration ? Math.round(t.duration / 1000) : undefined;
              const scUrl = t.permalink_url || targetUrl;
              const artworkUrl = t.artwork_url || playlistItem.data.artwork_url || oEmbedData?.thumbnail_url || undefined;
              const trackId = String(t.id || Math.random().toString(36).slice(2, 10));

              tracks.push({
                id: `imp-sc-${trackId}`,
                title,
                artist,
                year: currentYear,
                duration,
                artworkUrl,
                thumbnail: artworkUrl,
                importSource: 'soundcloud',
                scUrl
              });
            }

            return {
              ok: true,
              source: 'soundcloud',
              playlistTitle,
              tracks
            };
          }
        } catch (e) {
          console.warn('Failed to parse SoundCloud hydration:', e);
        }
      }
    }

    // Single track fallback via oEmbed
    if (oEmbedData) {
      const rawTitle = oEmbedData.title || 'Unknown Track';
      const channel = oEmbedData.author_name || 'SoundCloud Artist';
      const { title, artist } = cleanTitleAndArtist(rawTitle, channel);
      const artworkUrl = oEmbedData.thumbnail_url || undefined;

      return {
        ok: true,
        source: 'soundcloud',
        playlistTitle: title,
        tracks: [
          {
            id: `imp-sc-${Math.random().toString(36).slice(2, 10)}`,
            title,
            artist,
            year: currentYear,
            artworkUrl,
            thumbnail: artworkUrl,
            importSource: 'soundcloud',
            scUrl: targetUrl
          }
        ]
      };
    }

    return { ok: false, error: 'Could not extract SoundCloud track or playlist data' };
  } catch (e: any) {
    return { ok: false, error: `SoundCloud import error: ${e.message}` };
  }
}

/**
 * Apple Music parser: handles albums, playlists, and individual songs
 */
async function importAppleMusic(targetUrl: string): Promise<ImportResponsePayload> {
  try {
    let oEmbedData: any = null;
    try {
      const oEmbedRes = await fetch(
        `https://music.apple.com/api/oembed?url=${encodeURIComponent(targetUrl)}`
      );
      if (oEmbedRes.ok) {
        oEmbedData = await oEmbedRes.json();
      }
    } catch {
      // ignore
    }

    const currentYear = new Date().getFullYear();
    const pageRes = await fetch(targetUrl, {
      headers: { 'User-Agent': USER_AGENT }
    });

    if (pageRes.ok) {
      const html = await pageRes.text();
      const serverDataMatch = html.match(
        /<script type="application\/json" id="serialized-server-data">([\s\S]*?)<\/script>/
      );

      if (serverDataMatch) {
        try {
          const root = JSON.parse(serverDataMatch[1]);
          const sections = root.data?.[0]?.data?.sections || [];
          const trackSection = sections.find(
            (s: any) => s.id && (s.id.includes('track-list') || s.id.includes('tracks'))
          );

          if (trackSection && Array.isArray(trackSection.items) && trackSection.items.length > 0) {
            const playlistTitle = oEmbedData?.title || 'Apple Music Album';
            const defaultArtist = oEmbedData?.author_name || 'Apple Music Artist';
            const tracks: NormalizedImportTrack[] = [];

            for (const item of trackSection.items) {
              const title = item.title || 'Unknown Title';
              const artist = item.subtitleLinks?.[0]?.title || item.artistName || defaultArtist;
              const duration = parseDurationSeconds(item.duration);
              const songUrl = item.contentDescriptor?.url || targetUrl;
              const trackId = String(
                item.contentDescriptor?.identifiers?.storeAdamID ||
                  item.id ||
                  Math.random().toString(36).slice(2, 10)
              );
              const artworkUrl = oEmbedData?.thumbnail_url || undefined;

              tracks.push({
                id: `imp-am-${trackId}`,
                title,
                artist,
                year: currentYear,
                duration,
                artworkUrl,
                thumbnail: artworkUrl,
                importSource: 'apple-music',
                appleMusicUrl: songUrl
              });
            }

            return {
              ok: true,
              source: 'apple-music',
              playlistTitle,
              tracks
            };
          }
        } catch (e) {
          console.warn('Failed to parse Apple Music serialized data:', e);
        }
      }
    }

    // Single track or album fallback via oEmbed
    if (oEmbedData) {
      const title = oEmbedData.title || 'Unknown Track';
      const artist = oEmbedData.author_name || 'Apple Music Artist';
      const artworkUrl = oEmbedData.thumbnail_url || undefined;

      return {
        ok: true,
        source: 'apple-music',
        playlistTitle: title,
        tracks: [
          {
            id: `imp-am-${Math.random().toString(36).slice(2, 10)}`,
            title,
            artist,
            year: currentYear,
            artworkUrl,
            thumbnail: artworkUrl,
            importSource: 'apple-music',
            appleMusicUrl: targetUrl
          }
        ]
      };
    }

    return { ok: false, error: 'Could not extract Apple Music metadata' };
  } catch (e: any) {
    return { ok: false, error: `Apple Music import error: ${e.message}` };
  }
}

/**
 * Main importer request handler:
 * GET /api/import?url=...
 */
export async function handleImport(request: Request, _env?: Env): Promise<Response> {
  const url = new URL(request.url);
  const targetUrl = url.searchParams.get('url')?.trim();

  if (!targetUrl) {
    return Response.json(
      { ok: false, error: 'url parameter required' },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return Response.json(
      { ok: false, error: 'Invalid URL format' },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const host = parsed.hostname.toLowerCase();

  try {
    let result: ImportResponsePayload;

    if (host.includes('youtube.com') || host.includes('youtu.be')) {
      result = await importYouTube(targetUrl);
    } else if (host.includes('spotify.com')) {
      result = await importSpotify(targetUrl);
    } else if (host.includes('bandcamp.com')) {
      result = await importBandcamp(targetUrl);
    } else if (host.includes('soundcloud.com')) {
      result = await importSoundCloud(targetUrl);
    } else if (host.includes('apple.com')) {
      result = await importAppleMusic(targetUrl);
    } else {
      return Response.json(
        {
          ok: false,
          error: `Unsupported platform (${host}). Supported providers: YouTube, Spotify, SoundCloud, Bandcamp, Apple Music.`
        },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const status = result.ok ? 200 : 400;
    return Response.json(result, { status, headers: CORS_HEADERS });
  } catch (err: any) {
    console.error('Import error:', err);
    return Response.json(
      { ok: false, error: `Failed to import: ${err.message}` },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
