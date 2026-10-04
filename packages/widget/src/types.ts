import type { ChatMessage, SiteId } from '@ecw/shared';

/** Параметры инициализации виджета. */
export interface InitOptions {
  /** Публичный идентификатор сайта, полученный в дашборде. */
  siteId: SiteId;
}

/** Состояние доставки сообщения. Существует только на клиенте. */
export type MessageStatus = 'pending' | 'sent' | 'failed';

/**
 * Сообщение в том виде, в каком его показывает интерфейс: часть серверного
 * контракта из `@ecw/shared` плюс состояние доставки, которого на сервере нет.
 *
 * Именно так и задумано: отображение опирается на общий контракт, поэтому в
 * Фазе 2 настоящие сообщения с сервера лягут в тот же код без переделки
 * интерфейса.
 */
export type WidgetMessage = Pick<ChatMessage, 'id' | 'authorKind' | 'body' | 'createdAt'> & {
  status: MessageStatus;
};

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
