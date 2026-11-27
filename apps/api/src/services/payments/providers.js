/** The payment providers by method. Add a real integration by replacing its entry (see unavailableProvider.js). */
import { stripeProvider } from './stripeProvider.js';
import { testProvider } from './testProvider.js';
import { unavailableProvider } from './unavailableProvider.js';

export const PROVIDERS = {
  STRIPE: stripeProvider,
  MOCK: testProvider,
  JAZZCASH: unavailableProvider('JAZZCASH', 'JazzCash'),
  EASYPAISA: unavailableProvider('EASYPAISA', 'EasyPaisa'),
};

/** The provider for a method; an unknown method is never a working provider. */
export const providerFor = (method) => PROVIDERS[method] || unavailableProvider(String(method), 'This payment method');
