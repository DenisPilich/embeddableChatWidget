'use client';

declare global {
  interface Window {
    ECW?: { open?: () => void };
  }
}

/**
 * Кнопка, открывающая чат.
 *
 * Виджет выставляет наружу `window.ECW.open()`, поэтому страница клиента может
 * позвать его своей кнопкой — так и делают настоящие сайты: «Написать нам» в
 * шапке открывает чат, а не заставляет искать кружок в углу.
 *
 * Загрузчик грузится асинхронно, поэтому кнопка может быть нажата раньше, чем
 * виджет готов. В этом случае ничего не происходит: через мгновение виджет
 * появится, и нажать можно будет снова. Выдавать ошибку в этом месте
 * бессмысленно — посетитель ничего не сделал неправильно.
 */
export function OpenChatButton({
  className,
  children,
}: {
  className: string;
  children: React.ReactNode;
}) {
  return (
    <button
      className={className}
      onClick={() => {
        window.ECW?.open?.();
      }}
      type="button"
    >
      {children}
    </button>
  );
}
