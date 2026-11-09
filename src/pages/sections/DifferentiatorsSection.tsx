import { useCrudList } from '../../hooks/useCrudList';
import ItemActions from '../../components/ItemActions';
import type { Differentiator, DifferentiatorIcon } from '../../types';

const ICON_OPTIONS: { value: DifferentiatorIcon; label: string }[] = [
  { value: 'clock', label: 'Relógio' },
  { value: 'shield', label: 'Escudo' },
  { value: 'home', label: 'Casa' },
  { value: 'chart', label: 'Gráfico' },
  { value: 'calendar', label: 'Agenda' },
  { value: 'heart', label: 'Coração' },
];

export default function DifferentiatorsSection() {
  const list = useCrudList<Differentiator>('differentiators', ['icon', 'title', 'description', 'active']);

  if (list.loading) return <p className="loading-text">Carregando...</p>;
  if (list.loadError) return <p className="error-text">Erro ao carregar: {list.loadError}</p>;

  return (
    <section className="panel">
      <h2>Diferenciais</h2>
      <p className="panel-sub">O grid de amenidades ("Por que Tonsorium") mais abaixo no site.</p>

      <div className="item-list">
        {list.items.map((item, index) => (
          <div className="item-card" key={item.id}>
            <div className="item-row">
              <label>
                Ícone
                <select
                  value={item.icon}
                  onChange={(e) => list.update(item.id, { icon: e.target.value as DifferentiatorIcon })}
                >
                  {ICON_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={item.active}
                  onChange={(e) => list.update(item.id, { active: e.target.checked })}
                />
                Visível no site
              </label>
            </div>

            <label>
              Título
              <input value={item.title} onChange={(e) => list.update(item.id, { title: e.target.value })} maxLength={80} />
            </label>

            <label>
              Descrição
              <textarea
                rows={2}
                value={item.description}
                onChange={(e) => list.update(item.id, { description: e.target.value })}
              />
            </label>

            <ItemActions
              index={index}
              total={list.items.length}
              saving={list.savingId === item.id}
              dirty={list.dirtyIds.has(item.id)}
              onSave={() => list.save(item)}
              onRemove={() => list.remove(item, 'Remover este diferencial?')}
              onMove={(dir) => list.move(item.id, dir)}
            />
          </div>
        ))}
      </div>

      <button
        className="btn-add"
        onClick={() => list.add({ icon: 'clock', title: 'Novo diferencial', description: '', active: true })}
      >
        + Adicionar diferencial
      </button>
    </section>
  );
}
