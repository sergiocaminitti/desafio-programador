import { ExtractedDocument, ExtractedLine } from './pdf-reader.js';
import { PayrollValue, PayrollPage, PayrollField, PayrollBase } from '../shared/types.js';

// Regex para valores monetários brasileiros (ex: 2.389,77 ou 155,91 ou 2.3?9,77)
const CURRENCY_REGEX = /\b([0-9\?]{1,3}(?:\.[0-9\?]{3})*,[0-9\?]{2})\b/g;

// Regex para competência MM/AAAA ou MM-AAAA
const COMPETENCE_REGEX = /\b(0[1-9]|1[0-2]|[0-1\?][0-9\?])[\/\-](20\d{2}|19\d{2}|[12\?][0-9\?]{3})\b/;

const MONTH_NAMES: Record<string, string> = {
  janeiro: '01', jan: '01',
  fevereiro: '02', fev: '02',
  marco: '03', marco_: '03', mar: '03', 'março': '03',
  abril: '04', abr: '04',
  maio: '05', mai: '05',
  junho: '06', jun: '06',
  julho: '07', jul: '07',
  agosto: '08', ago: '08',
  setembro: '09', set: '09',
  outubro: '10', out: '10',
  novembro: '11', nov: '11',
  dezembro: '12', dez: '12',
};

// Rótulos conhecidos de bases e totais (NUNCA devem entrar em fields)
const KNOWN_BASE_PATTERNS = [
  /base\s+(?:de\s+c[aá]lculo\s+)?inss/i,
  /base\s+(?:de\s+c[aá]lculo\s+)?fgts/i,
  /base\s+(?:de\s+c[aá]lculo\s+)?ir(?:rf)?/i,
  /fgts\s+do\s+m[eê]s/i,
  /total\s+(?:de\s+)?vencimentos/i,
  /total\s+(?:de\s+)?proventos/i,
  /total\s+(?:de\s+)?descontos/i,
  /valor\s+l[ií]quido/i,
  /l[ií]quido\s+a\s+receber/i,
  /total\s+l[ií]quido/i,
  /sal\.\s*contr\.\s*inss/i,
];

/**
 * Extrai competência (ano e mês) do cabeçalho da página.
 */
export function extractCompetence(lines: ExtractedLine[]): { year: string; month: string } {
  for (const line of lines.slice(0, 15)) { // Procura nas primeiras 15 linhas (cabeçalho)
    const text = line.text;

    // 1. Padrão MM/AAAA
    const match = text.match(COMPETENCE_REGEX);
    if (match) {
      let month = match[1];
      if (month.length === 1 && !month.includes('?')) {
        month = '0' + month;
      }
      return {
        month,
        year: match[2],
      };
    }

    // 2. Padrão por extenso (ex: "Janeiro / 2020" ou "Mês: FEV/2020")
    for (const [name, num] of Object.entries(MONTH_NAMES)) {
      const regex = new RegExp(`\\b${name}\\b[\\s\\/\\-de]+(20\\d{2}|19\\d{2})`, 'i');
      const m = text.match(regex);
      if (m) {
        return {
          month: num,
          year: m[1],
        };
      }
    }
  }

  return { year: '????', month: '??' };
}

/**
 * Verifica se um texto corresponde a uma base/total.
 */
export function isBaseLabel(text: string): boolean {
  return KNOWN_BASE_PATTERNS.some((p) => p.test(text));
}

/**
 * Normaliza o rótulo de uma base para o padrão do contrato.
 */
export function normalizeBaseLabel(rawText: string): string {
  const t = rawText.trim();
  if (/base.*inss/i.test(t)) return 'Base INSS';
  if (/base.*fgts/i.test(t)) return 'Base FGTS';
  if (/base.*ir/i.test(t)) return 'Base IR';
  if (/total.*(venc|prov)/i.test(t)) return 'Total Vencimentos';
  if (/total.*desc/i.test(t)) return 'Total Descontos';
  if (/l[ií]quido/i.test(t)) return 'Valor Líquido';
  if (/fgts.*m[eê]s/i.test(t)) return 'FGTS do Mês';
  return t;
}

/**
 * Extrai a página de holerite separando estritamente fields (verbas) de bases (totais).
 */
export function parsePayrollPage(lines: ExtractedLine[], pageNum: number): PayrollPage {
  const { year, month } = extractCompetence(lines);

  const fields: PayrollField[] = [];
  const bases: PayrollBase[] = [];

  let inBasesSection = false;

  for (const line of lines) {
    const text = line.text;

    // Ignora linhas de cabeçalho puro ou dados cadastrais do funcionário/empresa
    if (/c[oó]digo\s+descri[cç][aã]o|demonstrativo\s+de\s+pagamento|recibo\s+de\s+pagamento/i.test(text)) {
      continue;
    }

    // Se detectou início de seção de bases/totais
    if (/bases?\s+de\s+c[aá]lculo|totais|valor\s+l[ií]quido|sal[aá]rio\s+base.*sal\.\s*contr/i.test(text)) {
      inBasesSection = true;
    }

    // Procura valores monetários na linha
    const currencyMatches = [...text.matchAll(CURRENCY_REGEX)];
    if (currencyMatches.length === 0) continue;

    // Se a linha tem cara de base ou estamos na seção de bases
    const lineMatchesBase = isBaseLabel(text);

    if (inBasesSection || lineMatchesBase) {
      // Extrai bases
      // Para cada valor monetário encontrado, tenta associar ao rótulo correspondente
      for (const curMatch of currencyMatches) {
        const val = curMatch[1];
        const labelCandidate = text.slice(0, curMatch.index).trim();
        const cleanLabel = normalizeBaseLabel(labelCandidate || text);

        // Evita duplicatas exatas de label na mesma página
        if (!bases.some((b) => b.label === cleanLabel && b.value === val)) {
          bases.push({
            label: cleanLabel,
            value: val,
          });
        }
      }
    } else {
      // É uma linha de verba (fields)
      // Estrutura típica: [Código] [Descrição / Label] [Referência opcional] [Valor]
      const val = currencyMatches[currencyMatches.length - 1][1]; // Último valor monetário é o provento/desconto
      const beforeVal = text.slice(0, currencyMatches[currencyMatches.length - 1].index).trim();

      // Procura código numérico no início (ex: "0010" ou "5560")
      const codeMatch = beforeVal.match(/^(\d{3,5})\s+/);
      const code = codeMatch ? codeMatch[1] : '';
      const afterCode = codeMatch ? beforeVal.slice(codeMatch[0].length).trim() : beforeVal;

      // Procura referência (ex: "220,00", "8,00", "30D", "11,00")
      const refMatch = afterCode.match(/(\d{1,3}(?:,\d{1,2})?%?|\d{1,2}D)$/);
      let reference = '';
      let label = afterCode;

      if (refMatch && refMatch.index !== undefined && refMatch.index > 0) {
        reference = refMatch[1];
        label = afterCode.slice(0, refMatch.index).trim();
      }

      // Limpa pontuações soltas do label
      label = label.replace(/[\-–—\.\:]+$/, '').trim();

      if (label.length > 0 && !isBaseLabel(label)) {
        fields.push({
          code,
          label,
          reference,
          value: val,
        });
      }
    }
  }

  return {
    page: pageNum,
    year,
    month,
    fields,
    bases,
  };
}

/**
 * Extrai a estrutura completa de Holerite a partir de um documento PDF lido.
 */
export function extractPayroll(doc: ExtractedDocument): PayrollValue {
  const pages: PayrollPage[] = [];

  for (const page of doc.pages) {
    const pageRecord = parsePayrollPage(page.lines, page.pageNumber);
    pages.push(pageRecord);
  }

  return {
    pages,
  };
}
