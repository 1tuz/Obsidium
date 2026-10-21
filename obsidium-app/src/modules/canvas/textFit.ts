export function canvasTextOverflow(textarea: HTMLTextAreaElement): number {
  const align = textarea.style.alignContent;
  textarea.style.alignContent = 'start';
  const overflow = textarea.scrollHeight - textarea.clientHeight;
  textarea.style.alignContent = align;
  return overflow;
}
