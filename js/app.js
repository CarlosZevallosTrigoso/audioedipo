// ============================================================
// audioedipo — reproductor de capítulos con índice, páginas,
// citas y transcripción sincronizada
// ============================================================

(() => {
    'use strict';

    const N = window.Nucleo;
    const $ = id => document.getElementById(id);
    const audio = $('audio');

    const VELOCIDADES = [1, 1.25, 1.5, 1.75, 2, 0.8];
    const SALTO = 30;

    const estado = {
        cap: null,
        plano: [],          // índice aplanado
        inicios: [],        // tiempos de inicio de cada nodo del índice
        tBloques: [],       // tiempos de inicio de cada bloque
        cursor: 0,          // posición elegida aunque el audio aún no esté
        audioListo: false,
        posicionAplicada: false, // ya se restauró la posición en el audio recién cargado
        urlAudio: null,
        bloqueActual: -1,
        nodoActual: -1,
        seguir: true,
        pausaSeguirHasta: 0,
        coincidencias: [],
        coincidenciaActual: -1,
        descarga: null,     // AbortController
        driveOk: false,
        vista: 'indice',
    };

    // ---------- arranque ----------

    async function iniciar() {
        $('marca').addEventListener('click', () => location.reload());

        let catalogo;
        try {
            catalogo = await (await fetch('capitulos/index.json', { cache: 'no-cache' })).json();
        } catch (e) {
            return fallo('No se pudo leer capitulos/index.json.');
        }
        const pedido = new URLSearchParams(location.search).get('cap');
        const entrada = catalogo.find(c => c.id === pedido) || catalogo[0];
        if (!entrada) return fallo('No hay capítulos en capitulos/index.json.');

        try {
            estado.cap = await (await fetch(`capitulos/${entrada.archivo}`, { cache: 'no-cache' })).json();
        } catch (e) {
            return fallo(`No se pudo leer capitulos/${entrada.archivo}.`);
        }

        const cap = estado.cap;
        document.title = `${cap.titulo} — audioedipo`;
        $('titulo-cap').textContent = cap.titulo;
        $('subtitulo-cap').textContent = cap.subtitulo || '';

        estado.plano = N.aplanar(cap.indice);
        estado.inicios = estado.plano.map(n => n.t);
        estado.tBloques = cap.bloques.map(b => b[0]);
        estado.cursor = Almacen.posicion(cap.id) || 0;

        const vel = Almacen.pref('velocidad', 1);
        audio.playbackRate = VELOCIDADES.includes(vel) ? vel : 1;
        $('btn-velocidad').textContent = `${formatoVel(audio.playbackRate)}×`;

        pintarFranja();
        pintarIndice();
        pintarPaginas();
        pintarCitas();
        pintarBloques();
        conectarControles();
        conectarAudio();
        conectarMediaSession();
        actualizar(estado.cursor, true);
        medirReproductor();

        await cargarAudioGuardado();
        if (window.DRIVE_CONFIG) iniciarDrive();
        registrarSW();
    }

    function fallo(msg) {
        $('titulo-cap').textContent = msg;
    }

    function formatoVel(v) {
        return String(v).replace('.', ',');
    }

    // ---------- audio: guardado, Drive, archivo local ----------

    async function cargarAudioGuardado() {
        const guardado = await Almacen.leerAudio(estado.cap.id);
        if (guardado) {
            usarBlob(guardado.blob, guardado.origen);
        } else {
            mostrarCarga('inicial');
        }
    }

    function usarBlob(blob, origen) {
        if (estado.urlAudio) URL.revokeObjectURL(estado.urlAudio);
        estado.urlAudio = URL.createObjectURL(blob);
        estado.posicionAplicada = false;
        audio.src = estado.urlAudio;
        audio.load();
        estado.audioListo = true;
        $('carga').hidden = true;
        pintarEstadoAudio(blob.size, origen);
        habilitarTransporte(true);
    }

    function pintarEstadoAudio(bytes, origen) {
        const caja = $('estado-audio');
        caja.innerHTML = '';
        if (!estado.audioListo) return;
        const txt = document.createElement('span');
        const mb = bytes ? `${Math.round(bytes / 1e6)} MB` : '';
        txt.textContent = `Audio guardado en este dispositivo${mb ? ` (${mb})` : ''}`;
        const quitar = document.createElement('button');
        quitar.textContent = 'Quitar';
        quitar.title = 'Borrar el audio guardado en este dispositivo';
        quitar.addEventListener('click', async () => {
            if (!confirm('¿Quitar el audio de este dispositivo? Tendrás que descargarlo de nuevo para escucharlo.')) return;
            audio.pause();
            await Almacen.borrarAudio(estado.cap.id);
            if (estado.urlAudio) URL.revokeObjectURL(estado.urlAudio);
            estado.urlAudio = null;
            audio.removeAttribute('src');
            audio.load();
            estado.audioListo = false;
            caja.innerHTML = '';
            mostrarCarga('inicial');
        });
        caja.append(txt, quitar);
        void origen;
    }

    function mostrarCarga(fase, info) {
        const caja = $('carga');
        caja.hidden = false;
        const msg = $('carga-msg');
        const barra = $('carga-progreso');
        msg.classList.remove('error');
        $('btn-drive').hidden = fase === 'descargando';
        $('btn-local').hidden = fase === 'descargando';
        $('btn-cancelar').hidden = fase !== 'descargando';
        barra.hidden = fase !== 'descargando';
        if (fase === 'inicial') {
            msg.textContent = 'El audio de este capítulo no está guardado en este dispositivo. Descárgalo una vez y quedará disponible sin conexión.';
            $('btn-drive').disabled = !window.DRIVE_CONFIG;
        } else if (fase === 'descargando') {
            msg.textContent = info || 'Conectando con Drive…';
        } else if (fase === 'error') {
            msg.textContent = info;
            msg.classList.add('error');
        }
        habilitarTransporte(estado.audioListo);
        medirReproductor();
    }

    function progresoDescarga(recibido, total) {
        const mb = n => (n / 1e6).toFixed(0);
        $('carga-msg').textContent = total
            ? `Descargando de Drive: ${mb(recibido)} de ${mb(total)} MB`
            : `Descargando de Drive: ${mb(recibido)} MB`;
        $('carga-progreso').firstElementChild.style.width = total ? `${(recibido / total) * 100}%` : '30%';
    }

    function iniciarDrive() {
        Drive.init(window.DRIVE_CONFIG).then(ok => {
            estado.driveOk = ok;
            if (!ok && !estado.audioListo) {
                $('btn-drive').disabled = true;
                $('btn-drive').title = 'No se pudo cargar el inicio de sesión de Google';
            }
        });
    }

    async function descargarDeDrive() {
        const d = estado.cap.drive;
        if (!d || !d.fileId) return mostrarCarga('error', 'Este capítulo no tiene archivo de Drive configurado.');
        if (!estado.driveOk) {
            return mostrarCarga('error', 'El inicio de sesión de Google todavía está cargando. Vuelve a pulsar «Descargar de Drive» en unos segundos.');
        }
        // ensureToken va antes de cualquier await: el navegador solo deja
        // abrir la ventana de Google si viene directo del clic.
        const token = Drive.ensureToken();
        mostrarCarga('descargando', 'Esperando el inicio de sesión de Google…');
        estado.descarga = new AbortController();
        try {
            await token;
            mostrarCarga('descargando', 'Conectando con Drive…');
            const blob = await Drive.download(d.fileId, 'audio/mpeg', progresoDescarga, estado.descarga.signal);
            $('carga-msg').textContent = 'Guardando en el dispositivo…';
            const guardado = await Almacen.guardarAudio(estado.cap.id, blob, 'drive');
            usarBlob(blob, 'drive');
            if (!guardado) avisoNoGuardado();
        } catch (e) {
            if (e.name === 'AbortError') return mostrarCarga('inicial');
            console.error('[Drive]', e);
            mostrarCarga('error', mensajeDrive(e));
        } finally {
            estado.descarga = null;
        }
    }

    function mensajeDrive(e) {
        const m = String(e && e.message || e);
        if (/popup_failed_to_open|popup_closed/.test(m + (e.code || ''))) return 'Se cerró o bloqueó la ventana de Google. Vuelve a pulsar «Descargar de Drive».';
        if (/403/.test(m)) return 'Drive rechazó la descarga (403). Revisa que la cuenta con la que entraste tenga acceso al archivo.';
        if (/404/.test(m)) return 'Drive no encuentra el archivo (404). Puede que se haya movido a la papelera o cambiado de cuenta.';
        if (/Failed to fetch|NetworkError/i.test(m)) return 'Se cortó la conexión durante la descarga. Vuelve a intentarlo.';
        return `No se pudo descargar: ${m}`;
    }

    function avisoNoGuardado() {
        $('estado-audio').firstChild.textContent = 'Audio cargado (no se pudo guardar en el dispositivo; habrá que descargarlo otra vez)';
    }

    async function abrirLocal(file) {
        if (!file) return;
        const blob = file.type ? file : new Blob([file], { type: 'audio/mpeg' });
        const guardado = await Almacen.guardarAudio(estado.cap.id, blob, 'local');
        usarBlob(blob, 'local');
        if (!guardado) avisoNoGuardado();
        audio.addEventListener('loadedmetadata', () => {
            const dif = Math.abs(audio.duration - estado.cap.duracion);
            if (isFinite(audio.duration) && dif > 5) {
                alert(`Este archivo dura ${N.reloj(audio.duration, true)} y el capítulo ${N.reloj(estado.cap.duracion, true)}. Los saltos del índice no van a coincidir.`);
            }
        }, { once: true });
    }

    function habilitarTransporte(si) {
        ['btn-play', 'btn-velocidad'].forEach(id => { $(id).disabled = !si; });
    }

    // ---------- tiempo ----------

    function listoParaSaltar() {
        return estado.audioListo && estado.posicionAplicada && audio.readyState > 0;
    }

    function ahora() {
        return listoParaSaltar() ? audio.currentTime : estado.cursor;
    }

    function irA(t, reproducir) {
        const cap = estado.cap;
        t = Math.min(Math.max(0, t), cap.duracion - 0.5);
        estado.cursor = t;
        if (listoParaSaltar()) {
            audio.currentTime = t;
            if (reproducir && audio.paused) audio.play().catch(() => {});
        }
        estado.pausaSeguirHasta = 0;
        actualizar(t, true);
        Almacen.guardarPosicion(cap.id, t);
    }

    let ultimoGuardado = 0;
    function actualizar(t, forzar) {
        const cap = estado.cap;
        const pct = (t / cap.duracion) * 100;
        $('franja-cursor').style.left = `${pct}%`;
        $('franja-escuchado').style.width = `${pct}%`;
        const fr = $('franja');
        fr.setAttribute('aria-valuenow', String(Math.round(t)));
        fr.setAttribute('aria-valuetext', `${N.reloj(t, true)} de ${N.reloj(cap.duracion, true)}`);
        $('tiempo').firstElementChild.textContent = N.reloj(t, true);

        const ib = N.bloqueEn(cap.bloques, t);
        if (ib !== estado.bloqueActual || forzar) marcarBloque(ib, forzar);

        const inodo = N.nodoEn(estado.plano, t);
        if (inodo !== estado.nodoActual || forzar) marcarNodo(inodo);

        if (Date.now() - ultimoGuardado > 5000 && estado.audioListo && !audio.paused) {
            ultimoGuardado = Date.now();
            Almacen.guardarPosicion(cap.id, t);
        }
    }

    // ---------- franja ----------

    function pintarFranja() {
        const cap = estado.cap;
        const fr = $('franja');
        fr.setAttribute('aria-valuemax', String(Math.round(cap.duracion)));
        $('tiempo').lastElementChild.textContent = `/ ${N.reloj(cap.duracion, true)}`;
        const tramos = N.tramosRaiz(cap.indice, cap.duracion);
        const primero = tramos.length ? tramos[0].ini : 0;
        const frag = document.createDocumentFragment();
        tramos.forEach((tr, i) => {
            const ini = i === 0 ? 0 : tr.ini;
            const el = document.createElement('div');
            el.className = 'franja-tramo' + (i % 2 ? ' par' : '');
            const ancho = ((tr.fin - ini) / cap.duracion) * 100;
            el.style.width = `${ancho}%`;
            el.title = `${tr.titulo} (${N.reloj(tr.ini, true)})`;
            const sig = document.createElement('span');
            sig.className = 'franja-sigla';
            sig.textContent = N.sigla(tr.titulo);
            el.appendChild(sig);
            tr.hijos.forEach(th => {
                const tic = document.createElement('span');
                tic.className = 'franja-tic';
                tic.style.left = `${((th - ini) / (tr.fin - ini)) * 100}%`;
                el.appendChild(tic);
            });
            frag.appendChild(el);
        });
        void primero;
        fr.insertBefore(frag, fr.firstChild);

        const tiempoDe = ev => {
            const r = fr.getBoundingClientRect();
            const x = Math.min(Math.max(0, ev.clientX - r.left), r.width);
            return (x / r.width) * cap.duracion;
        };
        let arrastrando = false;
        fr.addEventListener('pointerdown', ev => {
            arrastrando = true;
            fr.setPointerCapture(ev.pointerId);
            irA(tiempoDe(ev));
        });
        fr.addEventListener('pointermove', ev => {
            const t = tiempoDe(ev);
            if (arrastrando) { irA(t); return; }
            if (ev.pointerType === 'mouse') sondear(t, ev);
        });
        fr.addEventListener('pointerup', () => { arrastrando = false; });
        fr.addEventListener('pointercancel', () => { arrastrando = false; });
        fr.addEventListener('pointerleave', () => { $('franja-sondeo').hidden = true; pintarMiga(); });
        fr.addEventListener('keydown', ev => {
            if (ev.key === 'ArrowLeft') { ev.preventDefault(); irA(ahora() - SALTO); }
            if (ev.key === 'ArrowRight') { ev.preventDefault(); irA(ahora() + SALTO); }
            if (ev.key === 'Home') { ev.preventDefault(); irA(0); }
            if (ev.key === 'End') { ev.preventDefault(); irA(cap.duracion - 1); }
        });
    }

    function sondear(t) {
        const s = $('franja-sondeo');
        s.hidden = false;
        s.style.left = `${(t / estado.cap.duracion) * 100}%`;
        const n = estado.plano[N.nodoEn(estado.plano, t)];
        const miga = $('miga');
        miga.innerHTML = '';
        const span = document.createElement('span');
        span.className = 'sondeo-info';
        span.textContent = `${N.reloj(t, true)}  ${n ? n.titulo : ''}`;
        miga.appendChild(span);
    }

    // ---------- índice ----------

    function pintarIndice() {
        const ul = $('indice');
        const actualRaiz = N.camino(estado.plano, N.nodoEn(estado.plano, estado.cursor))[0];
        const crear = (nodo) => {
            const li = document.createElement('li');
            li.dataset.id = nodo.id;
            const b = document.createElement('button');
            b.className = `nodo n${nodo.nivel}`;
            b.dataset.id = nodo.id;
            const ple = document.createElement('span');
            if (nodo.nivel === 0 && nodo.hijos) {
                ple.className = 'plegar';
                ple.setAttribute('role', 'button');
                ple.setAttribute('aria-label', 'Mostrar u ocultar subtramos');
                ple.tabIndex = 0;
                ple.textContent = '+';
            }
            const tit = document.createElement('span');
            tit.textContent = nodo.titulo;
            if (nodo.paginas) {
                const pp = document.createElement('span');
                pp.className = 'pp';
                pp.textContent = `pp. ${nodo.paginas}`;
                tit.appendChild(pp);
            }
            const t = document.createElement('span');
            t.className = 't';
            t.textContent = N.reloj(nodo.t, true);
            b.append(ple, tit, t);
            b.addEventListener('click', ev => {
                if (ev.target === ple) { plegar(li); return; }
                irA(nodo.t, true);
            });
            ple.addEventListener('keydown', ev => {
                if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ev.stopPropagation(); plegar(li); }
            });
            li.appendChild(b);
            if (nodo.hijos) {
                const sub = document.createElement('ul');
                nodo.hijos.forEach(h => sub.appendChild(crear(h)));
                li.appendChild(sub);
                if (nodo.nivel === 0 && (!actualRaiz || actualRaiz.id !== nodo.id)) li.classList.add('plegado');
                if (nodo.nivel === 0) ple.textContent = li.classList.contains('plegado') ? '+' : '−';
            }
            return li;
        };
        estado.cap.indice.forEach(n => ul.appendChild(crear(n)));
    }

    function plegar(li, abrir) {
        const plegado = abrir === undefined ? !li.classList.contains('plegado') : !abrir;
        li.classList.toggle('plegado', plegado);
        const p = li.querySelector(':scope > .nodo .plegar');
        if (p) p.textContent = plegado ? '+' : '−';
    }

    function marcarNodo(idx) {
        estado.nodoActual = idx;
        const ruta = N.camino(estado.plano, idx);
        const ids = new Set(ruta.map(n => n.id));
        document.querySelectorAll('.nodo.actual, .nodo.en-curso').forEach(el => el.classList.remove('actual', 'en-curso'));
        ruta.forEach((n, i) => {
            const el = document.querySelector(`.nodo[data-id="${n.id}"]`);
            if (el) el.classList.add(i === ruta.length - 1 ? 'actual' : 'en-curso');
        });
        // abre la raíz vigente para que el tramo actual se vea
        if (ruta[0]) {
            const li = document.querySelector(`.indice > li[data-id="${ruta[0].id}"]`);
            if (li && li.classList.contains('plegado')) plegar(li, true);
        }
        void ids;
        pintarMiga();
        marcarCita();
        actualizarMediaSession();
    }

    function pintarMiga() {
        const ruta = N.camino(estado.plano, Math.max(0, estado.nodoActual));
        const miga = $('miga');
        miga.innerHTML = '';
        ruta.forEach((n, i) => {
            if (i > 0) miga.appendChild(document.createTextNode(' › '));
            const el = document.createElement(i === ruta.length - 1 ? 'b' : 'span');
            el.textContent = n.titulo;
            miga.appendChild(el);
        });
        miga.title = ruta.map(n => n.titulo).join(' › ');
    }

    // ---------- páginas ----------

    function pintarPaginas() {
        const pags = estado.cap.paginas || {};
        const nums = Object.keys(pags).map(Number);
        const rej = $('rejilla');
        if (!nums.length) { rej.textContent = 'Este capítulo no tiene referencias de página.'; return; }
        const min = Math.min(...nums), max = Math.max(...nums);
        for (let p = min; p <= max; p++) {
            const b = document.createElement('button');
            b.textContent = p;
            b.setAttribute('aria-pressed', 'false');
            if (!pags[p]) { b.disabled = true; b.title = 'No se menciona esta página'; }
            else {
                b.title = `${pags[p].length} ${pags[p].length === 1 ? 'momento' : 'momentos'}`;
                b.addEventListener('click', () => elegirPagina(p, b));
            }
            rej.appendChild(b);
        }
    }

    function elegirPagina(p, boton) {
        document.querySelectorAll('.rejilla button[aria-pressed="true"]').forEach(b => b.setAttribute('aria-pressed', 'false'));
        boton.setAttribute('aria-pressed', 'true');
        const ul = $('momentos');
        ul.innerHTML = '';
        estado.cap.paginas[p].forEach(t => {
            const li = document.createElement('li');
            const b = document.createElement('button');
            const tt = document.createElement('span');
            tt.className = 't';
            tt.textContent = N.reloj(t, true);
            const tit = document.createElement('span');
            tit.textContent = estado.plano[N.nodoEn(estado.plano, t)].titulo;
            b.append(tt, tit);
            b.addEventListener('click', () => irA(t, true));
            li.appendChild(b);
            ul.appendChild(li);
        });
    }

    // ---------- citas ----------

    function pintarCitas() {
        const ul = $('citas');
        const porId = {};
        estado.plano.forEach(n => { porId[n.id] = n; });
        (estado.cap.citas || []).forEach((c, i) => {
            const li = document.createElement('li');
            const b = document.createElement('button');
            b.className = 'cita';
            b.dataset.i = i;
            const meta = document.createElement('div');
            meta.className = 'cita-meta';
            const t = document.createElement('span');
            t.textContent = N.reloj(c.t, true);
            meta.appendChild(t);
            if (c.pag) {
                const p = document.createElement('span');
                p.className = 'pag';
                p.textContent = `p. ${c.pag}`;
                meta.appendChild(p);
            }
            const sec = document.createElement('span');
            sec.textContent = c.seccion && porId[c.seccion] ? porId[c.seccion].titulo : '';
            meta.appendChild(sec);
            const tx = document.createElement('div');
            tx.className = 'cita-texto';
            tx.textContent = c.texto;
            b.append(meta, tx);
            b.addEventListener('click', () => irA(c.t, true));
            li.appendChild(b);
            ul.appendChild(li);
        });
        if (!ul.children.length) ul.textContent = 'Este capítulo no tiene citas marcadas.';
    }

    function marcarCita() {
        const citas = estado.cap.citas || [];
        const t = ahora();
        document.querySelectorAll('.cita.actual').forEach(el => el.classList.remove('actual'));
        const i = citas.findIndex(c => c.t <= t + 0.5 && t <= (c.fin || c.t + 30));
        if (i >= 0) {
            const el = document.querySelector(`.cita[data-i="${i}"]`);
            if (el) el.classList.add('actual');
        }
    }

    // ---------- transcripción ----------

    function pintarBloques() {
        const cont = $('bloques');
        const inicioDe = {};
        estado.plano.forEach(n => {
            const ib = N.bloqueEn(estado.cap.bloques, n.t);
            (inicioDe[ib] = inicioDe[ib] || []).push(n);
        });
        const frag = document.createDocumentFragment();
        estado.cap.bloques.forEach((b, i) => {
            const div = document.createElement('div');
            div.className = 'bloque';
            div.dataset.i = i;
            const nodos = inicioDe[i];
            if (nodos) {
                if (nodos.some(n => n.nivel === 0)) div.classList.add('inicio-tramo');
                const rot = document.createElement('div');
                rot.className = 'rotulo';
                rot.textContent = nodos.map(n => n.titulo).join(' › ');
                div.appendChild(rot);
            }
            const t = document.createElement('button');
            t.className = 't';
            t.textContent = N.reloj(b[0], true);
            t.setAttribute('aria-label', `Ir a ${N.reloj(b[0], true)}`);
            const p = document.createElement('p');
            p.textContent = b[2];
            div.append(t, p);
            frag.appendChild(div);
        });
        cont.appendChild(frag);
        cont.addEventListener('click', ev => {
            const div = ev.target.closest('.bloque');
            if (!div || ev.target.closest('.rotulo')) return;
            const sel = window.getSelection();
            if (sel && String(sel).length > 0 && !ev.target.closest('.t')) return; // está seleccionando texto
            irA(estado.cap.bloques[Number(div.dataset.i)][0], true);
        });
    }

    function contenedorTexto() {
        return window.matchMedia('(max-width: 899px)').matches ? null : $('transcripcion');
    }

    function marcarBloque(i, forzar) {
        const prev = document.querySelector('.bloque.actual');
        if (prev) prev.classList.remove('actual');
        estado.bloqueActual = i;
        const el = document.querySelector(`.bloque[data-i="${i}"]`);
        if (!el) return;
        el.classList.add('actual');
        if (Date.now() < estado.pausaSeguirHasta && !forzar) {
            $('volver').hidden = false;
            return;
        }
        $('volver').hidden = true;
        llevarA(el);
    }

    function llevarA(el) {
        const cont = contenedorTexto();
        if (cont) {
            const top = el.offsetTop - cont.clientHeight * 0.3;
            cont.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
        } else if ($('texto').classList.contains('visible-movil')) {
            const alto = $('reproductor').offsetHeight + $('pestanas').offsetHeight;
            const y = el.getBoundingClientRect().top + window.scrollY - alto - 40;
            window.scrollTo({ top: Math.max(0, y), behavior: 'auto' });
        }
    }

    function pausarSeguimiento() {
        estado.pausaSeguirHasta = Date.now() + 12000;
        $('volver').hidden = false;
    }

    // búsqueda
    function buscar(q) {
        document.querySelectorAll('.bloque p').forEach(p => {
            if (p.querySelector('mark')) p.textContent = p.textContent;
        });
        estado.coincidencias = N.buscar(estado.cap.bloques, q);
        estado.coincidenciaActual = -1;
        const cuenta = $('buscar-cuenta');
        const hay = estado.coincidencias.length > 0;
        $('buscar-ant').hidden = !hay;
        $('buscar-sig').hidden = !hay;
        if (q.trim().length < 2) { cuenta.textContent = ''; return; }
        cuenta.textContent = hay ? `${estado.coincidencias.length} bloques` : 'Sin resultados';
        const nq = N.normalizar(q.trim());
        estado.coincidencias.forEach(i => resaltar(document.querySelector(`.bloque[data-i="${i}"] p`), nq));
        if (hay) saltarCoincidencia(1, true);
    }

    function resaltar(p, nq) {
        const texto = p.textContent;
        const nt = N.normalizar(texto);
        // NFD + quitar tildes conserva la longitud de cada letra base
        // salvo en caracteres compuestos; se mapea por índice.
        const mapa = [];
        let acc = '';
        for (let k = 0; k < texto.length; k++) {
            const n = N.normalizar(texto[k]);
            for (let j = 0; j < n.length; j++) mapa.push(k);
            acc += n;
        }
        void nt;
        p.textContent = '';
        let desde = 0, pos;
        while ((pos = acc.indexOf(nq, desde)) >= 0) {
            const ini = mapa[pos], fin = mapa[pos + nq.length - 1] + 1;
            const iniPrev = desde === 0 ? 0 : mapa[desde - 1] + 1;
            p.appendChild(document.createTextNode(texto.slice(iniPrev, ini)));
            const m = document.createElement('mark');
            m.textContent = texto.slice(ini, fin);
            p.appendChild(m);
            desde = pos + nq.length;
        }
        const iniPrev = desde === 0 ? 0 : mapa[desde - 1] + 1;
        p.appendChild(document.createTextNode(texto.slice(iniPrev)));
    }

    function saltarCoincidencia(dir, primera) {
        const lista = estado.coincidencias;
        if (!lista.length) return;
        if (primera) {
            const t = ahora();
            const k = lista.findIndex(i => estado.cap.bloques[i][0] >= t - 1);
            estado.coincidenciaActual = k >= 0 ? k : 0;
        } else {
            estado.coincidenciaActual = (estado.coincidenciaActual + dir + lista.length) % lista.length;
        }
        document.querySelectorAll('mark.activa').forEach(m => m.classList.remove('activa'));
        const i = lista[estado.coincidenciaActual];
        const el = document.querySelector(`.bloque[data-i="${i}"]`);
        el.querySelectorAll('mark').forEach(m => m.classList.add('activa'));
        $('buscar-cuenta').textContent = `${estado.coincidenciaActual + 1} de ${lista.length}`;
        pausarSeguimiento();
        llevarA(el);
    }

    // ---------- controles ----------

    function alternar() {
        if (!estado.audioListo) return;
        if (audio.paused) {
            if (Math.abs(audio.currentTime - estado.cursor) > 1) audio.currentTime = estado.cursor;
            audio.play().catch(e => console.warn('play', e));
        } else audio.pause();
    }

    function tramo(dir) {
        const t = ahora();
        const destino = dir < 0 ? N.anterior(estado.inicios, t) : N.siguiente(estado.inicios, t);
        if (destino !== null) irA(destino);
    }

    function bloque(dir) {
        const t = ahora();
        const destino = dir < 0 ? N.anterior(estado.tBloques, t, 3) : N.siguiente(estado.tBloques, t);
        if (destino !== null) irA(destino);
    }

    function cambiarVelocidad() {
        const i = VELOCIDADES.indexOf(audio.playbackRate);
        const v = VELOCIDADES[(i + 1) % VELOCIDADES.length];
        audio.playbackRate = v;
        $('btn-velocidad').textContent = `${formatoVel(v)}×`;
        Almacen.guardarPref('velocidad', v);
    }

    function mostrarVista(v) {
        estado.vista = v;
        document.querySelectorAll('#pestanas button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.vista === v)));
        ['indice', 'paginas', 'citas'].forEach(k => { $(`vista-${k}`).hidden = k !== v; });
        $('texto').classList.toggle('visible-movil', v === 'texto');
        if (v === 'texto') {
            const el = document.querySelector('.bloque.actual');
            if (el) requestAnimationFrame(() => llevarA(el));
        } else if (window.matchMedia('(max-width: 899px)').matches) {
            window.scrollTo({ top: 0 });
        }
    }

    function conectarControles() {
        $('btn-play').addEventListener('click', alternar);
        $('btn-menos').addEventListener('click', () => irA(ahora() - SALTO));
        $('btn-mas').addEventListener('click', () => irA(ahora() + SALTO));
        $('btn-bloque-ant').addEventListener('click', () => bloque(-1));
        $('btn-bloque-sig').addEventListener('click', () => bloque(1));
        $('btn-tramo-ant').addEventListener('click', () => tramo(-1));
        $('btn-tramo-sig').addEventListener('click', () => tramo(1));
        $('btn-velocidad').addEventListener('click', cambiarVelocidad);

        $('btn-drive').addEventListener('click', descargarDeDrive);
        $('btn-local').addEventListener('click', () => $('archivo-local').click());
        $('archivo-local').addEventListener('change', ev => abrirLocal(ev.target.files[0]));
        $('btn-cancelar').addEventListener('click', () => { if (estado.descarga) estado.descarga.abort(); });

        document.querySelectorAll('#pestanas button').forEach(b => b.addEventListener('click', () => mostrarVista(b.dataset.vista)));

        const tr = $('transcripcion');
        ['wheel', 'touchmove'].forEach(evt => tr.addEventListener(evt, pausarSeguimiento, { passive: true }));
        window.addEventListener('touchmove', () => { if (estado.vista === 'texto') pausarSeguimiento(); }, { passive: true });
        $('volver').addEventListener('click', () => {
            estado.pausaSeguirHasta = 0;
            $('volver').hidden = true;
            const el = document.querySelector('.bloque.actual');
            if (el) llevarA(el);
        });

        let tBusca;
        $('buscar').addEventListener('input', ev => { clearTimeout(tBusca); tBusca = setTimeout(() => buscar(ev.target.value), 200); });
        $('buscar').addEventListener('keydown', ev => {
            if (ev.key === 'Enter') { ev.preventDefault(); saltarCoincidencia(ev.shiftKey ? -1 : 1); }
            if (ev.key === 'Escape') { ev.target.value = ''; buscar(''); }
        });
        $('buscar-ant').addEventListener('click', () => saltarCoincidencia(-1));
        $('buscar-sig').addEventListener('click', () => saltarCoincidencia(1));

        document.addEventListener('keydown', ev => {
            const tag = (ev.target.tagName || '').toLowerCase();
            if (tag === 'input' || tag === 'textarea' || ev.metaKey || ev.ctrlKey || ev.altKey) return;
            if (ev.target.id === 'franja' && ev.key.startsWith('Arrow')) return;
            if (ev.key === ' ') {
                if (tag === 'button') return; // el botón ya responde al espacio
                ev.preventDefault(); alternar();
            } else if (ev.key === 'ArrowLeft') { ev.preventDefault(); ev.shiftKey ? bloque(-1) : irA(ahora() - SALTO); }
            else if (ev.key === 'ArrowRight') { ev.preventDefault(); ev.shiftKey ? bloque(1) : irA(ahora() + SALTO); }
            else if (ev.key === '[') tramo(-1);
            else if (ev.key === ']') tramo(1);
        });

        window.addEventListener('resize', medirReproductor);
    }

    function medirReproductor() {
        // oculta la sigla de los tramos demasiado angostos para leerla
        document.querySelectorAll('.franja-tramo').forEach(el => el.classList.toggle('estrecho', el.offsetWidth < 18));
        const alto = $('reproductor').offsetHeight;
        $('pestanas').style.top = window.matchMedia('(max-width: 899px)').matches ? `${alto}px` : '';
    }

    // ---------- eventos del audio ----------

    function conectarAudio() {
        // Al cargar, el navegador emite timeupdate con 0 antes de que se
        // pueda restaurar la posición: hasta entonces manda el cursor.
        audio.addEventListener('loadedmetadata', () => {
            if (estado.cursor > 0 && estado.cursor < audio.duration) audio.currentTime = estado.cursor;
            estado.posicionAplicada = true;
        });
        audio.addEventListener('timeupdate', () => {
            if (audio.seeking || !estado.posicionAplicada) return;
            estado.cursor = audio.currentTime;
            actualizar(audio.currentTime);
            posicionMediaSession();
        });
        audio.addEventListener('play', () => pintarPlay(true));
        audio.addEventListener('pause', () => {
            pintarPlay(false);
            Almacen.guardarPosicion(estado.cap.id, audio.currentTime);
        });
        audio.addEventListener('ended', () => pintarPlay(false));
        audio.addEventListener('error', () => {
            if (!estado.audioListo) return;
            mostrarCarga('error', 'El navegador no pudo leer el audio guardado. Quítalo y vuelve a descargarlo.');
        });
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && estado.cap) Almacen.guardarPosicion(estado.cap.id, ahora());
        });
        window.addEventListener('pagehide', () => { if (estado.cap) Almacen.guardarPosicion(estado.cap.id, ahora()); });
    }

    function pintarPlay(sonando) {
        $('ico-play').toggleAttribute('hidden', sonando);
        $('ico-pausa').toggleAttribute('hidden', !sonando);
        $('lbl-play').textContent = sonando ? 'Pausa' : 'Reproducir';
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = sonando ? 'playing' : 'paused';
    }

    // ---------- controles del sistema (pantalla bloqueada, auriculares) ----------

    function conectarMediaSession() {
        if (!('mediaSession' in navigator)) return;
        const ms = navigator.mediaSession;
        const accion = (nombre, fn) => { try { ms.setActionHandler(nombre, fn); } catch (e) {} };
        accion('play', () => alternar());
        accion('pause', () => alternar());
        accion('seekbackward', d => irA(ahora() - ((d && d.seekOffset) || SALTO)));
        accion('seekforward', d => irA(ahora() + ((d && d.seekOffset) || SALTO)));
        accion('previoustrack', () => tramo(-1));
        accion('nexttrack', () => tramo(1));
        accion('seekto', d => { if (d && typeof d.seekTime === 'number') irA(d.seekTime); });
    }

    function actualizarMediaSession() {
        if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
        const n = estado.plano[Math.max(0, estado.nodoActual)];
        try {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: n ? n.titulo : estado.cap.titulo,
                artist: estado.cap.titulo,
                album: estado.cap.subtitulo || '',
                artwork: [{ src: 'icons/icono-512.png', sizes: '512x512', type: 'image/png' }],
            });
        } catch (e) {}
    }

    let ultimaPos = 0;
    function posicionMediaSession() {
        if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
        if (Date.now() - ultimaPos < 2000 || !isFinite(audio.duration)) return;
        ultimaPos = Date.now();
        try {
            navigator.mediaSession.setPositionState({ duration: audio.duration, playbackRate: audio.playbackRate, position: audio.currentTime });
        } catch (e) {}
    }

    // ---------- instalación ----------

    function registrarSW() {
        if ('serviceWorker' in navigator && location.protocol === 'https:') {
            navigator.serviceWorker.register('sw.js').catch(e => console.warn('[SW]', e));
        }
    }

    iniciar();
})();
