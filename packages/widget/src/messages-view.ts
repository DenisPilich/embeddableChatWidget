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
    const row = this.buildRow(message);
    this.nodes.set(message.id, row);

    // Индикатор набора должен всегда оставаться последним, поэтому новое
    // сообщение встаёт перед ним, а не просто в конец.
    if (this.typingRow.hidden) this.log.append(row);
    else this.log.insertBefore(row, this.typingRow);

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
