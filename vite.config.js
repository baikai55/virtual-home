import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vite';

// 把产物内容哈希写进 sw.js：每次部署内容一变，浏览器就会更新 Service Worker 并清掉旧缓存。
function serviceWorkerVersion() {
  return {
    name: 'service-worker-version',
    apply: 'build',
    writeBundle(options, bundle) {
      const hash = createHash('sha256');
      for (const name of Object.keys(bundle).sort()) {
        const item = bundle[name];
        hash.update(name).update(item.type === 'chunk' ? item.code : item.source);
      }
      const file = join(options.dir, 'sw.js');
      writeFileSync(file, readFileSync(file, 'utf8').replace('__BUILD_VERSION__', hash.digest('hex').slice(0, 12)));
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [serviceWorkerVersion()],
  server: { host: '0.0.0.0', port: 5173, strictPort: true },
  preview: { host: '0.0.0.0', port: 4173, strictPort: true },
});
