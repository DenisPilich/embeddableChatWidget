import { defineConfig } from 'vite';
import pkg from './package.json' with { type: 'json' };

/**
 * Куда виджет обращается по умолчанию.
 *
 * Адрес разработки, а не рабочий: рабочий появится вместе с деплоем в Фазе 7,
 * и до тех пор публиковать пакет с ним нельзя. Локальное значение удобно ещё и
 * тем, что собранный виджет сразу работает против `pnpm dev` без настроек.
 */
const DEFAULT_API_URL = 'http://localhost:3000';

export default defineConfig({
  define: {
    // Версия подставляется в код на этапе сборки. Так версия, которую виджет
    // сообщает о себе на чужой странице, не может разъехаться с версией пакета,
    // и в бандле не остаётся чтения package.json во время работы.
    __ECW_VERSION__: JSON.stringify(pkg.version),
    // Адрес серверной части. Значение можно задать при сборке (ECW_API_URL),
    // а на странице клиента его можно переопределить атрибутом data-ecw-api —
    // это нужно тем, кто ставит серверную часть у себя.
    __ECW_API_URL__: JSON.stringify(process.env.ECW_API_URL ?? DEFAULT_API_URL),
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
