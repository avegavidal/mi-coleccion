# Mi Colección

Aplicación web **privada** para administrar figuras y coleccionables, con identificación visual por similitud (embeddings) en el navegador. Optimizada para **iPhone / Safari**, instalable como **PWA**, y pensada para costar **$0** al inicio (GitHub Pages + Supabase free + CLIP local).

---

## Qué puedes hacer

1. Registrar piezas con fotos.
2. Organizar por colecciones.
3. Buscar y filtrar.
4. **Identificar**: tomar una foto → comparar visualmente con TU colección → confirmar a mano.
5. Evitar duplicados (usa `quantity`).
6. Wishlist, estadísticas, exportar/importar CSV/JSON.
7. Instalar en el iPhone: Compartir → Añadir a pantalla de inicio.

---

## Principio de identificación

```
Foto nueva → embedding visual (CLIP en tu iPhone)
          → búsqueda vectorial en Supabase (solo TUS fotos)
          → coincidencias agrupadas por pieza
          → TÚ confirmas
```

La app **nunca** dice “esto es definitivamente X”. Dice “posible coincidencia” + porcentaje de similitud visual.

---

## Modelo de embeddings (v1 — gratis)

| | |
|---|---|
| **Modelo** | `Xenova/clip-vit-base-patch32` (CLIP ViT-B/32) |
| **Dónde corre** | En tu navegador (WebAssembly / WebGPU) vía Transformers.js |
| **¿Requiere Internet?** | Sí para la 1ª descarga del modelo (~90–150 MB) y para Supabase. Luego el modelo queda en caché del navegador. |
| **¿Se envía la foto a una API de IA de pago?** | **No.** El embedding se calcula en el dispositivo. |
| **Dimensiones** | 512 |
| **Coste** | $0 |
| **Ventajas** | Gratis, privado (la foto no va a un proveedor de IA), sustituible |
| **Desventajas** | Primera carga pesada en iPhone; precisión menor que un modelo comercial especializado; necesita RAM |
| **Alternativa futura** | `RemoteEmbeddingProvider` (API propia o de pago) — ver `docs/CAMBIAR_MODELO.md` |

Las fotos originales se guardan en **Supabase Storage privado**. Los embeddings en PostgreSQL con **pgvector**.

---

## Guía paso a paso (para principiantes)

### 1) Crear cuenta en GitHub

1. Entra a [https://github.com](https://github.com)
2. Crea una cuenta o inicia sesión.

### 2) Crear el repositorio

1. Pulsa **+** (arriba derecha) → **New repository**
2. Nombre, por ejemplo: `mi-coleccion`
3. Visibilidad: **Public** (necesario para GitHub Pages gratis) o Private si tienes Pages en plan de pago
4. **Create repository**

### 3) Subir los archivos del proyecto

**Opción A — desde la web**

1. En el repo vacío, **uploading an existing file**
2. Arrastra **todos** los archivos y carpetas de este proyecto
3. Commit

**Opción B — desde tu PC (Git)**

```bash
cd ruta/a/Project
git init
git add .
git commit -m "Mi Colección v1"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/mi-coleccion.git
git push -u origin main
```

### 4) Crear proyecto en Supabase (gratis)

1. Entra a [https://supabase.com](https://supabase.com) → Sign in
2. **New project**
3. Elige nombre, contraseña de base de datos (guárdala) y región cercana
4. Espera a que el proyecto esté listo

### 5) Ejecutar el SQL

1. En el menú izquierdo: **SQL Editor**
2. **New query**
3. Abre el archivo `sql/schema.sql` de este proyecto
4. Copia **todo** el contenido y pégalo en el editor
5. Pulsa **Run**
6. Debe terminar sin errores

Opcional (después de tener fotos): ejecuta también `sql/optional_vector_index.sql` para acelerar búsquedas.

### 6) Verificar Storage

1. Menú **Storage**
2. Debe existir el bucket **`item-photos`** (privado)
3. Si no aparece, créalo:
   - Name: `item-photos`
   - **Public bucket: OFF**
   - Límite sugerido: 10 MB
   - MIME: `image/jpeg, image/png, image/webp, image/heic`

Las políticas de Storage ya están en el SQL.

### 7) Activar autenticación por email

1. **Authentication** → **Providers** → **Email**
2. Activa Email
3. (Recomendado al empezar) desactiva temporalmente “Confirm email” si quieres entrar sin confirmar, o deja confirmación y revisa el correo

En **Authentication → URL Configuration**:

- **Site URL**: la URL de GitHub Pages (paso 9), por ejemplo `https://TU_USUARIO.github.io/mi-coleccion/`
- **Redirect URLs**: la misma URL

### 8) Copiar URL y anon key

1. **Project Settings** (engranaje) → **API**
2. Copia:
   - **Project URL**
   - **anon public** key  
3. Abre `js/config.js` en el proyecto
4. Pega así:

```js
SUPABASE_URL: 'https://xxxxx.supabase.co',
SUPABASE_ANON_KEY: 'eyJhbGciOi...',
```

⚠️ Usa **solo** la key `anon`. **Nunca** la `service_role` en el frontend.

Vuelve a subir/commit `js/config.js` al repositorio.

### 9) Activar GitHub Pages

1. En GitHub: repo → **Settings** → **Pages**
2. **Source**: Deploy from a branch
3. Branch: **main** / carpeta **/ (root)**
4. Save
5. Espera 1–2 minutos
6. La URL será algo como:  
   `https://TU_USUARIO.github.io/mi-coleccion/`

Si el repo no está en la raíz del sitio, asegúrate de que los enlaces relativos (`./js/...`) funcionen (ya están así).

### 10) Abrir en el iPhone e instalar

1. Abre la URL en **Safari** (no Chrome, para “Añadir a inicio”)
2. Crea tu cuenta en la app
3. Compartir (□↑) → **Añadir a pantalla de inicio**
4. Confirma el nombre → **Añadir**

---

## Prueba rápida de seguridad (importante)

1. Crea **Usuario A**, agrega una pieza con foto.
2. Cierra sesión.
3. Crea **Usuario B**.
4. Verifica que B **no** ve las piezas de A.
5. La búsqueda “Identificar” de B solo compara contra fotos de B (RLS + `auth.uid()` en el RPC).

Tener la URL pública **≠** tener acceso a la colección.

---

## Estructura del proyecto

```
index.html
manifest.json
service-worker.js
css/styles.css
js/
  config.js / config.example.js
  app.js
  providers/          ← embeddings intercambiables
  services/           ← auth, colección, imágenes, reconocimiento…
  screens/            ← pantallas
  utils/
sql/schema.sql
docs/CAMBIAR_MODELO.md
tests/run-tests.mjs
assets/icons/
```

---

## Diseño (estándares 2025/26)

- Optimizado para **una mano** y Safari iOS
- Targets táctiles ≥ 44–52 px (Apple HIG)
- Safe areas (notch / home indicator)
- Navegación inferior tipo **glass** (capa de controles); contenido sólido y legible
- **Foto-first**: tarjetas verticales, galerías con scroll horizontal
- Microinteracciones + respeto a `prefers-reduced-motion` / `prefers-reduced-transparency`
- Sin afirmar certezas en identificación

---

## Offline

El Service Worker cachea la **interfaz**.  
Identificación, login, subida de fotos y sincronización **requieren conexión**.  
No se promete inventario offline completo.

---

## Probar en local

```bash
# Desde la carpeta del proyecto
npx --yes serve -l 4173
# o: python -m http.server 4173
```

Abre `http://localhost:4173`

Tests automáticos:

```bash
node tests/run-tests.mjs
```

---

## Cambiar el modelo de IA más adelante

Ver `docs/CAMBIAR_MODELO.md`.  
La UI no cambia: solo el `EmbeddingProvider` y, si hace falta, la dimensión del `vector` en SQL.

---

## Limitaciones honestas

- Sin proyecto Supabase configurado en `js/config.js`, la app muestra aviso y no puede autenticar.
- CLIP local no es un scanner comercial de figuras; funciona mejor con varias fotos por pieza (frontal, caja, etc.).
- En iPhones antiguos la 1ª carga del modelo puede ser lenta o fallar por memoria: reintenta con Wi‑Fi y pocas pestañas abiertas.
- GitHub Pages sirve solo el frontend; la seguridad real está en **Supabase Auth + RLS**.

---

## Licencia

Uso personal. El modelo CLIP/Transformers.js tiene sus propias licencias en Hugging Face.
