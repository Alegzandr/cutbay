// Copies dist/index.html (the landing page) to dist/404.html so GitHub Pages
// shows the landing instead of its default 404 on unknown paths. The page is
// served with a 404 status, so search engines do not index stray URLs.
import { copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
copyFileSync(join(dist, 'index.html'), join(dist, '404.html'));
console.log('404 fallback: dist/404.html created from the landing page');
