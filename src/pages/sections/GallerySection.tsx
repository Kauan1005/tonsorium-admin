import { useCrudList } from '../../hooks/useCrudList';
import ItemActions from '../../components/ItemActions';
import MediaUpload from '../../components/MediaUpload';
import type { GalleryPhoto } from '../../types';

export default function GallerySection() {
  const list = useCrudList<GalleryPhoto>('gallery_photos', ['caption', 'active'], ['image_url']);

  if (list.loading) return <p className="loading-text">Carregando...</p>;
  if (list.loadError) return <p className="error-text">Erro ao carregar: {list.loadError}</p>;

  return (
    <section className="panel">
      <h2>Galeria de cortes</h2>
      <p className="panel-sub">
        Fotos de trabalhos realizados. A foto é publicada assim que o envio termina; a seção só aparece no site
        quando houver pelo menos uma foto visível.
      </p>

      <div className="item-list">
        {list.items.map((item, index) => (
          <div className="item-card" key={item.id}>
            {item.image_url ? (
              <img src={item.image_url} alt={item.caption || 'Foto da galeria'} className="gallery-thumb" />
            ) : (
              <p className="panel-sub">Sem foto — envie uma imagem (sem foto, o item não aparece no site).</p>
            )}
            <MediaUpload prefix="gallery" minWidth={1080} onUploaded={(url) => list.saveFields(item.id, { image_url: url })} />

            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={item.active}
                onChange={(e) => list.update(item.id, { active: e.target.checked })}
              />
              Visível no site
            </label>

            <label>
              Legenda (opcional — também usada como descrição da foto para acessibilidade e Google)
              <input
                value={item.caption}
                onChange={(e) => list.update(item.id, { caption: e.target.value })}
                placeholder="Ex: Corte + barba"
                maxLength={120}
              />
            </label>

            <ItemActions
              index={index}
              total={list.items.length}
              saving={list.savingId === item.id}
              dirty={list.dirtyIds.has(item.id)}
              onSave={() => list.save(item)}
              onRemove={() => list.remove(item, 'Remover esta foto?')}
              onMove={(dir) => list.move(item.id, dir)}
            />
          </div>
        ))}
      </div>

      <button className="btn-add" onClick={() => list.add({ image_url: '', caption: '', active: true })}>
        + Adicionar foto
      </button>
    </section>
  );
}
