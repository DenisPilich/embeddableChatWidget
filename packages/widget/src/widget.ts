import type { AuthorKind } from '@ecw/shared';
import { reply } from './assistant';
import { mustFind, pickMountNode } from './dom';
import { log } from './logger';
import { MessagesView } from './messages-view';
import { applyStyles } from './styles';
import type { InitOptions, MessageStatus, WidgetInstance, WidgetMessage } from './types';
import { createId, delay } from './utils';

/** Атрибут, по которому host-элемент виджета находится в светлом DOM. */
export const HOST_ATTRIBUTE = 'data-ecw-host';

/** Атрибут, включающий открытое состояние. */
const OPEN_ATTRIBUTE = 'data-ecw-open';

/** Приветствие ассистента. В Фазе 5 текст будет приходить из настроек сайта. */
const GREETING = 'Здравствуйте! Спросите про часы работы или как нас найти.';

/** Предельная высота поля ввода в пикселях: дальше оно начинает прокручиваться. */
const INPUT_MAX_HEIGHT = 120;

/**
 * Разметка виджета.
 *
 * Это статичная строка из нашего исходного кода: сюда никогда не попадают ни
 * данные из сети, ни текст посетителя. Правило проекта — innerHTML допустим
 * только для собственной разметки; всё, что приходит извне, вставляется через
 * textContent. Тогда случайная подстановка чужой строки не превратится в XSS.
 *
 * (Идентификаторы внутри shadow root не пересекаются с идентификаторами
 * страницы: дерево своё.)
 */
const MARKUP = `
  <div class="ecw-panel" role="dialog" aria-label="Чат" aria-hidden="true">
    <header class="ecw-header">
      <div class="ecw-header__text">
        <p class="ecw-header__title">Чат</p>
        <p class="ecw-header__status">Отвечает ассистент</p>
      </div>
      <button
        type="button"
        class="ecw-icon-button"
        data-ecw-action="close"
        aria-label="Закрыть чат"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path
            d="M3.5 3.5l9 9M12.5 3.5l-9 9"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
          />
        </svg>
      </button>
    </header>

    <div class="ecw-body">
      <div
        class="ecw-log"
        role="log"
        aria-label="Переписка"
        aria-live="polite"
        aria-relevant="additions"
      >
        <div class="ecw-message ecw-message--typing" hidden>
          <span class="ecw-visually-hidden">Ассистент печатает</span>
          <div class="ecw-message__bubble" aria-hidden="true">
            <span class="ecw-typing-dot"></span>
            <span class="ecw-typing-dot"></span>
            <span class="ecw-typing-dot"></span>
          </div>
        </div>
      </div>
    </div>

    <form class="ecw-composer" data-ecw-composer novalidate>
      <label class="ecw-visually-hidden" for="ecw-input">Сообщение</label>
      <textarea
        id="ecw-input"
        class="ecw-input"
        name="message"
        rows="1"
        placeholder="Написать сообщение…"
        autocomplete="off"
        data-ecw-input
      ></textarea>
      <button type="submit" class="ecw-send" aria-label="Отправить сообщение" disabled data-ecw-send>
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" fill="currentColor" />
        </svg>
      </button>
    </form>
  </div>

  <button
    type="button"
    class="ecw-launcher"
    data-ecw-action="toggle"
    aria-label="Открыть чат"
    aria-expanded="false"
  >
    <span class="ecw-launcher__icon ecw-launcher__icon--chat" aria-hidden="true">
      <svg width="24" height="24" viewBox="0 0 24 24" focusable="false">
        <path
          d="M12 3.5c-4.7 0-8.5 3.1-8.5 7 0 2.2 1.2 4.1 3.2 5.4l-.7 3.6 3.7-1.9c.7.1 1.5.2 2.3.2 4.7 0 8.5-3.1 8.5-7s-3.8-7.3-8.5-7.3z"
          fill="currentColor"
        />
      </svg>
    </span>
    <span class="ecw-launcher__icon ecw-launcher__icon--close" aria-hidden="true">
      <svg width="22" height="22" viewBox="0 0 22 22" focusable="false">
        <path
          d="M5.5 5.5l11 11M16.5 5.5l-11 11"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        />
      </svg>
    </span>
  </button>
`;

/**
 * Виджет на странице клиента.
 *
 * Один экземпляр на страницу. Состояние открытия хранится в атрибуте
 * host-элемента, а не только в поле класса: так стили внутри shadow root могут
 * на него реагировать (`:host([data-ecw-open])`), и в devtools видно, что
 * происходит.
 */
export class ChatWidget implements WidgetInstance {
  private readonly host: HTMLElement;
  private readonly launcher: HTMLButtonElement;
  private readonly panel: HTMLElement;
  private readonly input: HTMLTextAreaElement;
  private readonly sendButton: HTMLButtonElement;
  private readonly composer: HTMLFormElement;
  private readonly messages: MessagesView;
  private readonly onDocumentKeyDown: (event: KeyboardEvent) => void;
  private opened = false;

  constructor(options: InitOptions) {
    this.host = document.createElement('div');
    this.host.setAttribute(HOST_ATTRIBUTE, '');
    // Атрибут нужен только для отладки: на чужой странице он сразу отвечает
    // на вопрос «а какой siteId здесь вообще подключён».
    this.host.setAttribute('data-ecw-site', options.siteId);

    // Режим 'open', а не 'closed': closed не даёт настоящей защиты (стили и
    // разметку всё равно видно в devtools), но лишает возможности отлаживать
    // и тестировать виджет снаружи.
    const shadow = this.host.attachShadow({ mode: 'open' });
    applyStyles(shadow);

    const container = document.createElement('div');
    container.innerHTML = MARKUP;
    shadow.append(container);

    this.panel = mustFind<HTMLElement>(shadow, '.ecw-panel');
    this.launcher = mustFind<HTMLButtonElement>(shadow, '.ecw-launcher');
    this.input = mustFind<HTMLTextAreaElement>(shadow, '[data-ecw-input]');
    this.sendButton = mustFind<HTMLButtonElement>(shadow, '[data-ecw-send]');
    this.composer = mustFind<HTMLFormElement>(shadow, '[data-ecw-composer]');
    this.messages = new MessagesView(
      mustFind<HTMLElement>(shadow, '.ecw-body'),
      mustFind<HTMLElement>(shadow, '.ecw-log'),
      mustFind<HTMLElement>(shadow, '.ecw-message--typing'),
    );

    // Один обработчик на весь виджет вместо обработчика на каждую кнопку:
    // кнопки определяются по атрибуту действия.
    shadow.addEventListener('click', (event) => this.handleClick(event));

    // Форма даёт бесплатную семантику и отправку Enter с клавиатуры на кнопке.
    this.composer.addEventListener('submit', (event) => {
      event.preventDefault();
      this.send();
    });
    this.input.addEventListener('input', () => {
      this.autoGrow();
      this.refreshSendState();
    });
    this.input.addEventListener('keydown', (event) => this.handleInputKeyDown(event));

    // Esc закрывает окно, даже если фокус находится на странице клиента,
    // а не внутри виджета.
    this.onDocumentKeyDown = (event) => {
      if (event.key === 'Escape' && this.opened) this.close();
    };
    document.addEventListener('keydown', this.onDocumentKeyDown);

    const mount = pickMountNode();
    mount.append(this.host);
    log(`виджет добавлен в <${mount.tagName.toLowerCase()}>`);

    this.messages.append(this.createMessage('ai', GREETING));
    this.refreshSendState();
    // Высота выставляется сразу, а не при первом нажатии: иначе поле ввода
    // чуть подрастает при вводе первого символа.
    this.autoGrow();
  }

  open(): void {
    if (this.opened) return;
    this.opened = true;
    this.host.setAttribute(OPEN_ATTRIBUTE, '');
    this.panel.setAttribute('aria-hidden', 'false');
    this.launcher.setAttribute('aria-expanded', 'true');
    this.launcher.setAttribute('aria-label', 'Закрыть чат');
    // Пока окно было скрыто, в нём могли появиться сообщения — показываем
    // последнее из них.
    this.messages.scrollToLatest();
    log('окно открыто');
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.host.removeAttribute(OPEN_ATTRIBUTE);
    this.panel.setAttribute('aria-hidden', 'true');
    this.launcher.setAttribute('aria-expanded', 'false');
    this.launcher.setAttribute('aria-label', 'Открыть чат');
    log('окно закрыто');
  }

  toggle(): void {
    if (this.opened) {
      this.close();
      return;
    }
    this.open();
  }

  isOpen(): boolean {
    return this.opened;
  }

  private handleClick(event: Event): void {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const action = target.closest('[data-ecw-action]')?.getAttribute('data-ecw-action');
    if (action === 'toggle') this.toggle();
    else if (action === 'close') this.close();
  }

  private handleInputKeyDown(event: KeyboardEvent): void {
    // Во время набора иероглифов или через панель ввода Enter подтверждает
    // ввод, а не отправляет сообщение.
    if (event.isComposing) return;

    // Enter отправляет, Shift+Enter переносит строку — как в мессенджерах.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.send();
    }
  }

  private send(): void {
    const body = this.input.value.trim();
    if (!body) return;

    const outgoing = this.createMessage('visitor', body, 'pending');
    this.messages.append(outgoing);

    this.input.value = '';
    this.autoGrow();
    this.refreshSendState();

    // Намеренно без await: отправка не должна задерживать интерфейс, а ошибку
    // разбирает respond. Ключевое слово void явно сообщает линтеру, что промис
    // оставлен без ожидания осознанно — этого и требует no-floating-promises.
    void this.respond(outgoing);
  }

  private async respond(outgoing: WidgetMessage): Promise<void> {
    try {
      // В Фазе 2 здесь будет настоящий запрос к серверу, а подтверждение
      // доставки придёт от него.
      await delay(150);
      this.messages.setStatus(outgoing.id, 'sent');

      this.messages.setTyping(true);
      const answer = await reply(outgoing.body);
      this.messages.setTyping(false);

      this.messages.append(this.createMessage('ai', answer));
    } catch (error) {
      this.messages.setTyping(false);
      this.messages.setStatus(outgoing.id, 'failed');
      console.error('[ecw] не удалось получить ответ', error);
    }
  }

  /**
   * Подгоняет высоту поля ввода под содержимое.
   *
   * Сначала высота сбрасывается: иначе при удалении строк scrollHeight не
   * уменьшится и поле останется высоким.
   */
  private autoGrow(): void {
    this.input.style.height = 'auto';
    this.input.style.height = `${Math.min(this.input.scrollHeight, INPUT_MAX_HEIGHT)}px`;
  }

  private refreshSendState(): void {
    this.sendButton.disabled = this.input.value.trim().length === 0;
  }

  private createMessage(
    authorKind: AuthorKind,
    body: string,
    status: MessageStatus = 'sent',
  ): WidgetMessage {
    return {
      id: createId(),
      authorKind,
      body,
      createdAt: new Date().toISOString(),
      status,
    };
  }
}
