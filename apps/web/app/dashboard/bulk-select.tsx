'use client';

import { useEffect, useState } from 'react';

/**
 * Выбор нескольких разговоров и массовое закрытие.
 *
 * Разбирать очередь по одному — открыть, прочитать, закрыть, вернуться — это
 * три перехода на каждый разговор. После выходных их десятки, и оператор
 * перестаёт этим заниматься вовсе.
 *
 * Работает и без JavaScript: флажки и кнопка связаны с общей формой атрибутом
 * `form`, поэтому отправляются одной формой, хотя и лежат в разных местах
 * страницы. Скрипт лишь добавляет счётчик, «выбрать все» и подсветку.
 */
export function BulkSelect({ total }: { total: number }) {
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    function boxes(): HTMLInputElement[] {
      return Array.from(document.querySelectorAll<HTMLInputElement>('input[name="ids"]'));
    }

    function recount(): void {
      setSelected(boxes().filter((box) => box.checked).length);
    }

    // Считаем по событию, а не по состоянию React: флажки неконтролируемые, и
    // обновление очереди их не сбрасывает — выбранное переживает перерисовку.
    function onChange(event: Event): void {
      const target = event.target;
      if (target instanceof HTMLInputElement && target.name === 'ids') recount();
    }

    document.addEventListener('change', onChange);
    recount();

    return () => {
      document.removeEventListener('change', onChange);
    };
  }, []);

  function setAll(checked: boolean): void {
    for (const box of document.querySelectorAll<HTMLInputElement>('input[name="ids"]')) {
      box.checked = checked;
    }
    setSelected(checked ? total : 0);
  }

  return (
    <div className="bulk">
      <div className="bulk__select">
        <button className="bulk__link" onClick={() => setAll(true)} type="button">
          Select all
        </button>
        {selected === 0 ? null : (
          <button className="bulk__link" onClick={() => setAll(false)} type="button">
            Clear
          </button>
        )}
      </div>

      <div className={selected === 0 ? 'bulk__bar bulk__bar--idle' : 'bulk__bar'}>
        <span className="bulk__count">
          {selected === 0 ? 'Nothing selected' : `${String(selected)} selected`}
        </span>
        <button className="bulk__submit" disabled={selected === 0} form="bulk-close" type="submit">
          Close selected
        </button>
      </div>
    </div>
  );
}
