import { useCrudList } from '../../hooks/useCrudList';
import ItemActions from '../../components/ItemActions';
import type { FaqItem } from '../../types';

export default function FaqSection() {
  const list = useCrudList<FaqItem>('faq_items', ['question', 'answer', 'active']);

  if (list.loading) return <p className="loading-text">Carregando...</p>;
  if (list.loadError) return <p className="error-text">Erro ao carregar: {list.loadError}</p>;

  return (
    <section className="panel">
      <h2>Perguntas frequentes</h2>
      <p className="panel-sub">
        Dúvidas que o cliente costuma ter antes de agendar (atraso, pagamento, estacionamento...). Respostas curtas e
        diretas funcionam melhor. Sem nenhuma pergunta visível, a seção some do site.
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
              Pergunta
              <input
                value={item.question}
                onChange={(e) => list.update(item.id, { question: e.target.value })}
                maxLength={120}
              />
            </label>
            <label>
              Resposta
              <textarea
                rows={3}
                value={item.answer}
                onChange={(e) => list.update(item.id, { answer: e.target.value })}
                maxLength={600}
              />
            </label>
            <ItemActions
              index={index}
              total={list.items.length}
              saving={list.savingId === item.id}
              dirty={list.dirtyIds.has(item.id)}
              onSave={() => list.save(item)}
              onRemove={() => list.remove(item, 'Remover esta pergunta?')}
              onMove={(dir) => list.move(item.id, dir)}
            />
          </div>
        ))}
      </div>

      <button className="btn-add" onClick={() => list.add({ question: 'Nova pergunta', answer: '', active: true })}>
        + Adicionar pergunta
      </button>
    </section>
  );
}
