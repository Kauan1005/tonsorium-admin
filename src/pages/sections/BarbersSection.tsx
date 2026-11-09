import { useEffect, useState } from 'react';
import { useCrudList } from '../../hooks/useCrudList';
import ItemActions from '../../components/ItemActions';
import MediaUpload from '../../components/MediaUpload';
import StaffLoginBox from '../../components/StaffLoginBox';
import { listStaffAccounts } from '../../lib/staff';
import type { Barber, StaffAccount } from '../../types';

export default function BarbersSection() {
  const list = useCrudList<Barber>('barbers', ['name', 'role', 'bio', 'quote', 'active'], ['photo_url']);
  const [accounts, setAccounts] = useState<Record<string, StaffAccount>>({});
  const [accountsError, setAccountsError] = useState('');

  async function loadAccounts() {
    const { accounts: found, error } = await listStaffAccounts();
    setAccounts(found);
    setAccountsError(error ? 'Os logins dos barbeiros não carregaram. Rode o schema.sql atualizado no Supabase.' : '');
  }

  useEffect(() => {
    loadAccounts();
  }, []);

  if (list.loading) return <p className="loading-text">Carregando...</p>;
  if (list.loadError) return <p className="error-text">Erro ao carregar: {list.loadError}</p>;

  return (
    <section className="panel">
      <h2>Equipe</h2>
      <p className="panel-sub">
        Barbeiros mostrados no site, com foto, especialidade e descrição. A seção só aparece no site quando houver
        pelo menos um barbeiro visível. Use fotos na vertical (em pé), com o rosto bem iluminado. Em "Acesso ao
        painel" você cria o login de cada barbeiro: ele marca os horários ocupados na agenda dele e edita só a
        própria foto e descrição.
      </p>
      {accountsError && <p className="warning-text">{accountsError}</p>}

      <div className="item-list">
        {list.items.map((item, index) => (
          <div className="item-card" key={item.id}>
            {item.photo_url && <img src={item.photo_url} alt={item.name} className="barber-preview" />}
            <MediaUpload
              prefix={`barbers/${item.id}/photo`}
              minWidth={800}
              onUploaded={(url) => list.saveFields(item.id, { photo_url: url })}
            />

            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={item.active}
                onChange={(e) => list.update(item.id, { active: e.target.checked })}
              />
              Visível no site
            </label>

            <label>
              Nome
              <input value={item.name} onChange={(e) => list.update(item.id, { name: e.target.value })} maxLength={60} />
            </label>

            <label>
              Especialidade
              <input
                value={item.role}
                onChange={(e) => list.update(item.id, { role: e.target.value })}
                placeholder="Ex: Platinado e mechas · Visagismo"
                maxLength={80}
              />
            </label>

            <label>
              Descrição
              <textarea
                rows={3}
                value={item.bio ?? ''}
                onChange={(e) => list.update(item.id, { bio: e.target.value })}
                placeholder="Ex: 8 anos de barbearia, especialista em degradê e desenhos à mão livre."
                maxLength={300}
              />
            </label>

            <label>
              Frase de efeito (opcional)
              <input
                value={item.quote}
                onChange={(e) => list.update(item.id, { quote: e.target.value })}
                placeholder="Ex: Cada corte conta uma história."
                maxLength={160}
              />
            </label>

            <ItemActions
              index={index}
              total={list.items.length}
              saving={list.savingId === item.id}
              dirty={list.dirtyIds.has(item.id)}
              onSave={() => list.save(item)}
              onRemove={async () => {
                await list.remove(
                  item,
                  accounts[item.id]
                    ? `Remover ${item.name}? O login dele no painel e toda a agenda dele também serão apagados.`
                    : `Remover ${item.name}? A agenda dele também será apagada.`
                );
                loadAccounts();
              }}
              onMove={(dir) => list.move(item.id, dir)}
            />

            <StaffLoginBox barber={item} account={accounts[item.id]} onChanged={loadAccounts} />
          </div>
        ))}
      </div>

      <button
        className="btn-add"
        onClick={() => list.add({ name: 'Novo barbeiro', role: '', bio: '', quote: '', photo_url: '', active: false })}
      >
        + Adicionar barbeiro
      </button>
    </section>
  );
}
