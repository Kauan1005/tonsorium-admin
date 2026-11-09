import { useCrudList } from '../../hooks/useCrudList';
import ItemActions from '../../components/ItemActions';
import type { ExperienceStep } from '../../types';

export default function ExperienceSection() {
  const list = useCrudList<ExperienceStep>('experience_steps', ['title', 'description', 'active']);

  if (list.loading) return <p className="loading-text">Carregando...</p>;
  if (list.loadError) return <p className="error-text">Erro ao carregar: {list.loadError}</p>;

  return (
    <section className="panel">
      <h2>A experiência</h2>
      <p className="panel-sub">
        O passo a passo do atendimento ("Seu horário, do começo ao fim"). O ideal são 3 ou 4 passos. Sem nenhum
        passo visível, a seção some do site.
      </p>

      <div className="item-list">
        {list.items.map((item, index) => (
          <div className="item-card" key={item.id}>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={item.active}
                onChange={(e) => list.update(item.id, { active: e.target.checked })}
              />
              Visível no site
            </label>
            <label>
              Título do passo
              <input value={item.title} onChange={(e) => list.update(item.id, { title: e.target.value })} maxLength={60} />
            </label>
            <label>
              Descrição
              <textarea
                rows={2}
                value={item.description}
                onChange={(e) => list.update(item.id, { description: e.target.value })}
                maxLength={220}
              />
            </label>
            <ItemActions
              index={index}
              total={list.items.length}
              saving={list.savingId === item.id}
              dirty={list.dirtyIds.has(item.id)}
              onSave={() => list.save(item)}
              onRemove={() => list.remove(item, 'Remover este passo?')}
              onMove={(dir) => list.move(item.id, dir)}
            />
          </div>
        ))}
      </div>

      <button className="btn-add" onClick={() => list.add({ title: 'Novo passo', description: '', active: true })}>
        + Adicionar passo
      </button>
    </section>
  );
}
