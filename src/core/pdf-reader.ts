import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { performOcr } from './ocr.js';

export interface ExtractedToken {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ExtractedLine {
  y: number;
  text: string;
  tokens: ExtractedToken[];
}

export interface ExtractedPage {
  pageNumber: number;
  lines: ExtractedLine[];
  rawText: string;
  isScanned: boolean;
}

export interface ExtractedDocument {
  numPages: number;
  pages: ExtractedPage[];
}

const LINE_Y_TOLERANCE = 4.0; // tolerância em pontos para agrupar tokens na mesma linha

/**
 * Agrupa tokens soltos de uma página em linhas horizontais ordenadas de cima para baixo.
 */
export function groupTokensIntoLines(tokens: ExtractedToken[]): ExtractedLine[] {
  if (tokens.length === 0) return [];

  // Ordena por Y decrescente (topo para base da página no sistema de coordenadas do PDF)
  const sorted = [...tokens].sort((a, b) => b.y - a.y);

  const lines: { y: number; tokens: ExtractedToken[] }[] = [];

  for (const token of sorted) {
    // Procura uma linha existente com Y compatível
    const matchedLine = lines.find((l) => Math.abs(l.y - token.y) <= LINE_Y_TOLERANCE);

    if (matchedLine) {
      matchedLine.tokens.push(token);
      // Atualiza Y médio da linha
      const sumY = matchedLine.tokens.reduce((acc, t) => acc + t.y, 0);
      matchedLine.y = sumY / matchedLine.tokens.length;
    } else {
      lines.push({ y: token.y, tokens: [token] });
    }
  }

  // Ordena as linhas do topo para o rodapé da página
  lines.sort((a, b) => b.y - a.y);

  // Ordena os tokens de cada linha da esquerda para a direita (X crescente)
  return lines.map((line) => {
    line.tokens.sort((a, b) => a.x - b.x);

    // Constrói o texto da linha mantendo espaçamento inteligente
    let fullText = '';
    let lastRight = -1;

    for (const tok of line.tokens) {
      const trimmed = tok.text.trim();
      if (!trimmed) continue;

      if (lastRight >= 0 && tok.x - lastRight > 2.5) {
        fullText += ' ';
      }
      fullText += tok.text;
      lastRight = tok.x + (tok.width || 0);
    }

    return {
      y: line.y,
      text: fullText.trim(),
      tokens: line.tokens,
    };
  }).filter((line) => line.text.length > 0);
}

/**
 * Lê um arquivo PDF a partir de um buffer, extraindo páginas, linhas e identificando digital vs escaneado.
 */
export async function readPdfDocument(pdfBuffer: Buffer): Promise<ExtractedDocument> {
  const data = new Uint8Array(pdfBuffer);
  const loadingTask = pdfjsLib.getDocument({
    data,
    useSystemFonts: true,
    disableFontFace: true,
    isEvalSupported: false,
  });

  const doc = await loadingTask.promise;
  const numPages = doc.numPages;
  const pages: ExtractedPage[] = [];

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const textContent = await page.getTextContent();

    const rawTokens: ExtractedToken[] = [];
    let totalCharCount = 0;

    for (const item of textContent.items) {
      if ('str' in item) {
        const text = item.str;
        totalCharCount += text.trim().length;

        // transform: [scaleX, skewY, skewX, scaleY, transX, transY]
        const tx = item.transform[4];
        const ty = item.transform[5];
        const w = item.width || 0;
        const h = item.height || 0;

        if (text.length > 0) {
          rawTokens.push({
            text,
            x: tx,
            y: ty,
            width: w,
            height: h,
          });
        }
      }
    }

    // Se a página tiver menos de 25 caracteres embutidos, provavelmente é uma imagem escaneada
    const isScanned = totalCharCount < 25;

    let lines: ExtractedLine[] = [];
    let rawText = '';

    if (isScanned) {
      console.log(`[PDF Reader] Página ${pageNum} detectada como escaneada (texto nativo insuficiente). Aplicando OCR...`);
      // Executa OCR na página
      const ocrText = await performOcr(pdfBuffer);
      rawText = ocrText;
      const ocrLines = ocrText.split('\n').map((l) => l.trim()).filter(Boolean);
      lines = ocrLines.map((lineText, idx) => ({
        y: 1000 - idx * 20,
        text: lineText,
        tokens: [{ text: lineText, x: 50, y: 1000 - idx * 20, width: 200, height: 12 }],
      }));
    } else {
      lines = groupTokensIntoLines(rawTokens);
      rawText = lines.map((l) => l.text).join('\n');
    }

    pages.push({
      pageNumber: pageNum,
      lines,
      rawText,
      isScanned,
    });
  }

  return {
    numPages,
    pages,
  };
}
