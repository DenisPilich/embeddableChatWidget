#!/usr/bin/env node
/**
 * Одна команда, чтобы поднять всё.
 *
 * Раньше нужно было помнить две команды и два окна терминала, а ещё знать, что
 * виджет перед этим надо собрать. Это знание — часть проекта, а не часть
 * человека: пусть его держит скрипт.
 *
 * Что делает по порядку:
 *   1. проверяет, что порты свободны, — иначе понятная ошибка вместо EADDRINUSE;
 *   2. собирает виджет (стенд раздаёт собранный файл, как CDN);
 *   3. поднимает оба сервера и говорит, куда идти.
 *
 * Ctrl+C гасит оба сервера вместе с их потомками: на Windows дочерний процесс —
 * это оболочка, и обычное убийство оставило бы серверы висеть на портах. Именно
 * так и появляются «занятые порты» при следующем запуске.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

const STAND_PORT = 5173;
const BACKEND_PORT = 3000;

const children = [];
let stopping = false;

function run(command) {
  // stdio: 'inherit' — вывод идёт прямо в терминал: у серверов есть цвет и
  // прогресс, а перехват через каналы ломается в ограниченных средах.
  const child = spawn(command, { shell: true, stdio: 'inherit' });
  children.push(child);
  return child;
}

function waitForExit(command) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { shell: true, stdio: 'inherit' });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`команда завершилась с кодом ${String(code)}: ${command}`));
    });
  });
}

function isFree(port) {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => {
      resolve(false);
    });
    probe.once('listening', () => {
      probe.close(() => {
        resolve(true);
      });
    });
    probe.listen(port, '127.0.0.1');
  });
}

function stopAll() {
  if (stopping) return;
  stopping = true;

  for (const child of children) {
    if (child.pid === undefined || child.exitCode !== null) continue;

    if (process.platform === 'win32') {
      // /T — вместе с потомками, /F — не спрашивая.
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
  }
}

process.on('SIGINT', () => {
  stopAll();
  process.exit(0);
});
process.on('SIGTERM', () => {
  stopAll();
  process.exit(0);
});

async function main() {
  const busy = [];
  if (!(await isFree(STAND_PORT))) busy.push(`порт ${String(STAND_PORT)} (стенд)`);
  if (!(await isFree(BACKEND_PORT))) busy.push(`порт ${String(BACKEND_PORT)} (сервер)`);

  if (busy.length > 0) {
    console.error(`\nЗанято: ${busy.join(', ')}.`);
    console.error('Скорее всего остался запущенным прошлый сервер. Закрой его окно');
    console.error('или найди процесс: netstat -ano | findstr :3000\n');
    process.exit(1);
  }

  console.log('Собираю виджет…\n');
  try {
    await waitForExit('pnpm --filter ecw-widget build');
  } catch (error) {
    console.error(
      `\nВиджет не собрался: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }

  console.log('\nПоднимаю серверы. Ctrl+C выключит оба.\n');
  console.log(`  Стенд с виджетом:  http://localhost:${String(STAND_PORT)}`);
  console.log(`  Панель оператора:  http://localhost:${String(BACKEND_PORT)}/dashboard`);
  console.log('  Вход в панель:     demo@example.com / demo-operator-2026\n');

  run(`pnpm --filter @ecw/fixtures dev`);
  run(`pnpm --filter @ecw/web dev`);

  // Если один из серверов упал сам, второй держать незачем: человек останется с
  // половиной работающей системы и без объяснения.
  for (const child of children) {
    child.on('close', (code) => {
      if (stopping || code === 0) return;
      console.error(`\nСервер завершился с кодом ${String(code)} — гашу остальные.`);
      stopAll();
      process.exit(1);
    });
  }
}

await main();
