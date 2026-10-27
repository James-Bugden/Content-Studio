/**
 * Remember the scroll position of the textarea, every scrollable ancestor (the
 * panel) and the page, so a programmatic value change can put them back and the
 * view does not jump (#242).
 */
export function captureScroll(el: HTMLElement | null): () => void {
  const saved: { node: Element; top: number; left: number }[] = [];
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    if (node === el || node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth) {
      saved.push({ node, top: node.scrollTop, left: node.scrollLeft });
    }
  }
  const root = typeof document === 'undefined' ? null : document.scrollingElement;
  if (root && !saved.some((s) => s.node === root)) saved.push({ node: root, top: root.scrollTop, left: root.scrollLeft });
  return () => {
    for (const { node, top, left } of saved) {
      if (node.scrollTop !== top) node.scrollTop = top;
      if (node.scrollLeft !== left) node.scrollLeft = left;
    }
  };
}
