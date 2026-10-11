'use server';

import { notFound, redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { findOperatorSite, saveAiSettings, saveSiteSettings } from '@/lib/data';
import { requireOperator } from '@/lib/operator';

/**
 * Настройки сайта из панели.
 *
 * До проверки формы идёт проверка доступа: чужой сайт не найдётся, и дальше
 * дело не пойдёт. Порядок именно такой — сначала «твой ли это сайт», потом «что
 * ты в нём написал».
 *
 * Ошибки возвращаем в адресе, а не молча: форма, которая ничего не ответила, —
 * худший вид формы. Значения по умолчанию при этом не подставляются: владелец
 * должен видеть, что именно он написал не так.
 */

/** Цвет в виде #rrggbb. Проверяем строго: значение попадает в стили. */
const COLOR = /^#[0-9a-f]{6}$/i;

const settingsSchema = z.object({
  name: z.string().trim().min(1).max(80),
  origins: z
    .string()
    .transform((value) =>
      value
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== ''),
    )
    .pipe(z.array(z.string().url().max(200)).max(20)),
  widgetColor: z
    .string()
    .trim()
    .transform((value) => (value === '' ? null : value))
    .pipe(z.string().regex(COLOR).nullable()),
  widgetTitle: z
    .string()
    .trim()
    .max(60)
    .transform((value) => (value === '' ? null : value)),
  widgetGreeting: z
    .string()
    .trim()
    .max(500)
    .transform((value) => (value === '' ? null : value)),
  systemPrompt: z.string().trim().min(20).max(8000),
  model: z.string().trim().min(1).max(120),
  temperature: z.coerce.number().min(0).max(2),
  dailyTokenBudget: z.coerce.number().int().min(0).max(10_000_000),
});

export async function saveSite(siteId: string, form: FormData): Promise<void> {
  const operator = await requireOperator();

  const site = await findOperatorSite({ workspaceIds: operator.workspaceIds, siteId });
  if (site === null) notFound();

  const path = `/dashboard/sites/${siteId}`;
  const parsed = settingsSchema.safeParse({
    name: field(form, 'name'),
    origins: field(form, 'origins'),
    widgetColor: field(form, 'widgetColor'),
    widgetTitle: field(form, 'widgetTitle'),
    widgetGreeting: field(form, 'widgetGreeting'),
    systemPrompt: field(form, 'systemPrompt'),
    model: field(form, 'model'),
    temperature: field(form, 'temperature'),
    dailyTokenBudget: field(form, 'dailyTokenBudget'),
  });

  if (!parsed.success) {
    console.warn('[ecw] настройки сайта не сохранены', {
      siteId,
      issues: parsed.error.issues.map((issue) => issue.path.join('.')),
    });
    redirect(`${path}?error=1`);
  }

  const data = parsed.data;

  await saveSiteSettings({
    siteId,
    name: data.name,
    allowedOrigins: data.origins,
    widgetColor: data.widgetColor,
    widgetTitle: data.widgetTitle,
    widgetGreeting: data.widgetGreeting,
  });

  await saveAiSettings({
    siteId,
    systemPrompt: data.systemPrompt,
    model: data.model,
    temperature: data.temperature,
    dailyTokenBudget: data.dailyTokenBudget,
  });

  revalidatePath(path);
  redirect(`${path}?saved=1`);
}

/** `form.get` возвращает ещё и файл: приведение через `String` дало бы `[object File]`. */
function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}
