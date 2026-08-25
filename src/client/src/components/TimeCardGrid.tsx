import React from 'react';
import { TimeCardValue, TimeCardPage, TimeCardDay } from '@shared/types';
import { computeTimeCardWarnings, normalizeTimeHHMM } from '@shared/warnings';
import { AlertCircle, AlertTriangle, CheckCircle2 } from 'lucide-react';

interface TimeCardGridProps {
  value: TimeCardValue;
  onChange: (newValue: TimeCardValue) => void;
}

export const TimeCardGrid: React.FC<TimeCardGridProps> = ({ value, onChange }) => {
  // 1. Calcula o número máximo de batidas para determinar a quantidade de colunas Entrada N / Saída N
  let maxPunches = 0;
  value.pages.forEach((p: TimeCardPage) => {
    p.days.forEach((d: TimeCardDay) => {
      if (d.punches.length > maxPunches) {
        maxPunches = d.punches.length;
      }
    });
  });

  const numPairs = Math.max(1, Math.ceil(maxPunches / 2));

  // 2. Calcula avisos em tempo real com base no estado atual
  const warnings = computeTimeCardWarnings(value);

  // Manipuladores de edição
  const handleDateChange = (pageIdx: number, dayIdx: number, rawVal: string) => {
    // Permite apenas dígitos, separadores de data (/, -, .) e '?'
    const newDate = rawVal.replace(/[^\d\/\-\.\?]/g, '').slice(0, 10);

    const updatedPages = [...value.pages];
    const updatedDays = [...updatedPages[pageIdx].days];
    updatedDays[dayIdx] = {
      ...updatedDays[dayIdx],
      date_raw: newDate,
    };
    updatedPages[pageIdx] = {
      ...updatedPages[pageIdx],
      days: updatedDays,
    };
    onChange({ pages: updatedPages });
  };

  const handlePunchChange = (
    pageIdx: number,
    dayIdx: number,
    punchIdx: number,
    rawVal: string
  ) => {
    // Permite apenas dígitos, ':', 'h', '.', e '?'
    const newTime = rawVal.replace(/[^\d:hH\.\?]/g, '').slice(0, 5);

    const updatedPages = [...value.pages];
    const updatedDays = [...updatedPages[pageIdx].days];
    const day = updatedDays[dayIdx];
    const updatedPunches = [...day.punches];

    const kind = punchIdx % 2 === 0 ? 'IN' : 'OUT';
    const time_hhmm = normalizeTimeHHMM(newTime);

    if (newTime.trim() === '') {
      if (punchIdx < updatedPunches.length) {
        updatedPunches[punchIdx] = { kind, time_raw: '', time_hhmm: '' };
      }
    } else {
      updatedPunches[punchIdx] = {
        kind,
        time_raw: newTime,
        time_hhmm,
      };
    }

    updatedDays[dayIdx] = {
      ...day,
      punches: updatedPunches,
    };
    updatedPages[pageIdx] = {
      ...updatedPages[pageIdx],
      days: updatedDays,
    };
    onChange({ pages: updatedPages });
  };

  return (
    <div className="table-container">
      <table className="data-table">
        <thead>
          <tr>
            <th style={{ width: '125px', minWidth: '125px', textAlign: 'center' }}>Data</th>
            {Array.from({ length: numPairs }).map((_, i: number) => (
              <React.Fragment key={i}>
                <th style={{ width: '90px', minWidth: '90px', textAlign: 'center' }}>Entrada {i + 1}</th>
                <th style={{ width: '90px', minWidth: '90px', textAlign: 'center' }}>Saída {i + 1}</th>
              </React.Fragment>
            ))}
            <th style={{ width: '220px', minWidth: '220px' }}>Status & Auditoria</th>
          </tr>
        </thead>
        <tbody>
          {value.pages.flatMap((page: TimeCardPage, pageIdx: number) =>
            page.days.map((day: TimeCardDay, dayIdx: number) => {
              const warningKey = `${page.page}-${dayIdx}`;
              const highlight = warnings.get(warningKey);

              const rowClass =
                highlight?.color === 'red'
                  ? 'row-red'
                  : highlight?.color === 'yellow'
                  ? 'row-yellow'
                  : '';

              const cellBorderClass = highlight?.hasLeftBorder ? 'cell-red-border' : '';

              return (
                <tr key={warningKey} className={rowClass}>
                  {/* Coluna Data */}
                  <td className={cellBorderClass} style={{ textAlign: 'center' }}>
                    <input
                      type="text"
                      placeholder="DD/MM/AAAA"
                      className={`cell-input cell-input-date ${day.date_raw.includes('?') ? 'uncertain-cell' : ''}`}
                      value={day.date_raw}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        handleDateChange(pageIdx, dayIdx, e.target.value)
                      }
                    />
                  </td>

                  {/* Colunas de Batidas Alternadas Entrada / Saída */}
                  {Array.from({ length: numPairs * 2 }).map((_, pIdx: number) => {
                    const punch = day.punches[pIdx];
                    const val = punch ? punch.time_raw : '';
                    const isUncertain = val.includes('?');

                    return (
                      <td key={pIdx} style={{ textAlign: 'center' }}>
                        <input
                          type="text"
                          placeholder="--:--"
                          className={`cell-input cell-input-time ${isUncertain ? 'uncertain-cell' : ''}`}
                          value={val}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                            handlePunchChange(pageIdx, dayIdx, pIdx, e.target.value)
                          }
                        />
                      </td>
                    );
                  })}

                  {/* Coluna de Alertas / Explicação */}
                  <td>
                    {highlight && highlight.reasons.length > 0 ? (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                          fontSize: '0.76rem',
                          fontWeight: 600,
                        }}
                      >
                        {highlight.color === 'red' ? (
                          <AlertCircle size={14} color="#dc3545" />
                        ) : (
                          <AlertTriangle size={14} color="#856404" />
                        )}
                        <span>{highlight.reasons.join(', ')}</span>
                      </div>
                    ) : (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                          fontSize: '0.76rem',
                          color: '#2b8a3e',
                          fontWeight: 500,
                        }}
                      >
                        <CheckCircle2 size={13} />
                        <span>Validado</span>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
};
