import React, { useState } from 'react';
import { PayrollValue, PayrollPage, PayrollField, PayrollBase } from '@shared/types';
import { computePayrollWarnings } from '@shared/warnings';
import { AlertCircle, AlertTriangle, ChevronDown, ChevronRight, CheckCircle2 } from 'lucide-react';

interface PayrollGridProps {
  value: PayrollValue;
  onChange: (newValue: PayrollValue) => void;
}

export const PayrollGrid: React.FC<PayrollGridProps> = ({ value, onChange }) => {
  const [expandedPages, setExpandedPages] = useState<Record<number, boolean>>({});

  // 1. Extrai todas as verbas distintas (labels) na ordem de primeira aparição
  const distinctLabels: string[] = [];
  value.pages.forEach((page: PayrollPage) => {
    page.fields.forEach((field: PayrollField) => {
      if (field.label && !distinctLabels.includes(field.label)) {
        distinctLabels.push(field.label);
      }
    });
  });

  // 2. Calcula avisos em tempo real
  const warnings = computePayrollWarnings(value);

  // Manipuladores de edição
  const handlePageMetadataChange = (
    pageIdx: number,
    field: 'year' | 'month',
    rawVal: string
  ) => {
    // Permite apenas dígitos e '?'
    const maxLen = field === 'month' ? 2 : 4;
    const newVal = rawVal.replace(/[^\d\?]/g, '').slice(0, maxLen);

    const updatedPages = [...value.pages];
    updatedPages[pageIdx] = {
      ...updatedPages[pageIdx],
      [field]: newVal,
    };
    onChange({ pages: updatedPages });
  };

  const handleFieldValueChange = (
    pageIdx: number,
    label: string,
    rawVal: string
  ) => {
    // Permite apenas dígitos, separadores monetários (. e ,) e caractere de incerteza (?)
    const newVal = rawVal.replace(/[^\d\.,\?]/g, '');

    const updatedPages = [...value.pages];
    const page = updatedPages[pageIdx];
    const existingFieldIdx = page.fields.findIndex((f: PayrollField) => f.label === label);

    const updatedFields = [...page.fields];
    if (existingFieldIdx >= 0) {
      // Mantém o campo mesmo se vazio para a coluna NÃO sumir da tabela
      updatedFields[existingFieldIdx] = {
        ...updatedFields[existingFieldIdx],
        value: newVal,
      };
    } else {
      updatedFields.push({
        code: '',
        label,
        reference: '',
        value: newVal,
      });
    }

    updatedPages[pageIdx] = {
      ...page,
      fields: updatedFields,
    };
    onChange({ pages: updatedPages });
  };

  const handleBaseValueChange = (
    pageIdx: number,
    baseIdx: number,
    rawVal: string
  ) => {
    const newVal = rawVal.replace(/[^\d\.,\?]/g, '');
    const updatedPages = [...value.pages];
    const page = updatedPages[pageIdx];
    const updatedBases = [...page.bases];

    updatedBases[baseIdx] = {
      ...updatedBases[baseIdx],
      value: newVal,
    };

    updatedPages[pageIdx] = {
      ...page,
      bases: updatedBases,
    };
    onChange({ pages: updatedPages });
  };

  const togglePageExpand = (pageNum: number) => {
    setExpandedPages((prev) => ({ ...prev, [pageNum]: !prev[pageNum] }));
  };

  return (
    <div className="table-container">
      <table className="data-table">
        <thead>
          <tr>
            <th style={{ width: '55px', minWidth: '55px', textAlign: 'center' }}>Pág.</th>
            <th style={{ width: '65px', minWidth: '65px', textAlign: 'center' }}>Mês</th>
            <th style={{ width: '80px', minWidth: '80px', textAlign: 'center' }}>Ano</th>
            {distinctLabels.map((label: string, idx: number) => (
              <th key={idx} style={{ minWidth: '135px', textAlign: 'right' }}>{label}</th>
            ))}
            <th style={{ width: '220px', minWidth: '220px' }}>Status & Auditoria</th>
          </tr>
        </thead>
        <tbody>
          {value.pages.map((page: PayrollPage, pageIdx: number) => {
            const highlight = warnings.get(page.page);

            const rowClass =
              highlight?.color === 'red'
                ? 'row-red'
                : highlight?.color === 'yellow'
                ? 'row-yellow'
                : '';

            const cellBorderClass = highlight?.hasLeftBorder ? 'cell-red-border' : '';
            const isExpanded = !!expandedPages[page.page];

            return (
              <React.Fragment key={page.page}>
                <tr className={rowClass}>
                  {/* Coluna Pág */}
                  <td className={cellBorderClass} style={{ textAlign: 'center', fontWeight: 600 }}>
                    <button
                      type="button"
                      onClick={() => togglePageExpand(page.page)}
                      style={{
                        background: 'rgba(0, 0, 0, 0.05)',
                        border: 'none',
                        borderRadius: '4px',
                        padding: '0.2rem 0.4rem',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.25rem',
                        color: 'inherit',
                        fontWeight: 600,
                        fontSize: '0.8rem',
                      }}
                      title="Ver bases e totais desta página"
                    >
                      {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      {page.page}
                    </button>
                  </td>

                  {/* Coluna Mês */}
                  <td style={{ textAlign: 'center' }}>
                    <input
                      type="text"
                      className={`cell-input cell-input-month ${page.month.includes('?') ? 'uncertain-cell' : ''}`}
                      value={page.month}
                      placeholder="MM"
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        handlePageMetadataChange(pageIdx, 'month', e.target.value)
                      }
                    />
                  </td>

                  {/* Coluna Ano */}
                  <td style={{ textAlign: 'center' }}>
                    <input
                      type="text"
                      className={`cell-input cell-input-year ${page.year.includes('?') ? 'uncertain-cell' : ''}`}
                      value={page.year}
                      placeholder="AAAA"
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        handlePageMetadataChange(pageIdx, 'year', e.target.value)
                      }
                    />
                  </td>

                  {/* Colunas Transpostas de Verbas (Fields) */}
                  {distinctLabels.map((label: string, lIdx: number) => {
                    const field = page.fields.find((f: PayrollField) => f.label === label);
                    const val = field ? field.value : '';
                    const isUncertain = val.includes('?');

                    return (
                      <td key={lIdx} style={{ textAlign: 'right' }}>
                        <input
                          type="text"
                          placeholder="-"
                          className={`cell-input cell-input-money ${isUncertain ? 'uncertain-cell' : ''}`}
                          value={val}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                            handleFieldValueChange(pageIdx, label, e.target.value)
                          }
                        />
                      </td>
                    );
                  })}

                  {/* Coluna de Alertas */}
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

                {/* Linha expansível para Bases e Totais da Página */}
                {isExpanded && (
                  <tr style={{ background: 'rgba(245, 245, 247, 0.95)' }}>
                    <td colSpan={distinctLabels.length + 4} style={{ padding: '0.875rem 1.5rem' }}>
                      <div style={{ fontSize: '0.8125rem' }}>
                        <span style={{ fontWeight: 600, color: 'var(--apple-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          Bases de Cálculo e Totais da Página {page.page} (Seção Separada):
                        </span>
                        <div
                          style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: '0.75rem',
                            marginTop: '0.625rem',
                          }}
                        >
                          {page.bases.length > 0 ? (
                            page.bases.map((base: PayrollBase, bIdx: number) => (
                              <div
                                key={bIdx}
                                style={{
                                  background: 'white',
                                  padding: '0.45rem 0.85rem',
                                  borderRadius: 'var(--radius-sm)',
                                  border: '1px solid var(--apple-border)',
                                  boxShadow: 'var(--shadow-apple-subtle)',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '0.5rem',
                                }}
                              >
                                <span style={{ color: 'var(--apple-text-secondary)' }}>{base.label}: </span>
                                <input
                                  type="text"
                                  className={`cell-input cell-input-money ${base.value.includes('?') ? 'uncertain-cell' : ''}`}
                                  style={{ width: '95px', minWidth: '95px', padding: '0.15rem 0.35rem', fontWeight: 600 }}
                                  value={base.value}
                                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                                    handleBaseValueChange(pageIdx, bIdx, e.target.value)
                                  }
                                />
                              </div>
                            ))
                          ) : (
                            <span style={{ color: 'var(--apple-text-secondary)' }}>Nenhuma base identificada nesta página.</span>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
