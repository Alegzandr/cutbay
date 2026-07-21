/**
 * Cross-origin isolation for the editor, from a service worker.
 *
 * ffmpeg.wasm's multi-threaded core runs on SharedArrayBuffer, which a page only
 * gets when it is crossOriginIsolated - and that needs two response headers the
 * host cannot send (the site is static; the CSP already ships as a meta tag for
 * the same reason). A service worker sits between the page and the cache, so it
 * can add them to its own origin's responses.
 *
 * Scoped to /app/ on purpose: the landing pages have nothing to gain from
 * isolation, and COEP would make any cross-origin embed they later grow fail.
 *
 * Isolation is decided when the document is created, so the very first visit is
 * never isolated - this worker only takes effect from the next navigation. That
 * is why registration is silent and never forces a reload: a transcode started
 * today runs single-threaded, and the tab the user opens tomorrow does not.
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const request = event.request;
  // Range requests are served from the network untouched: rewriting a 206 into
  // a fresh Response drops the byte-range semantics media elements rely on.
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        // An opaque response has no readable headers or body to copy, and
        // handing one back rewritten would blank it.
        if (response.status === 0) return response;

        const headers = new Headers(response.headers);
        headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
        headers.set('Cross-Origin-Opener-Policy', 'same-origin');
        // Everything this app loads is same-origin; without CORP those same
        // subresources would be blocked by the COEP we just turned on.
        headers.set('Cross-Origin-Resource-Policy', 'same-origin');

        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      })
      // A failed fetch is the network's business, not this worker's: let the
      // page see the real error rather than one about isolation.
      .catch((err) => Promise.reject(err)),
  );
});
