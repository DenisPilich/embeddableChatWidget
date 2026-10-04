import styles from './styles.css?inline';

/**
 * Подключает стили к shadow root.
 *
 * Стили лежат в настоящем CSS-файле и подключаются через `?inline`. Это не
 * косметика: Vite отдаёт файл строкой, но обрабатывает его как CSS — при сборке
 * комментарии удаляются. Если держать стили прямо в JS-строке, минификатор их не
 * тронет (для него это содержимое строки, а не таблица стилей), и все пояснения
 * для разработчика уедут на страницы клиентов. Замерено: около килобайта gzip
 * из девяти.
 *
 * Строка нужна потому, что стили живут внутри shadow root, а не в документе.
 *
 * Почему не просто `<style>`: на страницах со строгой Content Security Policy
 * встроенный стиль может быть заблокирован директивой `style-src`, и виджет
 * останется без оформления. Таблица стилей, созданная из скрипта
 * (constructable stylesheet), встроенным стилем не является и под это
 * ограничение не попадает — проверено на стенде со строгой политикой.
 */
export function applyStyles(root: ShadowRoot): void {
  if (supportsConstructableStylesheets()) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(styles);
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    return;
  }

  // Запасной путь для браузеров без поддержки adoptedStyleSheets.
  const element = document.createElement('style');
  element.textContent = styles;
  root.append(element);
}

function supportsConstructableStylesheets(): boolean {
  return (
    typeof CSSStyleSheet !== 'undefined' &&
    'replaceSync' in CSSStyleSheet.prototype &&
    'adoptedStyleSheets' in ShadowRoot.prototype
  );
}
