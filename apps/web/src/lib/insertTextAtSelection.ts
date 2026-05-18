/** Insere texto na posição do cursor de um textarea (ou acrescenta no fim). */
export function insertTextAtSelection(
  el: HTMLTextAreaElement | null,
  current: string,
  insert: string,
  setValue: (next: string) => void,
): void {
  if (!el) {
    setValue(current + insert);
    return;
  }
  const start = el.selectionStart ?? current.length;
  const end = el.selectionEnd ?? current.length;
  const next = current.slice(0, start) + insert + current.slice(end);
  setValue(next);
  requestAnimationFrame(() => {
    el.focus();
    const pos = start + insert.length;
    el.setSelectionRange(pos, pos);
  });
}
