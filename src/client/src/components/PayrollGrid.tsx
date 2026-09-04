import React, { useState } from 'react';
import { PayrollValue, PayrollPage, PayrollField, PayrollBase } from '@shared/types';
import { computePayrollWarnings } from '@shared/warnings';
import {
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Calendar,
  Hash,
  Tag,
  BarChart2,
} from 'lucide-react';

interface PayrollGridProps {
  value: PayrollValue;
  onChange: (newValue: PayrollValue) => void;
}

// ─── helpers ────────────────────────────────────────────────────────────────

const MONTH_LABELS: Record<string, string> = {
  '01': 'Janeiro', '02': 'Fevereiro', '03': 'Março',
  '04': 'Abril',   '05': 'Maio',      '06': 'Junho',
  '07': 'Julho',   '08': 'Agosto',    '09': 'Setembro',
  '10': 'Outubro', '11': 'Novembro',  '12': 'Dezembro',
};

function formatCompetencia(month: string, year: string): string {
  const m = MONTH_LABELS[month] ?? month;
  return m && year ? `${m} / ${year}` : month || year || '—';
}

function hasUncertain(str: string) { return str.includes('?'); }

// ─── sub-components ──────────────────────────────────────────────────────────

interface MoneyInputProps {
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
  className?: string;
  style?: React.CSSProperties;
}

const MoneyInput: React.FC<MoneyInputProps> = ({ value, placeholder = '—', onChange, className = '', style }) => {
  const isUncertain = hasUncertain(value);
  return (
    <input
      type="text"
      placeholder={placeholder}
      className={`cell-input cell-input-money ${isUncertain ? 'uncertain-cell' : ''} ${className}`}
      value={value}
      style={style}
      onChange={(e) => onChange(e.target.value.replace(/[^\d.,?-]/g, ''))}
    />
  );
};

// ─── FieldRow ────────────────────────────────────────────────────────────────

interface FieldRowProps {
  field: PayrollField;
  onValueChange: (v: string) => void;
  rowIndex: number;
}

const FieldRow: React.FC<FieldRowProps> = ({ field, onValueChange, rowIndex }) => {
  const isEven = rowIndex % 2 === 0;
  return (
    <div
      className="pr-field-row"
      style={{ background: isEven ? 'transparent' : 'rgba(0,0,0,0.018)' }}
    >
      {/* Código */}
      <span className="pr-field-code" title="Código da verba">
        {field.code || <span style={{ opacity: 0.3 }}>—</span>}
      </span>

      {/* Label */}
      <span className="pr-field-label" title={field.label}>
        {field.label}
      </span>

      {/* Referência */}
      <span className="pr-field-ref" title="Referência / quantidade">
        {field.reference || <span style={{ opacity: 0.3 }}>—</span>}
      </span>

      {/* Valor (editável) */}
      <div className="pr-field-value">
        <MoneyInput
          value={field.value}
          onChange={onValueChange}
        />
      </div>
    </div>
  );
};

// ─── BaseChip ─────────────────────────────────────────────────────────────────

interface BaseChipProps {
  base: PayrollBase;
  onValueChange: (v: string) => void;
}

const BaseChip: React.FC<BaseChipProps> = ({ base, onValueChange }) => (
  <div className="pr-base-chip">
    <span className="pr-base-chip-label" title={base.label}>{base.label}</span>
    <MoneyInput
      value={base.value}
      onChange={onValueChange}
      style={{ width: '108px', minWidth: '108px', fontSize: '0.8125rem', fontWeight: 600 }}
    />
  </div>
);

// ─── PageCard ────────────────────────────────────────────────────────────────

interface PageCardProps {
  page: PayrollPage;
  pageIdx: number;
  highlight: { color: string; reasons: string[]; hasLeftBorder: boolean } | undefined;
  onFieldValueChange: (pageIdx: number, fieldIdx: number, val: string) => void;
  onBaseValueChange: (pageIdx: number, baseIdx: number, val: string) => void;
  onMetadataChange: (pageIdx: number, field: 'year' | 'month', val: string) => void;
  defaultExpanded: boolean;
}

const PageCard: React.FC<PageCardProps> = ({
  page,
  pageIdx,
  highlight,
  onFieldValueChange,
  onBaseValueChange,
  onMetadataChange,
  defaultExpanded,
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const borderColor =
    highlight?.color === 'red'
      ? 'var(--warning-red-border)'
      : highlight?.color === 'yellow'
      ? 'var(--warning-yellow-border)'
      : 'var(--apple-border)';

  const headerBg =
    highlight?.color === 'red'
      ? 'var(--warning-red-bg)'
      : highlight?.color === 'yellow'
      ? 'var(--warning-yellow-bg)'
      : 'rgba(245,245,250,0.95)';

  // Aplica borda colorida de acordo com o estado
  const cardStyle: React.CSSProperties = {
    borderColor,
  };
  if (highlight?.hasLeftBorder) {
    cardStyle.borderLeft = '4px solid var(--warning-red-border)';
  }

  return (
    <div
      className="pr-page-card"
      style={cardStyle}
    >
      {/* ── Card Header ── */}
      <button
        type="button"
        className="pr-page-header"
        style={{ background: headerBg }}
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
      >
        <div className="pr-page-header-left">
          <span className="pr-page-chevron">
            {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </span>

          {/* Badge de Página */}
          <span className="pr-page-badge">Pág. {page.page}</span>

          {/* Competência editável inline */}
          <div className="pr-competencia" onClick={(e) => e.stopPropagation()}>
            <Calendar size={13} style={{ opacity: 0.5 }} />
            <input
              type="text"
              className={`pr-meta-input ${hasUncertain(page.month) ? 'uncertain-cell' : ''}`}
              value={page.month}
              placeholder="MM"
              maxLength={2}
              title="Mês"
              style={{ width: '34px', textAlign: 'center' }}
              onChange={(e) => onMetadataChange(pageIdx, 'month', e.target.value.replace(/[^\d?]/g, '').slice(0, 2))}
            />
            <span style={{ opacity: 0.4 }}>/</span>
            <input
              type="text"
              className={`pr-meta-input ${hasUncertain(page.year) ? 'uncertain-cell' : ''}`}
              value={page.year}
              placeholder="AAAA"
              maxLength={4}
              title="Ano"
              style={{ width: '48px', textAlign: 'center' }}
              onChange={(e) => onMetadataChange(pageIdx, 'year', e.target.value.replace(/[^\d?]/g, '').slice(0, 4))}
            />
            <span className="pr-competencia-label">
              {formatCompetencia(page.month, page.year)}
            </span>
          </div>

          {/* Sumário */}
          <span className="pr-page-summary">
            {page.fields.length} verba{page.fields.length !== 1 ? 's' : ''}
            {page.bases.length > 0 && ` · ${page.bases.length} base${page.bases.length !== 1 ? 's' : ''}`}
          </span>
        </div>

        <div className="pr-page-header-right">
          {highlight && highlight.reasons.length > 0 ? (
            <div
              className="pr-alert-tag"
              title={highlight.reasons.join('\n')}
            >
              {highlight.color === 'red' ? (
                <AlertCircle size={13} color="var(--warning-red-border)" style={{ flexShrink: 0 }} />
              ) : (
                <AlertTriangle size={13} color="var(--warning-yellow-text)" style={{ flexShrink: 0 }} />
              )}
              <span>{highlight.reasons[0]}</span>
              {highlight.reasons.length > 1 && (
                <span style={{ opacity: 0.65, flexShrink: 0 }}>+{highlight.reasons.length - 1}</span>
              )}
            </div>
          ) : (
            <div className="pr-ok-tag">
              <CheckCircle2 size={13} style={{ flexShrink: 0 }} />
              <span>Validado</span>
            </div>
          )}
        </div>
      </button>

      {/* ── Card Body ── */}
      {expanded && (
        <div className="pr-page-body">
          {/* Seção: Verbas */}
          <div className="pr-section">
            <div className="pr-section-header">
              <Tag size={13} />
              <span>Verbas</span>
              <span className="pr-section-count">{page.fields.length}</span>
            </div>

            {page.fields.length > 0 ? (
              <div className="pr-fields-table">
                {/* Header da tabela de verbas */}
                <div className="pr-fields-thead">
                  <span className="pr-field-code">
                    <Hash size={10} style={{ display: 'inline', marginRight: 2 }} />Cód.
                  </span>
                  <span className="pr-field-label">Descrição</span>
                  <span className="pr-field-ref">Referência</span>
                  <span className="pr-field-value">Valor</span>
                </div>

                {page.fields.map((field, fIdx) => (
                  <FieldRow
                    key={fIdx}
                    field={field}
                    rowIndex={fIdx}
                    onValueChange={(v) => onFieldValueChange(pageIdx, fIdx, v)}
                  />
                ))}
              </div>
            ) : (
              <div className="pr-empty-state">Nenhuma verba extraída nesta página.</div>
            )}
          </div>

          {/* Seção: Bases e Totais */}
          {page.bases.length > 0 && (
            <div className="pr-section pr-section-bases">
              <div className="pr-section-header">
                <BarChart2 size={13} />
                <span>Bases e Totais</span>
                <span className="pr-section-count">{page.bases.length}</span>
              </div>
              <div className="pr-bases-grid">
                {page.bases.map((base, bIdx) => (
                  <BaseChip
                    key={bIdx}
                    base={base}
                    onValueChange={(v) => onBaseValueChange(pageIdx, bIdx, v)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

export const PayrollGrid: React.FC<PayrollGridProps> = ({ value, onChange }) => {
  const warnings = computePayrollWarnings(value);

  // ── Mutadores ──────────────────────────────────────────────────────────────

  const handleFieldValueChange = (pageIdx: number, fieldIdx: number, rawVal: string) => {
    const updated = [...value.pages];
    const page = { ...updated[pageIdx] };
    const fields = [...page.fields];
    fields[fieldIdx] = { ...fields[fieldIdx], value: rawVal };
    page.fields = fields;
    updated[pageIdx] = page;
    onChange({ pages: updated });
  };

  const handleBaseValueChange = (pageIdx: number, baseIdx: number, rawVal: string) => {
    const updated = [...value.pages];
    const page = { ...updated[pageIdx] };
    const bases = [...page.bases];
    bases[baseIdx] = { ...bases[baseIdx], value: rawVal };
    page.bases = bases;
    updated[pageIdx] = page;
    onChange({ pages: updated });
  };

  const handleMetadataChange = (pageIdx: number, field: 'year' | 'month', val: string) => {
    const updated = [...value.pages];
    updated[pageIdx] = { ...updated[pageIdx], [field]: val };
    onChange({ pages: updated });
  };

  // ── Render ─────────────────────────────────────────────────────────────────

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
        <PageCard
          key={`${page.page}-${pageIdx}`}
          page={page}
          pageIdx={pageIdx}
          highlight={warnings.get(page.page)}
          onFieldValueChange={handleFieldValueChange}
          onBaseValueChange={handleBaseValueChange}
          onMetadataChange={handleMetadataChange}
          defaultExpanded={pageIdx === 0}
        />
      ))}
    </div>
  );
};
