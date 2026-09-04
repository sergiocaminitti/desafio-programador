/**
 * Valida a qualidade dos JSONs gerados comparando com o esperado.
 * Imprime um resumo de: contagens, primeiros campos e primeiras bases.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import type { PayrollValue, TimeCardValue } from '../src/shared/types.js';

const dir = join(process.cwd(), 'exemplos');

function checkPayroll(fileName: string) {
  const data: PayrollValue = JSON.parse(readFileSync(join(dir, fileName), 'utf-8'));
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`PAYROLL: ${fileName}  (${data.pages.length} competências)`);
  console.log('─'.repeat(60));

  for (const page of data.pages) {
    const label = `[${page.month}/${page.year} p.${page.page}]`;
    const fieldsOk = page.fields.every(
      f => !f.label.match(/^\d{1,4}\s+/) && // código não vazando no label
           !f.label.includes('  ')          // espaços duplos (ref vazando)
    );
    const basesOk = page.bases.every(
      b => !b.label.match(/^-?\d{1,3}(?:\.\d{3})*,\d{2}\s+/) // número espúrio no início
    );

    const issues: string[] = [];
    if (!fieldsOk) issues.push('labels contaminados');
    if (!basesOk) issues.push('bases com número espúrio');
    if (page.fields.length === 0 && page.bases.length === 0) issues.push('página vazia');

    const status = issues.length === 0 ? '✓' : `✗ ${issues.join(', ')}`;
    console.log(`  ${label}  fields=${page.fields.length}  bases=${page.bases.length}  ${status}`);

    // Mostra os 3 primeiros campos se houver problemas
    if (issues.length > 0) {
      for (const f of page.fields.slice(0, 3)) {
        console.log(`      field: code="${f.code}" label="${f.label}" ref="${f.reference}" val="${f.value}"`);
      }
      for (const b of page.bases.slice(0, 3)) {
        console.log(`      base:  label="${b.label}" val="${b.value}"`);
      }
    }
  }
}

function checkTimeCard(fileName: string) {
  const data: TimeCardValue = JSON.parse(readFileSync(join(dir, fileName), 'utf-8'));
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`TIME-CARD: ${fileName}  (${data.pages.length} páginas)`);
  console.log('─'.repeat(60));

  let totalDays = 0;
  let stampDates = 0; // datas com ano > 2025 ou muito fora do período

  for (const page of data.pages) {
    totalDays += page.days.length;
    // Datas com ano muito fora do período do documento = carimbos não filtrados
    for (const day of page.days) {
      const m = day.date_raw.match(/(\d{4})$/);
      if (m) {
        const year = parseInt(m[1], 10);
        if (year > 2025) stampDates++;
      }
    }
    // Mostra os 3 primeiros e últimos dias
    const sample = [
      ...page.days.slice(0, 2),
      ...(page.days.length > 4 ? page.days.slice(-2) : []),
    ];
    console.log(`  Página ${page.page}: ${page.days.length} dias`);
    for (const d of sample) {
      const punches = d.punches.map(p => `${p.kind}:${p.time_raw}`).join(' ');
      console.log(`    ${d.date_raw}  [${punches || 'sem batidas'}]`);
    }
  }

  console.log(`  Total: ${totalDays} dias`);
  if (stampDates > 0) {
    console.log(`  ✗ PROBLEMA: ${stampDates} datas-carimbo não filtradas (ano > 2025)`);
  } else {
    console.log(`  ✓ Nenhuma data-carimbo detectada`);
  }
}

// ── PAYROLLS ──
checkPayroll('payroll-01.json');
checkPayroll('payroll-02.json');
checkPayroll('payroll-03.json');
checkPayroll('payroll-04.json');

// ── TIME CARDS ──
checkTimeCard('time-card-01.json');
checkTimeCard('time-card-02.json');
checkTimeCard('time-card-03.json');
checkTimeCard('time-card-04.json');

console.log('\n\nValidação concluída.');
