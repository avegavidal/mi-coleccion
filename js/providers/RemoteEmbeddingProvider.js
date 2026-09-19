/**
 * Stub para un proveedor remoto futuro (API de embeddings de pago o propia).
 * No se usa en v1. Sustituye en embeddingService sin tocar la UI.
 */
import { EmbeddingProvider } from './EmbeddingProvider.js';

export class RemoteEmbeddingProvider extends EmbeddingProvider {
  constructor(endpoint, apiKey) {
    super();
    this.endpoint = endpoint;
    this.apiKey = apiKey;
  }

  getModelId() {
    return 'remote-future';
  }

  getDimensions() {
    return 512;
  }

  isReady() {
    return Boolean(this.endpoint);
  }

  async embedImage(_image) {
    throw new Error(
      'RemoteEmbeddingProvider no está configurado. Usa LocalEmbeddingProvider en v1.'
    );
  }
}
