import type { Env } from './room-do';
import type { Track } from '../src/types/index';

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

const ytMemoryCache = new Map<string, string>();

export function handleOptions(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * GET /api/bc-stream?url=...&track_id=...&album_id=...
 * Resolves a Bandcamp track, album or URL into a playable bcbits.com MP3 stream URL.
 */
export async function handleBandcampStream(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const targetUrl = url.searchParams.get('url');
  const trackId = url.searchParams.get('track_id');
  const albumId = url.searchParams.get('album_id');

  if (!targetUrl && !trackId && !albumId) {
    return Response.json(
      { error: 'url, track_id, or album_id required' },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  try {
    // 1. If track_id is provided, try direct Bandcamp embedded track player
    if (trackId) {
      try {
        const embedRes = await fetch(
          `https://bandcamp.com/EmbeddedPlayer/track=${encodeURIComponent(trackId)}`,
          { headers: BANDCAMP_HEADERS }
        );
        const html = await embedRes.text();
        const m = html.match(/data-player-data="([^"]+)"/);
        if (m) {
          const raw = m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
          const data = JSON.parse(raw);
          const target =
            (data.tracks &&
              data.tracks.find(
                (t: any) =>
                  String(t.track_id) === String(trackId) ||
                  String(t.id) === String(trackId)
              )) ||
            (data.tracks && data.tracks[0]);
          if (target?.file?.['mp3-128']) {
            const streamUrl = target.file['mp3-128'].replace(/&amp;/g, '&');
            return Response.json({ streamUrl }, { headers: CORS_HEADERS });
          }
        }
      } catch (e: any) {
        console.warn('Track embed resolution fallback:', e?.message);
      }
    }

    // 2. If album_id is provided, try direct Bandcamp embedded album player
    if (albumId) {
      try {
        const embedRes = await fetch(
          `https://bandcamp.com/EmbeddedPlayer/album=${encodeURIComponent(albumId)}`,
          { headers: BANDCAMP_HEADERS }
        );
        const html = await embedRes.text();
        const m = html.match(/data-player-data="([^"]+)"/);
        if (m) {
          const raw = m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
          const data = JSON.parse(raw);
          let target = null;
          if (trackId && data.tracks) {
            target = data.tracks.find(
              (t: any) =>
                String(t.track_id) === String(trackId) ||
                String(t.id) === String(trackId)
            );
          }
          if (!target && data.tracks) target = data.tracks[0];
          if (target?.file?.['mp3-128']) {
            const streamUrl = target.file['mp3-128'].replace(/&amp;/g, '&');
            return Response.json({ streamUrl }, { headers: CORS_HEADERS });
          }
        }
      } catch (e: any) {
        console.warn('Album embed resolution fallback:', e?.message);
      }
    }

    // 3. If url is provided, fetch the Bandcamp page and parse data-tralbum or regex
    if (targetUrl) {
      try {
        const response = await fetch(targetUrl, {
          headers: BANDCAMP_HEADERS
        });
        const html = await response.text();

        // 3a. Parse data-tralbum
        const tralbumMatch = html.match(/data-tralbum="([^"]+)"/);
        if (tralbumMatch) {
          const raw = tralbumMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
          const data = JSON.parse(raw);
          let target = null;
          if (trackId && data.trackinfo) {
            target = data.trackinfo.find(
              (t: any) =>
                String(t.track_id) === String(trackId) ||
                String(t.id) === String(trackId)
            );
          }
          if (!target && data.trackinfo) target = data.trackinfo[0];
          if (target?.file?.['mp3-128']) {
            const streamUrl = target.file['mp3-128'].replace(/&amp;/g, '&');
            return Response.json({ streamUrl }, { headers: CORS_HEADERS });
          }
        }

        // 3b. Regex fallback
        const tokenMatch = html.match(
          /https?:\/\/[a-z0-9\.\-]+\.bcbits\.com\/stream\/[a-zA-Z0-9_\-\.\/]+\?(?:[^"'\s&]|&amp;)+/
        );
        if (tokenMatch) {
          return Response.json(
            { streamUrl: tokenMatch[0].replace(/&amp;/g, '&') },
            { headers: CORS_HEADERS }
          );
        }
      } catch (e: any) {
        console.warn('Bandcamp URL resolution fallback:', e?.message);
      }
    }

    return Response.json(
      { error: 'Stream URL not resolved', streamUrl: null },
      { status: 404, headers: CORS_HEADERS }
    );
  } catch (err: any) {
    console.error('Bandcamp stream error:', err);
    return Response.json(
      { error: 'Failed to extract stream', streamUrl: null },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

/**
 * GET /api/stream-pipe?url=...
 * Proxies audio streams with Range header pass-through and CORS headers.
 */
export async function handleStreamPipe(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const targetUrl = url.searchParams.get('url');

  if (!targetUrl) {
    return new Response('url parameter required', {
      status: 400,
      headers: CORS_HEADERS
    });
  }

  try {
    const range = request.headers.get('range');
    const upstreamHeaders: Record<string, string> = {
      'User-Agent': USER_AGENT
    };
    if (range) {
      upstreamHeaders['Range'] = range;
    }

    const audioRes = await fetch(targetUrl, {
      headers: upstreamHeaders
    });

    const responseHeaders = new Headers(CORS_HEADERS);
    for (const [key, val] of audioRes.headers.entries()) {
      const lower = key.toLowerCase();
      if (
        ['content-type', 'content-length', 'accept-ranges', 'content-range'].includes(
          lower
        )
      ) {
        responseHeaders.set(key, val);
      }
    }

    return new Response(audioRes.body, {
      status: audioRes.status,
      headers: responseHeaders
    });
  } catch (err: any) {
    console.error('Stream pipe error:', err);
    return new Response('Failed to stream audio', {
      status: 500,
      headers: CORS_HEADERS
    });
  }
}

/**
 * Resolve YouTube Video ID via InnerTube Search with web scrape fallback.
 */
async function resolveYouTubeVideoId(query: string): Promise<string | null> {
  // 1. Try YouTube InnerTube Search API (fast, structured JSON)
  try {
    const innerTubeRes = await fetch(
      'https://www.youtube.com/youtubei/v1/search?prettyPrint=false',
      {
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
          query
        })
      }
    );

    if (innerTubeRes.ok) {
      const text = await innerTubeRes.text();
      const match = text.match(/"videoId":\s*"([a-zA-Z0-9_-]{11})"/);
      if (match && match[1]) {
        return match[1];
      }
    }
  } catch (err: any) {
    console.warn('InnerTube search error:', err?.message);
  }

  // 2. Fallback: Search results scraping
  try {
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(
      query
    )}`;
    const pageRes = await fetch(searchUrl, {
      headers: { 'User-Agent': USER_AGENT }
    });
    if (pageRes.ok) {
      const html = await pageRes.text();
      const match = html.match(/"videoId":\s*"([a-zA-Z0-9_-]{11})"/);
      if (match && match[1]) {
        return match[1];
      }
    }
  } catch (err: any) {
    console.warn('YouTube search scraping error:', err?.message);
  }

  return null;
}

/**
 * GET /api/yt-resolve?q=Artist+Title[&roomId=...&trackId=...]
 * Resolves metadata-only tracks to a playable YouTube video ID and caches in the room's SQLite tracks table.
 */
export async function handleYtResolve(
  request: Request,
  env?: Env
): Promise<Response> {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();
  const roomId = url.searchParams.get('roomId')?.toLowerCase().trim();
  const trackId = url.searchParams.get('trackId')?.trim();

  if (!q) {
    return Response.json(
      { ok: false, error: 'q parameter required' },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const cacheKey = q.toLowerCase();
  let ytId = ytMemoryCache.get(cacheKey) || null;

  if (!ytId) {
    ytId = await resolveYouTubeVideoId(q);
    if (ytId) {
      ytMemoryCache.set(cacheKey, ytId);
      if (ytMemoryCache.size > 500) {
        const firstKey = ytMemoryCache.keys().next().value;
        if (firstKey) ytMemoryCache.delete(firstKey);
      }
    }
  }

  if (!ytId) {
    return Response.json(
      { ok: false, ytId: null, error: 'Could not resolve YouTube ID' },
      { status: 404, headers: CORS_HEADERS }
    );
  }

  // If roomId and trackId are provided, cache ytId in the room's SQLite tracks table
  if (roomId && trackId && env?.ROOMS) {
    try {
      const id = env.ROOMS.idFromName(roomId);
      const stub = env.ROOMS.get(id);
      await stub.fetch(
        new Request(`http://internal/api/rooms/${encodeURIComponent(roomId)}/track-patch`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Room-Id': roomId
          },
          body: JSON.stringify({
            trackId,
            patch: { ytId } satisfies Partial<Track>
          })
        })
      );
    } catch (e: any) {
      console.warn('Failed to cache ytId in room SQLite:', e?.message);
    }
  }

  return Response.json({ ok: true, ytId, query: q }, { headers: CORS_HEADERS });
}
