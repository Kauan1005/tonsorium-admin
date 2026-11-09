import { useCrudList } from '../../hooks/useCrudList';
import ItemActions from '../../components/ItemActions';
import MediaUpload from '../../components/MediaUpload';
import type { Product } from '../../types';

export default function ProductsSection() {
  const list = useCrudList<Product>('products', ['name', 'description', 'price', 'active'], ['photo_url']);

  if (list.loading) return <p className="loading-text">Carregando...</p>;
  if (list.loadError) return <p className="error-text">Erro ao carregar: {list.loadError}</p>;

  return (
    <section className="panel">
      <h2>Produtos</h2>
      <p className="panel-sub">
        Itens à venda na barbearia, com foto e preço. Deixe o preço em 0 para mostrar "Consulte". A seção só aparece
        no site quando houver pelo menos um produto visível.
      </p>

      <div className="item-list">
        {list.items.map((item, index) => (
          <div className="item-card" key={item.id}>
            {item.photo_url && <img src={item.photo_url} alt={item.name} className="gallery-thumb" />}
            <MediaUpload prefix="product" minWidth={800} onUploaded={(url) => list.saveFields(item.id, { photo_url: url })} />

            <div className="item-row">
              <label>
                Preço (R$)
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={item.price}
                  onChange={(e) => list.update(item.id, { price: Math.max(0, Number(e.target.value) || 0) })}
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
              Nome do produto
              <input value={item.name} onChange={(e) => list.update(item.id, { name: e.target.value })} maxLength={80} />
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
              onRemove={() => list.remove(item, 'Remover este produto?')}
              onMove={(dir) => list.move(item.id, dir)}
            />
          </div>
        ))}
      </div>

      <button
        className="btn-add"
        onClick={() => list.add({ name: 'Novo produto', description: '', price: 0, photo_url: '', active: false })}
      >
        + Adicionar produto
      </button>
    </section>
  );
}
