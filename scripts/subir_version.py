#!/usr/bin/env python3
"""Sube la versión de OmniCaster Music en los 5 sitios donde aparece.

Uso:  python3 scripts/subir_version.py 0.1.1
La versión actual se lee de package.json. Falla si algún sitio no coincide.
"""
import json
import re
import sys

if len(sys.argv) != 2 or not re.fullmatch(r"\d+\.\d+\.\d+", sys.argv[1]):
    sys.exit("Uso: python3 scripts/subir_version.py X.Y.Z")

V = sys.argv[1]
O = json.load(open("package.json", encoding="utf-8"))["version"]
if O == V:
    sys.exit(f"La versión ya es {V}")
e = re.escape(O)

cambios = [
    ("package.json", rf'"version": "{e}"', f'"version": "{V}"', 1),
    ("src-tauri/tauri.conf.json", rf'"version": "{e}"', f'"version": "{V}"', 1),
    ("package-lock.json", rf'"version": "{e}"', f'"version": "{V}"', 2),
    ("src-tauri/Cargo.toml", rf'(?m)^version = "{e}"', f'version = "{V}"', 1),
    ("src-tauri/Cargo.lock", rf'name = "omnicaster-music"\nversion = "{e}"', f'name = "omnicaster-music"\nversion = "{V}"', 1),
]

nuevos = {}
for ruta, patron, rep, n in cambios:
    s = open(ruta, encoding="utf-8").read()
    s2, c = re.subn(patron, rep, s, count=n)
    if c != n:
        sys.exit(f"{ruta}: se esperaban {n} cambios y hubo {c}. No se ha modificado nada.")
    nuevos[ruta] = s2

for ruta, s in nuevos.items():
    open(ruta, "w", encoding="utf-8", newline="").write(s)
print(f"Versión {O} -> {V} en {len(nuevos)} archivos")
