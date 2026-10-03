import { CONTRACT_VERSION, type SiteId } from '@ecw/shared';

/**
 * Публичная точка входа виджета.
 *
 * ВНИМАНИЕ: это заглушка. Она не рисует интерфейс — её задача доказать, что
 * сборка библиотеки, связи между пакетами монорепо и загрузка скрипта на чужой
 * странице работают. Настоящий виджет (Shadow DOM, окно чата) — Фаза 1.
 */

export interface InitOptions {
  siteId: SiteId;
}

export interface EcwGlobal {
  init(options: InitOptions): void;
  version: string;
}

declare global {
  interface Window {
    /** Публичный объект виджета на странице клиента. */
    ECW?: EcwGlobal;
    /**
     * Включает отладочные сообщения. По умолчанию выключено: на чужой странице
     * виджет не имеет права шуметь без явной просьбы.
     */
    ECW_DEBUG?: boolean;
  }
}

export function init(options: InitOptions): void {
  // Виджет обязан быть безопасным гостем на чужой странице: любая наша ошибка
  // не имеет права сломать сайт клиента. Отсюда проверки вместо предположений.
  if (typeof document === 'undefined') return;

  log(`заглушка инициализирована: siteId=${options.siteId}, контракт v${CONTRACT_VERSION}`);
}

/**
 * Единственное место в виджете, которому разрешено писать в консоль — и только
 * тогда, когда отладку включили явно. Правило no-console сознательно запрещает
 * делать это где-либо ещё, поэтому здесь стоит точечное исключение с причиной;
 * в Фазе 1 этот код переедет в отдельный модуль отладки.
 */
function log(message: string): void {
  if (typeof window === 'undefined' || !window.ECW_DEBUG) return;
  // eslint-disable-next-line no-console -- см. пояснение к функции log
  console.info(`[ecw] ${message}`);
}

// Самопроверка сборки: если этот объект виден на чужой странице, значит IIFE-сборка,
// резолв workspace-зависимости и подключение скрипта работают.
if (typeof window !== 'undefined') {
  window.ECW = { init, version: `0.0.0+contract.${CONTRACT_VERSION}` };
}
