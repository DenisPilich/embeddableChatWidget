import type { AuthorKind, ChatMessage, MenuItem, WidgetAppearance } from '@ecw/shared';
import { mustFind, pickMountNode } from './dom';
import { log } from './logger';
import { MessagesView } from './messages-view';
import { loadAppearance, loadHistory, saveAppearance, saveHistory } from './storage';
import { applyStyles } from './styles';
import type { Transport } from './transport';
import type { InitOptions, MessageStatus, WidgetInstance, WidgetMessage } from './types';
import { createId } from './utils';

/** Атрибут, по которому host-элемент виджета находится в светлом DOM. */
export const HOST_ATTRIBUTE = 'data-ecw-host';

/** Атрибут, включающий открытое состояние. */
const OPEN_ATTRIBUTE = 'data-ecw-open';

/** Приветствие ассистента. В Фазе 5 текст будет приходить из настроек сайта. */
const GREETING = 'Hello! Ask about our opening hours or how to find us.';

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
    aria-label="Chat"
    aria-hidden="true"
    tabindex="-1"
  >
    <header class="ecw-header">
      <div class="ecw-header__text">
        <p class="ecw-header__title">Chat</p>
        <p class="ecw-header__status" data-ecw-status>Assistant replies</p>
      </div>
      <button type="button" class="ecw-link" data-ecw-action="human" data-ecw-human>
        Talk to a human
      </button>
      <button
        type="button"
        class="ecw-icon-button"
        data-ecw-action="close"
        aria-label="Close chat"
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
      aria-label="Conversation"
      aria-live="polite"
      aria-relevant="additions"
      tabindex="0"
    >
      <div class="ecw-log">
        <div class="ecw-message ecw-message--typing" hidden>
          <span class="ecw-visually-hidden">Assistant is typing</span>
          <div class="ecw-message__bubble" aria-hidden="true">
            <span class="ecw-typing-dot"></span>
            <span class="ecw-typing-dot"></span>
            <span class="ecw-typing-dot"></span>
          </div>
        </div>
      </div>
    </div>

    <div class="ecw-menu" data-ecw-menu hidden>
      <div class="ecw-menu__items" data-ecw-menu-items></div>
      <button
        type="button"
        class="ecw-menu__back"
        data-ecw-action="menu-back"
        data-ecw-menu-back
        hidden
      >
        ← Back
      </button>
    </div>

    <div class="ecw-phone" data-ecw-phone hidden>
      <p class="ecw-phone__text">
        Sorry for the wait. Leave your number and we will call you back.
      </p>
      <form class="ecw-phone__form" data-ecw-phone-form novalidate>
        <label class="ecw-visually-hidden" for="ecw-phone">Phone number</label>
        <input
          id="ecw-phone"
          class="ecw-phone__input"
          type="tel"
          inputmode="tel"
          autocomplete="tel"
          value="+373"
          data-ecw-phone-input
        />
        <button type="submit" class="ecw-phone__submit" data-ecw-phone-submit>Send</button>
      </form>
    </div>

    <form class="ecw-composer" data-ecw-composer novalidate>
      <label class="ecw-visually-hidden" for="ecw-input">Message</label>
      <textarea
        id="ecw-input"
        class="ecw-input"
        name="message"
        rows="1"
        placeholder="Write a message…"
        autocomplete="off"
        data-ecw-input
      ></textarea>
      <button type="submit" class="ecw-send" aria-label="Send message" disabled data-ecw-send>
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
    aria-label="Open chat"
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

/** «4:12» из остатка в миллисекундах. */
function formatLeft(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;

  return `${String(minutes)}:${String(seconds).padStart(2, '0')}`;
}

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
  private readonly title: HTMLElement;
  private readonly status: HTMLElement;
  private readonly humanButton: HTMLElement;
  private readonly input: HTMLTextAreaElement;
  private readonly sendButton: HTMLButtonElement;
  private readonly composer: HTMLFormElement;
  private readonly menuBox: HTMLElement;
  private readonly menuItems: HTMLElement;
  private readonly menuBack: HTMLButtonElement;
  private readonly phoneBox: HTMLElement;
  private readonly phoneForm: HTMLFormElement;
  private readonly phoneInput: HTMLInputElement;
  private readonly shadow: ShadowRoot;
  private readonly messages: MessagesView;
  private readonly onDocumentKeyDown: (event: KeyboardEvent) => void;
  private readonly history: WidgetMessage[] = [];
  private opened = false;
  private unread = 0;
  /**
   * Текст ответа, пришедший по кускам.
   *
   * Живёт только здесь и только до окончания ответа: незаконченный ответ нельзя
   * ни сохранять, ни показывать оператору. В переписку он попадает, когда
   * приходит целиком.
   */
  private draft = '';
  /** Ждёт ли диалог живого оператора. Управляет подписью в шапке и кнопкой. */
  private waiting = false;
  /** Текст приветствия. Может быть задан владельцем сайта. */
  private greeting = GREETING;
  /** Меню сайта. Пусто — обычный чат с полем ввода. */
  private menu: MenuItem[] = [];
  /** Отвечает ли ассистент на свободные вопросы. */
  private aiEnabled = false;
  /** Сколько секунд ждать оператора до предложения телефона. */
  private handoverSeconds = 300;
  /** Когда попросили оператора, мс эпохи. */
  private waitingSince: number | null = null;
  /** Открытое подменю или `null`, если показан верхний уровень. */
  private menuPath: MenuItem | null = null;
  /** Отсчёт ожидания: перерисовывает подпись раз в секунду. */
  private clock: number | null = null;
  /** Оставлял ли посетитель телефон. Второй раз не спрашиваем. */
  private phoneGiven = false;

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
    this.title = mustFind<HTMLElement>(shadow, '.ecw-header__title');
    this.status = mustFind<HTMLElement>(shadow, '[data-ecw-status]');
    this.humanButton = mustFind<HTMLElement>(shadow, '[data-ecw-human]');
    this.launcher = mustFind<HTMLButtonElement>(shadow, '.ecw-launcher');
    this.badge = mustFind<HTMLElement>(shadow, '.ecw-badge');
    this.input = mustFind<HTMLTextAreaElement>(shadow, '[data-ecw-input]');
    this.sendButton = mustFind<HTMLButtonElement>(shadow, '[data-ecw-send]');
    this.composer = mustFind<HTMLFormElement>(shadow, '[data-ecw-composer]');
    this.menuBox = mustFind<HTMLElement>(shadow, '[data-ecw-menu]');
    this.menuItems = mustFind<HTMLElement>(shadow, '[data-ecw-menu-items]');
    this.menuBack = mustFind<HTMLButtonElement>(shadow, '[data-ecw-menu-back]');
    this.phoneBox = mustFind<HTMLElement>(shadow, '[data-ecw-phone]');
    this.phoneForm = mustFind<HTMLFormElement>(shadow, '[data-ecw-phone-form]');
    this.phoneInput = mustFind<HTMLInputElement>(shadow, '[data-ecw-phone-input]');
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
    this.phoneForm.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.sendPhone();
    });

    // Обработчик висит на документе, а не на shadow root: события клавиатуры
    // всплывают из теневого дерева наружу, поэтому так мы поймаем их, даже если
    // фокус оказался на странице клиента.
    this.onDocumentKeyDown = (event) => this.handleDocumentKeyDown(event);
    document.addEventListener('keydown', this.onDocumentKeyDown);

    const mount = pickMountNode();
    mount.append(this.host);
    log(`виджет добавлен в <${mount.tagName.toLowerCase()}>`);

    this.restoreHistory();
    // Вид применяем сразу из кэша, не дожидаясь сессии: иначе возвращающийся
    // посетитель видел бы, как кнопка перекрашивается после открытия страницы.
    this.applyAppearance(loadAppearance(options.siteId));

    this.refreshLauncher();
    this.refreshSendState();
    // Высота выставляется сразу, а не при первом нажатии: иначе поле ввода
    // чуть подрастает при вводе первого символа.
    this.autoGrow();

    // Подписка на входящие и открытие сессии. Неудачу открытия разбирает тот,
    // кто создал транспорт: виджету в этот момент показать посетителю нечего.
    this.transport.onMessages((messages) => this.handleIncoming(messages));
    this.transport.onDelta((text) => this.handleDelta(text));
    this.transport.onIdle(() => {
      this.handleIdle();
    });
    void this.connectSession(0);
  }

  /**
   * Открывает сессию, повторяя попытку при неудаче.
   *
   * Один неудачный запрос не должен оставлять виджет мёртвым. Самая обидная
   * причина — самая обычная: посетитель нажал на кнопку раньше, чем сервер
   * ответил на первый запрос, и виджет до перезагрузки страницы молчал. Три
   * повтора с растущей паузой покрывают это целиком.
   */
  private async connectSession(attempt: number): Promise<void> {
    try {
      await this.transport.connect();

      // Настройки сайта известны только теперь: до открытия сессии виджет не
      // знает ни меню, ни того, включён ли ассистент.
      this.menu = [...this.transport.menu];
      this.aiEnabled = this.transport.aiEnabled;
      this.handoverSeconds = this.transport.handoverTimeout;
      this.waitingSince = this.transport.waitingSince;
      this.phoneGiven = this.transport.phone !== null;

      // Состояние ожидания известно только после открытия сессии: диалог мог
      // ждать оператора ещё с прошлого визита.
      this.setWaiting(this.transport.waitingForHuman);

      const appearance = this.transport.appearance;
      if (appearance !== null) {
        this.applyAppearance(appearance);
        saveAppearance(this.options.siteId, appearance);
      }

      // Приветствие добавляем только теперь: его текст может задать владелец
      // сайта, а приходит он вместе с сессией. Показать одно приветствие и
      // сразу заменить его на другое — хуже, чем подождать доли секунды.
      this.showGreetingIfEmpty();
      this.refreshFlow();
    } catch (error) {
      console.error('[ecw] не удалось открыть сессию', error);
      if (attempt >= 3) return;

      window.setTimeout(
        () => {
          void this.connectSession(attempt + 1);
        },
        1500 * (attempt + 1),
      );
    }
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

  /** Приветствие в пустой переписке. */
  private showGreetingIfEmpty(): void {
    if (this.history.length > 0) return;

    // Показываем только в пустой переписке: возвращаться к разговору с
    // приветствием посреди уже начатого диалога было бы странно.
    this.appendMessage(this.createMessage('ai', this.greeting));
  }

  /**
   * Применяет вид, заданный владельцем сайта.
   *
   * Цвет задаём пользовательским свойством на host: он наследуется сквозь
   * границу Shadow DOM, поэтому переписывать стили не нужно — и виджет остаётся
   * одним и тем же файлом для всех сайтов.
   */
  private applyAppearance(appearance: WidgetAppearance | null): void {
    if (appearance === null) return;

    if (appearance.color !== null) {
      this.host.style.setProperty('--ecw-primary', appearance.color);
    }

    if (appearance.title !== null) this.title.textContent = appearance.title;
    if (appearance.greeting !== null) this.greeting = appearance.greeting;
  }

  private handleClick(event: Event): void {
    const target = event.target;
    if (!(target instanceof Element)) return;

    // Пункты меню приходят из базы, поэтому у них отдельный атрибут: смешивать
    // их с действиями самого виджета значило бы позволить базе вызвать «закрыть».
    const optionId = target.closest('[data-ecw-option]')?.getAttribute('data-ecw-option');
    if (optionId !== null && optionId !== undefined) {
      void this.choose(optionId);
      return;
    }

    const action = target.closest('[data-ecw-action]')?.getAttribute('data-ecw-action');
    if (action === 'toggle') this.toggle();
    else if (action === 'close') this.close();
    else if (action === 'human') void this.askForHuman();
    else if (action === 'menu-back') this.goBack();
  }

  /**
   * Просит живого оператора.
   *
   * Состояние ожидания включается сразу, не дожидаясь ответа сервера: кнопка
   * нажата, и повторное нажатие ничего не изменит. Если запрос не прошёл —
   * возвращаем кнопку и говорим об этом в журнал: обещать оператора, которого
   * не позвали, нельзя.
   */
  private async askForHuman(): Promise<void> {
    // Кнопка скрывается в состоянии ожидания, но нажать её могли до этого:
    // второй запрос ничего не изменит, а в переписке появилась бы лишняя
    // реплика про оператора.
    if (this.waiting) return;

    this.setWaiting(true);

    // Нажать могли раньше, чем открылась сессия: тогда первый запрос упадёт не
    // по вине посетителя. Повторяем — просьба не должна теряться из-за того,
    // что сервер не успел ответить на первый запрос.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await this.transport.requestHuman();

        // Отсчёт стартует и здесь: просьба пришла из шапки окна, а не из меню,
        // но ждать оператора человек будет ровно так же долго.
        this.waitingSince = Date.now();
        // Подтверждение приходит от сервера обычным сообщением — своё не
        // добавляем, иначе посетитель читает две одинаковые фразы подряд.
        this.registerIncoming();
        return;
      } catch (error) {
        console.error('[ecw] не удалось позвать оператора', error);

        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 1500 * (attempt + 1));
        });
      }
    }

    // Обещать оператора, которого не позвали, нельзя.
    this.setWaiting(false);
  }

  /** Показывает и скрывает состояние «ждём оператора». */
  private setWaiting(waiting: boolean): void {
    this.waiting = waiting;
    this.host.toggleAttribute('data-ecw-waiting', waiting);
    this.humanButton.hidden = waiting;

    if (waiting) {
      this.startClock();
    } else {
      this.stopClock();
      this.status.textContent = 'Assistant replies';
    }

    this.refreshFlow();
  }

  /**
   * Показывает тот экран, который сейчас уместен.
   *
   * Порядок важнее, чем кажется: пока посетитель не выбрал пункт меню, писать
   * ему некуда — поле ввода появляется только после явного выбора. Это и есть
   * разница между «чат-навигатор» и «чат, в котором надо придумать вопрос».
   */
  private refreshFlow(): void {
    if (this.waiting) {
      // Ждём человека: выбор уже сделан, меню больше не нужно. Через отведённое
      // время вместо пустого ожидания предлагаем оставить номер.
      const askPhone = this.isOverdue() && !this.phoneGiven;
      this.menuBox.hidden = true;
      this.phoneBox.hidden = !askPhone;
      this.showComposer(!askPhone);
      return;
    }

    this.phoneBox.hidden = true;

    if (this.menu.length > 0) {
      this.menuPath = null;
      this.renderMenu(this.menu);
      this.menuBox.hidden = false;
      this.showComposer(false);
      return;
    }

    // Меню нет — виджет ведёт себя как обычный чат.
    this.menuBox.hidden = true;
    this.showComposer(true);
  }

  /** Прошло ли время ожидания, после которого предлагаем телефон. */
  private isOverdue(): boolean {
    if (this.waitingSince === null) return false;

    return Date.now() - this.waitingSince >= this.handoverSeconds * 1000;
  }

  /** Рисует пункты. Текст берём через `textContent`: он приходит из базы. */
  private renderMenu(items: readonly MenuItem[]): void {
    this.menuItems.replaceChildren();

    for (const item of items) {
      // «Свой вопрос» показываем только когда ассистент включён: иначе пункт
      // обещает то, чего сайт не умеет.
      if (item.action === 'ai' && !this.aiEnabled) continue;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ecw-menu__item';
      button.setAttribute('data-ecw-option', item.id);
      button.textContent = item.label;
      this.menuItems.append(button);
    }

    this.menuBack.hidden = this.menuPath === null;
  }

  /** Возвращает меню на верхний уровень. */
  private goBack(): void {
    this.menuPath = null;
    this.renderMenu(this.menu);
  }

  private showComposer(visible: boolean): void {
    this.composer.hidden = !visible;
  }

  /** Нажатие пункта меню. */
  private async choose(optionId: string): Promise<void> {
    const item = this.findOption(this.menu, optionId);
    if (item === undefined) return;

    log(`выбран пункт «${item.label}»`);

    if (item.action === 'submenu') {
      this.menuPath = item;
      this.renderMenu(item.children);
      return;
    }

    if (item.action === 'ai') {
      // Свободный вопрос: показываем поле ввода, меню убираем.
      this.menuPath = null;
      this.menuBox.hidden = true;
      this.showComposer(true);
      this.input.focus();
      return;
    }

    try {
      const choice = await this.transport.chooseMenuItem(item.id);

      for (const message of choice.messages) {
        this.appendMessage({
          id: message.id,
          authorKind: message.authorKind,
          body: message.body,
          createdAt: message.createdAt,
          status: 'sent',
        });
      }

      // После ответа возвращаемся к списку: посетитель часто спрашивает второе.
      this.menuPath = null;
      this.renderMenu(this.menu);

      if (choice.waitingForHuman) {
        this.waitingSince = choice.waitingSince;
        this.setWaiting(true);
      }

      this.registerIncoming();
    } catch (error) {
      console.error('[ecw] не удалось выбрать пункт меню', error);
    }
  }

  /** Ищет пункт по идентификатору во всём дереве. */
  private findOption(items: readonly MenuItem[], id: string): MenuItem | undefined {
    for (const item of items) {
      if (item.id === id) return item;

      const nested = this.findOption(item.children, id);
      if (nested !== undefined) return nested;
    }

    return undefined;
  }

  /** Отправляет оставленный телефон. */
  private async sendPhone(): Promise<void> {
    const value = this.phoneInput.value.trim();
    if (value.replace(/\D/g, '').length < 6) {
      this.status.textContent = 'Please enter a full number';
      return;
    }

    try {
      const left = await this.transport.leavePhone(value);
      this.phoneGiven = true;
      this.phoneInput.value = left.phone;

      this.appendMessage({
        id: left.message.id,
        authorKind: left.message.authorKind,
        body: left.message.body,
        createdAt: left.message.createdAt,
        status: 'sent',
      });
      this.registerIncoming();

      // Форма больше не нужна: номер записан, обещание дано.
      this.phoneBox.hidden = true;
      this.showComposer(true);
      this.panel.focus();
    } catch (error) {
      console.error('[ecw] не удалось оставить номер', error);
      this.status.textContent = 'Could not send the number';
    }
  }

  /** Запускает отсчёт ожидания. */
  private startClock(): void {
    if (this.clock !== null) return;

    this.tick();
    this.clock = window.setInterval(() => {
      this.tick();
    }, 1000);
  }

  private stopClock(): void {
    if (this.clock === null) return;

    window.clearInterval(this.clock);
    this.clock = null;
  }

  /** Перерисовывает подпись в шапке и вовремя предлагает телефон. */
  private tick(): void {
    if (!this.waiting) return;

    if (this.waitingSince === null) {
      this.status.textContent = 'An operator will reply';
      return;
    }

    const left = this.handoverSeconds * 1000 - (Date.now() - this.waitingSince);

    if (left > 0) {
      // Посетитель должен видеть, что его ждут, а не гадать.
      this.status.textContent = `Waiting for an operator · ${formatLeft(left)}`;
      return;
    }

    this.status.textContent = 'No operator is free yet';

    if (!this.phoneGiven && this.phoneBox.hidden) {
      this.refreshFlow();
      this.phoneInput.focus();
    }
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
    // Новый ответ начинается с чистого листа: предварительный показ предыдущего
    // к нему не относится.
    this.draft = '';
    this.messages.setStreamingText(null);

    try {
      await this.transport.send({ clientId: outgoing.id, body: outgoing.body });
      this.updateStatus(outgoing.id, 'sent');
      // Набор показываем сразу после подтверждения: ответ придёт не мгновенно.
      // Но если первые куски уже пришли, показывать нечего — ответ пошёл, и
      // индикатор только мигал бы поверх текста.
      if (this.draft === '') this.messages.setTyping(true);
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
      // Настоящий ответ вытесняет предварительный показ: дальше он не нужен.
      if (message.authorKind !== 'visitor') this.draft = '';

      // Оператор ответил — ждать больше некого. Отсчёт снимаем сразу, а не
      // тогда, когда посетитель перезагрузит страницу: иначе он видел бы, что
      // его всё ещё ждут, хотя ответ уже пришёл.
      if (message.authorKind === 'agent') this.setWaiting(false);

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

  /** Показывает ответ по мере появления. */
  private handleDelta(text: string): void {
    // Первый же кусок означает, что ответ пошёл: индикатор набора больше не
    // нужен, его место занимает сам текст.
    this.messages.setTyping(false);

    this.draft += text;
    this.messages.setStreamingText(this.draft);
  }

  /** Отвечать нечем: ответа не будет. */
  private handleIdle(): void {
    this.messages.setTyping(false);

    if (this.transport.waitingForHuman) this.setWaiting(true);
  }

  /**
   * Добавляет сообщение: в список, в представление и в хранилище.
   *
   * Единая точка нужна, чтобы эти три места не разъезжались. Любое новое
   * сообщение обязано проходить здесь.
   */
  private appendMessage(message: WidgetMessage): void {
    // Одно и то же сообщение может прийти дважды: из локального кэша при запуске
    // и из добора пропущенного. В переписке оно должно быть одно — без этой
    // проверки ответ задваивался бы у каждого, кто вернулся на страницу.
    if (this.history.some((known) => known.id === message.id)) return;

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
    if (this.opened) return 'Close chat';
    // Число непрочитанных озвучивается словами: точка с цифрой для программы
    // чтения с экрана — просто «один», без смысла.
    if (this.unread > 0) return `Open chat, new messages: ${String(this.unread)}`;
    return 'Open chat';
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
