import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Кладёт собранный виджет в статику приложения.
 *
 * Демонстрационная страница живёт внутри серверной части, поэтому виджет должен
 * раздаваться с того же адреса. Это не то же самое, что установка из npm, и
 * сделано намеренно: так демонстрация всегда показывает ТОТ ЖЕ код, что лежит в
 * репозитории. Иначе после правки виджета на странице оставался бы старый
 * выпущенный файл, и это выглядело бы как неработающая правка.
 *
 * Путь к виджету берём из соседнего пакета, а не из node_modules: сборка
 * кладёт файлы именно туда.
 */
const source = fileURLToPath(new URL('../../../packages/widget/dist', import.meta.url));
const target = fileURLToPath(new URL('../public/ecw', import.meta.url));

/** Только те файлы, которые нужны странице: загрузчик и основной бандл. */
const FILES = ['ecw-loader.iife.js', 'ecw-widget.iife.js'];

if (!existsSync(source)) {
  console.error(`Нет собранного виджета: ${source}`);
  console.error('Сначала собери его: pnpm --filter ecw-widget build');
  process.exit(1);
}

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });

for (const file of FILES) {
  const from = fileURLToPath(new URL(file, `file:///${source.replaceAll('\\', '/')}/`));

  if (!existsSync(from)) {
    console.error(`В сборке виджета нет файла ${file}`);
    process.exit(1);
  }

  cpSync(from, fileURLToPath(new URL(file, `file:///${target.replaceAll('\\', '/')}/`)));
}

console.log(`Виджет скопирован в public/ecw: ${FILES.join(', ')}`);
