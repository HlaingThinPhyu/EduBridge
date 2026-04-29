// static/sw.js

const CACHE_NAME = "edubridge-cache-v1";
const URLS_TO_CACHE = [
  "/",
  "/static/index.html",
  "/static/lesson.html",
  "/static/dashboard.html",
  "/static/styles.css",
  "/static/app.js",
  "/static/manifest.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(URLS_TO_CACHE);
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      )
    )
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // 只对 GET、同源请求做缓存处理
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) {
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) {
        return cached;
      }
      return fetch(req).then((res) => {
        // 对静态资源进行缓存
        if (
          req.url.endsWith(".html") ||
          req.url.endsWith(".css") ||
          req.url.endsWith(".js") ||
          req.url.endsWith("manifest.json")
        ) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return res;
      });
    })
  );
});
