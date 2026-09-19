# Cómo cambiar el modelo de embeddings

La interfaz **no** depende de un proveedor concreto.

## Cadena actual (v1)

```
UI (Identificar)
  → recognitionService.recognizeImage()
    → embeddingService.generateEmbedding()
      → LocalEmbeddingProvider (CLIP en el navegador)
    → Supabase RPC match_item_images
```

## Archivos clave

| Archivo | Rol |
|---------|-----|
| `js/providers/EmbeddingProvider.js` | Interfaz base |
| `js/providers/LocalEmbeddingProvider.js` | CLIP gratis en el navegador |
| `js/providers/RemoteEmbeddingProvider.js` | Stub para API futura |
| `js/services/embeddingService.js` | Elige el proveedor activo |
| `js/services/recognitionService.js` | Orquesta búsqueda y agrupación |
| `sql/schema.sql` | `vector(512)` + RPC |

## Cambiar a otro proveedor

1. Implementa `embedImage()` en una clase que extienda `EmbeddingProvider`.
2. En `js/services/embeddingService.js`, cambia:

```js
activeProvider = getLocalEmbeddingProvider();
// por ejemplo:
// activeProvider = new RemoteEmbeddingProvider(url, key);
```

3. Si las dimensiones cambian (p. ej. 768), actualiza:
   - `item_images.embedding` en SQL (`vector(N)`)
   - `match_item_images(query_embedding vector(N), …)`
   - `APP_CONFIG.EMBEDDING_DIMENSIONS`
   - Re-genera embeddings de fotos existentes.

## Importante

Embeddings de modelos distintos **no son comparables**.
Si cambias de modelo, vuelve a procesar las fotografías de la colección.
