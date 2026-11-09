import { useSingleRow } from '../../hooks/useSingleRow';
import { useCrudList } from '../../hooks/useCrudList';
import ItemActions from '../../components/ItemActions';
import SaveBar from '../../components/SaveBar';
import type { Concept, Pillar } from '../../types';

const EMPTY_CONCEPT: Concept = { id: 1, eyebrow: '', title: '', paragraph_1: '', paragraph_2: '' };

export default function ConceptSection() {
  const concept = useSingleRow('site_concept', EMPTY_CONCEPT);
  const pillars = useCrudList<Pillar>('site_pillars', ['title', 'description']);

  if (concept.loading || pillars.loading) return <p className="loading-text">Carregando...</p>;

  const c = concept.data;

  return (
    <section className="panel">
      <h2>O Conceito</h2>
      <p className="panel-sub">Texto de apresentação da barbearia, logo abaixo do topo.</p>

      <label>
        Rótulo da seção
        <input value={c.eyebrow} onChange={(e) => concept.update('eyebrow', e.target.value)} maxLength={60} />
      </label>

      <label>
        Título (use Enter para quebrar a linha)
        <textarea rows={2} value={c.title} onChange={(e) => concept.update('title', e.target.value)} maxLength={120} />
      </label>

      <label>
        Primeiro parágrafo
        <textarea rows={3} value={c.paragraph_1} onChange={(e) => concept.update('paragraph_1', e.target.value)} />
      </label>

      <label>
        Segundo parágrafo
        <textarea rows={3} value={c.paragraph_2} onChange={(e) => concept.update('paragraph_2', e.target.value)} />
      </label>

      <SaveBar saving={concept.saving} dirty={concept.dirty} onSave={concept.save} label="Salvar texto" />

      <hr className="panel-divider" />

      <h3 className="panel-subtitle">Pilares (os pontos ao lado do texto)</h3>
      <div className="item-list">
        {pillars.items.map((pillar, index) => (
          <div className="item-card" key={pillar.id}>
            <label>
              Título
              <input
                value={pillar.title}
                onChange={(e) => pillars.update(pillar.id, { title: e.target.value })}
                maxLength={80}
              />
            </label>
            <label>
              Descrição
              <textarea
                rows={2}
                value={pillar.description}
                onChange={(e) => pillars.update(pillar.id, { description: e.target.value })}
              />
            </label>
            <ItemActions
              index={index}
              total={pillars.items.length}
              saving={pillars.savingId === pillar.id}
              dirty={pillars.dirtyIds.has(pillar.id)}
              onSave={() => pillars.save(pillar)}
              onRemove={() => pillars.remove(pillar, 'Remover este pilar?')}
              onMove={(dir) => pillars.move(pillar.id, dir)}
            />
          </div>
        ))}
      </div>
      <button className="btn-add" onClick={() => pillars.add({ title: 'Novo pilar', description: '' })}>
        + Adicionar pilar
      </button>
    </section>
  );
}
