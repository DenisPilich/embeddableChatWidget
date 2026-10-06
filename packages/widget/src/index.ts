import { readOptionsFromScript } from './config';
import { whenReady } from './dom';
import { log } from './logger';
import { LocalTransport } from './transport-local';
import { ChatWidget, HOST_ATTRIBUTE } from './widget';
import type { InitOptions, WidgetInstance } from './types';

export type { EcwGlobal, InitOptions, WidgetInstance } from './types';

/**
 * Версия пакета. Подставляется сборщиком на этапе сборки (см. `define`
 * в vite.config.ts) — так версия в коде и версия в package.json не разъезжаются.
 */
declare const __ECW_VERSION__: string;

export const version = __ECW_VERSION__;

/**
 * Общее состояние виджета.
 *
 * Лежит на `window`, а не в переменной модуля: если скрипт подключён дважды,
 * модуль выполнится дважды, и у каждой копии будет своя переменная, а страница
 * у нас одна.
 */
function state(): { instance: WidgetInstance | null } {
  const existing = window.__ECW_STATE__;
  if (existing) return existing;

  const created: { instance: WidgetInstance | null } = { instance: null };
  window.__ECW_STATE__ = created;
  return created;
}

/**
 * Создаёт виджет на странице клиента.
 *
 * Повторные вызовы безопасны: второй виджет не появится.
 */
export function init(options: InitOptions): void {
  // Пакет может быть импортирован и вне браузера: при сборке, в тестах, при
  // серверном рендеринге. Там виджет обязан молча ничего не делать.
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const siteId = typeof options?.siteId === 'string' ? options.siteId.trim() : '';
  if (!siteId) {
    // Не бросаем исключение: наша ошибка не должна ломать чужую страницу.
    console.warn('[ecw] виджет не запущен: не указан siteId');
    return;
  }

  const current = state();
  if (current.instance) {
    log('виджет уже создан, повторная инициализация пропущена');
    return;
  }

  // Вторая линия защиты. Состояние на window спасает от двойного подключения
  // скрипта, а эта проверка — ещё и от случая, когда разметка осталась, а
  // состояние почему-то потеряно.
  if (document.querySelector(`[${HOST_ATTRIBUTE}]`)) {
    console.warn('[ecw] на странице уже есть виджет');
    return;
  }

  try {
    // Транспорт создаётся здесь и передаётся виджету. Это единственное место,
    // которое знает, каким способом ходят сообщения: чтобы перейти на настоящий
    // сервер, меняется ровно эта строка, а виджет остаётся прежним.
    current.instance = new ChatWidget({ siteId }, new LocalTransport());
    log(`виджет готов: siteId=${siteId}, версия ${version}`);
  } catch (error) {
    // Виджет — гость на чужой странице: выпускать исключение наружу нельзя,
    // иначе оно всплывёт в чужом коде обработчиком ошибок.
    console.error('[ecw] не удалось создать виджет', error);
  }
}

export function open(): void {
  state().instance?.open();
}

export function close(): void {
  state().instance?.close();
}

export function toggle(): void {
  state().instance?.toggle();
}

export function isOpen(): boolean {
  return state().instance?.isOpen() ?? false;
}

if (typeof window !== 'undefined') {
  // Публичный объект на странице клиента. Для сборки в формате IIFE этот же
  // набор функций выставляет и сам сборщик (build.lib.name), а для тех, кто
  // ставит пакет из npm, он нужен здесь.
  window.ECW = { version, init, open, close, toggle, isOpen };

  // Автозапуск: клиент вставил <script src="..." data-site-id="..." async>.
  // Разметка при этом может быть ещё не разобрана — whenReady это учитывает.
  const options = typeof document === 'undefined' ? null : readOptionsFromScript();
  if (options) {
    whenReady(() => init(options));
  } else {
    log('параметров в теге скрипта нет: ждём вызова window.ECW.init({ siteId })');
  }
}
