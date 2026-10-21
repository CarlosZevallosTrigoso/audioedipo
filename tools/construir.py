#!/usr/bin/env python3
"""
Construye capitulos/<cap>/<cap>.json a partir de fuente.json y las
transcripciones por pieza.

Uso:  python3 tools/construir.py capitulos/cap1

- Convierte los tiempos locales de cada pieza a tiempo global
  (suma de las duraciones de las piezas anteriores).
- Corrige nombres y términos con tools/correcciones.py.
- Ubica cada entrada del índice buscando su "ancla" (texto literal
  de la transcripción original) e interpola dentro del bloque según
  la posición del texto, porque las marcas son cada 15-30 s.
- Extrae menciones de páginas y citas («Cito… Fin de la cita»).
"""
import json, re, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from correcciones import CORRECCIONES

MARGEN = 1.5          # segundos que se adelanta un salto interpolado
PAGINAS_CAP = (8, 54)  # páginas que pertenecen al capítulo

STAMP = re.compile(r"^\[(?:(\d+):)?(\d{1,2}):(\d{2})\]\s*$")


def leer_pieza(path):
    bloques, actual = [], None
    for linea in Path(path).read_text(encoding="utf-8").splitlines():
        m = STAMP.match(linea.strip())
        if m:
            h, mi, s = m.groups()
            actual = {"t": int(h or 0) * 3600 + int(mi) * 60 + int(s), "x": []}
            bloques.append(actual)
        elif linea.strip() and actual is not None:
            actual["x"].append(linea.strip())
    for b in bloques:
        b["x"] = " ".join(b["x"])
    return bloques


def corregir(texto, usos):
    for i, (pat, rep) in enumerate(CORRECCIONES):
        texto, n = re.subn(pat, rep, texto)
        usos[i] += n
    return texto


def main(carpeta):
    carpeta = Path(carpeta)
    fuente = json.loads((carpeta / "fuente.json").read_text(encoding="utf-8"))
    usos = [0] * len(CORRECCIONES)

    bloques = []          # {t, d, raw, x, pieza}
    piezas = []
    offset = 0.0
    for n, p in enumerate(fuente["piezas"]):
        bs = leer_pieza(carpeta / p["archivo"])
        for i, b in enumerate(bs):
            fin_local = bs[i + 1]["t"] if i + 1 < len(bs) else p["duracion"]
            bloques.append({
                "t": round(offset + b["t"], 3),
                "d": round(fin_local - b["t"], 3),
                "raw": b["x"],
                "x": corregir(b["x"], usos),
                "pieza": n,
            })
        piezas.append({"n": n, "inicio": round(offset, 3), "duracion": p["duracion"]})
        offset += p["duracion"]
    duracion = round(offset, 3)

    def tiempo_en(b, pos, largo):
        frac = pos / max(1, largo)
        return round(max(b["t"], b["t"] + frac * b["d"] - MARGEN), 1)

    # ---------- índice ----------
    errores = []
    contador = [0]

    def ubicar(nodo, nivel):
        contador[0] += 1
        nid = f"s{contador[0]}"
        candidatos = [b for b in bloques if b["pieza"] == nodo["pieza"]]
        hit = None
        for b in candidatos:
            pos = b["raw"].find(nodo["ancla"])
            if pos >= 0:
                hit = (b, pos); break
        if hit is None:
            for b in candidatos:
                pos = b["raw"].lower().find(nodo["ancla"].lower())
                if pos >= 0:
                    hit = (b, pos); break
        if hit is None:
            errores.append(f"ancla no encontrada: {nodo['titulo']!r} → {nodo['ancla']!r}")
            t = None
        else:
            b, pos = hit
            t = tiempo_en(b, pos, len(b["raw"]))
        out = {"id": nid, "titulo": nodo["titulo"], "t": t, "nivel": nivel}
        if nodo.get("paginas"):
            out["paginas"] = nodo["paginas"]
        if nodo.get("hijos"):
            out["hijos"] = [ubicar(h, nivel + 1) for h in nodo["hijos"]]
        return out

    indice = [ubicar(n, 0) for n in fuente["indice"]]

    plano = []
    def aplanar(ns):
        for n in ns:
            plano.append(n)
            aplanar(n.get("hijos", []))
    aplanar(indice)
    for a, b in zip(plano, plano[1:]):
        if a["t"] is not None and b["t"] is not None and b["t"] < a["t"]:
            errores.append(f"orden: {b['titulo']!r} ({b['t']}) antes que {a['titulo']!r} ({a['t']})")

    def seccion_en(t):
        mejor = None
        for n in plano:
            if n["t"] is not None and n["t"] <= t:
                mejor = n
        return mejor["id"] if mejor else None

    # ---------- flujo continuo para páginas y citas ----------
    flujo, mapa = [], []   # mapa: (inicio_char, fin_char, bloque)
    pos = 0
    for b in bloques:
        flujo.append(b["x"])
        mapa.append((pos, pos + len(b["x"]), b))
        pos += len(b["x"]) + 1
    texto = " ".join(flujo)

    def tiempo_char(c):
        for ini, fin, b in mapa:
            if ini <= c <= fin:
                return tiempo_en(b, c - ini, fin - ini)
        return duracion

    # páginas
    paginas = {}
    for m in re.finditer(r"[Pp]áginas?\s+(\d{1,3})(?:\s*(y|a)\s+(\d{1,3}))?", texto):
        p1 = int(m.group(1))
        p2 = int(m.group(3)) if m.group(3) else p1
        if p2 < p1 or p2 - p1 > 15:
            p2 = p1
        t = tiempo_char(m.start())
        for p in range(p1, p2 + 1):
            if PAGINAS_CAP[0] <= p <= PAGINAS_CAP[1]:
                lst = paginas.setdefault(str(p), [])
                if not lst or abs(lst[-1] - t) > 20:
                    lst.append(t)

    # citas
    citas = []
    inicios = [m for m in re.finditer(r"\b[Cc]ito\b", texto)]
    for i, m in enumerate(inicios):
        siguiente = inicios[i + 1].start() if i + 1 < len(inicios) else len(texto)
        f = re.search(r"[Ff]in de la cita", texto[m.end():])
        cerrada = f is not None and m.end() + f.start() < siguiente and f.start() < 2500
        if cerrada:
            cuerpo = texto[m.end(): m.end() + f.start()]
            fin_c = m.end() + f.end()
            pm = re.match(r"[\s.,:;]*[Pp]ágina\s+(\d{1,3})", texto[fin_c: fin_c + 30])
            pag = int(pm.group(1)) if pm else None
        else:
            cuerpo = texto[m.end(): m.end() + 260]
            fin_c, pag = None, None
        cuerpo = re.sub(r"^[\s.,:;]+", "", cuerpo).strip()
        # quita la frase de presentación ("la fórmula más compacta.", "el arranque.")
        cuerpo = re.sub(r"^(?:la|el) (?:frase|descripción|fórmula|arranque|pregunta)[^.:]{0,110}[.:]\s*", "", cuerpo)
        cuerpo = re.sub(r"^porque es decisiva\.\s*", "", cuerpo)
        cuerpo = cuerpo.strip(' "“”')
        t = tiempo_char(m.start())
        citas.append({
            "t": t,
            "fin": tiempo_char(fin_c) if fin_c else None,
            "pag": pag,
            "texto": cuerpo,
            "seccion": seccion_en(t),
        })

    salida = {
        "id": fuente["id"],
        "titulo": fuente["titulo"],
        "subtitulo": fuente.get("subtitulo", ""),
        "drive": fuente["drive"],
        "duracion": duracion,
        "piezas": piezas,
        "indice": indice,
        "paginas": dict(sorted(paginas.items(), key=lambda kv: int(kv[0]))),
        "citas": citas,
        "bloques": [[b["t"], b["d"], b["x"]] for b in bloques],
    }
    destino = carpeta / f"{fuente['id']}.json"
    destino.write_text(json.dumps(salida, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    sin_uso = [CORRECCIONES[i][0] for i, n in enumerate(usos) if n == 0]
    print(f"{destino}: {len(bloques)} bloques, duración {duracion:.1f} s, "
          f"{len(plano)} entradas de índice, {len(paginas)} páginas, {len(citas)} citas, "
          f"{sum(usos)} correcciones aplicadas")
    if sin_uso:
        print("correcciones sin efecto:", *sin_uso, sep="\n  ")
    if errores:
        print("ERRORES:", *errores, sep="\n  ")
        sys.exit(1)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "capitulos/cap1")
