/**
 * Стили виджета.
 *
 * Единственный источник стилей: и для современных браузеров, и для запасного
 * пути используется одна и та же строка.
 */
export const styles = `
  :host {
    /* ── Сброс наследуемых свойств ────────────────────────────────────────
       Сквозь границу Shadow DOM проходят только наследуемые свойства: шрифт,
       цвет, межстрочный интервал, выравнивание, направление текста. Всё
       остальное из CSS хозяйской страницы до нас не достаёт. Поэтому сбрасываем
       именно их — иначе на сайте со шрифтом Georgia наш чат окажется с засечками. */
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    font-size: 15px;
    font-weight: 400;
    font-style: normal;
    font-variant: normal;
    line-height: 1.45;
    letter-spacing: normal;
    word-spacing: normal;
    text-align: left;
    text-transform: none;
    text-indent: 0;
    text-shadow: none;
    white-space: normal;
    word-break: normal;
    overflow-wrap: break-word;
    hyphens: none;
    direction: ltr;
    color: #1c1c1e;
    cursor: auto;

    /* ── Настройки внешнего вида ──────────────────────────────────────────
       Пользовательские свойства наследуются через границу Shadow DOM в обе
       стороны. Значит, владелец сайта может переопределить их своими стилями,
       не залезая внутрь виджета. В Фазе 5 сюда лягут настройки из дашборда. */
    --ecw-primary: #4338ca;
    --ecw-primary-hover: #3730a3;
    --ecw-radius: 16px;
    --ecw-gap: 20px;
    --ecw-shadow: 0 12px 32px rgba(15, 23, 42, 0.18), 0 2px 8px rgba(15, 23, 42, 0.08);

    /* ── Расположение ─────────────────────────────────────────────────────
       Host — единственный элемент виджета в светлом DOM. Он нулевого размера
       и висит в углу окна; всё остальное позиционируется внутри него абсолютно.
       Поэтому виджет не занимает места в потоке страницы и не влияет на её
       вёрстку. */
    position: fixed;
    inset: auto var(--ecw-gap) var(--ecw-gap) auto;
    z-index: 2147483000;
    display: block;
    margin: 0;
    padding: 0;
    border: 0;
    background: none;
    box-sizing: border-box;
    -webkit-font-smoothing: antialiased;
  }

  /* Действует только внутри нашего shadow root: на стили страницы не влияет. */
  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }

  /* ── Кнопка запуска ─────────────────────────────────────────────────── */

  .ecw-launcher {
    position: absolute;
    right: 0;
    bottom: 0;
    display: grid;
    place-items: center;
    width: 56px;
    height: 56px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--ecw-primary);
    color: #fff;
    cursor: pointer;
    box-shadow: 0 8px 20px rgba(67, 56, 202, 0.32);
    -webkit-tap-highlight-color: transparent;
    transition:
      background-color 160ms ease,
      transform 160ms ease,
      box-shadow 160ms ease;
  }

  .ecw-launcher:hover {
    background: var(--ecw-primary-hover);
  }

  .ecw-launcher:active {
    transform: scale(0.96);
  }

  .ecw-launcher:focus-visible {
    outline: 3px solid var(--ecw-primary);
    outline-offset: 3px;
  }

  /* Обе иконки лежат в одной ячейке сетки и подменяют друг друга поворотом. */
  .ecw-launcher__icon {
    grid-area: 1 / 1;
    display: block;
    transition:
      opacity 160ms ease,
      transform 160ms ease;
  }

  .ecw-launcher__icon--close {
    opacity: 0;
    transform: rotate(-60deg) scale(0.6);
  }

  :host([data-ecw-open]) .ecw-launcher__icon--chat {
    opacity: 0;
    transform: rotate(60deg) scale(0.6);
  }

  :host([data-ecw-open]) .ecw-launcher__icon--close {
    opacity: 1;
    transform: none;
  }

  /* ── Окно чата ──────────────────────────────────────────────────────── */

  .ecw-panel {
    position: absolute;
    right: 0;
    bottom: 72px;
    display: flex;
    flex-direction: column;
    width: 380px;
    max-width: calc(100vw - 2 * var(--ecw-gap));
    height: min(560px, calc(100vh - 112px));
    height: min(560px, calc(100dvh - 112px));
    overflow: hidden;
    background: #fff;
    border-radius: var(--ecw-radius);
    box-shadow: var(--ecw-shadow);
    transform-origin: bottom right;

    /* Закрытое окно убираем через visibility: оно перестаёт ловить клики и
       попадать в обход клавиатурой, но остаётся в DOM — иначе не получится
       анимация открытия. Задержка на закрытии даёт анимации доиграть. */
    opacity: 0;
    visibility: hidden;
    transform: translateY(12px) scale(0.98);
    transition:
      opacity 160ms ease,
      transform 160ms ease,
      visibility 0s linear 160ms;
  }

  :host([data-ecw-open]) .ecw-panel {
    opacity: 1;
    visibility: visible;
    transform: none;
    transition:
      opacity 160ms ease,
      transform 160ms ease,
      visibility 0s;
  }

  .ecw-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px;
    background: var(--ecw-primary);
    color: #fff;
  }

  .ecw-header__text {
    flex: 1;
    min-width: 0;
  }

  .ecw-header__title {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
  }

  .ecw-header__status {
    margin: 2px 0 0;
    font-size: 13px;
    opacity: 0.82;
  }

  .ecw-icon-button {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    transition: background-color 120ms ease;
  }

  .ecw-icon-button:hover {
    background: rgba(255, 255, 255, 0.16);
  }

  .ecw-icon-button:focus-visible {
    outline: 2px solid currentColor;
    outline-offset: 1px;
  }

  .ecw-body {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
  }

  .ecw-placeholder {
    margin: 24px 0 0;
    color: #8a8f98;
    font-size: 13px;
    text-align: center;
  }

  /* ── Узкие экраны ───────────────────────────────────────────────────── */

  @media (max-width: 480px) {
    .ecw-panel {
      position: fixed;
      inset: 0;
      width: auto;
      max-width: none;
      height: auto;
      border-radius: 0;
    }

    /* В полноэкранном окне кнопка запуска не нужна: закрыть можно из шапки. */
    :host([data-ecw-open]) .ecw-launcher {
      display: none;
    }
  }

  /* ── Уважение к настройкам системы ──────────────────────────────────── */

  @media (prefers-reduced-motion: reduce) {
    .ecw-panel,
    .ecw-launcher,
    .ecw-launcher__icon {
      transition: none;
    }
  }
`;

/**
 * Подключает стили к shadow root.
 *
 * Почему не просто `<style>`: на страницах со строгой Content Security Policy
 * встроенный стиль может быть заблокирован директивой `style-src`, и виджет
 * останется без оформления. Таблица стилей, созданная из скрипта
 * (constructable stylesheet), встроенным стилем не является и под это
 * ограничение не попадает.
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
