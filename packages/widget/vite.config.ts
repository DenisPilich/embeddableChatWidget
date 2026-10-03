import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // Библиотечная сборка: Vite не генерирует HTML, а собирает один JS-файл.
    lib: {
      // Путь относительно корня пакета, а не __dirname: пакет объявлен как
      // ESM ("type": "module"), и в ESM __dirname недоступен.
      entry: 'src/index.ts',
      // Имя глобальной переменной для IIFE-сборки: window.ECW
      name: 'ECW',
      formats: ['es', 'iife'],
      fileName: (format) => (format === 'es' ? 'ecw-widget.js' : 'ecw-widget.iife.js'),
    },
    // Shadow DOM и нативный ESM доступны везде, где мы собираемся работать.
    // Более старый target только раздул бы бандл полифилами.
    target: 'es2020',
    sourcemap: true,
    emptyOutDir: true,
  },
});
