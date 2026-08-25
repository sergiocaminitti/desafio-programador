import { z } from 'zod';

export const PunchSchema = z.object({
  kind: z.enum(['IN', 'OUT']),
  time_raw: z.string(),
  time_hhmm: z.string(),
});

export const TimeCardDaySchema = z.object({
  date_raw: z.string(),
  punches: z.array(PunchSchema),
});

export const TimeCardPageSchema = z.object({
  page: z.number().int().positive(),
  days: z.array(TimeCardDaySchema),
});

export const TimeCardValueSchema = z.object({
  pages: z.array(TimeCardPageSchema),
});

export const PayrollFieldSchema = z.object({
  code: z.string(),
  label: z.string(),
  reference: z.string(),
  value: z.string(),
});

export const PayrollBaseSchema = z.object({
  label: z.string(),
  value: z.string(),
});

export const PayrollPageSchema = z.object({
  page: z.number().int().positive(),
  year: z.string(),
  month: z.string(),
  fields: z.array(PayrollFieldSchema),
  bases: z.array(PayrollBaseSchema),
});

export const PayrollValueSchema = z.object({
  pages: z.array(PayrollPageSchema),
});

export const TranscriptionPutBodySchema = z.object({
  value: z.union([TimeCardValueSchema, PayrollValueSchema]),
});

export function validateTranscriptionValue(tipo: 'cartao-ponto' | 'holerite', value: unknown) {
  if (tipo === 'cartao-ponto') {
    return TimeCardValueSchema.safeParse(value);
  }
  return PayrollValueSchema.safeParse(value);
}
