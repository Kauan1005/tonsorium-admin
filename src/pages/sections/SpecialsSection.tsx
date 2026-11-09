import { useCrudList } from '../../hooks/useCrudList';
import ItemActions from '../../components/ItemActions';
import type { SpecialService } from '../../types';

export default function SpecialsSection() {
  const list = useCrudList<SpecialService>('services_special', ['tag', 'title', 'description', 'price_label', 'active']);

  if (list.loading) return <p className="loading-text">Carregando...</p>;
  if (list.loadError) return <p className="error-text">Erro ao carregar: {list.loadError}</p>;

  return (
    <section className="panel">
      <h2>Serviços especiais</h2>
      <p className="panel-sub">Os serviços em destaque, mostrados logo após o conceito.</p>

      <div className="item-list">
        {list.items.map((item, index) => (
          <div className="item-card" key={item.id}>
            <div className="item-row">
              <label>
                Tag
                <input
                  value={item.tag}
                  onChange={(e) => list.update(item.id, { tag: e.target.value })}
                  placeholder="Técnico / Assinatura / Cuidado"
                  maxLength={30}
                />
              </label>
              <label>
                Preço (opcional)
                <input
                  value={item.price_label}
                  onChange={(e) => list.update(item.id, { price_label: e.target.value })}
                  placeholder="Ex: a partir de R$ 120"
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
              onRemove={() => list.remove(item, 'Remover este serviço especial?')}
              onMove={(dir) => list.move(item.id, dir)}
            />
          </div>
        ))}
      </div>

      <button
        className="btn-add"
        onClick={() => list.add({ tag: '', title: 'Novo serviço', description: '', price_label: '', active: true })}
      >
        + Adicionar serviço especial
      </button>
    </section>
  );
}
