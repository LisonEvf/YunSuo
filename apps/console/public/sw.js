// YunSuo Console Service Worker - SELF-UNINSTALLING VERSION
// This SW exists solely to purge all legacy caches and unregister itself,
// eliminating the stale-content problem caused by the old cache-first SW.
// No new SW is registered by the app (see main.tsx), so once this version
// activates, it cleans up and goes away permanently.

const ALL_CACHE_PREFIXES = ["yunsuo-v1", "yunsuo-v2", "yunsuo-v3"];

self.addEventListener("install", (event) => {
  // Skip waiting so this SW activates immediately, even if an old one is running.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // 1. Delete every cache from any version (v1, v2, v3, static, runtime).
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames.map((name) => {
          if (ALL_CACHE_PREFIXES.some((prefix) => name.startsWith(prefix))) {
            return caches.delete(name);
          }
          return caches.delete(name); // delete everything to be safe
        })
      );

      // 2. Claim all clients so the cleanup takes effect on open tabs.
      await self.clients.claim();

      // 3. Tell every open tab to reload so it picks up the fresh assets.
      const clientList = await self.clients.matchAll({ type: "window" });
      clientList.forEach((client) => {
        client.navigate(client.url);
      });

      // 4. Unregister this SW so it never intercepts requests again.
      await self.registration.unregister();
    })()
  );
});

// Pass-through: never intercept any request. Let the browser handle it normally.
self.addEventListener("fetch", () => {});