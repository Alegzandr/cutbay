import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// GitHub Pages allows no HTTP headers, so the CSP ships as a meta tag injected
// at build time only (the Vite dev server relies on inline scripts). blob: is
// required for export and media preview, data: for the favicon and thumbnails,
// 'unsafe-inline' in style for framer-motion.
const CSP = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function injectCsp(): Plugin {
  return {
    name: 'inject-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return {
        html,
        tags: [
          {
            tag: 'meta',
            attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
            injectTo: 'head-prepend',
          },
        ],
      };
    },
  };
}

// Base path = the GitHub repo name, for the GitHub Pages deployment.
// Change BASE_PATH (or set the VITE_BASE env var) if the repo is renamed.
const BASE_PATH = process.env.VITE_BASE ?? '/selfcut/';

export default defineConfig({
  base: BASE_PATH,
  plugins: [react(), tailwindcss(), injectCsp()],
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
  },
});
