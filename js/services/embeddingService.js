/**
 * Servicio de embeddings. Cambia el proveedor aquí sin tocar pantallas.
 */
import { getConfig } from './supabaseClient.js';
import { getLocalEmbeddingProvider } from '../providers/LocalEmbeddingProvider.js';

/** @type {import('../providers/EmbeddingProvider.js').EmbeddingProvider} */
let activeProvider = null;

export function getEmbeddingProvider() {
  if (!activeProvider) {
    // v1: local gratis. Para cambiar: activeProvider = new RemoteEmbeddingProvider(...)
    activeProvider = getLocalEmbeddingProvider();
  }
  return activeProvider;
}

export function setEmbeddingProvider(provider) {
  activeProvider = provider;
}

export async function generateEmbedding(image, onProgress) {
  const provider = getEmbeddingProvider();
  if (onProgress) provider.onProgress = onProgress;
  return provider.embedImage(image);
}

export function embeddingToArray(float32) {
  return Array.from(float32);
}

export function getEmbeddingMeta() {
  const provider = getEmbeddingProvider();
  const cfg = getConfig();
  return {
    modelId: provider.getModelId(),
    dimensions: provider.getDimensions() || cfg.EMBEDDING_DIMENSIONS,
    ready: provider.isReady(),
    status: provider.getStatus?.() || null
  };
}

export async function warmupEmbeddings(onProgress) {
  const provider = getEmbeddingProvider();
  if (onProgress) provider.onProgress = onProgress;
  await provider.warmup();
  return getEmbeddingMeta();
}
