const { Editor } = require('@tiptap/core');
const { Selection } = require('@tiptap/pm/state');
const { createExtensions, RAW_LABEL_KEYS } = require('./extensions');
const { t } = require('../i18n');
const { createMarkdownBridge } = require('./markdown-bridge');
const { highlighter } = require('./highlight');
const { DocumentSearchExtension, EditorSearch } = require('./search');

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Visual Markdown editor. The DOM is always built from the editor schema, never from document HTML:
 * the only HTML rendered as such is the content of protected blocks, which goes through `renderRaw`
 * (the reader's sanitizing renderer).
 */
function createVisualEditor({ host, source, renderRaw, resolveImage, onChange, onStateChange }) {
  const nodeViews = {
    rawBlock: ({ node }) => {
      const { kind, source: raw } = node.attrs;
      const dom = element('div', 'raw-block');
      dom.dataset.kind = kind;
      dom.contentEditable = 'false';
      dom.append(element('div', 'raw-block-label', t('editor.raw.preserved', { label: t(RAW_LABEL_KEYS[kind] || RAW_LABEL_KEYS.markdown) })));
      const body = element('div', 'raw-block-body');
      if (kind === 'html') {
        body.innerHTML = renderRaw(raw);
        for (const image of body.querySelectorAll('img[src]')) {
          const original = image.getAttribute('src');
          image.removeAttribute('src');
          resolveImage(original).then((url) => { image.src = url; }).catch(() => {});
        }
      }
      if (kind !== 'html' || (!body.textContent.trim() && !body.querySelector('img, hr, table, svg, video, audio'))) {
        body.replaceChildren(element('pre', 'raw-block-source', raw));
      }
      dom.append(body);
      return {
        dom,
        ignoreMutation: () => true,
        update: (updated) => updated.type === node.type && updated.attrs.kind === kind && updated.attrs.source === raw,
      };
    },

    image: ({ node }) => {
      const dom = document.createElement('img');
      let current = null;
      const apply = (attrs) => {
        dom.alt = attrs.alt || '';
        if (attrs.title) dom.title = attrs.title;
        else dom.removeAttribute('title');
        if (attrs.src === current) return;
        current = attrs.src;
        dom.removeAttribute('src');
        resolveImage(attrs.src).then((url) => { if (current === attrs.src) dom.src = url; }).catch(() => {});
      };
      dom.referrerPolicy = 'no-referrer';
      dom.decoding = 'async';
      apply(node.attrs);
      return {
        dom,
        update(updated) {
          if (updated.type !== node.type) return false;
          apply(updated.attrs);
          return true;
        },
      };
    },

    codeBlock: ({ node, getPos, editor }) => {
      let current = node;
      const dom = element('div', 'code-block');
      const input = element('input', 'code-language');
      input.type = 'text';
      input.placeholder = t('editor.codeLanguage.placeholder');
      input.spellcheck = false;
      input.autocomplete = 'off';
      input.setAttribute('list', 'code-languages');
      input.setAttribute('aria-label', t('editor.codeLanguage'));
      input.value = node.attrs.language || '';
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      pre.append(code);
      dom.append(input, pre);

      const commit = () => {
        const language = input.value.trim().split(/\s+/)[0] || null;
        const position = typeof getPos === 'function' ? getPos() : undefined;
        if (language === current.attrs.language || typeof position !== 'number') return;
        editor.view.dispatch(editor.state.tr.setNodeAttribute(position, 'language', language));
      };
      input.addEventListener('change', commit);
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === 'Escape') {
          event.preventDefault();
          if (event.key === 'Escape') input.value = current.attrs.language || '';
          commit();
          editor.view.focus();
        }
      });

      return {
        dom,
        contentDOM: code,
        stopEvent: (event) => event.target === input,
        ignoreMutation: (mutation) => !code.contains(mutation.target),
        update(updated) {
          if (updated.type !== node.type) return false;
          current = updated;
          if (document.activeElement !== input) input.value = updated.attrs.language || '';
          return true;
        },
      };
    },
  };

  // The search extension only adds decorations: the schema stays the one shared with the Markdown bridge.
  const extensions = [...createExtensions({ lowlight: highlighter, nodeViews }), DocumentSearchExtension];
  let bridge = null;
  let origin = null;
  const surfaceAttributes = () => ({ class: 'markdown-body editor-surface', spellcheck: 'false', 'aria-label': t('editor.label'), role: 'textbox', 'aria-multiline': 'true' });

  const editor = new Editor({
    element: host,
    extensions,
    content: '',
    editorProps: { attributes: surfaceAttributes() },
    onUpdate: () => onChange && onChange(),
    onTransaction: () => onStateChange && onStateChange(),
  });

  bridge = createMarkdownBridge(editor.schema);
  const parsed = bridge.parse(source);
  origin = parsed.origin;
  // Loading the document is not an editing step: undo must never go back to an empty editor.
  editor.chain()
    .setMeta('addToHistory', false)
    .setContent(parsed.doc, { emitUpdate: false })
    .command(({ tr }) => { tr.setSelection(Selection.atStart(tr.doc)); return true; })
    .run();

  return {
    editor,
    get root() { return editor.view.dom; },
    search: new EditorSearch(editor.view),
    getMarkdown: () => bridge.serialize(editor.state.doc, origin),
    focus: () => editor.view.focus(),
    /**
     * Shows the editor's own labels in the current language. Handing ProseMirror a new set of node
     * views makes it draw the document again: content, selection, history and search stay as they are.
     */
    translate() {
      editor.setOptions({ editorProps: { attributes: surfaceAttributes() } });
      editor.view.setProps({ nodeViews: editor.extensionManager.nodeViews });
    },
    destroy: () => editor.destroy(),
  };
}

module.exports = { createVisualEditor };
