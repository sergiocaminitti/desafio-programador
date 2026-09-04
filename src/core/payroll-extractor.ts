import { ExtractedDocument, ExtractedLine, ExtractedToken } from './pdf-reader.js';
import { PayrollValue, PayrollPage, PayrollField, PayrollBase } from '../shared/types.js';

const CURRENCY_REGEX = /(?<![A-Za-z0-9])(-?\d{1,3}(?:\.\d{3})*,\d{2})/g;

const MONTH_NAMES: Record<string, string> = {
  jan: '01', janeiro: '01', aneiro: '01',
  fev: '02', fevereiro: '02', evereiro: '02',
  mar: '03', marco: '03', março: '03', arco: '03',
  abr: '04', abril: '04', bril: '04',
  mai: '05', maio: '05', aio: '05',
  jun: '06', junho: '06', unho: '06',
  jul: '07', julho: '07', ulho: '07',
  ago: '08', agosto: '08', gosto: '08',
  set: '09', setembro: '09', etembro: '09',
  out: '10', outubro: '10', utubro: '10',
  nov: '11', novembro: '11', ovembro: '11',
  dez: '12', dezembro: '12', ezembro: '12',
};

const KNOWN_BASE_PATTERNS = [
  /base\s*(?:de\s*c[aá]lculo\s*)?(?:do\s*)?i\.?\s*n\.?\s*s\.?\s*s/i,
  /basedecalculodoinss/i,
  /base\s*(?:de\s*c[aá]lculo\s*)?(?:do\s*)?fgts/i,
  /basedecalculodofgts/i,
  /base\s*(?:de\s*c[aá]lculo\s*)?(?:do\s*)?i\.?\s*r(?:\.?\s*r?f)?/i,
  /basedecalculodoirf/i,
  /valor\s*(?:do\s*)?fgts/i,
  /valordofgts/i,
  /f\.?\s*g\.?\s*t\.?\s*s\.?\s*do\s*m[eê]s/i,
  /fgts\s*m[eê]s/i,
  /sal\.?\s*contrib\.?\s*inss/i,
  /base\s*c[aá]lc\.?\s*(?:do\s*)?(?:inss|fgts|irrf)/i,
  /tot\.?\s*rendimentos/i,
  /total\s*(?:de\s*)?rendimentos/i,
  /total\s*(?:de\s*)?vencimentos/i,
  /(?:t?otal|tot\.?)\s*(?:de\s*)?proventos/i,
  /(?:t?otal|tot\.?)\s*(?:de\s*)?descontos/i,
  /totaldescontos/i,
  /^total$/i,
  /sal[aá]rio\s*l[ií]quido/i,
  /salarioliquidonomes/i,
  /valor\s*l[ií]quido/i,
  /[lIíi]?quido\s*(?:a\s*receber)?/i,
  /l[ií]q[uü]ido/i,
  /proventos\s*bruto/i,
  /proventos\s*l[ií]quidos/i,
  /proventos\s*retidos/i,
  /provis[aã]o\s*fgts/i,
  /remunera[cç][aã]o\s*fun[cç][aã]o/i,
  /adiantamento\s*13/i,
  /margem\s*\(\d+%\s*\)/i,
  /consigna[cç][aã]o/i,
  /dep\.?\s*i\.?\s*r/i,
  /valordoirfarecolher/i,
  /valor\s*do\s*i\.?r\.?f/i,
];

// Linhas inteiras a ignorar
const SKIP_LINE_RE =
  /verba\s+nome|declara[cç][aã]o\s+remunera|funcion[aá]rio\s*:|folha de pagamento\s*:|cod\.?\s*descri|impresso por|documento assinado|assinado eletr|fls\.?\s*:|cnpj|ctps|centro custo|no\.?\s*pessoal|demonstrativo de pagamento/i;

// Labels que são exclusivamente dados cadastrais do funcionário, nunca verbas.
const HEADER_FIELD_RE =
  /^(grupo|subgrupo|banco\/?ag\b|admiss[aã]o\b)/i;

// Labels que devem ser ignorados dentro de blocos de ficha
const SKIP_FICHA_LABEL_RE = /^(dias\/horastrab|folha\s+normal|m[eê]s\b)/i;

// ─────────────────────────────────────────────────────────────────────────────
// Utilitários
// ─────────────────────────────────────────────────────────────────────────────

export function isBaseLabel(label: string): boolean {
  const clean = label.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!clean) return false;
  return KNOWN_BASE_PATTERNS.some((pattern) => pattern.test(clean));
}

/**
 * Colapsa texto com letras espaçadas (artefato OCR de fontes decorativas):
 * "D E M O N S T R A T I V O" → "DEMONSTRATIVO"
 */
export function despaceText(text: string): string {
  if (/(?:[A-Za-z0-9À-ÿ]\s){3,}[A-Za-z0-9À-ÿ]/.test(text)) {
    return text.replace(/([A-Za-z0-9À-ÿ])\s(?=[A-Za-z0-9À-ÿ])/g, '$1');
  }
  return text;
}

function collapseSpaces(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Remove código numérico inicial de um label.
 * "40 Reembolso VR" → { code: "40", label: "Reembolso VR" }
 */
function stripLeadingCode(labelPart: string): { code: string; label: string } {
  const cleaned = collapseSpaces(labelPart).replace(/:$/, '').trim();
  const match = cleaned.match(/^(\/?[A-Z]?\d{1,4})\s+(.+)$/i);
  if (match && match[2]) {
    return { code: match[1].replace(/^\//, ''), label: match[2].trim() };
  }
  return { code: '', label: cleaned };
}

/**
 * Limpa prefixos OCR espúrios no início de um label.
 *
 * Artefatos comuns de OCR de documentos escaneados:
 *   "[SALARIO"       → "SALARIO"        (colchete inicial)
 *   "ILICENCA"       → "LICENCA"        (I maiúsculo antes de L)
 *   "IREMUNERACAO"   → "REMUNERACAO"
 *   "DpESC"          → "DESC"           (letra minúscula no meio)
 *   "DPpESC"         → "DESC"
 *   "ALE REFEICAO"   → permanece (ALE pode ser "VALE" com V→A)
 */
function cleanOcrLabelPrefix(label: string): string {
  let s = label;

  // 1. Remove colchetes, parênteses, barras, hífens ou dois-pontos iniciais (artefatos de borda)
  s = s.replace(/^[[\]()\-—|!:\s]+/, '').trim();

  // 2. Remove prefixos OCR com padrão misto claro:
  //    ex: "DpSALARIO" → "SALARIO", "IlLICENCA" → "LICENCA", "DPpESC" -> "DESC", "pEP" -> "EP"
  s = s.replace(/^[A-Z]?[A-Z][a-z](?=[A-Z]{2,})/, '').trim();
  s = s.replace(/^[A-Z][a-z](?=[A-Z]{2,})/, '').trim();
  s = s.replace(/^[a-z](?=[A-Z]{2,})/, '').trim();

  // 3. Normalização de corruptelas comuns de OCR em cabeçalhos escaneados
  s = s.replace(/\b(?:fwss|fnss|rnss)\b/gi, 'INSS');
  s = s.replace(/\b(?:frrf)\b/gi, 'IRRF');
  s = s.replace(/\b(?:ialario|alario)\b/gi, 'SALARIO');
  s = s.replace(/\b(?:sr comiss[aã]o|ppsr comiss[aã]o|bsr comiss[aã]o)\b/gi, 'DSR COMISSAO');
  s = s.replace(/\b(?:if media|ppif media)\b/gi, 'DIF MEDIA');
  s = s.replace(/\b(?:ale|male)\s+refei[cç][aã]o\b/gi, 'VALE REFEICAO');
  s = s.replace(/\b(?:pesc|dpesc|dppesc|besc|esc)\b/gi, 'DESC');
  s = s.replace(/\b(?:esc adt)\b/gi, 'DESC ADT');
  s = s.replace(/\b(?:esc dep)\b/gi, 'DESC DEP');
  s = s.replace(/\b(?:otal de)\b/gi, 'TOTAL DE');
  s = s.replace(/\b(?:lssist|ssist|pssist)\b/gi, 'ASSIST');
  s = s.replace(/\b(?:ep assist|pep assist|ppep assist)\b/gi, 'DEP ASSIST');
  s = s.replace(/\b(?:icenca|ilicenca)\b/gi, 'LICENCA');
  s = s.replace(/\b(?:rremunera|emunera|iremunera)/gi, 'REMUNERA');
  s = s.replace(/Líquino/gi, 'Líquido');
  s = s.replace(/^[íi]quido\b/gi, 'Líquido');

  return s;
}

/**
 * Normaliza o label de uma verba para maximizar a reutilização de colunas.
 *
 * Problemas tratados:
 * 1. Sufixo numérico/zero do sistema de folha: "VA Funcionario 0" → "VA Funcionario"
 *    - Na ficha, o campo "referência" fica colado ao label quando é "0" ou vazio.
 *    - Mas sufixos que são quantidades reais (ex: "13" vales) também devem ser removidos.
 * 2. Prefixos OCR espúrios: "[SALARIO", "ILICENCA", "DpESC"
 * 3. Informações variáveis embutidas que mudam mês a mês:
 *    - Mês referência: "HORA EXTRA-BCO HORAS-CONV JULHO/18" → "HORA EXTRA-BCO HORAS-CONV"
 *    - Código de ajuste: "PREVI PESSOAL PB2 AC.SIST/0718" → "PREVI PESSOAL PB2 AC.SIST"
 *
 * A normalização é aplicada APÓS a extração e NÃO altera o valor monetário.
 */
export function normalizeFieldLabel(label: string): string {
  let s = cleanOcrLabelPrefix(collapseSpaces(label));

  // Remove sufixo zero/numérico isolado no final que é separador de coluna no PDF
  // Ex: "VA Funcionario 0" → "VA Funcionario"
  // Ex: "INSS Normal 0" → "INSS Normal"
  // Ex: "Vale Ref Func 22" → "Vale Ref Func" (quantidade de vales)
  // Mas: "Hr Ext Diu 60%" → mantém (60% é parte do nome)
  // Mas: "PB2-2B" → mantém (código alfanumérico)
  s = s.replace(/\s+\d+\s*$/, '').trim();

  // Remove sufixo de mês/ano variável: "JULHO/18", "AGOSTO/18", "0718"
  // Ex: "HORA EXTRA-BCO HORAS-CONV JULHO/18" → "HORA EXTRA-BCO HORAS-CONV"
  s = s.replace(/\s+(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-z]*\/?\d{2,4}\s*$/i, '').trim();
  s = s.replace(/\s+[A-Z]{3,}O\/?\d{2,4}\s*$/i, '').trim(); // meses em maiúsculo
  s = s.replace(/\s+\d{2}\/\d{2,4}\s*$/, '').trim(); // MM/AA ou MM/AAAA

  // Remove sufixo de código de ajuste variável: "AC.SIST/0718", "S/0818"
  s = s.replace(/\s+(?:AC\.?SIST|S)\/\d{4}\s*$/i, '').trim();
  // Remove sufixos "S/13 SAL", "S/FERIAS"
  s = s.replace(/\s+S\/(?:13\s*SAL|FERIAS|FER|LP|AB)\b.*/i, '').trim();

  return s || label; // fallback para o original se a limpeza removeu tudo
}

/**
 * Normaliza o label de uma base de cálculo.
 * Remove prefixos numéricos espúrios e padroniza os nomes conhecidos.
 */
export function normalizeBaseLabel(label: string): string {
  let s = cleanOcrLabelPrefix(collapseSpaces(label));
  // Remove número espúrio no início (ex: "30,67 BASEDECALCULODOINSS")
  s = s.replace(/^-?\d{1,3}(?:\.\d{3})*,\d{2}\s+/, '');
  s = s.replace(/^-?\d+(?:[.,]\d+)?\s+/, '');
  return s.trim() || label;
}

function allCurrencyMatches(text: string): RegExpMatchArray[] {
  return [...text.matchAll(CURRENCY_REGEX)];
}

// ─────────────────────────────────────────────────────────────────────────────
// Separação de colunas por posição X absoluta (ficha financeira payroll-01)
// ─────────────────────────────────────────────────────────────────────────────

function hasFichaLayout(line: ExtractedLine): boolean {
  if (!line.tokens || line.tokens.length < 6) return false;
  const xs = line.tokens.map((t) => t.x);
  return (
    xs.some((x) => x < 215) &&
    xs.some((x) => x >= 220 && x < 415) &&
    xs.some((x) => x >= 415)
  );
}

function splitFichaColumns(line: ExtractedLine): [string, string, string] {
  const col1Toks: ExtractedToken[] = [];
  const col2Toks: ExtractedToken[] = [];
  const col3Toks: ExtractedToken[] = [];

  for (const tok of line.tokens) {
    if (tok.x < 215) col1Toks.push(tok);
    else if (tok.x < 415) col2Toks.push(tok);
    else col3Toks.push(tok);
  }

  const joinCol = (toks: ExtractedToken[]) =>
    collapseSpaces(toks.sort((a, b) => a.x - b.x).map((t) => t.text).join(' '));

  return [joinCol(col1Toks), joinCol(col2Toks), joinCol(col3Toks)];
}

function splitByGaps(line: ExtractedLine, minGap = 60): string[] {
  if (!line.tokens || line.tokens.length === 0) return [line.text];

  const sorted = [...line.tokens].sort((a, b) => a.x - b.x);
  const cols: ExtractedToken[][] = [];
  let current: ExtractedToken[] = [];
  let lastRight = -9999;

  for (const tok of sorted) {
    if (current.length > 0 && tok.x - lastRight > minGap) {
      cols.push(current);
      current = [];
    }
    current.push(tok);
    lastRight = tok.x + (tok.width || 0);
  }
  if (current.length) cols.push(current);

  return cols.map((c) => collapseSpaces(c.map((t) => t.text).join(' '))).filter(Boolean);
}

// ─────────────────────────────────────────────────────────────────────────────
// Funções de acumulação de fields/bases
// ─────────────────────────────────────────────────────────────────────────────

function pushField(
  fields: PayrollField[],
  code: string,
  rawLabel: string,
  reference: string,
  value: string
) {
  const lab = normalizeFieldLabel(collapseSpaces(rawLabel).replace(/:$/, ''));
  if (!lab || lab.length < 2) return;
  if (HEADER_FIELD_RE.test(lab)) return;
  if (SKIP_FICHA_LABEL_RE.test(lab)) return;
  fields.push({ code, label: lab, reference, value });
}

function pushBase(bases: PayrollBase[], rawLabel: string, value: string) {
  const lab = normalizeBaseLabel(rawLabel);
  if (!lab || lab.length < 2) return;
  if (/^base$/i.test(lab)) return;
  bases.push({ label: lab, value });
}

/**
 * Deduplica fields dentro de uma competência.
 *
 * Quando o mesmo label aparece múltiplas vezes (ex: duplicação de OCR no payroll-04,
 * ou verbas com mesmo código em meses diferentes do 13º no payroll-01), mantém
 * apenas a primeira ocorrência — que é a que a UI e os exporters já usam via .find().
 *
 * Exceção: se o mesmo label tem valores **diferentes**, mantém ambos porque representam
 * lançamentos distintos (ex: PREVI PESSOAL PB2 normal vs PREVI PESSOAL PB2 ACERTO).
 * Nesses casos, o segundo recebe um sufixo numérico para diferenciação.
 */
function deduplicateFields(fields: PayrollField[]): PayrollField[] {
  const seen = new Map<string, number>(); // label → ocorrências
  const result: PayrollField[] = [];

  for (const f of fields) {
    const count = seen.get(f.label) ?? 0;
    if (count === 0) {
      // Primeira ocorrência — sempre mantém
      result.push(f);
      seen.set(f.label, 1);
    } else {
      // Ocorrência duplicada — verifica se o value é diferente
      const firstIdx = result.findIndex((r) => r.label === f.label);
      if (firstIdx >= 0 && result[firstIdx].value === f.value) {
        // Mesmo valor → duplicata literal (OCR duplicou), descarta
        continue;
      }
      // Valor diferente → lançamento distinto, mantém com sufixo
      const newLabel = `${f.label} (${count + 1})`;
      result.push({ ...f, label: newLabel });
      seen.set(f.label, count + 1);
    }
  }

  return result;
}

function deduplicateBases(bases: PayrollBase[]): PayrollBase[] {
  const seen = new Set<string>();
  const result: PayrollBase[] = [];
  for (const b of bases) {
    const key = `${b.label.toUpperCase().trim()}|${b.value.trim()}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(b);
    }
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Parsing de coluna da ficha financeira
// ─────────────────────────────────────────────────────────────────────────────

export function parseFichaColumnText(
  text: string,
  isResult: boolean,
  fields: PayrollField[],
  bases: PayrollBase[]
) {
  const raw = collapseSpaces(text);
  if (!raw) return;
  if (SKIP_FICHA_LABEL_RE.test(raw)) return;

  if (isResult || isBaseLabel(raw)) {
    const matches = allCurrencyMatches(raw);
    if (matches.length === 0) return;

    // Para a coluna de resultados (isResult), quando há múltiplos valores,
    // cada um é uma base separada — extraímos todos, não apenas o último.
    // Cada valor tem o texto antes do próximo como label.
    if (matches.length >= 2) {
      for (let i = 0; i < matches.length; i++) {
        const val = matches[i][1];
        const start = i === 0 ? 0 : (matches[i - 1].index! + matches[i - 1][0].length);
        const labelPart = raw.slice(start, matches[i].index!).trim();
        if (labelPart && labelPart.length > 1) {
          pushBase(bases, labelPart, val);
        }
      }
      return;
    }

    const last = matches[matches.length - 1];
    const before = raw.slice(0, last.index).trim();
    if (SKIP_FICHA_LABEL_RE.test(before)) return;
    pushBase(bases, before || raw, last[1]);
    return;
  }

  const money = allCurrencyMatches(raw);

  if (money.length >= 2) {
    const value = money[money.length - 1][1];
    const reference = money[0][1];
    const labelPart = raw.slice(0, money[0].index!).trim();
    if (!labelPart) return;
    const { code, label } = stripLeadingCode(labelPart);
    if (isBaseLabel(label) || isBaseLabel(labelPart)) {
      pushBase(bases, label || labelPart, value);
      return;
    }
    pushField(fields, code, label, reference, value);
    return;
  }

  if (money.length === 1) {
    const value = money[0][1];
    const labelPart = raw.slice(0, money[0].index!).trim();
    if (!labelPart) return;
    const { code, label } = stripLeadingCode(labelPart);
    if (isBaseLabel(label) || isBaseLabel(labelPart)) {
      pushBase(bases, label || labelPart, value);
      return;
    }
    pushField(fields, code, label, '', value);
    return;
  }

  const intOnly = raw.match(/^(?:(\d{1,4})\s+)?(.+?)\s+(-?\d+)$/);
  if (intOnly) {
    const code = intOnly[1] || '';
    const label = intOnly[2].trim();
    if (SKIP_FICHA_LABEL_RE.test(label)) return;
    if (isBaseLabel(label)) {
      pushBase(bases, label, intOnly[3]);
      return;
    }
    pushField(fields, code, label, '', intOnly[3]);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Parsing de linha completa
// ─────────────────────────────────────────────────────────────────────────────

function parseFichaLine(line: ExtractedLine, fields: PayrollField[], bases: PayrollBase[]) {
  if (hasFichaLayout(line)) {
    const [c1, c2, c3] = splitFichaColumns(line);
    if (c1) parseFichaColumnText(c1, false, fields, bases);
    if (c2) parseFichaColumnText(c2, false, fields, bases);
    if (c3) parseFichaColumnText(c3, true, fields, bases);
    return;
  }

  const cols = splitByGaps(line);
  if (cols.length >= 3) {
    parseFichaColumnText(cols[0], false, fields, bases);
    parseFichaColumnText(cols[1], false, fields, bases);
    for (let c = 2; c < cols.length; c++) {
      parseFichaColumnText(cols[c], true, fields, bases);
    }
    return;
  }
  if (cols.length === 2) {
    parseFichaColumnText(cols[0], false, fields, bases);
    parseFichaColumnText(cols[1], isBaseLabel(cols[1]), fields, bases);
    return;
  }
  parseFichaColumnText(cols[0] || line.text, isBaseLabel(line.text), fields, bases);
}

export function parseStandardPayrollLine(
  lineText: string,
  fields: PayrollField[],
  bases: PayrollBase[]
) {
  const text = collapseSpaces(despaceText(lineText));
  if (!text) return;
  if (SKIP_LINE_RE.test(text)) return;
  if (HEADER_FIELD_RE.test(text)) return;
  if (SKIP_FICHA_LABEL_RE.test(text)) return;

  if (parseLabelValuePairs(text, bases)) return;

  const matches = allCurrencyMatches(text);
  if (matches.length === 0) return;

  // Se há múltiplos valores monetários e entre eles existe descrição de verba (letras >= 2)
  // trata-se de linha com múltiplas colunas (ex: Proventos | Descontos)
  if (matches.length >= 2) {
    const segments: { label: string; ref: string; value: string }[] = [];
    let curStart = 0;

    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      const nextM = matches[i + 1];

      // Texto entre este match e o próximo
      const betweenNext = nextM
        ? text.slice(m.index! + m[0].length, nextM.index!).trim()
        : '';

      const hasNextLabel = /[A-Za-zÀ-ÿ]{2,}/.test(betweenNext);

      if (hasNextLabel || !nextM) {
        // O valor atual fecha um segmento iniciado em curStart
        const chunk = text.slice(curStart, m.index!).trim();
        segments.push({ label: chunk, ref: '', value: m[1] });
        if (nextM) {
          curStart = m.index! + m[0].length;
        }
      } else {
        // O próximo valor NÃO tem label antes dele — m é referência e nextM é o valor
        const chunk = text.slice(curStart, m.index!).trim();
        segments.push({ label: chunk, ref: m[1], value: nextM[1] });
        i++; // consome nextM
        if (i + 1 < matches.length) {
          curStart = nextM.index! + nextM[0].length;
        }
      }
    }

    for (const seg of segments) {
      const raw = cleanOcrLabelPrefix(collapseSpaces(seg.label));
      if (!raw) continue;
      if (HEADER_FIELD_RE.test(raw)) continue;
      const { code, label } = stripLeadingCode(raw);
      if (isBaseLabel(label) || isBaseLabel(raw)) {
        pushBase(bases, label || raw, seg.value);
      } else {
        pushField(fields, code, label, seg.ref, seg.value);
      }
    }
    return;
  }

  // Apenas 1 valor monetário
  const m = matches[0];
  const labelPart = cleanOcrLabelPrefix(text.slice(0, m.index!));
  if (!labelPart) return;
  if (HEADER_FIELD_RE.test(labelPart)) return;
  const { code, label } = stripLeadingCode(labelPart);
  if (isBaseLabel(label) || isBaseLabel(labelPart)) {
    pushBase(bases, label || labelPart, m[1]);
  } else {
    pushField(fields, code, label, '', m[1]);
  }
}

function parseLabelValuePairs(text: string, bases: PayrollBase[]): boolean {
  const pairRe = /([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9 ./%()\-]+?)\s*:\s*(-?\d{1,3}(?:\.\d{3})*,\d{2})/g;
  const pairs = [...text.matchAll(pairRe)];

  if (pairs.length < 2) return false;

  let anyBase = false;
  for (const p of pairs) {
    const label = collapseSpaces(p[1]);
    const value = p[2];
    if (isBaseLabel(label)) {
      pushBase(bases, label, value);
      anyBase = true;
    } else if (label.length > 3) {
      pushBase(bases, label, value);
      anyBase = true;
    }
  }
  return anyBase;
}

// ─────────────────────────────────────────────────────────────────────────────
// Extração de competência (mês/ano)
// ─────────────────────────────────────────────────────────────────────────────

export function extractCompetence(lines: ExtractedLine[]): { year: string; month: string } | null {
  for (const l of lines) {
    const text = collapseSpaces(despaceText(l.text));

    // Ignora linhas de admissão/cadastro para não confundir data cadastral com mês de competência
    if (/admiss[aã]o\b/i.test(text)) continue;

    // "Mês: jan/17" ou "Mês: jan-17"
    const named = text.match(/M[eê]s\s*:\s*([a-zçãéêíóôú]{3,9})[/\-](\d{2,4})/i);
    if (named) {
      const mStr = MONTH_NAMES[named[1].toLowerCase()];
      if (mStr) {
        let y = named[2];
        if (y.length === 2) y = '20' + y;
        return { year: y, month: mStr };
      }
    }

    // "Mês/Ano: 08/2018" ou "Período: 01/2020" ou "Competência: 01/2020"
    const header = text.match(
      /(?:M[eê]s\s*[/\-]?\s*Ano|Per[ií]odo|refer[eê]ncia|compet[eê]ncia)\s*[:=]?\s*(\d{1,2})[/\-.](\d{4})/i
    );
    if (header) {
      return { year: header[2], month: header[1].padStart(2, '0') };
    }

    // "Referência SETEMBRO/2019" ou "CNPJ: ETEMBRO/2019" — mês por extenso + ano (payroll-04 e similares)
    const namedSlash = text.match(
      /(?:refer[eê]ncia|compet[eê]ncia|m[eê]s|folha|cnpj)?\s*[:=]?\s*([a-zçãéêíóôú]{4,9})\/(\d{4})/i
    );
    if (namedSlash) {
      const mStr = MONTH_NAMES[namedSlash[1].toLowerCase()];
      if (mStr) return { year: namedSlash[2], month: mStr };
    }

    // "SETEMBRO/2019" ou "SETEMBRO 2019" sem prefixo — cabeçalho de recibo
    const monthYear = text.match(/\b([a-zçãéêíóôú]{4,9})[/\s-]+(20\d{2}|19\d{2})\b/i);
    if (monthYear) {
      const mStr = MONTH_NAMES[monthYear[1].toLowerCase()];
      if (mStr) return { year: monthYear[2], month: mStr };
    }

    // "Recibo de Pagamento de Salário - 01/2020"
    const dashed = text.match(/(?:sal[aá]rio|pagamento|recibo|holerite)[^\d]{0,40}(\d{2})\/(\d{4})/i);
    if (dashed) {
      return { year: dashed[2], month: dashed[1] };
    }

    // "10/2019 Data Pagto 31.10.2019" — MM/AAAA explícito no início
    // Não pode ser parte de uma data completa DD/MM/AAAA (ex: 09/09/2019)
    if (!/\d{2}[/.-]\d{2}[/.-]\d{4}/.test(text)) {
      const periodExplicit = text.match(/\b(\d{2})\/(\d{4})\b/);
      if (periodExplicit && !/fls|pag\.?\s*\d/i.test(text)) {
        const monthNum = parseInt(periodExplicit[1], 10);
        if (monthNum >= 1 && monthNum <= 12) {
          return { year: periodExplicit[2], month: periodExplicit[1] };
        }
      }
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// API pública — parse de página individual (usada nos testes)
// ─────────────────────────────────────────────────────────────────────────────

export function parsePayrollPage(lines: ExtractedLine[], pageNumber: number): PayrollPage {
  const fake: ExtractedDocument = {
    numPages: 1,
    pages: [
      {
        pageNumber,
        lines,
        rawText: lines.map((l) => l.text).join('\n'),
        isScanned: false,
      },
    ],
  };
  const extracted = extractPayroll(fake);
  return extracted.pages[0] ?? {
    page: pageNumber,
    year: '',
    month: '',
    fields: [],
    bases: [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Extrator principal
// ─────────────────────────────────────────────────────────────────────────────

export function extractPayroll(doc: ExtractedDocument): PayrollValue {
  const pages: PayrollPage[] = [];

  for (const page of doc.pages) {
    // ── Detecta blocos mensais da ficha financeira (payroll-01) ──
    const monthBlocks: { lineIdx: number; month: string; year: string }[] = [];

    for (let idx = 0; idx < page.lines.length; idx++) {
      const text = collapseSpaces(page.lines[idx].text);
      const m1 = text.match(/M[eê]s\s*:\s*([a-zç]{3,9})[/\-](\d{2,4})/i);
      if (m1) {
        const mStr = MONTH_NAMES[m1[1].toLowerCase()];
        if (!mStr) continue;
        let yStr = m1[2];
        if (yStr.length === 2) yStr = '20' + yStr;
        monthBlocks.push({ lineIdx: idx, month: mStr, year: yStr });
      }
    }

    if (monthBlocks.length > 0) {
      for (let b = 0; b < monthBlocks.length; b++) {
        const current = monthBlocks[b];
        const nextIdx =
          b + 1 < monthBlocks.length ? monthBlocks[b + 1].lineIdx : page.lines.length;
        const blockLines = page.lines.slice(current.lineIdx, nextIdx);
        const fields: PayrollField[] = [];
        const bases: PayrollBase[] = [];

        for (const bl of blockLines) {
          parseFichaLine(bl, fields, bases);
        }

        pages.push({
          page: page.pageNumber,
          year: current.year,
          month: current.month,
          fields: deduplicateFields(fields),
          bases: deduplicateBases(bases),
        });
      }
      continue;
    }

    // ── Layout padrão ──
    const comp = extractCompetence(page.lines);

    // Detecta se a página contém múltiplas vias do mesmo recibo (ex: payroll-04 escaneado com Via 1 e Via 2)
    const receiptIndices: number[] = [];
    for (let i = 0; i < page.lines.length; i++) {
      if (/recibo\s+de\s+pagamento/i.test(page.lines[i].text)) {
        receiptIndices.push(i);
      }
    }

    const parseLines = (lines: ExtractedLine[]) => {
      const f: PayrollField[] = [];
      const b: PayrollBase[] = [];
      for (let lIdx = 0; lIdx < lines.length; lIdx++) {
        const line = lines[lIdx];
        const text = collapseSpaces(line.text);

        if (
          /sal[aá]rio\s*base/i.test(text) &&
          /(?:contrib\.?\s*inss|fgts|irrf)/i.test(text) &&
          allCurrencyMatches(text).length === 0
        ) {
          const nextLine = lines[lIdx + 1];
          if (nextLine) {
            const nextText = collapseSpaces(nextLine.text);
            const moneyMatches = allCurrencyMatches(nextText);
            if (moneyMatches.length >= 4) {
              const defaultLabels = [
                'Salário Base',
                'Sal. Contrib. INSS',
                'Base Cálc. FGTS',
                'FGTS Mês',
                'Base Cálc. IRRF',
              ];
              for (let mIdx = 0; mIdx < moneyMatches.length && mIdx < defaultLabels.length; mIdx++) {
                pushBase(b, defaultLabels[mIdx], moneyMatches[mIdx][1]);
              }
              lIdx++;
              continue;
            }
          }
        }

        parseStandardPayrollLine(line.text, f, b);
      }
      return { fields: f, bases: b };
    };

    let fields: PayrollField[] = [];
    let bases: PayrollBase[] = [];

    if (receiptIndices.length >= 2) {
      const blocks = [];
      for (let r = 0; r < receiptIndices.length; r++) {
        const start = receiptIndices[r];
        const end = r + 1 < receiptIndices.length ? receiptIndices[r + 1] : page.lines.length;
        blocks.push(parseLines(page.lines.slice(start, end)));
      }

      for (const blk of blocks) {
        bases.push(...blk.bases);
      }

      const parseBRL = (valStr: string) => {
        const num = parseFloat(valStr.replace(/\./g, '').replace(',', '.'));
        return isNaN(num) ? 0 : num;
      };

      const totalProvBase = bases.find((b) => /total\s+de\s+proventos/i.test(b.label));
      const targetProv = totalProvBase ? parseBRL(totalProvBase.value) : null;

      let bestBlock = blocks[blocks.length - 1]; // default para a última via (centro do scanner)
      let bestDiff = Infinity;

      if (targetProv !== null && targetProv > 0) {
        for (const blk of blocks) {
          // Soma os 3 maiores valores de cada bloco (que costumam ser os proventos principais)
          const sortedVals = blk.fields.map(f => parseBRL(f.value)).sort((a, b) => b - a);
          // Ou busca subset que soma targetProv
          let provSum = 0;
          for (const v of sortedVals) {
            if (provSum + v <= targetProv + 0.05) {
              provSum += v;
            }
          }
          const diff = Math.abs(provSum - targetProv);
          if (diff < bestDiff) {
            bestDiff = diff;
            bestBlock = blk;
          }
        }
      }

      fields = bestBlock.fields;
    } else {
      const single = parseLines(page.lines);
      fields = single.fields;
      bases = single.bases;
    }

    pages.push({
      page: page.pageNumber,
      year: comp?.year ?? '',
      month: comp?.month ?? '',
      fields: deduplicateFields(fields),
      bases: deduplicateBases(bases),
    });
  }

  // ── Inferência sequencial para páginas cujo OCR danificou o nome do mês ──
  for (let i = 0; i < pages.length; i++) {
    if (!pages[i].year || !pages[i].month) {
      if (i > 0 && pages[i - 1].year && pages[i - 1].month) {
        const prevY = parseInt(pages[i - 1].year, 10);
        const prevM = parseInt(pages[i - 1].month, 10);
        const nextM = prevM === 12 ? 1 : prevM + 1;
        const nextY = prevM === 12 ? prevY + 1 : prevY;
        pages[i].year = String(nextY);
        pages[i].month = String(nextM).padStart(2, '0');
      }
    }
  }

  return { pages };
}
