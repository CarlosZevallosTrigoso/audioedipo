// ============================================================
// Drive — autenticación (GIS) y descarga de un archivo por ID
// ============================================================
// Tomado de AudioGuía (repo reproductor, js/drive.js): misma
// autenticación con Google Identity Services y la API REST de
// Drive v3 con fetch. Se quitaron el listado de carpetas y el
// Picker, que aquí no hacen falta.
//
//   - google.accounts.oauth2.initTokenClient / requestAccessToken
//     con prompt '' (sólo pide consentimiento la primera vez).
//   - GET drive/v3/files/{id}?alt=media
// ============================================================

const Drive = (() => {
    const FLAG_CONNECTED = 'audioedipo:driveConectado';
    const API = 'https://www.googleapis.com/drive/v3';

    let config = null;
    let tokenClient = null;
    let token = null;
    let expiresAt = 0;
    let pending = null;      // { resolve, reject } de la petición de token en curso
    let gisReady = false;

    const handlers = {};
    function on(evt, fn) { (handlers[evt] = handlers[evt] || []).push(fn); }
    function emit(evt, data) { (handlers[evt] || []).forEach(fn => fn(data)); }

    function isConfigured() {
        return !!(config && config.API_KEY && config.CLIENT_ID);
    }

    function wasConnected() {
        try { return localStorage.getItem(FLAG_CONNECTED) === '1'; } catch (e) { return false; }
    }

    function hasValidToken() {
        return !!token && Date.now() < expiresAt - 60 * 1000;
    }

    // ---------- carga de GIS ----------

    function waitFor(check, timeoutMs = 10000) {
        return new Promise((resolve, reject) => {
            const start = Date.now();
            const iv = setInterval(() => {
                if (check()) { clearInterval(iv); resolve(); }
                else if (Date.now() - start > timeoutMs) { clearInterval(iv); reject(new Error('timeout')); }
            }, 100);
        });
    }

    async function init(cfg) {
        config = cfg || null;
        if (!isConfigured()) return false;

        try {
            await waitFor(() => typeof google !== 'undefined' && google.accounts && google.accounts.oauth2);
        } catch (e) {
            emit('error', { code: 'gis_unavailable', message: 'No se pudo cargar Google Identity (¿sin conexión?)' });
            return false;
        }

        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: config.CLIENT_ID,
            scope: config.SCOPES,
            prompt: '',
            callback: (response) => {
                const p = pending; pending = null;
                if (response.error) {
                    const err = new Error(response.error_description || response.error);
                    err.code = response.error;
                    if (p) p.reject(err);
                    emit('error', { code: response.error, message: err.message });
                    return;
                }
                token = response.access_token;
                expiresAt = Date.now() + (Number(response.expires_in) || 3600) * 1000;
                try { localStorage.setItem(FLAG_CONNECTED, '1'); } catch (e) {}
                if (p) p.resolve(token);
                emit('connected', { expiresAt });
            },
            error_callback: (err) => {
                const p = pending; pending = null;
                const e = new Error(err && err.message ? err.message : 'Error de autenticación');
                e.code = (err && err.type) || 'unknown';
                if (p) p.reject(e);
                emit('error', { code: e.code, message: e.message });
            },
        });
        gisReady = true;
        emit('ready');
        return true;
    }

    // Pide un token. Con prompt '' Google sólo muestra el consentimiento
    // la primera vez; después el popup se abre y cierra solo. Si el
    // navegador bloquea el popup (sin gesto de usuario) se rechaza con
    // code 'popup_failed_to_open' y hay que reintentar desde un click.
    function requestToken(overrides = {}) {
        if (!gisReady) return Promise.reject(Object.assign(new Error('Drive no inicializado'), { code: 'not_ready' }));
        if (pending) return Promise.reject(Object.assign(new Error('Ya hay una autenticación en curso'), { code: 'busy' }));
        return new Promise((resolve, reject) => {
            pending = { resolve, reject };
            try {
                tokenClient.requestAccessToken(Object.assign({ prompt: '' }, overrides));
            } catch (e) {
                pending = null;
                reject(e);
            }
        });
    }

    async function ensureToken() {
        if (hasValidToken()) return token;
        return requestToken();
    }

    function disconnect() {
        const t = token;
        token = null;
        expiresAt = 0;
        try { localStorage.removeItem(FLAG_CONNECTED); } catch (e) {}
        if (t && typeof google !== 'undefined' && google.accounts) {
            try { google.accounts.oauth2.revoke(t, () => {}); } catch (e) {}
        }
        emit('disconnected');
    }

    // ---------- REST ----------

    async function apiFetch(path, params = {}, options = {}) {
        const t = await ensureToken();
        const url = new URL(`${API}${path}`);
        Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null) url.searchParams.set(k, v); });
        const res = await fetch(url.toString(), Object.assign({}, options, {
            headers: Object.assign({ 'Authorization': `Bearer ${t}` }, options.headers || {}),
        }));
        if (res.status === 401) {
            // Token inválido pese a expiresAt: forzamos renovación una vez
            token = null; expiresAt = 0;
            const t2 = await ensureToken();
            return fetch(url.toString(), Object.assign({}, options, {
                headers: Object.assign({ 'Authorization': `Bearer ${t2}` }, options.headers || {}),
            }));
        }
        return res;
    }

    // Descarga un archivo completo como Blob, con progreso si el servidor
    // envía Content-Length (Drive lo hace para alt=media).
    async function download(fileId, mimeType, onProgress, signal) {
        const res = await apiFetch(`/files/${encodeURIComponent(fileId)}`, { alt: 'media', supportsAllDrives: 'true' }, { signal });
        if (!res.ok) throw new Error(`Drive download ${res.status}`);

        const total = Number(res.headers.get('Content-Length')) || 0;
        const type = mimeType || res.headers.get('Content-Type') || 'audio/mpeg';

        if (!res.body || !onProgress) {
            const blob = await res.blob();
            return new Blob([blob], { type });
        }

        const reader = res.body.getReader();
        const chunks = [];
        let received = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            received += value.length;
            onProgress(received, total);
        }
        return new Blob(chunks, { type });
    }

    return {
        init, on, isConfigured, wasConnected, hasValidToken,
        requestToken, ensureToken, disconnect, download,
    };
})();
