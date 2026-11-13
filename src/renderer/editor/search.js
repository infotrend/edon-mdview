const { Extension } = require('@tiptap/core');
const { Plugin, PluginKey, TextSelection } = require('@tiptap/pm/state');
const { Decoration, DecorationSet } = require('@tiptap/pm/view');

const MATCH_LIMIT = 2000;
const searchKey = new PluginKey('documentSearch');
const EMPTY = { query: '', matches: [], current: -1, decorations: DecorationSet.empty };

/** Lower-cases a text and maps the indexes of the result back to the original string. */
function fold(text) {
  const lower = text.toLocaleLowerCase();
  if (lower.length === text.length) return { text: lower, start: (index) => index, end: (index) => index };
  // A few characters change length when lower-cased («İ»): fold one character at a time and keep the offsets.
  let folded = '';
  const starts = [];
  const ends = [];
  for (let index = 0; index < text.length;) {
    const character = String.fromCodePoint(text.codePointAt(index));
    const piece = character.toLocaleLowerCase();
    for (let unit = 0; unit < piece.length; unit += 1) {
      starts.push(index);
      ends.push(index + character.length);
    }
    folded += piece;
    index += character.length;
  }
  return { text: folded, start: (index) => starts[index], end: (index) => ends[index - 1] };
}

/**
 * Finds the occurrences of `query` in an editor document, ignoring case, as `{ from, to }` document positions.
 * An occurrence can span different formatting (bold, links…) inside the same text block; it never spans
 * two blocks, nor a non-text inline element (line break, image, protected inline HTML).
 * Protected elements (`rawBlock`, `rawInline`) hold source, not editor text, and are not searched.
 */
function findMatches(doc, query, limit = MATCH_LIMIT) {
  const matches = [];
  if (!query) return matches;
  const needle = query.toLocaleLowerCase();

  const searchRun = (text, start) => {
    const folded = fold(text);
    let index = folded.text.indexOf(needle);
    while (index !== -1 && matches.length < limit) {
      const end = index + needle.length;
      matches.push({ from: start + folded.start(index), to: start + folded.end(end) });
      index = folded.text.indexOf(needle, end);
    }
  };

  doc.descendants((node, position) => {
    if (matches.length >= limit) return false;
    if (!node.isTextblock) return true;
    let text = '';
    let start = 0;
    node.forEach((child, offset) => {
      if (child.isText) {
        if (!text) start = position + 1 + offset;
        text += child.text;
      } else {
        if (text) searchRun(text, start);
        text = '';
      }
    });
    if (text) searchRun(text, start);
    return false;
  });
  return matches;
}

function searchState(doc, query, matches, current) {
  const decorations = matches.map(({ from, to }, index) => Decoration.inline(from, to, {
    nodeName: 'mark',
    class: index === current ? 'search-highlight current' : 'search-highlight',
  }));
  return { query, matches, current, decorations: DecorationSet.create(doc, decorations) };
}

/**
 * Search highlighting as ProseMirror decorations: the document, its history and the Markdown produced
 * from it never change. Driven by transactions carrying a `searchKey` meta:
 * `{ type: 'search', query }`, `{ type: 'activate', index }` or `{ type: 'clear' }`.
 */
function createSearchPlugin() {
  return new Plugin({
    key: searchKey,
    state: {
      init: () => EMPTY,
      apply(transaction, previous) {
        const action = transaction.getMeta(searchKey);
        if (action && action.type === 'search') {
          const matches = findMatches(transaction.doc, action.query);
          return searchState(transaction.doc, action.query, matches, matches.length ? 0 : -1);
        }
        if (action && action.type === 'activate') {
          const count = previous.matches.length;
          if (!count) return previous;
          return searchState(transaction.doc, previous.query, previous.matches, ((action.index % count) + count) % count);
        }
        if (action && action.type === 'clear') return EMPTY;
        if (!transaction.docChanged || !previous.query) return previous;

        // The document changed while searching: find again, staying on the active match (or the one after it).
        const matches = findMatches(transaction.doc, previous.query);
        let current = -1;
        if (matches.length) {
          const anchor = previous.current >= 0 ? transaction.mapping.map(previous.matches[previous.current].from, 1) : 0;
          current = Math.max(0, matches.findIndex((match) => match.from >= anchor));
        }
        return searchState(transaction.doc, previous.query, matches, current);
      },
    },
    props: {
      decorations: (state) => searchKey.getState(state).decorations,
    },
  });
}

const DocumentSearchExtension = Extension.create({
  name: 'documentSearch',
  addProseMirrorPlugins() {
    return [createSearchPlugin()];
  },
});

/** Search over an editor view, with the same interface as the reading mode `DocumentSearch`. */
class EditorSearch {
  constructor(view) {
    this.view = view;
  }

  get state() {
    return searchKey.getState(this.view.state);
  }

  get matches() {
    return this.state.matches;
  }

  get current() {
    return this.state.current;
  }

  dispatch(action, reveal = false) {
    this.view.dispatch(this.view.state.tr.setMeta(searchKey, action));
    if (reveal) this.view.dom.querySelector('mark.search-highlight.current')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  search(query) {
    if (query) this.dispatch({ type: 'search', query }, true);
    else this.clear();
    return this.matches;
  }

  activate(index) {
    if (this.matches.length) this.dispatch({ type: 'activate', index }, true);
  }

  clear() {
    if (this.state.query) this.dispatch({ type: 'clear' });
  }

  /** Selects the active match, so that typing after closing the search continues from there. */
  selectCurrent() {
    const match = this.matches[this.current];
    if (!match) return;
    const { state } = this.view;
    this.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, match.from, match.to)));
  }
}

module.exports = { findMatches, createSearchPlugin, searchKey, DocumentSearchExtension, EditorSearch, MATCH_LIMIT };
