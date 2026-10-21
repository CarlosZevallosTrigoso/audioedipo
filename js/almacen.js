// ============================================================
// Almacén — audio guardado en el dispositivo y posición de escucha
// ============================================================
// El audio vive en Cache API bajo una URL sintética por capítulo,
// así sobrevive al cierre del navegador. La posición y las
// preferencias van en localStorage. Todo con prefijo propio porque
// este sitio comparte origen (carloszevallostrigoso.github.io) con
// AudioGuía y otras apps.
// ============================================================

const Almacen = (() => {
    const CACHE = 'audioedipo-audio-v1';
    const PREFIJO = 'audioedipo:';

    function claveAudio(capId) {
        return new URL(`./__audio/${encodeURIComponent(capId)}`, location.href).toString();
    }

    function hayCache() {
        return typeof caches !== 'undefined';
    }

    async function leerAudio(capId) {
        if (!hayCache()) return null;
        try {
            const c = await caches.open(CACHE);
            const r = await c.match(claveAudio(capId));
            if (!r) return null;
            const blob = await r.blob();
            return { blob, origen: r.headers.get('X-Origen') || 'guardado' };
        } catch (e) {
            console.warn('[Almacén] no se pudo leer el audio guardado', e);
            return null;
        }
    }

    async function guardarAudio(capId, blob, origen) {
        if (!hayCache()) return false;
        try {
            if (navigator.storage && navigator.storage.persist) {
                try { await navigator.storage.persist(); } catch (e) {}
            }
            const c = await caches.open(CACHE);
            await c.put(claveAudio(capId), new Response(blob, {
                headers: {
                    'Content-Type': blob.type || 'audio/mpeg',
                    'Content-Length': String(blob.size),
                    'X-Origen': origen || 'guardado',
                },
            }));
            return true;
        } catch (e) {
            console.warn('[Almacén] no se pudo guardar el audio', e);
            return false;
        }
    }

    async function borrarAudio(capId) {
        if (!hayCache()) return;
        try {
            const c = await caches.open(CACHE);
            await c.delete(claveAudio(capId));
        } catch (e) {}
    }

    function leer(clave, porDefecto) {
        try {
            const v = localStorage.getItem(PREFIJO + clave);
            return v === null ? porDefecto : JSON.parse(v);
        } catch (e) { return porDefecto; }
    }

    function escribir(clave, valor) {
        try { localStorage.setItem(PREFIJO + clave, JSON.stringify(valor)); } catch (e) {}
    }

    return {
        leerAudio, guardarAudio, borrarAudio,
        posicion: capId => leer(`pos:${capId}`, 0),
        guardarPosicion: (capId, t) => escribir(`pos:${capId}`, Math.round(t * 10) / 10),
        pref: leer,
        guardarPref: escribir,
    };
})();
