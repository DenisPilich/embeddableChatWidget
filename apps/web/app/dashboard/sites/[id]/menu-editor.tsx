import type { MenuRow } from '@/lib/menu';
import { addMenuItem, deleteMenuItem, saveMenuItem } from '../actions';

/**
 * Редактор меню для посетителя.
 *
 * Форма на каждый пункт, а не одна большая: сохранить одну строку проще, чем
 * разбираться, почему не сохранились сразу двенадцать. Удаление — отдельная
 * форма рядом, потому что вкладывать форму в форму нельзя.
 *
 * Вложенность задаётся выбором родителя, а не перетаскиванием: здесь нет
 * клиентского состояния, а значит страница работает и без JavaScript.
 */

const ACTIONS = [
  { value: 'ANSWER', label: 'Show an answer' },
  { value: 'OPERATOR', label: 'Call a human' },
  { value: 'SUBMENU', label: 'Open a submenu' },
  { value: 'AI', label: 'Ask the assistant' },
] as const;

export function MenuEditor({ siteId, items }: { siteId: string; items: readonly MenuRow[] }) {
  const byId = new Map(items.map((item) => [item.id, item.label]));

  return (
    <section className="panel">
      <h2 className="panel__title">Questions for the visitor</h2>
      <p className="panel__note">
        The chat opens on this list: the visitor picks a question instead of inventing one. Answers
        are instant and cost nothing. An item with a parent appears inside that item as a submenu.
        An empty list means the widget behaves like a plain chat.
      </p>

      {items.length === 0 ? (
        <p className="panel__note">
          <em>No questions yet — the visitor goes straight to the message field.</em>
        </p>
      ) : null}

      <div className="menu-editor">
        {items.map((item) => (
          <div className="menu-row" key={item.id}>
            <form action={saveMenuItem.bind(null, siteId)} className="menu-row__form">
              <input name="optionId" type="hidden" value={item.id} />

              <label className="menu-row__field">
                <span>Question</span>
                <input name="label" defaultValue={item.label} required maxLength={80} />
              </label>

              <label className="menu-row__field">
                <span>What it does</span>
                <select name="action" defaultValue={item.action}>
                  {ACTIONS.map((action) => (
                    <option key={action.value} value={action.value}>
                      {action.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="menu-row__field menu-row__field--wide">
                <span>Answer text</span>
                <textarea
                  name="answer"
                  defaultValue={item.answer ?? ''}
                  rows={3}
                  maxLength={2000}
                  placeholder="Only used by “Show an answer”."
                />
              </label>

              <label className="menu-row__field">
                <span>Inside</span>
                <select name="parentId" defaultValue={item.parentId ?? ''}>
                  <option value="">(top level)</option>
                  {items
                    .filter((candidate) => candidate.id !== item.id)
                    .map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.label}
                      </option>
                    ))}
                </select>
              </label>

              <label className="menu-row__field menu-row__field--narrow">
                <span>Order</span>
                <input
                  name="position"
                  type="number"
                  min={0}
                  max={999}
                  defaultValue={item.position}
                />
              </label>

              <div className="menu-row__actions">
                <button className="form__submit" type="submit">
                  Save
                </button>
                <span className="menu-row__meta">
                  {item.clicks} {item.clicks === 1 ? 'click' : 'clicks'}
                </span>
              </div>
            </form>

            <form action={deleteMenuItem.bind(null, siteId, item.id)} className="menu-row__delete">
              <button className="menu-row__remove" type="submit">
                Delete
              </button>
            </form>
          </div>
        ))}

        <div className="menu-row menu-row--new">
          <form action={addMenuItem.bind(null, siteId)} className="menu-row__form">
            <label className="menu-row__field">
              <span>New question</span>
              <input name="label" required maxLength={80} placeholder="How does delivery work?" />
            </label>

            <label className="menu-row__field">
              <span>What it does</span>
              <select name="action" defaultValue="ANSWER">
                {ACTIONS.map((action) => (
                  <option key={action.value} value={action.value}>
                    {action.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="menu-row__field menu-row__field--wide">
              <span>Answer text</span>
              <textarea name="answer" rows={3} maxLength={2000} />
            </label>

            <label className="menu-row__field">
              <span>Inside</span>
              <select name="parentId" defaultValue="">
                <option value="">(top level)</option>
                {items.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {byId.get(candidate.id) ?? candidate.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="menu-row__field menu-row__field--narrow">
              <span>Order</span>
              <input name="position" type="number" min={0} max={999} defaultValue={items.length} />
            </label>

            <div className="menu-row__actions">
              <button className="form__submit" type="submit">
                Add question
              </button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}
