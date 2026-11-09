interface Props {
  saving: boolean;
  dirty: boolean;
  onSave: () => void;
  label?: string;
}

/** Botão de salvar das abas de linha única, com aviso de "não salvo". */
export default function SaveBar({ saving, dirty, onSave, label = 'Salvar alterações' }: Props) {
  return (
    <div className="panel-actions">
      <button onClick={onSave} disabled={saving}>
        {saving ? 'Salvando...' : label}
      </button>
      {dirty && !saving && <span className="unsaved-badge">Alterações não salvas</span>}
    </div>
  );
}
