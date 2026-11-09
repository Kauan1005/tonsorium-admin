import { useSingleRow } from '../../hooks/useSingleRow';
import { useCrudList } from '../../hooks/useCrudList';
import ItemActions from '../../components/ItemActions';
import SaveBar from '../../components/SaveBar';
import type { Visagism, VisagismPoint } from '../../types';

const EMPTY: Visagism = {
  id: 1,
  active: true,
  eyebrow: '',
  title: '',
  intro: '',
  cta_label: '',
  service_name: '',
};

export default function VisagismSection() {
  const section = useSingleRow('site_visagism', EMPTY);
  const points = useCrudList<VisagismPoint>('visagism_points', ['title', 'description', 'active']);

  if (section.loading || points.loading) return <p className="loading-text">Carregando...</p>;

  const s = section.data;

  return (
    <section className="panel">
      <h2>Visagismo</h2>
      <p className="panel-sub">
        A seção que explica a consultoria de visagismo, logo depois do conceito. Desmarque "Mostrar no site" se a
        barbearia não oferecer esse serviço.
      </p>

      <label className="checkbox-label">
        <input type="checkbox" checked={s.active} onChange={(e) => section.update('active', e.target.checked)} />
        Mostrar no site
      </label>

      <label>
        Rótulo da seção
        <input value={s.eyebrow} onChange={(e) => section.update('eyebrow', e.target.value)} maxLength={40} />
      </label>

      <label>
        Título
        <input value={s.title} onChange={(e) => section.update('title', e.target.value)} maxLength={90} />
      </label>

      <label>
        Texto
        <textarea rows={4} value={s.intro} onChange={(e) => section.update('intro', e.target.value)} maxLength={500} />
      </label>

      <div className="item-row">
        <label>
          Texto do botão
          <input
            value={s.cta_label}
            onChange={(e) => section.update('cta_label', e.target.value)}
            placeholder="Agendar com visagismo"
            maxLength={40}
          />
        </label>
        <label>
          Nome do serviço no agendamento
          <input
            value={s.service_name}
            onChange={(e) => section.update('service_name', e.target.value)}
            placeholder="Consultoria de visagismo"
            maxLength={60}
          />
        </label>
      </div>

      <SaveBar saving={section.saving} dirty={section.dirty} onSave={section.save} />

      <hr className="panel-divider" />

      <h3 className="panel-subtitle">O que é analisado (os quadros ao lado do texto)</h3>
      <div className="item-list">
        {points.items.map((p, index) => (
          <div className="item-card" key={p.id}>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={p.active}
                onChange={(e) => points.update(p.id, { active: e.target.checked })}
              />
              Visível no site
            </label>
            <label>
              Título
              <input value={p.title} onChange={(e) => points.update(p.id, { title: e.target.value })} maxLength={60} />
            </label>
            <label>
              Descrição
              <textarea
                rows={2}
                value={p.description}
                onChange={(e) => points.update(p.id, { description: e.target.value })}
                maxLength={220}
              />
            </label>
            <ItemActions
              index={index}
              total={points.items.length}
              saving={points.savingId === p.id}
              dirty={points.dirtyIds.has(p.id)}
              onSave={() => points.save(p)}
              onRemove={() => points.remove(p, 'Remover este quadro?')}
              onMove={(dir) => points.move(p.id, dir)}
            />
          </div>
        ))}
      </div>
      <button className="btn-add" onClick={() => points.add({ title: 'Novo ponto', description: '', active: true })}>
        + Adicionar quadro
      </button>
    </section>
  );
}
