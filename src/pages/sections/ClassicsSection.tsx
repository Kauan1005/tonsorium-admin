import { useCrudList } from '../../hooks/useCrudList';
import ItemActions from '../../components/ItemActions';
import type { ClassicService } from '../../types';

export default function ClassicsSection() {
  const list = useCrudList<ClassicService>('services_classic', ['title', 'description', 'price_label', 'active']);

  if (list.loading) return <p className="loading-text">Carregando...</p>;
  if (list.loadError) return <p className="error-text">Erro ao carregar: {list.loadError}</p>;

  return (
    <section className="panel">
      <h2>Clássicos</h2>
      <p className="panel-sub">Corte, barba, sobrancelha — a lista compacta mais abaixo no site.</p>

      <div className="item-list">
        {list.items.map((item, index) => (
          <div className="item-card" key={item.id}>
            <div className="item-row">
              <label>
                Preço (opcional)
                <input
                  value={item.price_label}
                  onChange={(e) => list.update(item.id, { price_label: e.target.value })}
                  placeholder="Ex: R$ 50"
                  maxLength={40}
                />
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
              Nome do serviço
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
              onRemove={() => list.remove(item, 'Remover este serviço clássico?')}
              onMove={(dir) => list.move(item.id, dir)}
            />
          </div>
        ))}
      </div>

      <button
        className="btn-add"
        onClick={() => list.add({ title: 'Novo serviço', description: '', price_label: '', active: true })}
      >
        + Adicionar clássico
      </button>
    </section>
  );
}
