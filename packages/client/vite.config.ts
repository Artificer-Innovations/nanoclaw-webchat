import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const webchatApiTarget =
  process.env.VITE_WEBCHAT_API_TARGET ?? process.env.WEBCHAT_API_TARGET ?? 'http://127.0.0.1:3200';
const WEBCHAT_TOKEN_META_NAME = 'webchat-token';

function escapeHtmlAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function webchatTokenMetaPlugin(): Plugin {
  return {
    name: 'webchat-token-meta',
    transformIndexHtml(html, ctx) {
      // Dev only — never bake secrets into production dist/client bundles.
      if (!ctx.server) return html;
      const secret = process.env.WEBCHAT_SECRET?.trim();
      if (!secret) return html;
      const meta = `<meta name="${WEBCHAT_TOKEN_META_NAME}" content="${escapeHtmlAttr(secret)}" />`;
      return html.replace('</head>', `    ${meta}\n  </head>`);
    },
  };
}

export default defineConfig({
  plugins: [react(), webchatTokenMetaPlugin()],
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
  },
  base: '/',
  server: {
    proxy: {
      '/api': {
        target: webchatApiTarget,
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
