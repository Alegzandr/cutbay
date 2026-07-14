import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// GitHub Pages ne permet pas d'en-têtes HTTP : la CSP passe par une balise meta,
// injectée seulement au build (le dev server Vite dépend de scripts inline).
// blob: est requis pour l'export et la preview média, data: pour le favicon et
// les vignettes, 'unsafe-inline' en style pour framer-motion.
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

// Base path = nom du repo GitHub pour le déploiement sur GitHub Pages.
// Changez BASE_PATH (ou définissez la variable d'env VITE_BASE) si le repo est renommé.
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
