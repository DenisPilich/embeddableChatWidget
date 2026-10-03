import { defineConfig } from 'vite';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  define: {
    // Версия подставляется в код на этапе сборки. Так версия, которую виджет
    // сообщает о себе на чужой странице, не может разъехаться с версией пакета,
    // и в бандле не остаётся чтения package.json во время работы.
    __ECW_VERSION__: JSON.stringify(pkg.version),
  },
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
    // Shadow DOM, adoptedStyleSheets и нативный ESM доступны везде, где мы
    // собираемся работать. Более старый target только раздул бы бандл
    // полифилами ради браузеров, которых у клиентов уже нет.
    target: 'es2020',
    sourcemap: true,
    emptyOutDir: true,
  },
});
