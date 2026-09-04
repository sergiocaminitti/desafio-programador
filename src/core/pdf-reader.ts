import { createCanvas, Path2D, DOMMatrix, ImageData, Image, loadImage } from '@napi-rs/canvas';

// Registra polyfills nativos de canvas antes de carregar o motor de PDF
(globalThis as any).Path2D = Path2D;
(globalThis as any).DOMMatrix = DOMMatrix;
(globalThis as any).ImageData = ImageData;
(globalThis as any).Image = Image;

import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { renderPageAsImage } from 'unpdf';
import { performOcr, performOcrBestOf, scoreOcrText, performOcrQuinzenaWords, type OcrWord } from './ocr.js';

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
  /** Tokens OCR com bbox — preenchido apenas para páginas de ficha de quinzena */
  ocrWords?: OcrWord[];
  /** Largura da imagem renderizada em pixels — necessário para cálculo de colunas */
  imageWidth?: number;
}

export interface ExtractedDocument {
  numPages: number;
  pages: ExtractedPage[];
}

const LINE_Y_TOLERANCE = 4.0; // tolerância em pontos para agrupar tokens na mesma linha

const BOILERPLATE_RE =
  /assinado eletr|juntado em|n[uú]mero do (processo|documento)|documento assinado eletronicamente|impresso por em/i;

/**
 * Carimbos de processo (Fls., assinatura digital) não contam como camada de texto útil.
 * Sem isso, PDFs escaneados com só o cabeçalho do tribunal nunca disparam OCR.
 */
export function isBoilerplateText(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return true;
  if (/^fls\.?\s*:?\s*\d+/i.test(t)) return true;
  if (/^p[aá]g(?:ina)?\.?\s*:?\s*\d+/i.test(t)) return true;
  return BOILERPLATE_RE.test(t);
}

export function meaningfulCharCount(tokens: ExtractedToken[]): number {
  return tokens.reduce((n, tok) => {
    if (isBoilerplateText(tok.text)) return n;
    return n + tok.text.trim().length;
  }, 0);
}

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
 * Pré-processa uma imagem PNG/JPEG para melhorar a qualidade do OCR.
 *
 * Aplica normalização de contraste adaptativa (normalização por percentis 5%/95%)
 * convertendo a imagem para escala de cinza.
 *
 * NÃO aplica threshold/binarização agressiva pois isso piora documentos que
 * já têm bom contraste — causa destruição de caracteres em fontes finas.
 * O threshold só é aplicado se o contraste da imagem for muito baixo
 * (range de tons < 80 após normalização indica documento muito apagado).
 */
async function enhanceImageForOcr(imageBuffer: Buffer): Promise<Buffer> {
  try {
    const img = await loadImage(imageBuffer);
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;

    // 1. Converte para escala de cinza (Rec. 601 luminância)
    const gray = new Uint8Array(data.length / 4);
    for (let i = 0; i < data.length; i += 4) {
      gray[i >> 2] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    }

    // 2. Calcula percentis 5% e 95% para normalização de contraste
    const hist = new Uint32Array(256);
    for (const g of gray) hist[g]++;
    const totalPx = gray.length;
    let lo = 0, hi = 255;
    let cumLo = 0, cumHi = 0;
    for (let v = 0; v < 256; v++) {
      cumLo += hist[v];
      if (cumLo / totalPx < 0.05) lo = v;
    }
    for (let v = 255; v >= 0; v--) {
      cumHi += hist[v];
      if (cumHi / totalPx < 0.05) hi = v;
    }

    const range = hi - lo;
    // Se o range já é adequado (>= 80), a imagem tem contraste suficiente
    // — aplica apenas normalização leve sem binarização
    // Se o range é muito pequeno (< 80), o documento é de baixo contraste
    // — aplica binarização para tentar recuperar o texto
    const isLowContrast = range < 80;
    const normalizedRange = range || 1;

    for (let i = 0; i < data.length; i += 4) {
      const idx = i >> 2;
      let g = Math.round(((gray[idx] - lo) / normalizedRange) * 255);
      g = Math.max(0, Math.min(255, g));

      // Threshold agressivo apenas para documentos de baixo contraste
      const out = isLowContrast ? (g < 128 ? 0 : 255) : g;
      data[i] = data[i + 1] = data[i + 2] = out;
    }

    ctx.putImageData(imgData, 0, 0);
    return canvas.toBuffer('image/png');
  } catch (err) {
    console.warn('[PDF Reader] Falha no pré-processamento OCR, usando imagem original:', err);
    return imageBuffer;
  }
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

    const usefulChars = meaningfulCharCount(rawTokens);
    const isScanned = totalCharCount < 25 || usefulChars < 40;

    let lines: ExtractedLine[] = [];
    let rawText = '';
    let ocrWords: OcrWord[] | undefined;
    let imageWidth: number | undefined;

    if (isScanned) {
      console.log(`[PDF Reader] Página ${pageNum} detectada como escaneada (chars=${totalCharCount}, úteis=${usefulChars}). OCR...`);
      try {
        const imageArrayBuffer = await renderPageAsImage(new Uint8Array(pdfBuffer), pageNum, {
          scale: 3.0,   // escala maior = mais detalhes para OCR em docs degradados
          canvasImport: () => import('@napi-rs/canvas'),
        });
        const imageBuffer = Buffer.from(imageArrayBuffer);

        let ocrText: string;

        // Tenta PSM 4 e PSM 6 em paralelo — usa o que produzir score mais alto
        const [text4, text6] = await Promise.all([
          performOcr(imageBuffer, '4'),
          performOcr(imageBuffer, '6'),
        ]);
        const score4 = scoreOcrText(text4);
        const score6 = scoreOcrText(text6);

        if (score4 >= 5 && score4 >= score6) {
          // PSM 4 bom e igual ou melhor que PSM 6
          ocrText = text4;
        } else if (score6 > score4) {
          // PSM 6 melhor — usa
          ocrText = text6;
        } else if (score4 >= 5) {
          // PSM 4 aceitável
          ocrText = text4;
        } else {
          // Ambos ruins — tenta PSM 11 como último recurso
          console.log(`[PDF Reader] PSM 4 (${score4}) e PSM 6 (${score6}) insuficientes, tentando PSM 11...`);
          const text11 = await performOcr(imageBuffer, '11');
          const score11 = scoreOcrText(text11);
          const best = [
            { text: text4, score: score4 },
            { text: text6, score: score6 },
            { text: text11, score: score11 },
          ].sort((a, b) => b.score - a.score)[0];
          ocrText = best.text;
        }

        rawText = ocrText;
        const ocrLines = ocrText.split('\n').map((l) => l.trim()).filter(Boolean);
        lines = ocrLines.map((lineText, idx) => ({
          y: 1000 - idx * 20,
          text: lineText,
          tokens: [{ text: lineText, x: 50, y: 1000 - idx * 20, width: 200, height: 12 }],
        }));
      } catch (err) {
        console.error(`[PDF Reader] Erro ao renderizar/executar OCR na página ${pageNum}:`, err);
      }
    } else {
      lines = groupTokensIntoLines(rawTokens);
      rawText = lines.map((l) => l.text).join('\n');
    }

    pages.push({
      pageNumber: pageNum,
      lines,
      rawText,
      isScanned,
      ocrWords,
      imageWidth,
    });
  }

  return {
    numPages,
    pages,
  };
}
