/**
 * Contrato modular para fuentes de precio de mercado (US / Japón).
 */
export class MarketPriceProvider {
  get id() {
    return 'base';
  }

  get label() {
    return 'Mercado';
  }

  /**
   * @param {{ query: string, limit?: number }} _opts
   */
  async lookup(_opts) {
    throw new Error('MarketPriceProvider.lookup no implementado');
  }
}
