// Controla se existe alguma edição ainda não salva no painel, para
// avisar antes de trocar de aba, sair ou fechar a página.

const dirtySources = new Set<string>();

export function setUnsaved(source: string, dirty: boolean) {
  if (dirty) dirtySources.add(source);
  else dirtySources.delete(source);
}

export function hasUnsavedChanges() {
  return dirtySources.size > 0;
}

export function clearUnsaved() {
  dirtySources.clear();
}

export function confirmDiscard() {
  return !hasUnsavedChanges() || confirm('Existem alterações não salvas. Descartar e continuar?');
}
