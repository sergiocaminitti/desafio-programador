import fs from 'fs';
import path from 'path';
import { readPdfDocument } from '../src/core/pdf-reader.js';
import { extractTimeCard } from '../src/core/time-card-extractor.js';
import { extractPayroll } from '../src/core/payroll-extractor.js';
import { generateTimeCardExcel, generatePayrollExcel } from '../src/exporters/excel-exporter.js';
import { generateTimeCardCsv, generatePayrollCsv } from '../src/exporters/csv-exporter.js';
import { generateJson } from '../src/exporters/json-exporter.js';

async function generateAllSpreadsheets() {
  const files = [
    { name: 'payroll-01.pdf', type: 'payroll' as const },
    { name: 'payroll-02.pdf', type: 'payroll' as const },
    { name: 'payroll-03.pdf', type: 'payroll' as const },
    { name: 'payroll-04.pdf', type: 'payroll' as const },
    { name: 'time-card-01.pdf', type: 'time-card' as const },
    { name: 'time-card-02.pdf', type: 'time-card' as const },
    { name: 'time-card-03.pdf', type: 'time-card' as const },
    { name: 'time-card-04.pdf', type: 'time-card' as const },
  ];

  const exemplosDir = path.join(process.cwd(), 'exemplos');

  console.log('=====================================================');
  console.log('GERANDO PLANILHAS E EXPORTAÇÕES PARA OS EXEMPLOS REAIS');
  console.log('=====================================================\n');

  for (const item of files) {
    const pdfPath = path.join(exemplosDir, item.name);
    if (!fs.existsSync(pdfPath)) {
      console.log(`[SKIP] Arquivo não encontrado: ${item.name}`);
      continue;
    }

    const baseName = item.name.replace('.pdf', '');
    console.log(`[Processando] ${item.name} (${item.type})...`);

    const buffer = fs.readFileSync(pdfPath);
    const doc = await readPdfDocument(buffer);

    if (item.type === 'time-card') {
      const value = extractTimeCard(doc);
      const totalDays = value.pages.reduce((acc, p) => acc + p.days.length, 0);
      console.log(`  -> Extraídos ${totalDays} dias em ${value.pages.length} páginas.`);

      const xlsxBuffer = await generateTimeCardExcel(value);
      fs.writeFileSync(path.join(exemplosDir, `${baseName}.xlsx`), xlsxBuffer);

      const csvContent = generateTimeCardCsv(value);
      fs.writeFileSync(path.join(exemplosDir, `${baseName}.csv`), csvContent);

      const jsonContent = generateJson(value);
      fs.writeFileSync(path.join(exemplosDir, `${baseName}.json`), jsonContent);
    } else {
      const value = extractPayroll(doc);
      console.log(`  -> Extraídas ${value.pages.length} competências/páginas.`);

      const xlsxBuffer = await generatePayrollExcel(value);
      fs.writeFileSync(path.join(exemplosDir, `${baseName}.xlsx`), xlsxBuffer);

      const csvContent = generatePayrollCsv(value);
      fs.writeFileSync(path.join(exemplosDir, `${baseName}.csv`), csvContent);

      const jsonContent = generateJson(value);
      fs.writeFileSync(path.join(exemplosDir, `${baseName}.json`), jsonContent);
    }

    console.log(`  ✓ Gerados: ${baseName}.xlsx, ${baseName}.csv, ${baseName}.json\n`);
  }

  console.log('Todas as planilhas dos 8 exemplos reais foram geradas com sucesso!');
}

generateAllSpreadsheets().catch(console.error);
