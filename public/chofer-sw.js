// Únicamente el cascarón anónimo y sus recursos estáticos. La jornada personal vive en IndexedDB.
const CACHE = "araucana-shell-chofer-v1-" + (new URL(self.location.href).searchParams.get("v") ?? "base");
const OFFLINE = "/chofer/sin-conexion";
self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const shell = await fetch(OFFLINE, { credentials: "omit", cache: "reload" });
    if (!shell.ok || shell.redirected) throw new Error("No se pudo preparar el inicio sin conexión");
    const html = await shell.clone().text();
    const assets = [...new Set(Array.from(html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g),
      match => match[1].replaceAll("&amp;", "&")))];
    await cache.addAll(assets);
    await cache.put(OFFLINE, shell);
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith("araucana-shell-chofer-") && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (request.mode === "navigate" && ["/chofer", "/chofer/", OFFLINE].includes(url.pathname)) {
    event.respondWith(fetch(request).catch(async () => (await caches.match(OFFLINE, { cacheName: CACHE })) ?? Response.error()));
  } else if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(request);
      if (hit) return hit;
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    })());
  }
});
