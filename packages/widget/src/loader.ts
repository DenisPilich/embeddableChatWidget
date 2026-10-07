/**
 * Загрузчик виджета.
 *
 * Это единственный файл, который подключает клиент:
 *
 *   <script src="https://cdn.example/ecw-loader.iife.js" data-site-id="site_123" async></script>
 *
 * Задач у загрузчика три: узнать параметры, дождаться, пока страница клиента
 * загрузится, и только потом подтянуть основной файл.
 *
 * Почему основной файл отдельно. Он в разы больше загрузчика. Если положить его
 * в этот же файл, он окажется в критическом пути загрузки чужой страницы, а
 * виджет не имеет права ухудшать метрики сайта, по которым клиент ранжируется
 * в поиске и по которым его оценивают посетители. Ленивая загрузка здесь — не
 * про нашу экономию, а про чужие метрики.
 */

/** Имя основного файла, лежащего рядом с загрузчиком. */
const BUNDLE_FILE = 'ecw-widget.iife.js';

/** Отметка на вставленном теге: и защита от повторов, и удобство отладки. */
const BUNDLE_ATTRIBUTE = 'data-ecw-bundle';

/**
 * Предельное ожидание события `load`.
 *
 * Если страница клиента грузится бесконечно — а зависший рекламный скрипт
 * обычное дело, — виджет всё равно должен появиться. Иначе на такой странице
 * чата не будет никогда.
 */
const LOAD_TIMEOUT_MS = 3500;

interface LoaderOptions {
  siteId: string;
  bundleUrl: string;
  /**
   * Все data-атрибуты тега загрузчика.
   *
   * Переносятся целиком, а не по одному: перечислить их поимённо означало бы,
   * что каждый новый параметр виджета надо не забыть добавить и сюда. Забыть
   * легко, а ошибка при этом молчаливая — параметр просто не доедет, и виджет
   * будет вести себя не так, как написано в документации.
   */
  attributes: Record<string, string>;
}

let scheduled = false;

/**
 * Читает параметры из собственного тега.
 *
 * `document.currentScript` заполнен, пока выполняется сам скрипт. Это работает
 * и для `async`, и для динамически вставленных скриптов — то есть и тогда,
 * когда загрузчик подключён обычным тегом, и тогда, когда его подключил кто-то
 * ещё своим кодом. У `type="module"` это свойство пустое: модули так не
 * работают, и такой способ подключения мы не поддерживаем.
 */
function readOptions(): LoaderOptions | null {
  const script = document.currentScript;
  if (!(script instanceof HTMLScriptElement)) return null;

  const siteId = script.dataset.siteId?.trim();
  if (!siteId || !script.src) return null;

  const attributes: Record<string, string> = {};
  for (const attribute of script.attributes) {
    if (attribute.name.startsWith('data-') && attribute.name !== BUNDLE_ATTRIBUTE) {
      attributes[attribute.name] = attribute.value;
    }
  }

  // Адрес основного файла выводим из адреса самого загрузчика. Клиенту
  // достаточно одной ссылки, и версия в ней одна на оба файла — иначе они
  // однажды разъедутся.
  return { siteId, bundleUrl: new URL(BUNDLE_FILE, script.src).href, attributes };
}

function injectBundle(options: LoaderOptions): void {
  // Проверяем ещё раз перед самой вставкой. Пока мы ждали события load, на
  // странице мог отработать второй экземпляр загрузчика — клиент вставил
  // сниппет дважды, и это происходит регулярно. Проверка в начале работы
  // такой случай не поймает: оба экземпляра стартуют до вставки.
  if (document.querySelector(`script[${BUNDLE_ATTRIBUTE}]`)) return;

  const script = document.createElement('script');
  script.src = options.bundleUrl;
  script.async = true;
  script.setAttribute(BUNDLE_ATTRIBUTE, '');
  // Основной файл читает параметры из собственного тега — ровно так же, как
  // читал бы их у клиента при прямой вставке. Поэтому достаточно перенести
  // атрибуты, и основной файл не знает, что его кто-то загрузил.
  for (const [name, value] of Object.entries(options.attributes)) {
    script.setAttribute(name, value);
  }
  // Значение с обрезанными пробелами важнее исходного: проверка выше уже
  // убедилась, что оно непустое.
  script.setAttribute('data-site-id', options.siteId);
  document.head.append(script);
}

function schedule(options: LoaderOptions): void {
  if (scheduled) return;
  scheduled = true;

  // requestIdleCallback отдаёт браузеру возможность сначала закончить срочные
  // дела; timeout — страховка на случай, если браузер занят постоянно.
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(() => injectBundle(options), { timeout: 2000 });
    return;
  }
  window.setTimeout(() => injectBundle(options), 200);
}

const options = readOptions();

if (!options) {
  // Не бросаем исключение: наша ошибка не должна ломать чужую страницу.
  console.warn('[ecw] загрузчик не запущен: в теге скрипта нет data-site-id или src');
} else if (document.readyState === 'complete') {
  schedule(options);
} else {
  window.addEventListener('load', () => schedule(options), { once: true });
  window.setTimeout(() => schedule(options), LOAD_TIMEOUT_MS);
}
