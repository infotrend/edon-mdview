class DocumentSearch {
  constructor(container) {
    this.container = container;
    this.matches = [];
    this.current = -1;
  }

  clear() {
    const marks = this.container.querySelectorAll('mark.search-highlight');
    for (const mark of marks) mark.replaceWith(document.createTextNode(mark.textContent));
    if (marks.length) this.container.normalize();
    this.matches = [];
    this.current = -1;
  }

  search(query) {
    this.clear();
    if (!query) return this.matches;

    const normalizedQuery = query.toLocaleLowerCase();
    const walker = document.createTreeWalker(this.container, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.parentElement || ['SCRIPT', 'STYLE'].includes(node.parentElement.tagName)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    for (const node of nodes) {
      const text = node.nodeValue;
      const normalized = text.toLocaleLowerCase();
      let start = 0;
      let index = normalized.indexOf(normalizedQuery, start);
      if (index === -1) continue;

      const fragment = document.createDocumentFragment();
      while (index !== -1 && this.matches.length < 2000) {
        fragment.append(document.createTextNode(text.slice(start, index)));
        const mark = document.createElement('mark');
        mark.className = 'search-highlight';
        mark.textContent = text.slice(index, index + query.length);
        fragment.append(mark);
        this.matches.push(mark);
        start = index + query.length;
        index = normalized.indexOf(normalizedQuery, start);
      }
      fragment.append(document.createTextNode(text.slice(start)));
      node.replaceWith(fragment);
      if (this.matches.length >= 2000) break;
    }

    if (this.matches.length) this.activate(0);
    return this.matches;
  }

  activate(index) {
    if (!this.matches.length) return;
    if (this.current >= 0) this.matches[this.current]?.classList.remove('current');
    this.current = (index + this.matches.length) % this.matches.length;
    const active = this.matches[this.current];
    active.classList.add('current');
    active.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

module.exports = { DocumentSearch };
