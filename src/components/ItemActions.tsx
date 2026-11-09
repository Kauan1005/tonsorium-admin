interface Props {
  index: number;
  total: number;
  saving: boolean;
  dirty: boolean;
  onSave: () => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
}

/** Botões padrão de cada card de lista: salvar, mover e remover. */
export default function ItemActions({ index, total, saving, dirty, onSave, onRemove, onMove }: Props) {
  return (
    <div className="item-actions">
      <button onClick={onSave} disabled={saving}>
        {saving ? 'Salvando...' : 'Salvar'}
      </button>
      {dirty && !saving && <span className="unsaved-badge">Não salvo</span>}
      <div className="move-buttons">
        <button
          type="button"
          className="btn-icon"
          onClick={() => onMove(-1)}
          disabled={index === 0}
          aria-label="Mover para cima"
          title="Mover para cima"
        >
          ↑
        </button>
        <button
          type="button"
          className="btn-icon"
          onClick={() => onMove(1)}
          disabled={index === total - 1}
          aria-label="Mover para baixo"
          title="Mover para baixo"
        >
          ↓
        </button>
      </div>
      <button className="btn-danger" onClick={onRemove}>
        Remover
      </button>
    </div>
  );
}
