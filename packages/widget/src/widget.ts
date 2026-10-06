import type { AuthorKind, ChatMessage } from '@ecw/shared';
import { mustFind, pickMountNode } from './dom';
import { log } from './logger';
import { MessagesView } from './messages-view';
import { loadHistory, saveHistory } from './storage';
import { applyStyles } from './styles';
import type { Transport } from './transport';
import type { InitOptions, MessageStatus, WidgetInstance, WidgetMessage } from './types';
import { createId } from './utils';

/** Атрибут, по которому host-элемент виджета находится в светлом DOM. */
export const HOST_ATTRIBUTE = 'data-ecw-host';

/** Атрибут, включающий открытое состояние. */
const OPEN_ATTRIBUTE = 'data-ecw-open';

/** Приветствие ассистента. В Фазе 5 текст будет приходить из настроек сайта. */
const GREETING = 'Здравствуйте! Спросите про часы работы или как нас найти.';

/** Предельная высота поля ввода в пикселях: дальше оно начинает прокручиваться. */
const INPUT_MAX_HEIGHT = 120;

/**
 * С какого числа непрочитанных показывать «9+».
 * Точное число в углу кнопки всё равно не читается, а место занимает.
 */
const UNREAD_LIMIT = 9;

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
  <div
    class="ecw-panel"
    role="dialog"
    aria-modal="true"
    aria-label="Чат"
    aria-hidden="true"
    tabindex="-1"
  >
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

    <div
      class="ecw-body"
      role="log"
      aria-label="Переписка"
      aria-live="polite"
      aria-relevant="additions"
      tabindex="0"
    >
      <div class="ecw-log">
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
    <span class="ecw-badge" aria-hidden="true" hidden></span>
  </button>
`;

/**
 * Виджет на странице клиента.
 *
 * Один экземпляр на страницу. Состояние открытия хранится в атрибуте
 * host-элемента, а не только в поле класса: так стили внутри shadow root могут
 * на него реагировать (`:host([data-ecw-open])`), и в devtools видно, что
 * происходит.
 *
 * Список сообщений живёт здесь, а не в представлении: представление умеет
 * только показывать, а хранить, отдавать в хранилище и считать непрочитанные —
 * дело виджета.
 */
export class ChatWidget implements WidgetInstance {
  private readonly host: HTMLElement;
  private readonly launcher: HTMLButtonElement;
  private readonly badge: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly input: HTMLTextAreaElement;
  private readonly sendButton: HTMLButtonElement;
  private readonly composer: HTMLFormElement;
  private readonly shadow: ShadowRoot;
  private readonly messages: MessagesView;
  private readonly onDocumentKeyDown: (event: KeyboardEvent) => void;
  private readonly history: WidgetMessage[] = [];
  private opened = false;
  private unread = 0;

  constructor(
    private readonly options: InitOptions,
    private readonly transport: Transport,
  ) {
    this.host = document.createElement('div');
    this.host.setAttribute(HOST_ATTRIBUTE, '');
    // Атрибут нужен только для отладки: на чужой странице он сразу отвечает
    // на вопрос «а какой siteId здесь вообще подключён».
    this.host.setAttribute('data-ecw-site', options.siteId);

    // Режим 'open', а не 'closed': closed не даёт настоящей защиты (стили и
    // разметку всё равно видно в devtools), но лишает возможности отлаживать
    // и тестировать виджет снаружи.
    this.shadow = this.host.attachShadow({ mode: 'open' });
    const shadow = this.shadow;
    applyStyles(shadow);

    const container = document.createElement('div');
    // Обёртка, на которой держится сброс наследуемых свойств: до неё селекторы
    // страницы клиента не достают. Подробности — в styles.css и ADR-010.
    container.className = 'ecw-root';
    container.innerHTML = MARKUP;
    shadow.append(container);

    this.panel = mustFind<HTMLElement>(shadow, '.ecw-panel');
    this.launcher = mustFind<HTMLButtonElement>(shadow, '.ecw-launcher');
    this.badge = mustFind<HTMLElement>(shadow, '.ecw-badge');
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

    // Обработчик висит на документе, а не на shadow root: события клавиатуры
    // всплывают из теневого дерева наружу, поэтому так мы поймаем их, даже если
    // фокус оказался на странице клиента.
    this.onDocumentKeyDown = (event) => this.handleDocumentKeyDown(event);
    document.addEventListener('keydown', this.onDocumentKeyDown);

    const mount = pickMountNode();
    mount.append(this.host);
    log(`виджет добавлен в <${mount.tagName.toLowerCase()}>`);

    this.restoreHistory();
    if (this.history.length === 0) {
      // Приветствие показываем только в пустой переписке: возвращаться к
      // разговору с ним посреди уже начатого диалога было бы странно.
      this.appendMessage(this.createMessage('ai', GREETING));
    }

    this.refreshLauncher();
    this.refreshSendState();
    // Высота выставляется сразу, а не при первом нажатии: иначе поле ввода
    // чуть подрастает при вводе первого символа.
    this.autoGrow();

    // Подписка на входящие и открытие сессии. Неудачу открытия разбирает тот,
    // кто создал транспорт: виджету в этот момент показать посетителю нечего.
    this.transport.onMessages((messages) => this.handleIncoming(messages));
    void this.transport.connect();
  }

  open(): void {
    if (this.opened) return;
    this.opened = true;
    this.host.setAttribute(OPEN_ATTRIBUTE, '');
    this.panel.removeAttribute('aria-hidden');
    // Открытие окна — признак того, что посетитель прочитал всё, что пришло.
    this.unread = 0;
    this.refreshLauncher();
    // Пока окно было скрыто, в нём могли появиться сообщения — показываем
    // последнее из них.
    this.messages.scrollToLatest();
    // Фокус переносим внутрь окна: иначе он остался бы на кнопке запуска, а
    // программа чтения с экрана не узнала бы, что открылся диалог. Ставим его
    // на само окно, а не на поле ввода: на телефоне фокус в поле немедленно
    // поднял бы экранную клавиатуру и закрыл приветствие.
    this.panel.focus();
    log('окно открыто');
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.host.removeAttribute(OPEN_ATTRIBUTE);
    this.panel.setAttribute('aria-hidden', 'true');
    this.refreshLauncher();
    // Возвращаем фокус туда, откуда пришли: иначе после Esc он оказался бы
    // нигде, и обход страницы клавиатурой начинался бы с самого начала.
    this.launcher.focus();
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

  /**
   * Esc закрывает окно, Tab не выпускает фокус наружу.
   *
   * Удержание фокуса обязательно, раз окно объявлено модальным
   * (`aria-modal="true"`): в этом режиме программа чтения с экрана игнорирует
   * всё за пределами диалога, и фокус, ушедший на страницу клиента, оказался бы
   * для пользователя в невидимой области.
   */
  private handleDocumentKeyDown(event: KeyboardEvent): void {
    if (!this.opened) return;

    if (event.key === 'Escape') {
      this.close();
      return;
    }

    if (event.key === 'Tab') this.trapFocus(event);
  }

  private trapFocus(event: KeyboardEvent): void {
    const items = this.focusableItems();
    const first = items[0];
    const last = items[items.length - 1];

    if (!first || !last) {
      event.preventDefault();
      return;
    }

    const active = this.shadow.activeElement;
    const isInside = active !== null && items.some((item) => item === active);

    if (event.shiftKey) {
      if (isInside && active !== first) return;
      event.preventDefault();
      last.focus();
      return;
    }

    if (isInside && active !== last) return;
    event.preventDefault();
    first.focus();
  }

  /**
   * Элементы, которые могут получить фокус прямо сейчас.
   *
   * Ссылки и поля перечислены явно: селектор по одному лишь `[tabindex]` поймал
   * бы и само окно, у которого `tabindex="-1"` — оно нужно как цель
   * программного фокуса, но не как остановка при обходе.
   */
  private focusableItems(): HTMLElement[] {
    const selector =
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

    return Array.from(this.shadow.querySelectorAll<HTMLElement>(selector)).filter(
      (element) => element.closest('[hidden]') === null,
    );
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
    this.appendMessage(outgoing);

    this.input.value = '';
    this.autoGrow();
    this.refreshSendState();
    // Отправка кнопкой делает её неактивной (поле пустое), а неактивный элемент
    // не может держать фокус — он улетел бы на страницу клиента. Возвращаем
    // фокус в поле ввода: заодно удобнее писать следующее сообщение.
    this.input.focus();

    // Намеренно без await: отправка не должна задерживать интерфейс, а ошибку
    // разбирает deliver. Ключевое слово void явно сообщает линтеру, что промис
    // оставлен без ожидания осознанно — этого и требует no-floating-promises.
    void this.deliver(outgoing);
  }

  /**
   * Передаёт сообщение транспорту и ждёт подтверждения.
   *
   * Подтверждение означает «сервер принял и записал», а не «ассистент ответил».
   * Ответ придёт отдельно, через подписку: он может не прийти вовсе, и это не
   * ошибка отправки.
   */
  private async deliver(outgoing: WidgetMessage): Promise<void> {
    try {
      await this.transport.send({ clientId: outgoing.id, body: outgoing.body });
      this.updateStatus(outgoing.id, 'sent');
      // Набор показываем сразу после подтверждения: ответ придёт не мгновенно.
      this.messages.setTyping(true);
    } catch (error) {
      this.updateStatus(outgoing.id, 'failed');
      console.error('[ecw] не удалось отправить сообщение', error);
    }
  }

  /** Принимает всё, что транспорт принёс из диалога. */
  private handleIncoming(incoming: readonly ChatMessage[]): void {
    if (incoming.length === 0) return;

    // Первое пришедшее сообщение означает, что ответ готов.
    this.messages.setTyping(false);

    for (const message of incoming) {
      this.appendMessage({
        id: message.id,
        authorKind: message.authorKind,
        body: message.body,
        createdAt: message.createdAt,
        status: 'sent',
      });
      this.registerIncoming();
    }
  }

  /**
   * Добавляет сообщение: в список, в представление и в хранилище.
   *
   * Единая точка нужна, чтобы эти три места не разъезжались. Любое новое
   * сообщение обязано проходить здесь.
   */
  private appendMessage(message: WidgetMessage): void {
    this.history.push(message);
    this.messages.append(message);
    this.persist();
  }

  /** Меняет состояние доставки — тоже во всех трёх местах сразу. */
  private updateStatus(id: string, status: MessageStatus): void {
    const message = this.history.find((candidate) => candidate.id === id);
    if (message) message.status = status;

    this.messages.setStatus(id, status);
    this.persist();
  }

  private persist(): void {
    saveHistory(this.options.siteId, this.history);
  }

  /**
   * Восстанавливает переписку из хранилища.
   *
   * Сообщения вставляются напрямую, минуя appendMessage: сохранять только что
   * прочитанное обратно в хранилище незачем.
   */
  private restoreHistory(): void {
    const restored = loadHistory(this.options.siteId);
    if (restored.length === 0) return;

    for (const message of restored) {
      this.history.push(message);
      this.messages.append(message);
    }

    this.messages.scrollToLatest();
    log(`переписка восстановлена: ${restored.length} сообщений`);
  }

  /**
   * Учитывает сообщение, пришедшее без открытого окна.
   *
   * Именно так работает счётчик непрочитанных: посетитель свернул чат, ответ
   * пришёл — он должен увидеть это на кнопке, иначе ответа он не заметит.
   */
  private registerIncoming(): void {
    if (this.opened) return;
    this.unread += 1;
    this.refreshLauncher();
  }

  /** Приводит кнопку запуска в соответствие состоянию: подпись и счётчик. */
  private refreshLauncher(): void {
    this.launcher.setAttribute('aria-expanded', String(this.opened));
    this.launcher.setAttribute('aria-label', this.launcherLabel());
    this.badge.hidden = this.unread === 0;
    if (this.unread > 0) {
      this.badge.textContent =
        this.unread > UNREAD_LIMIT ? `${UNREAD_LIMIT}+` : String(this.unread);
    }
  }

  private launcherLabel(): string {
    if (this.opened) return 'Закрыть чат';
    // Число непрочитанных озвучивается словами: точка с цифрой для программы
    // чтения с экрана — просто «один», без смысла.
    if (this.unread > 0) return `Открыть чат, новых сообщений: ${this.unread}`;
    return 'Открыть чат';
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
