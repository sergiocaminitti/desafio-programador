import fs from 'fs';
import path from 'path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { readPdfDocument } from '../src/core/pdf-reader.js';
import { extractTimeCard } from '../src/core/time-card-extractor.js';
import { extractPayroll } from '../src/core/payroll-extractor.js';
import { generateTimeCardExcel, generatePayrollExcel } from '../src/exporters/excel-exporter.js';
import { generateTimeCardCsv, generatePayrollCsv } from '../src/exporters/csv-exporter.js';
import { generateJson } from '../src/exporters/json-exporter.js';

async function createSamplePdfs() {
  const outputDir = path.join(process.cwd(), 'exemplos');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // 1. cartao-ponto-1.pdf
  const pdf1 = await PDFDocument.create();
  const font = await pdf1.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf1.embedFont(StandardFonts.HelveticaBold);
  const page1 = pdf1.addPage([600, 800]);

  page1.drawText('ESPELHO DE PONTO - MAIO/2019', { x: 50, y: 750, size: 14, font: fontBold, color: rgb(0.1, 0.2, 0.45) });
  page1.drawText('Empresa: Exemplo Servicos LTDA | CNPJ: 12.345.678/0001-90', { x: 50, y: 730, size: 9, font });
  page1.drawText('Funcionario: Joao da Silva | Cargo: Analista', { x: 50, y: 715, size: 9, font });
  page1.drawText('-------------------------------------------------------------------------------------------------', { x: 50, y: 700, size: 9, font });
  page1.drawText('Data         Entrada 1   Saida 1   Entrada 2   Saida 2   Obs', { x: 50, y: 685, size: 10, font: fontBold });
  page1.drawText('-------------------------------------------------------------------------------------------------', { x: 50, y: 675, size: 9, font });

  const days1 = [
    '01/05/2019   FERIADO NACIONAL',
    '02/05/2019   08:00       12:00     13:00       17:00',
    '03/05/2019   08:02       12:01     13:05       17:08',
    '04/05/2019   SABADO / DSR',
    '05/05/2019   DOMINGO / DSR',
    '06/05/2019   08:00       12:00     13:00       18:00',
    '07/05/2019   08:15       12:30     13:30       17:45',
    '08/05/2019   08:00       12:00     13:00       17:00',
    '09/05/2019   08:05       12:05     13:10       17:15',
    '10/05/2019   07:55       12:00     13:00       17:00',
  ];

  let y = 655;
  for (const day of days1) {
    page1.drawText(day, { x: 50, y, size: 9, font });
    y -= 20;
  }

  fs.writeFileSync(path.join(outputDir, 'cartao-ponto-1.pdf'), await pdf1.save());

  // 2. cartao-ponto-2.pdf (Com avisos: batida impar, caractere ?, data quebra sequencia)
  const pdf2 = await PDFDocument.create();
  const font2 = await pdf2.embedFont(StandardFonts.Helvetica);
  const fontBold2 = await pdf2.embedFont(StandardFonts.HelveticaBold);
  const page2 = pdf2.addPage([600, 800]);
  page2.drawText('FOLHA DE PONTO INDIVIDUAL - JUNHO/2019', { x: 50, y: 750, size: 14, font: fontBold2, color: rgb(0.1, 0.2, 0.45) });
  page2.drawText('Data         Entrada 1   Saida 1   Entrada 2   Saida 2', { x: 50, y: 700, size: 10, font: fontBold2 });

  const days2 = [
    '01/06/2019   08:00       12:00     13:00       17:00',
    '02/06/2019   08:30       17:30',                          // 2 batidas
    '03/06/2019   08:00       12:00     17:00',                 // 3 batidas (impar -> aviso amarelo)
    '04/06/2019   0?:25       12:00     13:00       18:00',     // Incerteza ? -> aviso amarelo
    '02/06/2019   08:00       12:00     13:00       17:00',     // Data quebra sequencia -> aviso vermelho
    '06/06/2019   08:00       12:00     13:00       17:00',
  ];

  y = 675;
  for (const day of days2) {
    page2.drawText(day, { x: 50, y, size: 9, font: font2 });
    y -= 20;
  }
  fs.writeFileSync(path.join(outputDir, 'cartao-ponto-2.pdf'), await pdf2.save());

  // 3. holerite-1.pdf (Holerite com verbas e bases separadas)
  const pdf3 = await PDFDocument.create();
  const font3 = await pdf3.embedFont(StandardFonts.Helvetica);
  const fontBold3 = await pdf3.embedFont(StandardFonts.HelveticaBold);
  const page3 = pdf3.addPage([600, 800]);
  page3.drawText('RECIBO DE PAGAMENTO DE SALARIO - 01/2020', { x: 50, y: 750, size: 14, font: fontBold3, color: rgb(0.1, 0.2, 0.45) });
  page3.drawText('Empresa: Alpha Tech LTDA | Competencia: 01/2020', { x: 50, y: 725, size: 10, font: font3 });
  page3.drawText('Codigo  Descricao                  Referencia  Vencimentos  Descontos', { x: 50, y: 690, size: 9, font: fontBold3 });
  page3.drawText('-----------------------------------------------------------------------------------------', { x: 50, y: 680, size: 9, font: font3 });

  const fields1 = [
    '0010    Salario Base               220,00      2.389,77',
    '5560    Horas Extras - 50%         8,00        155,91',
    '0998    INSS                       11,00%                   262,87',
    '0999    Vale Transporte            6,00%                    143,38',
  ];

  y = 660;
  for (const f of fields1) {
    page3.drawText(f, { x: 50, y, size: 9, font: font3 });
    y -= 20;
  }

  page3.drawText('-----------------------------------------------------------------------------------------', { x: 50, y: 560, size: 9, font: font3 });
  page3.drawText('Bases de Calculo e Totais', { x: 50, y: 545, size: 10, font: fontBold3 });
  page3.drawText('Base INSS: 2.545,68       Base FGTS: 2.545,68       FGTS do Mes: 203,65', { x: 50, y: 525, size: 9, font: font3 });
  page3.drawText('Total Vencimentos: 2.545,68     Total Descontos: 406,25     Valor Liquido: 2.139,43', { x: 50, y: 505, size: 9, font: font3 });

  fs.writeFileSync(path.join(outputDir, 'holerite-1.pdf'), await pdf3.save());

  // 4. holerite-2.pdf (Multi-página com meses consecutivos: 01/2020 e 02/2020)
  const pdf4 = await PDFDocument.create();
  const font4 = await pdf4.embedFont(StandardFonts.Helvetica);
  const fontBold4 = await pdf4.embedFont(StandardFonts.HelveticaBold);

  // Pagina 1
  const page4_1 = pdf4.addPage([600, 800]);
  page4_1.drawText('DEMONSTRATIVO DE PAGAMENTO - 01/2020', { x: 50, y: 750, size: 14, font: fontBold4, color: rgb(0.1, 0.2, 0.45) });
  page4_1.drawText('Competencia: 01/2020', { x: 50, y: 725, size: 10, font: font4 });
  page4_1.drawText('0010 Salario Base 220,00 3.500,00', { x: 50, y: 680, size: 9, font: font4 });
  page4_1.drawText('0045 Adicional Noturno 20,00 350,00', { x: 50, y: 660, size: 9, font: font4 });
  page4_1.drawText('0998 INSS 14,00% 450,00', { x: 50, y: 640, size: 9, font: font4 });
  page4_1.drawText('Base INSS 3.850,00   Total Vencimentos 3.850,00   Valor Liquido 3.400,00', { x: 50, y: 520, size: 9, font: font4 });

  // Pagina 2
  const page4_2 = pdf4.addPage([600, 800]);
  page4_2.drawText('DEMONSTRATIVO DE PAGAMENTO - 02/2020', { x: 50, y: 750, size: 14, font: fontBold4, color: rgb(0.1, 0.2, 0.45) });
  page4_2.drawText('Competencia: 02/2020', { x: 50, y: 725, size: 10, font: font4 });
  page4_2.drawText('0010 Salario Base 220,00 3.500,00', { x: 50, y: 680, size: 9, font: font4 });
  page4_2.drawText('5560 Horas Extras - 50% 12,00 280,00', { x: 50, y: 660, size: 9, font: font4 });
  page4_2.drawText('0998 INSS 14,00% 460,00', { x: 50, y: 640, size: 9, font: font4 });
  page4_2.drawText('Base INSS 3.780,00   Total Vencimentos 3.780,00   Valor Liquido 3.320,00', { x: 50, y: 520, size: 9, font: font4 });

  fs.writeFileSync(path.join(outputDir, 'holerite-2.pdf'), await pdf4.save());

  console.log('✓ 4 PDFs de exemplo criados em exemplos/');
}

async function generateSpreadsheets() {
  const outputDir = path.join(process.cwd(), 'exemplos');

  const files = [
    { name: 'cartao-ponto-1', tipo: 'cartao-ponto' as const },
    { name: 'cartao-ponto-2', tipo: 'cartao-ponto' as const },
    { name: 'holerite-1', tipo: 'holerite' as const },
    { name: 'holerite-2', tipo: 'holerite' as const },
  ];

  for (const item of files) {
    const pdfPath = path.join(outputDir, `${item.name}.pdf`);
    const pdfBuffer = fs.readFileSync(pdfPath);
    const doc = await readPdfDocument(pdfBuffer);

    if (item.tipo === 'cartao-ponto') {
      const value = extractTimeCard(doc);
      const xlsxBuffer = await generateTimeCardExcel(value);
      const csvStr = generateTimeCardCsv(value);
      const jsonStr = generateJson(value);

      fs.writeFileSync(path.join(outputDir, `${item.name}.xlsx`), xlsxBuffer);
      fs.writeFileSync(path.join(outputDir, `${item.name}.csv`), csvStr);
      fs.writeFileSync(path.join(outputDir, `${item.name}.json`), jsonStr);
    } else {
      const value = extractPayroll(doc);
      const xlsxBuffer = await generatePayrollExcel(value);
      const csvStr = generatePayrollCsv(value);
      const jsonStr = generateJson(value);

      fs.writeFileSync(path.join(outputDir, `${item.name}.xlsx`), xlsxBuffer);
      fs.writeFileSync(path.join(outputDir, `${item.name}.csv`), csvStr);
      fs.writeFileSync(path.join(outputDir, `${item.name}.json`), jsonStr);
    }
    console.log(`✓ Geradas planilhas (.xlsx, .csv, .json) para ${item.name}`);
  }
}

async function main() {
  await createSamplePdfs();
  await generateSpreadsheets();
  console.log('✓ Todos os exemplos gerados com sucesso!');
}

main().catch(console.error);
