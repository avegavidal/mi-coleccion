/**
 * Interfaz base de proveedores de embeddings.
 * Sustituye LocalEmbeddingProvider por RemoteEmbeddingProvider sin cambiar la UI.
 */
export class EmbeddingProvider {
  /**
   * @param {Blob|File|HTMLImageElement|string} image
   * @returns {Promise<Float32Array>}
   */
  async embedImage(_image) {
    throw new Error('embedImage() no implementado');
  }

  getModelId() {
    return 'unknown';
  }

  getDimensions() {
    return 0;
  }

  isReady() {
    return false;
  }

  async warmup() {
    return this;
  }
}
