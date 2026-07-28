/**
 * =============================================================================
 *  حساب‌یار | Entry-point برای Cloudflare Workers (همراه Static Assets)
 * =============================================================================
 *  این فایل درخواست‌های /api/* را به همان منطق API می‌سپارد و
 *  بقیه درخواست‌ها (HTML، CSS، JS، آیکون‌ها) را از پوشه public سرو می‌کند.
 *  منطق API در src/api.js است تا هم این حالت و هم Pages Functions کار کند.
 * =============================================================================
 */

import { onRequest } from './api.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      return onRequest({
        request,
        env,
        ctx,
        params: {},
        data: {},
        waitUntil: (promise) => ctx.waitUntil(promise),
        next: async () => new Response('Not found', { status: 404 }),
      });
    }

    // فایل‌های ایستا (public/)
    return env.ASSETS.fetch(request);
  },
};
