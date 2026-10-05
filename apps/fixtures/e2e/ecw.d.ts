/**
 * Публичный контракт виджета, объявленный со стороны потребителя.
 *
 * Это намеренно не импорт из `@ecw/widget`: тест смотрит на виджет снаружи,
 * как смотрел бы владелец сайта. Если виджет изменит публичный интерфейс,
 * объявление перестанет совпадать с реальностью и тесты это покажут.
 */
export {};

declare global {
  interface Window {
    ECW?: {
      readonly version: string;
      init(options: { siteId: string }): void;
      open(): void;
      close(): void;
      toggle(): void;
      isOpen(): boolean;
    };
    /**
     * Отметки для тестов, которые ставит сам тест через addInitScript.
     * В коде виджета их нет — это инструмент наблюдения снаружи.
     */
    __ecwProbe?: { bundleAtLoad: boolean | null };
  }
}
