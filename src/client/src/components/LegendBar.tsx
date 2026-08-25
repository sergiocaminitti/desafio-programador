import React from 'react';

interface LegendBarProps {
  totalItems?: number;
  totalWarnings?: number;
  tipo?: string;
}

export const LegendBar: React.FC<LegendBarProps> = ({
  totalItems = 0,
  totalWarnings = 0,
  tipo = 'Documento',
}) => {
  return (
    <div className="toolbar-bar">
      <div className="legend-group">
        <span style={{ fontWeight: 600, color: 'var(--apple-text-primary)', fontSize: '0.8125rem' }}>
          Legenda de Auditoria:
        </span>
        <div className="legend-pill">
          <div className="indicator-dot yellow" />
          <span><strong>Atenção (Amarelo):</strong> Batidas ímpares, caractere ilegível (?) ou página vazia</span>
        </div>
        <div className="legend-pill">
          <div className="indicator-dot red" />
          <span><strong>Crítico (Vermelho):</strong> Data ou mês fora da sequência esperada</span>
        </div>
      </div>

      {totalItems > 0 && (
        <div className="stats-group">
          <div className="stat-chip">
            Total {tipo === 'holerite' ? 'Páginas' : 'Dias'}: <strong>{totalItems}</strong>
          </div>
          <div
            className="stat-chip"
            style={{
              background: totalWarnings > 0 ? 'var(--warning-yellow-bg)' : 'var(--success-bg)',
              color: totalWarnings > 0 ? 'var(--warning-yellow-text)' : 'var(--success-text)',
            }}
          >
            {totalWarnings > 0 ? (
              <>
                Avisos pendentes: <strong>{totalWarnings}</strong>
              </>
            ) : (
              <>
                <strong>✓ 100% Validado</strong>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
