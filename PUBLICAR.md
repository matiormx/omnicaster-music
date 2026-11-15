# Publicar una versión nueva de OmniCaster Music

Repo `matiormx/omnicaster-music`, rama `main`. Ejemplo: de 0.1.0 a 0.1.1.

> Compilar y publicar solo cuando Matías lo pida.

## 1. Subir la versión (5 sitios)

```bash
python3 scripts/subir_version.py 0.1.1
```

Cambia `package.json`, `src-tauri/tauri.conf.json`, `package-lock.json` (las 2 primeras apariciones), `src-tauri/Cargo.toml` y el bloque `name = "omnicaster-music"` de `src-tauri/Cargo.lock`. Si algún sitio no coincide, aborta sin tocar nada.

## 2. Commit y push a main

```bash
git commit -am "Versión 0.1.1" && git push
```

## 3. Lanzar la compilación y publicación (Windows + Linux)

```bash
gh workflow run release.yml -R matiormx/omnicaster-music --ref main
```

También sirve subir la etiqueta: `git tag v0.1.1 && git push origin v0.1.1`. Sin etiqueta, el flujo crea la Release `v` + la versión de `tauri.conf.json`.

## 4. Esperar y comprobar

```bash
gh run list -R matiormx/omnicaster-music -w release.yml -L 1
gh run watch <id> -R matiormx/omnicaster-music
gh api repos/matiormx/omnicaster-music/releases/latest -q .tag_name   # debe dar v0.1.1
```

Los dos trabajos (`publicar` en windows-latest y en ubuntu-22.04) deben terminar en success. La Release debe tener `.exe`, `.msi`, `.AppImage`, `.deb`, sus `.sig` y `latest.json`.

## Notas

- Si falla un trabajo: `gh run view <id> --log-failed -R matiormx/omnicaster-music`.
- Los secretos `TAURI_SIGNING_PRIVATE_KEY` y `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` tienen que estar en el repo (Settings → Secrets and variables → Actions). Sin ellos, el flujo falla al firmar.
- Las apps instaladas ven la actualización solas en cuanto la Release está publicada.
- Desde la sesión de Claude el proxy bloquea `gh workflow run` y subir etiquetas: ese paso se hace desde el PC de Matías o con el botón «Run workflow» de la pestaña Actions.
