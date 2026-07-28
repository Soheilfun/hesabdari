/**
 * مسیر Pages Functions — منطق اصلی API در src/api.js قرار دارد
 * تا هم در حالت Cloudflare Pages و هم در حالت Workers قابل استفاده باشد.
 */
export { onRequest } from '../../src/api.js';
