import { Env, WaystationRoom } from './room-do';
import {
  handleBandcampStream,
  handleOptions,
  handleStreamPipe,
  handleYtResolve
} from './streams';

export { WaystationRoom };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight for API requests
    if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
      return handleOptions();
    }

    // Health check endpoint
    if (url.pathname === '/api/health') {
      return Response.json({
        ok: true,
        service: 'waystation-worker',
        timestamp: Date.now()
      });
    }

    // Stream proxy & audio resolution endpoints
    if (url.pathname === '/api/bc-stream') {
      return handleBandcampStream(request);
    }

    if (url.pathname === '/api/stream-pipe') {
      return handleStreamPipe(request);
    }

    if (url.pathname === '/api/yt-resolve') {
      return handleYtResolve(request, env);
    }

    // WebSocket upgrade for room presence: /ws/room/:roomId
    const wsMatch = url.pathname.match(/^\/ws\/room\/([^/]+)$/);
    if (wsMatch) {
      const roomId = decodeURIComponent(wsMatch[1]).toLowerCase();
      const id = env.ROOMS.idFromName(roomId);
      const stub = env.ROOMS.get(id);
      const headers = new Headers(request.headers);
      headers.set('X-Room-Id', roomId);
      return stub.fetch(new Request(request.url, { method: request.method, headers }));
    }

    // Room REST API: /api/rooms/:roomId/*
    const roomApiMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)(\/.*)?$/);
    if (roomApiMatch) {
      const roomId = decodeURIComponent(roomApiMatch[1]).toLowerCase();
      const id = env.ROOMS.idFromName(roomId);
      const stub = env.ROOMS.get(id);
      const headers = new Headers(request.headers);
      headers.set('X-Room-Id', roomId);
      return stub.fetch(
        new Request(request.url, {
          method: request.method,
          headers,
          body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined
        })
      );
    }

    // Fallback to static assets (SPA)
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  }
};
