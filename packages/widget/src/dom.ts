/**
 * Ждёт, пока документ будет готов принимать элементы.
 *
 * Скрипт подключается с `async` и вполне может выполниться раньше, чем браузер
 * разберёт `<body>`. В этот момент `document.body` ещё `null`, и попытка
 * вставить виджет закончилась бы ошибкой.
 */
export function whenReady(callback: () => void): void {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', callback, { once: true });
    return;
  }
  callback();
}

/**
 * Выбирает узел, в который вставляется host-элемент виджета.
 *
 * `position: fixed` прижимает элемент к окну только до тех пор, пока ни у одного
 * его предка нет `transform`, `filter`, `perspective`, `backdrop-filter` или
 * `will-change: transform`. Любое из этих свойств создаёт новый containing block,
 * и «приклеенный к углу экрана» виджет начинает ездить вместе со страницей.
 * На трансформированном `<body>` переносим host в `<html>`: там, как правило, чисто.
 *
 * Проверка выполняется один раз при инициализации. Если клиент навесит transform
 * на `<body>` позже, динамически, виджет об этом не узнает — это осознанное
 * упрощение.
 */
export function pickMountNode(): Element {
  const body = document.body;
  if (!body) return document.documentElement;

  const style = getComputedStyle(body);
  const createsContainingBlock =
    style.transform !== 'none' ||
    style.filter !== 'none' ||
    style.perspective !== 'none' ||
    style.backdropFilter !== 'none' ||
    style.willChange.includes('transform');

  return createsContainingBlock ? document.documentElement : body;
}

/**
 * Находит элемент, который обязан существовать.
 *
 * Разметка виджета статична и лежит рядом с этим кодом, поэтому сюда можно
 * попасть только при ошибке в самом виджете. Но даже тогда падать на чужой
 * странице нельзя: исключение перехватывается в точке входа и превращается
 * в сообщение об ошибке.
 */
export function mustFind<T extends Element>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`виджет собран неправильно: не найден ${selector}`);
  return found;
}
