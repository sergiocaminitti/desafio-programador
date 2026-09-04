import { ExtractedDocument, ExtractedLine } from './pdf-reader.js';
import type { OcrWord } from './ocr.js';
import { TimeCardValue, TimeCardPage, TimeCardDay, Punch } from '../shared/types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Regex compartilhadas
// ─────────────────────────────────────────────────────────────────────────────

/** Data completa no formato DD/MM/AAAA (também aceita '?' como dígito incerto) */
const FULL_DATE_REGEX = /\b([0-3?][0-9?][/\-.][0-1?][0-9?][/\-.][12?][0-9?]{2,4})\b/;

/** Horário HH:MM — aceita separadores : h H . Não captura segundos. */
const TIME_REGEX = /\b([0-2?][0-9?][:hH.][0-5?][0-9?]|[0-9][:hH.][0-5?][0-9?])(?:[cd])?\b/g;

/** Dias da semana em português */
const WEEKDAY_RE_SRC = 'SEG|TER|QUA|QUI|SEX|SAB|SÁB|DOM|FER';
const WEEKDAY_RE = new RegExp(WEEKDAY_RE_SRC, 'i');

/**
 * Linha-cabeçalho de dia no SIPON: "2 - SEG" ou "17 - TER"
 * Captura o número do dia e o dia da semana.
 */
const DAY_HEADER_RE = new RegExp(
  `^([0-3]?\\d)\\s*[\\-–]?\\s*(${WEEKDAY_RE_SRC})\\b`,
  'i'
);

/**
 * Cabeçalho de dia do Relatório Mensal BB:
 * "17SEG", "O1TER", "OBTER", "138TER" — DD colado ao dia da semana,
 * possivelmente com letras 'O' no lugar de '0' (OCR noise).
 * Captura: grupo 1 = parte numérica/OCR do dia, grupo 2 = dia da semana.
 */
const BB_DAY_RE = new RegExp(
  `^([O0-9]{1,3})(${WEEKDAY_RE_SRC})\\b`,
  'i'
);

/**
 * Ocorrências que interrompem a leitura de batidas.
 * Tudo após esses tokens NÃO é horário de ponto — são totalizadores,
 * ocorrências de RH ou campos de outra coluna.
 */
const OCCURRENCE_RE =
  /\b(HE(?:-|\s)|DESTACAMENTO|REG\.?\s*SUSPENSO|ABN\b|ABONO\b|FALTA|ATESTADO|FOLGA|AFAST|SUSPENSO|COMPENSADA|FERIAS|FÉRIAS|DEC\.CHEFIA|CHEFIA|JORNADA\s+ENT)/i;

/**
 * Palavras que indicam dia sem registro (sem batidas a extrair).
 * Aparecem nas linhas do Relatório Mensal BB.
 */
const NO_PUNCH_RE =
  /\b(sem\s+registro|feriado|descanso\s+semanal|folga)\b/i;

// ─────────────────────────────────────────────────────────────────────────────
// Linhas a ignorar completamente
// ─────────────────────────────────────────────────────────────────────────────

export function isIgnorableTimeCardLine(text: string): boolean {
  const t = text.trim();
  if (!t) return true;

  // Timestamp de sistema com segundos: 08:34:23
  if (/\d{1,2}:\d{2}:\d{2}/.test(t)) return true;

  // Linha de separação gráfica (»»» ou ─── ou ===)
  if (/^[»─=\-*_]{5,}/.test(t)) return true;

  // Cabeçalho de colunas da tabela
  if (/^(dia\s+semana|dia\s+seg|entrada\s+sa[ií]da|dia\s+entrada\s+saida)/i.test(t)) return true;

  // Rodapés e cabeçalhos administrativos
  if (
    /assinado\s+eletronicamente|assinado por|juntado em|n[uú]mero do (processo|documento)|p[aá]g\.\s*\d|folha de frequ[eê]ncia|sipon|poel,c|consulta ponto|pje\s+documento|impresso por/i.test(t)
  ) return true;

  // Linhas de cadastro do funcionário
  if (
    /^(horario de trabalho|unidade de lota|matricula\s*:|ass\.?\s*respons|tipo de jornada|fls\.\s*:\s*\d|banco\s*do\s*brasil\s*ponto|relat[oó]rio\s*mensal|funcion[aá]rio\s*:|localiza[cç][aã]o\s*:|ctps|total\s+de\s+horas|folgas\s+geradas|c[oó]digo\s+nome|escriturario)/i.test(t)
  ) return true;

  // Linha que começa com "Mes/Ano:" — cabeçalho de mês, não linha de dia
  if (/^m[eê]s[\s/]?ano\s*:/i.test(t)) return true;

  // Linha que começa com "Data:" sem ser um dia real (carimbo de emissão)
  if (/^data\s*:\s*\d{2}\/\d{2}\/\d{4}/i.test(t)) return true;

  // Linha de período "CNPF - Período: DD/MM/AAAA à DD/MM/AAAA"
  if (/per[ií]odo\s*:/i.test(t)) return true;

  // Linha de emissão "Emissão: Mês/Ano"
  if (/^emiss[aã]o\s*:/i.test(t)) return true;

  // Linhas de seção/cabeçalho do cartão de ponto (time-card-03)
  if (/^(cart[aã]o\s+de\s+ponto|se[cç][aã]o\s*:|chapa\s+nome|carteira\s+de\s+trabalho|data\s+ent\d?\s+sai\d?)/i.test(t)) return true;

  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalização de horários
// ─────────────────────────────────────────────────────────────────────────────

export function normalizeTimeHHMM(timeRaw: string): string {
  const clean = timeRaw
    .trim()
    .replace(/[hH.]/, ':')
    .replace(/[cdCD+]$/, '')  // strip sufixos c/d e + (hora extra overnight)
    .replace(/[^\d:?]/g, '');
  const parts = clean.split(':');
  if (parts.length !== 2) return clean;
  let [hh, mm] = parts;
  if (hh.length === 1 && !hh.includes('?')) hh = '0' + hh;
  return `${hh}:${mm}`;
}

export function isValidOrUncertainTime(timeHhmm: string): boolean {
  if (timeHhmm.includes('?')) return true;
  const [hhStr, mmStr] = timeHhmm.split(':');
  const hh = parseInt(hhStr, 10);
  const mm = parseInt(mmStr, 10);
  if (isNaN(hh) || isNaN(mm)) return false;
  return hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59;
}

// ─────────────────────────────────────────────────────────────────────────────
// Conversão de lista de horários brutos em Punches IN/OUT alternados
// ─────────────────────────────────────────────────────────────────────────────

function timesToPunches(rawTimes: string[]): Punch[] {
  const punches: Punch[] = [];
  let isEntry = true;
  for (const raw of rawTimes) {
    const norm = normalizeTimeHHMM(raw);
    if (!isValidOrUncertainTime(norm)) continue;
    punches.push({
      kind: isEntry ? 'IN' : 'OUT',
      time_raw: raw.replace(/[hH.]/, ':').replace(/[cdCD+]$/, ''),
      time_hhmm: norm,
    });
    isEntry = !isEntry;
  }
  return punches;
}

// ─────────────────────────────────────────────────────────────────────────────
// Layout SIPON — extração de horários de uma linha
// ─────────────────────────────────────────────────────────────────────────────

export function punchTimesFromSiponText(text: string, isDayHeader: boolean): string[] {
  const occ = text.search(OCCURRENCE_RE);
  const punchPart = occ >= 0 ? text.slice(0, occ) : text;
  const times = [...punchPart.matchAll(TIME_REGEX)].map((m) => m[1]);
  // Em linhas-cabeçalho SIPON, o primeiro horário é a jornada contratual
  if (isDayHeader && times.length > 0) return times.slice(1);
  return times;
}

// ─────────────────────────────────────────────────────────────────────────────
// Layout BB clássico — ranges "HH:MM - HH:MM" (com espaço)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tenta reconstruir um horário onde o OCR perdeu o dígito inicial.
 *
 * O OCR frequentemente perde o "1" inicial de horários como:
 *   "4:00" → "14:00"   "3:15" → "13:15"   "1:01" → "11:01"
 *
 * Heurística: se hora < 10 e o horário está numa sequência em que os vizinhos
 * são > 10 (típico de intervalo de almoço), o "1" foi perdido.
 * Usada especificamente nas ranges de intervalo do TC-02.
 */
function repairTruncatedHour(raw: string): string {
  const m = raw.match(/^(\d):(\d{2})$/);
  if (!m) return raw; // já tem 2 dígitos ou formato diferente
  const hh = parseInt(m[1], 10);
  const mm = m[2];
  // Horas de 1 dígito reais são improvável em expediente comercial (exceto 00:xx, 01:xx)
  // Heurística conservadora: só reconstrói se a hora for 1-9 (mais provavelmente 11-19)
  if (hh >= 1 && hh <= 9) {
    return `1${m[1]}:${mm}`; // "4:00" → "14:00"
  }
  return raw;
}

/**
 * Converte 2 ranges "jornada + intervalo" em 4 punches IN/OUT/IN/OUT.
 *
 * Aceita horários com 1 dígito na hora (OCR noise) e tenta reconstruí-los.
 * Range format aceito: "HH:MM - HH:MM" com qualquer número de espaços.
 */
function parseBbRanges(text: string): Punch[] | null {
  // Aceita 1 ou 2 dígitos na hora: \d{1,2}:\d{2}
  // Espaços opcionais ao redor do traço
  const rangeRe = /(\d{1,2}:[0-5]\d)\s*[\-–]\s*(\d{1,2}:[0-5]\d)/g;
  const raw = [...text.matchAll(rangeRe)];
  if (raw.length === 0) return null;

  // Reconstrói horas truncadas pelo OCR
  const matches = raw.map((m) => ({
    full: m[0],
    t1: repairTruncatedHour(m[1]),
    t2: repairTruncatedHour(m[2]),
  }));

  // Valida: ambos os horários do range devem ser válidos
  const validMatches = matches.filter(
    (m) => isValidOrUncertainTime(normalizeTimeHHMM(m.t1)) &&
           isValidOrUncertainTime(normalizeTimeHHMM(m.t2))
  );
  if (validMatches.length === 0) return null;

  const punches: Punch[] = [];
  if (validMatches.length === 2) {
    // 2 ranges: [jornada-principal] [intervalo]
    // Resultado: IN jornada-início, OUT intervalo-início, IN intervalo-fim, OUT jornada-fim
    const main = validMatches[0];
    const interval = validMatches[1];
    punches.push(
      { kind: 'IN',  time_raw: main.t1,     time_hhmm: normalizeTimeHHMM(main.t1) },
      { kind: 'OUT', time_raw: interval.t1, time_hhmm: normalizeTimeHHMM(interval.t1) },
      { kind: 'IN',  time_raw: interval.t2, time_hhmm: normalizeTimeHHMM(interval.t2) },
      { kind: 'OUT', time_raw: main.t2,     time_hhmm: normalizeTimeHHMM(main.t2) }
    );
  } else {
    for (const r of validMatches) {
      punches.push(
        { kind: 'IN',  time_raw: r.t1, time_hhmm: normalizeTimeHHMM(r.t1) },
        { kind: 'OUT', time_raw: r.t2, time_hhmm: normalizeTimeHHMM(r.t2) }
      );
    }
  }
  return punches;
}

// ─────────────────────────────────────────────────────────────────────────────
// Layout "Relatório Mensal BB" — "HH:MM-HH:MM" (sem espaço) + intervalo
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normaliza artefatos OCR comuns no número do dia do Relatório Mensal BB:
 *   "O1" → "01"  (letra O confundida com zero)
 *   "138" → "13" (dígito extra grudado antes do dia da semana)
 */
function normalizeBbDayNumber(raw: string): number | null {
  // Substitui O maiúsculo por 0
  let cleaned = raw.replace(/O/gi, '0');
  // Se ficou com mais de 2 dígitos, pega os últimos 2 (ex: "138" → "13")
  if (cleaned.length > 2) cleaned = cleaned.slice(-2);
  const n = parseInt(cleaned, 10);
  if (isNaN(n) || n < 1 || n > 31) return null;
  return n;
}

/**
 * Detecta se a linha tem formato "Relatório Mensal BB":
 * presença de jornada colada "HH:MM-HH:MM" (sem espaço ao redor do traço).
 */
function hasBbRelatorioFormat(text: string): boolean {
  const s = sanitizeTimesInLine(text);
  return /\d{2}:\d{2}-\d{2}:\d{2}/.test(s) || /\d{2}:\d{2}-\d{4}/.test(s);
}

/**
 * Sanitiza artefatos OCR dentro e ao redor de padrões de horário.
 *
 * Cobre os padrões reais observados no TC-04:
 *   1. Letra ENTRE dígitos e ':':  "08B:48"   → "08:48"
 *   2. Letra-prefixo antes do HH:  "f14:07"   → "14:07"
 *   3. Letra ENTRE os dois grupos de dígitos: "19b99:46" → "19:46" (reconstituição)
 *   4. Letra 'O' como zero nos dígitos:       "pO9:50"   → "09:50"
 *   5. Separador 'h' em horário:              "29h06"    → "29:06" (detectável depois)
 */
function sanitizeTimesInLine(text: string): string {
  // 1. Letra espúria entre dígitos da hora e ':' — "08B:48" → "08:48"
  let s = text.replace(/(\d{1,2})[A-Za-z](:\d{2})/g, '$1$2');

  // 2. Letra-prefixo antes de HH:MM — "f14:07" → "14:07"
  s = s.replace(/\b[A-Za-z](\d{2}:[0-5]\d)\b/g, '$1');

  // 3. Letra-prefixo antes de dígitos soltos que formam horário — "p09:50" → "09:50"
  s = s.replace(/\b[A-Za-z]([0-9O]\d:[0-5]\d)\b/g, (_, g) => g.replace(/O/g, '0'));

  // 4. Letra 'O' (maiúsculo) confundida com zero dentro de horário — "O9:50" → "09:50"
  s = s.replace(/\bO(\d:[0-5]\d)\b/g, '0$1');   // "O9:50" → "09:50"
  s = s.replace(/\b(\d)O(:[0-5]\d)\b/g, '$10$2'); // "9O:50" → "90:50" (inválido, OK)

  // 5. Letra entre dois grupos de dígitos de horário — "19b99:46" ou "19b09:46"
  //    Captura \d{2}[letra]\d{2}:\d{2} e monta \d{2}:\d{2}
  s = s.replace(/(\d{2})[A-Za-z](\d{2}:[0-5]\d)/g, (_, h, rest) => {
    // Mantém apenas o segundo grupo como horário completo
    return `${h}:${rest.split(':')[1]}`;
  });

  return s;
}

/**
 * Reconstrói um horário "HHMM" (4 dígitos sem ':') como "HH:MM".
 * Usado para recuperar horários onde o OCR apagou o ':' (ex: "1815" → "18:15").
 */
function recoverTime4Digits(s: string): string | null {
  if (s.length !== 4) return null;
  const hh = parseInt(s.slice(0, 2), 10);
  const mm = parseInt(s.slice(2), 10);
  if (hh > 23 || mm > 59) return null;
  return `${s.slice(0, 2)}:${s.slice(2)}`;
}

/**
 * Extrai punches de uma linha no formato Relatório Mensal BB.
 *
 * Estrutura da linha: "[DD][DDD] [—] [Jornada] [Intervalo(s)] [extras]"
 *   - Jornada: "HH:MM-HH:MM" (entrada-saída colados com traço)
 *   - Intervalo: "HH:MM - HH:MM" (com espaços)
 *   - Colunas extras irrelevantes aparecem depois (números, letras, siglas)
 *
 * O resultado é: IN jornada-entrada, OUT intervalo-início, IN intervalo-fim, OUT jornada-saída
 * Se não há intervalo: apenas IN jornada-entrada, OUT jornada-saída
 */
function parseBbRelatorioLine(text: string): Punch[] | null {
  // Verifica se é dia sem registro
  if (NO_PUNCH_RE.test(text)) return [];

  // Sanitiza artefatos OCR dentro de horários (ex: "08B:48" → "08:48")
  const clean = sanitizeTimesInLine(text);

  // Regex para jornada colada: "HH:MM-HHMM" ou "HH:MM-HH:MM"
  // O OCR frequentemente apaga o ':' do segundo horário
  const jornada = clean.match(
    /([0-2]\d:[0-5]\d)\s*-\s*([0-2]\d:[0-5]\d|\d{4})/
  );
  if (!jornada) return null;

  const entradaRaw = jornada[1];
  let saidaRaw = jornada[2];

  // Recupera "HHMM" → "HH:MM" se o OCR comeu o ':'
  if (!saidaRaw.includes(':')) {
    const recovered = recoverTime4Digits(saidaRaw);
    if (!recovered) return null;
    saidaRaw = recovered;
  }

  const entradaHhmm = normalizeTimeHHMM(entradaRaw);
  const saidaHhmm = normalizeTimeHHMM(saidaRaw);

  if (!isValidOrUncertainTime(entradaHhmm) || !isValidOrUncertainTime(saidaHhmm)) {
    return null;
  }

  // Tenta detectar intervalo "HH:MM - HH:MM" ou "H:MM - HH:MM" (com espaço) na mesma linha
  // Pega apenas o texto APÓS a jornada para não re-capturar
  const afterJornada = clean.slice(clean.indexOf(jornada[0]) + jornada[0].length);
  const intervalMatch = afterJornada.match(
    /(\d{1,2}:[0-5]\d)\s+[\-–]\s+(\d{1,2}:[0-5]\d)/
  );

  const punches: Punch[] = [];
  if (intervalMatch) {
    const intT1 = repairTruncatedHour(intervalMatch[1]);
    const intT2 = repairTruncatedHour(intervalMatch[2]);
    const intSaidaHhmm = normalizeTimeHHMM(intT1);
    const intEntradaHhmm = normalizeTimeHHMM(intT2);

    punches.push(
      { kind: 'IN',  time_raw: entradaRaw, time_hhmm: entradaHhmm },
      { kind: 'OUT', time_raw: intT1,       time_hhmm: intSaidaHhmm },
      { kind: 'IN',  time_raw: intT2,       time_hhmm: intEntradaHhmm },
      { kind: 'OUT', time_raw: saidaRaw,    time_hhmm: saidaHhmm }
    );
  } else {
    punches.push(
      { kind: 'IN',  time_raw: entradaRaw, time_hhmm: entradaHhmm },
      { kind: 'OUT', time_raw: saidaRaw,   time_hhmm: saidaHhmm }
    );
  }

  return punches;
}

// ─────────────────────────────────────────────────────────────────────────────
// Layout Ficha de Quinzena (time-card-04) — grade física escaneada
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detecta se o conjunto de linhas de uma página é do formato "ficha de quinzena".
 *
 * Indicadores diretos: "QUINZENA", "MANHÃ", "TARDE"
 * Indicadores indiretos (quando OCR perde as palavras-chave):
 *   - "EXTRA" + ("Entrada" ou "Saida") → estrutura de 3 blocos de turno
 *   - Estrutura com células "Entrada | Saida" repetidas 3+ vezes
 *   - Página que já foi identificada como quinzena no mesmo documento
 */
function isQuinzenaLayout(lines: ExtractedLine[]): boolean {
  const fullText = lines.map((l) => l.text).join('\n').toUpperCase();
  // Indicadores diretos
  if (fullText.includes('QUINZENA')) return true;
  if (fullText.includes('MANH') && fullText.includes('TARDE')) return true;
  // Indicadores indiretos: estrutura de grade de quinzena
  // A linha de cabeçalho de colunas tipicamente tem Entrada e Saida repetidos
  // mesmo que o OCR distorça ("Entaca", "Saica", "Envaca", "saia")
  const entSaidaLine = lines.find(l => {
    const t = l.text.toLowerCase();
    // Conta variantes de "entrada" e "saída"
    const entCount = (t.match(/entr|entac|envac/g) || []).length;
    const saiCount = (t.match(/sa[ií]da|saica|saia\b/g) || []).length;
    return entCount >= 2 || saiCount >= 2 || (entCount >= 1 && saiCount >= 1 && t.includes('|'));
  });
  if (entSaidaLine) return true;
  return false;
}

/**
 * Extrai mês e ano de uma página de quinzena.
 * O mês/ano é manuscrito — OCR captura o ano (4 dígitos) mas raramente o mês.
 * Retorna '??' para valores não encontrados (usuário corrige manualmente).
 */
function extractQuinzenaMonthYear(lines: ExtractedLine[]): { month: string; year: string } {
  const fullText = lines.map((l) => l.text).join(' ');

  const yearMatch = fullText.match(/\b(20\d{2}|19\d{2})\b/);
  const year = yearMatch ? yearMatch[1] : '??';

  const monthMatch = fullText.match(/\b(0?[1-9]|1[0-2])\s*[/\-]\s*(20\d{2}|19\d{2})\b/);
  const month = monthMatch ? monthMatch[1].padStart(2, '0') : '??';

  return { month, year };
}

// ── Limites de coluna como fração da largura da imagem ────────────────────────
//
// Baseado na análise dos dados reais do TC-04 (803px de largura):
//   Col Dia:         x < 15%  (0.00 – 0.15)
//   Manhã Entrada:   15-35%   (0.15 – 0.35)
//   Manhã Saída:     35-50%   (0.35 – 0.50)
//   Tarde Entrada:   50-63%   (0.50 – 0.63)
//   Tarde Saída:     63-74%   (0.63 – 0.74)
//   Extra Entrada:   74-85%   (0.74 – 0.85)
//   Extra Saída:     > 85%    (0.85 – 1.00)
//
const COL_BOUNDS = [0.15, 0.35, 0.50, 0.63, 0.74, 0.85] as const;
// índices: 0=DiaCol 1=ManhãEnt 2=ManhãSaí 3=TardeEnt 4=TardeSaí 5=ExtraEnt 6=ExtraSaí
const COL_NAMES = ['dia', 'manhã-ent', 'manhã-saí', 'tarde-ent', 'tarde-saí', 'extra-ent', 'extra-saí'] as const;

/** Mapeia a posição X (em pixels) à coluna da grade de quinzena */
function xToQuinzenaCol(x: number, imageWidth: number): number {
  const xFrac = x / imageWidth;
  for (let i = 0; i < COL_BOUNDS.length; i++) {
    if (xFrac < COL_BOUNDS[i]) return i;
  }
  return COL_BOUNDS.length; // última coluna (extra-saída)
}

/** Regex para extrair HH:MM de um token OCR possivelmente sujo */
const TIME_IN_TOKEN_RE = /(\d{2}:\d{2})/;

/**
 * Tenta extrair um horário válido HH:MM de um token OCR.
 *
 * Estratégia agressiva:
 *   1. Sanitiza letras espúrias entre dígitos e ':' (ex: "08B:48" → "08:48")
 *   2. Procura padrão \d{2}:\d{2} em qualquer posição do token
 *   3. Tenta reconstruir horário truncado (1 dígito na hora)
 *   4. Valida range de hora (00-23) e minutos (00-59)
 *
 * Retorna null se nenhum horário válido for encontrado.
 */
function extractTimeFromToken(text: string): string | null {
  // Sanitiza letras espúrias antes do ':' (ex: "08B:48" → "08:48")
  const clean = sanitizeTimesInLine(text);

  // Procura \d{2}:\d{2} no token (possivelmente com lixo ao redor)
  const m = clean.match(TIME_IN_TOKEN_RE);
  if (m) {
    const t = m[1];
    const [hh, mm] = t.split(':').map(Number);
    if (hh <= 23 && mm <= 59) return t;
  }

  // Tenta padrão com 1 dígito na hora (truncado)
  const m1 = clean.match(/\b(\d:\d{2})\b/);
  if (m1) {
    const repaired = repairTruncatedHour(m1[1]);
    const [hh, mm] = repaired.split(':').map(Number);
    if (hh <= 23 && mm <= 59) return repaired;
  }

  return null;
}

/**
 * Parseia uma página de ficha de quinzena usando bbox dos tokens OCR.
 *
 * Estratégia em duas camadas:
 *   1. Se `ocrWords` disponível (tokens com bbox): mapeia cada token à coluna
 *      correspondente pela posição X relativa. Agrupa tokens por linha Y para
 *      associar horários ao número do dia da mesma linha.
 *   2. Fallback para OCR linear (sem bbox): extrai o que conseguir das linhas
 *      de texto — comportamento anterior, mais impreciso mas melhor que nada.
 */
function parseQuinzenaPage(
  lines: ExtractedLine[],
  pageNumber: number,
  month: string,
  year: string,
  ocrWords?: OcrWord[],
  imageWidth?: number
): TimeCardDay[] {

  // ── Estratégia 1: bbox disponível E contém horários válidos ──────────────
  if (ocrWords && ocrWords.length > 0 && imageWidth && imageWidth > 0) {
    // Conta quantos tokens têm horários válidos extraíveis
    const timesInWords = ocrWords.filter(w => extractTimeFromToken(w.text) !== null).length;
    if (timesInWords >= 3) {
      // Suficiente para uma extração baseada em posição — usa bbox
      return parseQuinzenaFromWords(ocrWords, imageWidth, month, year);
    }
  }

  // ── Estratégia 2: fallback linear ─────────────────────────────────────────
  return parseQuinzenaLinear(lines, month, year);
}

/**
 * Extrai dias de quinzena usando a posição X dos tokens OCR.
 *
 * Agrupa tokens por Y (tolerância ±20px), depois para cada grupo:
 *   - Token na coluna "dia" (x < 15%) com valor numérico 1-31 = número do dia
 *   - Tokens nas outras colunas com HH:MM válido = horários na posição correta
 *
 * A ordem das colunas (manhã-ent, manhã-saí, tarde-ent, tarde-saí, extra-ent, extra-saí)
 * determina diretamente a alternância IN/OUT — não precisa de heurística.
 */
function parseQuinzenaFromWords(
  words: OcrWord[],
  imageWidth: number,
  month: string,
  year: string
): TimeCardDay[] {
  const Y_TOLERANCE = 25; // px — tokens na mesma linha horizontal

  // Agrupa tokens por linha Y
  const groups: { y: number; tokens: OcrWord[] }[] = [];
  for (const w of words) {
    const cy = (w.y0 + w.y1) / 2;
    const existing = groups.find((g) => Math.abs(g.y - cy) <= Y_TOLERANCE);
    if (existing) {
      existing.tokens.push(w);
    } else {
      groups.push({ y: cy, tokens: [w] });
    }
  }

  // Ordena grupos de cima para baixo
  groups.sort((a, b) => a.y - b.y);

  const days: TimeCardDay[] = [];
  const seenDays = new Set<number>();

  for (const group of groups) {
    // Ordena tokens da esquerda para direita
    group.tokens.sort((a, b) => a.x0 - b.x0);

    let dayNum: number | null = null;
    // 6 slots: [manhã-ent, manhã-saí, tarde-ent, tarde-saí, extra-ent, extra-saí]
    const timeSlots: (string | null)[] = [null, null, null, null, null, null];

    for (const tok of group.tokens) {
      const col = xToQuinzenaCol(tok.x0, imageWidth);
      const text = tok.text.trim();

      if (col === 0) {
        // Coluna de dia — extrai número 1-31
        const numMatch = text.match(/(?<!\d)(\d{1,2})(?!\d|:)/);
        if (numMatch) {
          const n = parseInt(numMatch[1], 10);
          if (n >= 1 && n <= 31) dayNum = n;
        }
      } else if (col >= 1 && col <= 6) {
        // Coluna de horário — tenta extrair HH:MM válido
        const t = extractTimeFromToken(text);
        if (t) timeSlots[col - 1] = t;
      }
    }

    if (dayNum === null || seenDays.has(dayNum)) continue;
    seenDays.add(dayNum);

    const dateRaw = `${dayNum.toString().padStart(2, '0')}/${month}/${year}`;

    // Monta punches a partir dos slots
    // Ordem: [manhã-ent=IN, manhã-saí=OUT, tarde-ent=IN, tarde-saí=OUT, extra-ent=IN, extra-saí=OUT]
    const punches: Punch[] = [];
    const kinds: Array<'IN' | 'OUT'> = ['IN', 'OUT', 'IN', 'OUT', 'IN', 'OUT'];
    for (let s = 0; s < 6; s++) {
      if (timeSlots[s]) {
        const norm = normalizeTimeHHMM(timeSlots[s]!);
        if (isValidOrUncertainTime(norm)) {
          punches.push({ kind: kinds[s], time_raw: timeSlots[s]!, time_hhmm: norm });
        }
      }
    }

    days.push({ date_raw: dateRaw, punches });
  }

  days.sort((a, b) => parseInt(a.date_raw.slice(0, 2)) - parseInt(b.date_raw.slice(0, 2)));
  return days;
}

/**
 * Fallback: extrai dias de quinzena a partir do OCR linear (sem bbox).
 * Menos preciso — usa heurísticas de posição de texto dentro da linha.
 */
function parseQuinzenaLinear(
  lines: ExtractedLine[],
  month: string,
  year: string
): TimeCardDay[] {
  const days: TimeCardDay[] = [];
  const seenDays = new Set<number>();
  const TIME_RE = /(\d{2}:\d{2})/g;

  for (const line of lines) {
    const raw = sanitizeTimesInLine(line.text).replace(/\s+/g, ' ').trim();
    if (!raw || isIgnorableTimeCardLine(raw)) continue;
    if (/quinzena|manh[aã]|tarde|extra|entrada|sa[ií]da|hor[as]?\s+trab/i.test(raw)) continue;

    // Testa se tem horário na linha
    const hasTime = TIME_RE.test(raw);
    TIME_RE.lastIndex = 0;

    // Extrai número do dia (com tolerância a lixo antes do número)
    let dayNum: number | null = null;
    const startMatch = raw.match(/^\D{0,4}(\d{1,2})\b/);
    if (startMatch) {
      const n = parseInt(startMatch[1], 10);
      if (n >= 1 && n <= 31) dayNum = n;
    }
    if (dayNum === null && hasTime) {
      // Busca livre — pega primeiro número 1-31 não embutido em horário
      for (const m of [...raw.matchAll(/(?<!\d)(\d{1,2})(?!\d|:)/g)]) {
        const n = parseInt(m[1], 10);
        if (n >= 1 && n <= 31) { dayNum = n; break; }
      }
    }
    if (dayNum === null || seenDays.has(dayNum)) continue;
    seenDays.add(dayNum);

    const dateRaw = `${dayNum.toString().padStart(2, '0')}/${month}/${year}`;

    // Extrai todos os horários válidos e alterna IN/OUT
    const allTimes = [...raw.matchAll(TIME_RE)].map((m) => m[1]).filter((t) => {
      const [hh, mm] = t.split(':').map(Number);
      return hh <= 23 && mm <= 59;
    });
    TIME_RE.lastIndex = 0;

    days.push({ date_raw: dateRaw, punches: timesToPunches(allTimes) });
  }

  days.sort((a, b) => parseInt(a.date_raw.slice(0, 2)) - parseInt(b.date_raw.slice(0, 2)));
  return days;
}

function hasCdSuffixFormat(text: string): boolean {
  return /\d{2}:\d{2}[cd]\b/i.test(text);
}

/**
 * Extrai punches de linha com sufixos c (chegada) e d (despedida).
 *
 * Estratégia em camadas:
 * 1. Se sufixos mistos E produzem sequência alternada válida → usa mapeamento c/d semântico
 * 2. Se sufixos mistos mas sequência não alternada (ex: d d consecutivos) → alternância simples
 * 3. Se sufixos todos iguais (OCR perdeu distinção) → alternância simples
 */
function punchesFromCdFormat(text: string): Punch[] {
  // Descarta tudo a partir de OCCURRENCE_RE antes de capturar horários
  const occ = text.search(OCCURRENCE_RE);
  const punchPart = occ >= 0 ? text.slice(0, occ) : text;

  const cdRe = /(\d{2}:\d{2})([cd])\b/gi;
  const matches = [...punchPart.matchAll(cdRe)];
  if (matches.length === 0) return [];

  const suffixes = matches.map((m) => m[2].toLowerCase());
  const hasMixed = suffixes.some((s) => s === 'c') && suffixes.some((s) => s === 'd');

  if (hasMixed) {
    // Tenta mapeamento semântico c→IN, d→OUT
    const semantic: Punch[] = [];
    for (const m of matches) {
      const norm = normalizeTimeHHMM(m[1]);
      if (!isValidOrUncertainTime(norm)) continue;
      semantic.push({
        kind: m[2].toLowerCase() === 'c' ? 'IN' : 'OUT',
        time_raw: m[1],
        time_hhmm: norm,
      });
    }

    // Valida se a sequência resultante é alternada (IN OUT IN OUT ...)
    // Se não for (ex: OUT OUT consecutivos por OCR noise), usa alternância simples
    let isAlternating = true;
    for (let k = 1; k < semantic.length; k++) {
      if (semantic[k].kind === semantic[k - 1].kind) {
        isAlternating = false;
        break;
      }
    }
    if (isAlternating) return semantic;
  }

  // Fallback: alternância simples IN/OUT independente de sufixo
  return timesToPunches(matches.map((m) => m[1]));
}

// ─────────────────────────────────────────────────────────────────────────────
// Parser de linha com data completa (formato simples e c/d)
// ─────────────────────────────────────────────────────────────────────────────

export function parseTimeCardLine(line: ExtractedLine): TimeCardDay | null {
  const text = line.text.trim();
  if (!text || isIgnorableTimeCardLine(text)) return null;

  const fullDateMatch = text.match(FULL_DATE_REGEX);
  if (!fullDateMatch) return null;

  const dateRaw = fullDateMatch[1];
  const afterDate = text.slice((fullDateMatch.index || 0) + fullDateMatch[0].length);

  // Formato c/d (time-card-03)
  if (hasCdSuffixFormat(afterDate)) {
    return { date_raw: dateRaw, punches: punchesFromCdFormat(afterDate) };
  }

  // Descarta ocorrências antes de ler horários
  const occ = afterDate.search(OCCURRENCE_RE);
  const punchPart = occ >= 0 ? afterDate.slice(0, occ) : afterDate;
  const rawTimes = [...punchPart.matchAll(TIME_REGEX)].map((m) => m[1]);

  return {
    date_raw: dateRaw,
    punches: timesToPunches(rawTimes),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Detecção de mês/ano no cabeçalho da página
// ─────────────────────────────────────────────────────────────────────────────

function findHeaderMonthYear(lines: ExtractedLine[]): { month: string; year: string } {
  for (const line of lines) {
    const text = line.text.replace(/\s+/g, ' ');

    // "Mes/Ano : 7 / 2012" (SIPON)
    const sipon = text.match(/M[eê]s[\s/]?[Aa]no\s*:\s*(\d{1,2})\s*[/\-]\s*(\d{4})/i);
    if (sipon) return { month: sipon[1].padStart(2, '0'), year: sipon[2] };

    // "Mês/Ano: 08/2018" (genérico)
    const generic =
      text.match(/M[eê]s\s*[/\-]?\s*Ano\s*[:=]?\s*(\d{1,2})\s*[/\-]\s*(\d{4})/i) ||
      text.match(/\bM[eê]s\s*[:=]\s*(\d{1,2})\s*[/\-]\s*(\d{4})/i);
    if (generic) return { month: generic[1].padStart(2, '0'), year: generic[2] };
  }
  return { month: '', year: '' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Remoção de carimbos de digitalização (datas outlier)
// ─────────────────────────────────────────────────────────────────────────────

function removeStampDates(days: TimeCardDay[]): TimeCardDay[] {
  if (days.length <= 2) return days;

  const timestamps: number[] = [];
  for (const d of days) {
    if (d.date_raw.includes('?')) continue;
    const m = d.date_raw.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
    if (!m) continue;
    const dt = new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));
    if (!isNaN(dt.getTime())) timestamps.push(dt.getTime());
  }

  if (timestamps.length < 3) return days;

  const sorted = [...timestamps].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const MS_365 = 365 * 86_400_000;

  return days.filter((d) => {
    if (d.date_raw.includes('?')) return true;
    const m = d.date_raw.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
    if (!m) return true;
    const dt = new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));
    if (isNaN(dt.getTime())) return true;
    return Math.abs(dt.getTime() - median) <= MS_365;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Mesclagem de dias consecutivos com a mesma data
// ─────────────────────────────────────────────────────────────────────────────

function mergeConsecutiveSameDates(days: TimeCardDay[]): TimeCardDay[] {
  const out: TimeCardDay[] = [];
  for (const d of days) {
    const prev = out[out.length - 1];
    if (prev && prev.date_raw === d.date_raw) {
      prev.punches.push(...d.punches);
    } else {
      out.push({ date_raw: d.date_raw, punches: [...d.punches] });
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Extrator principal
// ─────────────────────────────────────────────────────────────────────────────

export function extractTimeCard(doc: ExtractedDocument): TimeCardValue {
  const pages: TimeCardPage[] = [];

  for (const page of doc.pages) {
    // ── Detecção de layout de quinzena (TC-04 e similares) ────────────────
    if (isQuinzenaLayout(page.lines)) {
      const { month, year } = extractQuinzenaMonthYear(page.lines);
      const days = parseQuinzenaPage(
        page.lines,
        page.pageNumber,
        month,
        year,
        page.ocrWords,
        page.imageWidth
      );
      pages.push({
        page: page.pageNumber,
        days: removeStampDates(mergeConsecutiveSameDates(days)),
      });
      continue;
    }

    // ── Layouts padrão ────────────────────────────────────────────────────
    const days: TimeCardDay[] = [];
    const { month: headerMonth, year: headerYear } = findHeaderMonthYear(page.lines);

    for (let i = 0; i < page.lines.length; i++) {
      const line = page.lines[i];
      const text = line.text.replace(/\s+/g, ' ').trim();
      if (!text || isIgnorableTimeCardLine(text)) continue;

      // ── 1. Tenta data completa na linha (formato simples, c/d) ──────────
      const parsedFull = parseTimeCardLine({ ...line, text });
      if (parsedFull) {
        days.push(parsedFull);
        continue;
      }

      // Os próximos formatos precisam do mês/ano do cabeçalho
      if (!headerMonth || !headerYear) continue;

      // ── 2. Formato SIPON: "DD - DDD ..." ────────────────────────────────
      const siponMatch = text.match(DAY_HEADER_RE);

      // ── 3. Formato Relatório Mensal BB: "17SEG — 12:00-18:15 ..." ───────
      // Verificar ANTES do SIPON padrão porque ambos podem casar o início da linha.
      // O BB Relatório se distingue pela jornada colada "HH:MM-HHMM" ou dia-semana colado.
      const bbMatch = text.match(BB_DAY_RE);
      if (bbMatch && (hasBbRelatorioFormat(text) || NO_PUNCH_RE.test(text))) {
        const dayNum = normalizeBbDayNumber(bbMatch[1]);
        if (dayNum !== null) {
          const dateRaw = `${dayNum.toString().padStart(2, '0')}/${headerMonth}/${headerYear}`;
          const punches = parseBbRelatorioLine(text);
          if (punches !== null) {
            days.push({ date_raw: dateRaw, punches });
            continue;
          }
        }
      }

      if (siponMatch) {
        const dayNum = parseInt(siponMatch[1], 10);
        if (dayNum >= 1 && dayNum <= 31) {
          const dateRaw = `${dayNum.toString().padStart(2, '0')}/${headerMonth}/${headerYear}`;

          // Sub-formato BB com ranges "HH:MM - HH:MM"
          const bb = parseBbRanges(text);
          if (bb) {
            days.push({ date_raw: dateRaw, punches: bb });
            continue;
          }

          // SIPON padrão: coleta horários desta e das linhas de continuação
          const collected = punchTimesFromSiponText(text, true);
          while (i + 1 < page.lines.length) {
            const nextText = page.lines[i + 1].text.replace(/\s+/g, ' ').trim();
            if (!nextText || isIgnorableTimeCardLine(nextText)) break;
            if (DAY_HEADER_RE.test(nextText) || FULL_DATE_REGEX.test(nextText)) break;
            collected.push(...punchTimesFromSiponText(nextText, false));
            i++;
          }

          days.push({ date_raw: dateRaw, punches: timesToPunches(collected) });
          continue;
        }
      }
    }

    pages.push({
      page: page.pageNumber,
      days: removeStampDates(mergeConsecutiveSameDates(days)),
    });
  }

  return { pages };
}
