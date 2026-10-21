// ============================================================
// Núcleo — lógica pura sobre los datos de un capítulo.
// Sin DOM: se prueba en Node (tests/nucleo.test.js).
// ============================================================

(function (raiz) {
    'use strict';

    // Formato h:mm:ss (o m:ss si dura menos de una hora)
    function reloj(seg, conHoras) {
        seg = Math.max(0, Math.floor(seg || 0));
        const h = Math.floor(seg / 3600);
        const m = Math.floor((seg % 3600) / 60);
        const s = seg % 60;
        const ss = String(s).padStart(2, '0');
        if (h > 0 || conHoras) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
        return `${m}:${ss}`;
    }

    // Árbol → lista en orden de lectura, con referencia al padre
    function aplanar(indice) {
        const lista = [];
        (function rec(nodos, padre) {
            nodos.forEach(n => {
                const item = Object.assign({}, n, { padre: padre ? padre.id : null });
                delete item.hijos;
                lista.push(item);
                if (n.hijos) rec(n.hijos, n);
            });
        })(indice, null);
        return lista;
    }

    // Búsqueda binaria: último índice con clave(i) <= t, o -1
    function ultimoHasta(n, clave, t) {
        let lo = 0, hi = n - 1, r = -1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (clave(mid) <= t) { r = mid; lo = mid + 1; } else hi = mid - 1;
        }
        return r;
    }

    function bloqueEn(bloques, t) {
        return Math.max(0, ultimoHasta(bloques.length, i => bloques[i][0], t));
    }

    // Nodo más profundo vigente en t (el último en orden de lectura con inicio <= t)
    function nodoEn(plano, t) {
        const i = ultimoHasta(plano.length, k => plano[k].t, t + 0.05);
        return i >= 0 ? i : 0;
    }

    // Camino desde la raíz hasta el nodo (para la miga de pan)
    function camino(plano, idx) {
        const porId = {};
        plano.forEach(n => { porId[n.id] = n; });
        const out = [];
        let n = plano[idx];
        while (n) { out.unshift(n); n = n.padre ? porId[n.padre] : null; }
        return out;
    }

    // Anterior al estilo de un reproductor: si ya avanzaste más de
    // `umbral` segundos dentro del tramo actual, vuelve a su inicio;
    // si no, salta al tramo previo.
    function anterior(inicios, t, umbral) {
        umbral = umbral == null ? 4 : umbral;
        const i = ultimoHasta(inicios.length, k => inicios[k], t + 0.05);
        if (i < 0) return 0;
        if (t - inicios[i] > umbral) return inicios[i];
        return i > 0 ? inicios[i - 1] : 0;
    }

    function siguiente(inicios, t) {
        for (let k = 0; k < inicios.length; k++) {
            if (inicios[k] > t + 0.5) return inicios[k];
        }
        return null;
    }

    // Raíces (nivel 0) con su fin, para la franja proporcional
    function tramosRaiz(indice, duracion) {
        return indice.map((n, i) => ({
            id: n.id,
            titulo: n.titulo,
            ini: n.t,
            fin: i + 1 < indice.length ? indice[i + 1].t : duracion,
            hijos: (n.hijos || []).map(h => h.t),
        }));
    }

    // Etiqueta corta para la franja: "S1", "Umbral" → "U", etc.
    function sigla(titulo) {
        const m = /^Sección (\d+)/.exec(titulo);
        if (m) return m[1];
        const palabra = titulo.split(/[\s·]+/)[0] || '';
        return palabra.charAt(0).toUpperCase();
    }

    // Búsqueda en la transcripción, sin distinguir tildes ni mayúsculas
    function normalizar(s) {
        return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    }

    function buscar(bloques, consulta) {
        const q = normalizar(consulta).trim();
        if (q.length < 2) return [];
        const out = [];
        bloques.forEach((b, i) => { if (normalizar(b[2]).includes(q)) out.push(i); });
        return out;
    }

    const api = { reloj, aplanar, bloqueEn, nodoEn, camino, anterior, siguiente, tramosRaiz, sigla, normalizar, buscar };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else raiz.Nucleo = api;
})(typeof window !== 'undefined' ? window : globalThis);
