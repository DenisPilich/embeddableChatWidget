import { CONTRACT_VERSION, type SiteId } from '@ecw/shared';

/**
 * Публичная точка входа виджета.
 *
 * ВНИМАНИЕ: это заглушка Фазы 0. Она не рисует интерфейс — её задача доказать,
 * что сборка библиотеки, связи между пакетами монорепо и загрузка скрипта на
 * чужой странице работают. Настоящий виджет (Shadow DOM, окно чата) — Фаза 1.
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
    ECW?: EcwGlobal;
  }
}

export function init(options: InitOptions): void {
  // Виджет обязан быть безопасным гостем на чужой странице: любая наша ошибка
  // не имеет права сломать сайт клиента. Отсюда проверки вместо предположений.
  if (typeof document === 'undefined') return;

  console.info(`[ecw] заглушка инициализирована: siteId=${options.siteId}, контракт v${CONTRACT_VERSION}`);
}

// Самопроверка сборки: если этот объект виден на чужой странице, значит IIFE-сборка,
// резолв workspace-зависимости и подключение скрипта работают.
if (typeof window !== 'undefined') {
  window.ECW = { init, version: `0.0.0+contract.${CONTRACT_VERSION}` };
}
