const { Node, mergeAttributes } = require('@tiptap/core');
const { StarterKit } = require('@tiptap/starter-kit');
const { Code } = require('@tiptap/extension-code');
const { Strike } = require('@tiptap/extension-strike');
const { Link } = require('@tiptap/extension-link');
const { Image } = require('@tiptap/extension-image');
const { BulletList, OrderedList, TaskList, TaskItem } = require('@tiptap/extension-list');
const { Table, TableRow, TableHeader, TableCell } = require('@tiptap/extension-table');
const { CodeBlockLowlight } = require('@tiptap/extension-code-block-lowlight');

const { t } = require('../i18n');

// Dictionary keys of the labels shown on protected blocks, by kind.
const RAW_LABEL_KEYS = {
  html: 'editor.raw.html',
  footnote: 'editor.raw.footnote',
  reference: 'editor.raw.reference',
  frontmatter: 'editor.raw.frontmatter',
  markdown: 'editor.raw.markdown',
};

// Without a real lowlight instance (unit tests) the schema is identical but nothing is highlighted.
const plainLowlight = {
  highlight: (language, value) => ({ type: 'root', children: [{ type: 'text', value }] }),
  highlightAuto: (value) => ({ type: 'root', children: [{ type: 'text', value }] }),
  listLanguages: () => [],
  registered: () => false,
};

const tightAttribute = (parent) => ({
  ...parent,
  tight: {
    default: true,
    parseHTML: (element) => element.getAttribute('data-tight') !== 'false',
    renderHTML: (attributes) => ({ 'data-tight': attributes.tight ? 'true' : 'false' }),
  },
});

const alignAttribute = (parent) => ({
  ...parent,
  align: {
    default: null,
    parseHTML: (element) => {
      const value = element.getAttribute('data-align') || element.style?.textAlign || element.getAttribute('align');
      return ['left', 'center', 'right'].includes(value) ? value : null;
    },
    renderHTML: (attributes) => (attributes.align ? { 'data-align': attributes.align } : {}),
  },
});

function rawInlineLabel(node) {
  const { kind, source } = node.attrs;
  if (kind === 'footnote') return source.replace(/^\[\^|\]$/g, '').replace(/^\^\[/, '') || 'nota';
  return source;
}

/**
 * Builds the Tiptap extensions shared by the editor and by the Markdown bridge.
 * The options only add DOM behaviour (node views, highlighting): the schema never depends on them.
 */
function createExtensions(options = {}) {
  const { lowlight = plainLowlight, nodeViews = {} } = options;

  const RawBlock = Node.create({
    name: 'rawBlock',
    group: 'block',
    atom: true,
    selectable: true,
    draggable: true,
    isolating: true,
    addAttributes() {
      return {
        kind: {
          default: 'markdown',
          parseHTML: (element) => element.getAttribute('data-raw-block') || 'markdown',
          renderHTML: (attributes) => ({ 'data-raw-block': attributes.kind }),
        },
        source: {
          default: '',
          parseHTML: (element) => element.getAttribute('data-source') || '',
          renderHTML: (attributes) => ({ 'data-source': attributes.source }),
        },
      };
    },
    parseHTML() {
      return [{ tag: 'div[data-raw-block]' }];
    },
    renderHTML({ HTMLAttributes }) {
      return ['div', mergeAttributes(HTMLAttributes)];
    },
    addNodeView() {
      return nodeViews.rawBlock || null;
    },
  });

  const RawInline = Node.create({
    name: 'rawInline',
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,
    addAttributes() {
      return {
        kind: {
          default: 'html',
          parseHTML: (element) => element.getAttribute('data-raw-inline') || 'html',
          renderHTML: (attributes) => ({ 'data-raw-inline': attributes.kind }),
        },
        source: {
          default: '',
          parseHTML: (element) => element.getAttribute('data-source') || '',
          renderHTML: (attributes) => ({ 'data-source': attributes.source }),
        },
      };
    },
    parseHTML() {
      return [{ tag: 'span[data-raw-inline]' }];
    },
    renderHTML({ node, HTMLAttributes }) {
      const title = t(node.attrs.kind === 'footnote' ? 'editor.rawInline.footnote' : 'editor.rawInline.html');
      return ['span', mergeAttributes(HTMLAttributes, { class: 'raw-inline', title, contenteditable: 'false' }), rawInlineLabel(node)];
    },
  });

  const cellOptions = {
    content: 'paragraph',
    addAttributes() {
      return alignAttribute(this.parent?.());
    },
    addKeyboardShortcuts() {
      return {
        // A Markdown cell is a single line: Enter inserts a line break instead of a new paragraph.
        Enter: () => (this.editor.isActive('table') ? this.editor.commands.setHardBreak() : false),
      };
    },
  };

  return [
    StarterKit.configure({
      code: false,
      strike: false,
      link: false,
      underline: false,
      codeBlock: false,
      bulletList: false,
      orderedList: false,
    }),
    // Ctrl+Shift+S is «Salva con nome».
    Strike.extend({
      addKeyboardShortcuts() {
        return { 'Mod-Shift-x': () => this.editor.commands.toggleStrike() };
      },
    }),
    Link.extend({
      inclusive: false,
      addAttributes() {
        return { ...this.parent?.(), auto: { default: null, rendered: false } };
      },
      addKeyboardShortcuts() {
        return {};
      },
    }).configure({
      openOnClick: false,
      autolink: false,
      linkOnPaste: true,
      HTMLAttributes: { target: null, rel: null, class: null },
    }),
    // Declared after the other marks so that code is always the innermost one, as Markdown requires.
    // It can be combined with emphasis, and Ctrl+E is reserved for the edit mode toggle.
    Code.extend({
      excludes: '',
      addKeyboardShortcuts() {
        return { 'Mod-Shift-c': () => this.editor.commands.toggleCode() };
      },
    }),
    BulletList.extend({ addAttributes() { return tightAttribute(this.parent?.()); } }),
    OrderedList.extend({ addAttributes() { return tightAttribute(this.parent?.()); } }),
    TaskList.extend({ addAttributes() { return tightAttribute(this.parent?.()); } }),
    TaskItem.configure({
      nested: true,
      a11y: { checkboxLabel: (node, checked) => t(checked ? 'editor.task.done' : 'editor.task.todo', { text: node.textContent || t('editor.task.empty') }) },
    }),
    Image.extend({
      addNodeView() {
        return nodeViews.image || null;
      },
    }).configure({ inline: true, allowBase64: true }),
    CodeBlockLowlight.extend({
      addAttributes() {
        return { ...this.parent?.(), meta: { default: null, rendered: false } };
      },
      addNodeView() {
        return nodeViews.codeBlock || null;
      },
    }).configure({ lowlight, defaultLanguage: null, enableTabIndentation: true, tabSize: 2 }),
    Table.configure({ resizable: false, allowTableNodeSelection: true }),
    TableRow,
    TableHeader.extend(cellOptions),
    TableCell.extend(cellOptions),
    RawBlock,
    RawInline,
  ];
}

module.exports = { createExtensions, RAW_LABEL_KEYS };
