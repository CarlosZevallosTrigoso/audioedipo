// Pruebas de la lógica pura y de la integridad de los datos del capítulo.
// Uso: node tests/nucleo.test.js
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const N = require('../js/nucleo.js');

let ok = 0;
function prueba(nombre, fn) {
    try { fn(); ok++; console.log('ok  ', nombre); }
    catch (e) { console.error('FALLA', nombre, '\n     ', e.message); process.exitCode = 1; }
}

prueba('reloj', () => {
    assert.strictEqual(N.reloj(0, true), '0:00:00');
    assert.strictEqual(N.reloj(65), '1:05');
    assert.strictEqual(N.reloj(3725.9, true), '1:02:05');
    assert.strictEqual(N.reloj(-3), '0:00');
});

const indice = [
    { id: 'a', t: 0, titulo: 'Nota', nivel: 0 },
    { id: 'b', t: 100, titulo: 'Sección 1 · X', nivel: 0, hijos: [
        { id: 'c', t: 120, titulo: 'c', nivel: 1 },
        { id: 'd', t: 200, titulo: 'd', nivel: 1, hijos: [{ id: 'e', t: 210, titulo: 'e', nivel: 2 }] },
    ]},
    { id: 'f', t: 300, titulo: 'Cierre', nivel: 0 },
];
const plano = N.aplanar(indice);

prueba('aplanar conserva orden y padres', () => {
    assert.deepStrictEqual(plano.map(n => n.id), ['a', 'b', 'c', 'd', 'e', 'f']);
    assert.strictEqual(plano[4].padre, 'd');
    assert.strictEqual(plano[0].padre, null);
});

prueba('nodoEn devuelve el más profundo vigente', () => {
    assert.strictEqual(plano[N.nodoEn(plano, 50)].id, 'a');
    assert.strictEqual(plano[N.nodoEn(plano, 110)].id, 'b');
    assert.strictEqual(plano[N.nodoEn(plano, 215)].id, 'e');
    assert.strictEqual(plano[N.nodoEn(plano, 9999)].id, 'f');
});

prueba('camino hasta la raíz', () => {
    assert.deepStrictEqual(N.camino(plano, 4).map(n => n.id), ['b', 'd', 'e']);
});

prueba('anterior/siguiente al estilo de reproductor', () => {
    const ini = plano.map(n => n.t);
    assert.strictEqual(N.anterior(ini, 130), 120);      // avanzó 10 s: vuelve al inicio del tramo
    assert.strictEqual(N.anterior(ini, 121), 100);      // recién empezado: tramo previo
    assert.strictEqual(N.anterior(ini, 2), 0);
    assert.strictEqual(N.siguiente(ini, 130), 200);
    assert.strictEqual(N.siguiente(ini, 300), null);
});

prueba('bloqueEn', () => {
    const bloques = [[0, 10, 'a'], [10, 10, 'b'], [20, 10, 'c']];
    assert.strictEqual(N.bloqueEn(bloques, 0), 0);
    assert.strictEqual(N.bloqueEn(bloques, 15), 1);
    assert.strictEqual(N.bloqueEn(bloques, 99), 2);
});

prueba('buscar ignora tildes y mayúsculas', () => {
    const bloques = [[0, 1, 'El cuerpo sin órganos'], [1, 1, 'Schreber y los RAYOS'], [2, 1, 'nada']];
    assert.deepStrictEqual(N.buscar(bloques, 'organos'), [0]);
    assert.deepStrictEqual(N.buscar(bloques, 'rayos'), [1]);
    assert.deepStrictEqual(N.buscar(bloques, 'x'), []);
});

prueba('sigla', () => {
    assert.strictEqual(N.sigla('Sección 4 · Psiquiatría'), '4');
    assert.strictEqual(N.sigla('Umbral · Antes'), 'U');
});

// ---------- datos reales ----------
const cap = JSON.parse(fs.readFileSync(path.join(__dirname, '../capitulos/cap1/cap1.json'), 'utf8'));

prueba('cap1: duración = suma de piezas', () => {
    const suma = cap.piezas.reduce((a, p) => a + p.duracion, 0);
    assert.ok(Math.abs(suma - cap.duracion) < 0.01);
    assert.ok(Math.abs(cap.duracion - 10904.77) < 0.01, `duración ${cap.duracion}`);
});

prueba('cap1: bloques ordenados y dentro del audio', () => {
    for (let i = 1; i < cap.bloques.length; i++) assert.ok(cap.bloques[i][0] > cap.bloques[i - 1][0], `bloque ${i}`);
    const ult = cap.bloques[cap.bloques.length - 1];
    assert.ok(ult[0] + ult[1] <= cap.duracion + 0.01);
});

prueba('cap1: índice completo, ordenado y con tiempos', () => {
    const p = N.aplanar(cap.indice);
    assert.ok(p.length >= 90);
    p.forEach(n => assert.ok(typeof n.t === 'number', n.titulo));
    for (let i = 1; i < p.length; i++) assert.ok(p[i].t >= p[i - 1].t, p[i].titulo);
    // las secciones caen en la pieza esperada
    const s4 = p.find(n => n.titulo.startsWith('Sección 4'));
    assert.ok(s4.t > cap.piezas[3].inicio && s4.t < cap.piezas[4].inicio);
});

prueba('cap1: páginas dentro del capítulo', () => {
    Object.keys(cap.paginas).forEach(k => assert.ok(+k >= 8 && +k <= 54, k));
    assert.ok(cap.paginas['33'] && cap.paginas['33'].length > 0);
});

prueba('cap1: sin restos de nombres mal transcritos', () => {
    const texto = cap.bloques.map(b => b[2]).join(' ');
    ['Guatari', 'Watari', 'De Leus', 'Delous', 'Artow', 'Moyoy', 'Klerambol', 'Betelheim', 'según 12', 'Según 12']
        .forEach(m => assert.ok(!texto.includes(m), m));
});

console.log(`\n${ok} pruebas correctas`);
