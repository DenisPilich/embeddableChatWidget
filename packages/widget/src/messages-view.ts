import type { MessageStatus, WidgetMessage } from './types';

/** Формат времени рядом с сообщением. */
const TIME_FORMAT: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };

/**
 * Отображение переписки.
 *
 * Занимается только показом: превращает данные в элементы и следит за
 * прокруткой. Ничего не знает ни о сети, ни о том, кто отвечает.
 */
export class MessagesView {
  private readonly scrollContainer: HTMLElement;
  private readonly log: HTMLElement;
  private readonly typingRow: HTMLElement;
  private readonly nodes = new Map<string, HTMLElement>();
  private readonly timeFormatter: Intl.DateTimeFormat;
  /** Предварительный показ ответа: существует только на экране, не в переписке. */
  private streamingRow: HTMLElement | null = null;
  private streamingBubble: HTMLElement | null = null;

  constructor(scrollContainer: HTMLElement, log: HTMLElement, typingRow: HTMLElement) {
    this.scrollContainer = scrollContainer;
    this.log = log;
    this.typingRow = typingRow;

    // Язык берём у страницы клиента: виджет стоит на чужом сайте и должен
    // выглядеть своим, а не навязывать свой язык форматирования.
    const locale = document.documentElement.lang || undefined;
    this.timeFormatter = new Intl.DateTimeFormat(locale, TIME_FORMAT);
  }

  append(message: WidgetMessage): void {
    // Окончательное сообщение вытесняет предварительный показ: иначе один и тот
    // же ответ остался бы в переписке дважды.
    this.setStreamingText(null);

    const row = this.buildRow(message);
    this.nodes.set(message.id, row);

    // Индикатор набора должен всегда оставаться последним, поэтому новое
    // сообщение встаёт перед ним, а не просто в конец.
    if (this.typingRow.hidden) this.log.append(row);
    else this.log.insertBefore(row, this.typingRow);

    this.scrollToLatest();
  }

  /**
   * Показывает ответ по мере появления.
   *
   * `null` убирает показ. Отдельного сообщения в переписке для этого нет: это
   * предварительный показ, который заменится настоящим сообщением. Хранить его
   * нельзя — незаконченный ответ не должен переживать перезагрузку страницы и
   * попадать оператору.
   */
  setStreamingText(text: string | null): void {
    if (text === null) {
      this.streamingRow?.remove();
      this.streamingRow = null;
      this.streamingBubble = null;
      return;
    }

    if (!this.streamingRow || !this.streamingBubble) {
      const row = document.createElement('div');
      row.className = 'ecw-message ecw-message--ai ecw-message--streaming';

      const bubble = document.createElement('div');
      bubble.className = 'ecw-message__bubble';

      row.append(bubble);
      this.streamingRow = row;
      this.streamingBubble = bubble;

      if (this.typingRow.hidden) this.log.append(row);
      else this.log.insertBefore(row, this.typingRow);
    }

    // Только textContent: ответ модели — такой же чужой текст, как и сообщение
    // посетителя, и вставлять его через innerHTML нельзя.
    this.streamingBubble.textContent = text;
    this.scrollToLatest();
  }

  setStatus(id: string, status: MessageStatus): void {
    const row = this.nodes.get(id);
    if (!row) return;
    row.dataset.status = status;
  }

  setTyping(visible: boolean): void {
    this.typingRow.hidden = !visible;
    if (!visible) return;

    // Переносим индикатор в конец: перед показом он мог оказаться выше
    // последних сообщений.
    this.log.append(this.typingRow);
    this.scrollToLatest();
  }

  scrollToLatest(): void {
    this.scrollContainer.scrollTop = this.scrollContainer.scrollHeight;
  }

  private buildRow(message: WidgetMessage): HTMLElement {
    const row = document.createElement('div');
    row.className = `ecw-message ecw-message--${message.authorKind}`;
    row.dataset.status = message.status;

    const bubble = document.createElement('div');
    bubble.className = 'ecw-message__bubble';
    // ВАЖНО: текст посетителя попадает в DOM только через textContent.
    // Через innerHTML он означал бы XSS: посетитель напишет <img onerror=...>,
    // и это выполнится на странице клиента.
    bubble.textContent = message.body;
    row.append(bubble);

    const time = document.createElement('time');
    time.className = 'ecw-message__time';
    time.dateTime = message.createdAt;
    time.textContent = this.timeFormatter.format(new Date(message.createdAt));
    row.append(time);

    return row;
  }
}
