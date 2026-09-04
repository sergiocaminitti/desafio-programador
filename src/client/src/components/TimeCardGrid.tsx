import React, { useState } from 'react';
import { TimeCardValue, TimeCardPage, TimeCardDay } from '@shared/types';
import { computeTimeCardWarnings, normalizeTimeHHMM } from '@shared/warnings';
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react';

interface TimeCardGridProps {
  value: TimeCardValue;
  onChange: (newValue: TimeCardValue) => void;
}

interface TimeCardPageCardProps {
  page: TimeCardPage;
  pageIdx: number;
  numPairs: number;
  warnings: ReturnType<typeof computeTimeCardWarnings>;
  onDateChange: (pageIdx: number, dayIdx: number, value: string) => void;
  onPunchChange: (pageIdx: number, dayIdx: number, punchIdx: number, value: string) => void;
  defaultExpanded: boolean;
}

const TimeCardPageCard: React.FC<TimeCardPageCardProps> = ({
  page,
  pageIdx,
  numPairs,
  warnings,
  onDateChange,
  onPunchChange,
  defaultExpanded,
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const pageWarnings = page.days
    .map((_, dayIdx) => warnings.get(`${page.page}-${dayIdx}`))
    .filter((warning): warning is NonNullable<typeof warning> => Boolean(warning && warning.reasons.length > 0));
  const firstWarning = pageWarnings[0];

  return (
    <div className="pr-page-card">
      <button
        type="button"
        className="pr-page-header"
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
        aria-controls={`time-card-page-${pageIdx}`}
      >
        <div className="pr-page-header-left">
          <span className="pr-page-chevron">
            {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </span>
          <span className="pr-page-badge">Folha {page.page}</span>
          <span className="pr-page-summary">
            {page.days.length} dia{page.days.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="pr-page-header-right">
          {firstWarning ? (
            <div className="pr-alert-tag" title={pageWarnings.flatMap((warning) => warning.reasons).join('\n')}>
              {firstWarning.color === 'red' ? (
                <AlertCircle size={13} color="var(--warning-red-border)" />
              ) : (
                <AlertTriangle size={13} color="var(--warning-yellow-text)" />
              )}
              <span>{firstWarning.reasons[0]}</span>
              {pageWarnings.length > 1 && (
                <span style={{ opacity: 0.65 }}>+{pageWarnings.length - 1}</span>
              )}
            </div>
          ) : (
            <div className="pr-ok-tag">
              <CheckCircle2 size={13} />
              <span>Validado</span>
            </div>
          )}
        </div>
      </button>

      {expanded && (
        <div id={`time-card-page-${pageIdx}`} className="pr-page-body">
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: '125px', minWidth: '125px', textAlign: 'center' }}>Data</th>
                  {Array.from({ length: numPairs }).map((_, pairIdx) => (
                    <React.Fragment key={pairIdx}>
                      <th style={{ width: '90px', minWidth: '90px', textAlign: 'center' }}>Entrada {pairIdx + 1}</th>
                      <th style={{ width: '90px', minWidth: '90px', textAlign: 'center' }}>Saída {pairIdx + 1}</th>
                    </React.Fragment>
                  ))}
                  <th style={{ width: '220px', minWidth: '220px' }}>Status & Auditoria</th>
                </tr>
              </thead>
              <tbody>
                {page.days.map((day: TimeCardDay, dayIdx: number) => {
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
                      <td className={cellBorderClass} style={{ textAlign: 'center' }}>
                        <input
                          type="text"
                          placeholder="DD/MM/AAAA"
                          className={`cell-input cell-input-date ${day.date_raw.includes('?') ? 'uncertain-cell' : ''}`}
                          value={day.date_raw}
                          onChange={(event) => onDateChange(pageIdx, dayIdx, event.target.value)}
                        />
                      </td>
                      {Array.from({ length: numPairs * 2 }).map((_, punchIdx) => {
                        const punch = day.punches[punchIdx];
                        const val = punch ? punch.time_raw : '';
                        return (
                          <td key={punchIdx} style={{ textAlign: 'center' }}>
                            <input
                              type="text"
                              placeholder="--:--"
                              className={`cell-input cell-input-time ${val.includes('?') ? 'uncertain-cell' : ''}`}
                              value={val}
                              onChange={(event) => onPunchChange(pageIdx, dayIdx, punchIdx, event.target.value)}
                            />
                          </td>
                        );
                      })}
                      <td>
                        {highlight && highlight.reasons.length > 0 ? (
                          <div className="pr-alert-tag">
                            {highlight.color === 'red' ? (
                              <AlertCircle size={14} color="var(--warning-red-border)" />
                            ) : (
                              <AlertTriangle size={14} color="var(--warning-yellow-text)" />
                            )}
                            <span>{highlight.reasons.join(', ')}</span>
                          </div>
                        ) : (
                          <div className="pr-ok-tag">
                            <CheckCircle2 size={13} />
                            <span>Validado</span>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export const TimeCardGrid: React.FC<TimeCardGridProps> = ({ value, onChange }) => {
  let maxPunches = 0;
  value.pages.forEach((page) => {
    page.days.forEach((day) => {
      maxPunches = Math.max(maxPunches, day.punches.length);
    });
  });
  const numPairs = Math.max(1, Math.ceil(maxPunches / 2));
  const warnings = computeTimeCardWarnings(value);

  const handleDateChange = (pageIdx: number, dayIdx: number, rawVal: string) => {
    const newDate = rawVal.replace(/[^\d\/\-\.\?]/g, '').slice(0, 10);
    const updatedPages = [...value.pages];
    const updatedDays = [...updatedPages[pageIdx].days];
    updatedDays[dayIdx] = { ...updatedDays[dayIdx], date_raw: newDate };
    updatedPages[pageIdx] = { ...updatedPages[pageIdx], days: updatedDays };
    onChange({ pages: updatedPages });
  };

  const handlePunchChange = (pageIdx: number, dayIdx: number, punchIdx: number, rawVal: string) => {
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
      updatedPunches[punchIdx] = { kind, time_raw: newTime, time_hhmm };
    }

    updatedDays[dayIdx] = { ...day, punches: updatedPunches };
    updatedPages[pageIdx] = { ...updatedPages[pageIdx], days: updatedDays };
    onChange({ pages: updatedPages });
  };

  if (value.pages.length === 0) {
    return (
      <div className="pr-empty-state" style={{ padding: '2.5rem', textAlign: 'center' }}>
        Nenhuma página extraída.
      </div>
    );
  }

  return (
    <div className="pr-grid-container">
      {value.pages.map((page, pageIdx) => (
        <TimeCardPageCard
          key={`${page.page}-${pageIdx}`}
          page={page}
          pageIdx={pageIdx}
          numPairs={numPairs}
          warnings={warnings}
          onDateChange={handleDateChange}
          onPunchChange={handlePunchChange}
          defaultExpanded={pageIdx === 0}
        />
      ))}
    </div>
  );
};
