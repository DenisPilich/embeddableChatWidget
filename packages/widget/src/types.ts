import type { SiteId } from '@ecw/shared';

/** Параметры инициализации виджета. */
export interface InitOptions {
  /** Публичный идентификатор сайта, полученный в дашборде. */
  siteId: SiteId;
}

/**
 * Минимальный набор действий, который публичный API ожидает от экземпляра
 * виджета. Описан отдельно от самого класса, чтобы состояние на `window`
 * можно было типизировать без циклического импорта.
 */
export interface WidgetInstance {
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
}

/** Публичный объект, который виджет выставляет на страницу клиента. */
export interface EcwGlobal extends WidgetInstance {
  readonly version: string;
  init(options: InitOptions): void;
}

declare global {
  interface Window {
    /** Публичный объект виджета на странице клиента. */
    ECW?: EcwGlobal;
    /**
     * Включает отладочные сообщения виджета. По умолчанию выключено: на чужой
     * странице виджет не имеет права шуметь без явной просьбы.
     */
    ECW_DEBUG?: boolean;
    /**
     * Общее состояние виджета.
     *
     * Хранится на `window`, а не в переменной модуля: если скрипт подключён на
     * страницу дважды, модуль выполнится дважды, и у каждой копии появится своя
     * переменная. `window` же один на страницу.
     */
    __ECW_STATE__?: { instance: WidgetInstance | null };
  }
}
