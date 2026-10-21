// Service worker: deja la app usable sin conexión.
// Red primero para todo lo propio (así los cambios llegan apenas hay
// conexión) y copia en caché como respaldo. No toca el audio, que
// vive en su propia caché (js/almacen.js), ni las peticiones a Google.
const SHELL = 'audioedipo-shell-v1';
const ARCHIVOS = [
    './', 'index.html', 'css/app.css',
    'js/config.js', 'js/nucleo.js', 'js/almacen.js', 'js/drive.js', 'js/app.js',
    'fonts/fira-code-latin-400-normal.woff2', 'fonts/fira-code-latin-500-normal.woff2', 'fonts/fira-code-latin-600-normal.woff2',
    'capitulos/index.json', 'manifest.webmanifest', 'icons/icono-192.png', 'icons/icono-512.png',
];

self.addEventListener('install', ev => {
    ev.waitUntil(caches.open(SHELL).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', ev => {
    ev.waitUntil(caches.keys()
        .then(ks => Promise.all(ks.filter(k => k.startsWith('audioedipo-shell-') && k !== SHELL).map(k => caches.delete(k))))
        .then(() => self.clients.claim()));
});

self.addEventListener('fetch', ev => {
    const req = ev.request;
    const url = new URL(req.url);
    if (req.method !== 'GET' || url.origin !== location.origin) return;
    if (!url.pathname.startsWith(new URL('./', self.registration.scope).pathname)) return;
    if (url.pathname.includes('/__audio/')) return;
    ev.respondWith(
        fetch(req).then(res => {
            if (res.ok) {
                const copia = res.clone();
                caches.open(SHELL).then(c => c.put(req, copia));
            }
            return res;
        }).catch(() => caches.match(req, { ignoreSearch: true }))
    );
});
