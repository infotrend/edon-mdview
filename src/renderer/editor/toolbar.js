const { t } = require('../i18n');

const SAFE_REFERENCE =/^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;

const COMMANDS = {
  undo: (chain) => chain.undo(),
  redo: (chain) => chain.redo(),
  bold: (chain) => chain.toggleBold(),
  italic: (chain) => chain.toggleItalic(),
  strike: (chain) => chain.toggleStrike(),
  code: (chain) => chain.toggleCode(),
  bulletList: (chain) => chain.toggleBulletList(),
  orderedList: (chain) => chain.toggleOrderedList(),
  taskList: (chain) => chain.toggleTaskList(),
  blockquote: (chain) => chain.toggleBlockquote(),
  codeBlock: (chain) => chain.toggleCodeBlock(),
  horizontalRule: (chain) => chain.setHorizontalRule(),
  table: (chain) => chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }),
  rowBefore: (chain) => chain.addRowBefore(),
  rowAfter: (chain) => chain.addRowAfter(),
  rowDelete: (chain) => chain.deleteRow(),
  columnBefore: (chain) => chain.addColumnBefore(),
  columnAfter: (chain) => chain.addColumnAfter(),
  columnDelete: (chain) => chain.deleteColumn(),
  tableDelete: (chain) => chain.deleteTable(),
};

/**
 * Connects the formatting toolbar and the link/image dialogs to an editor. Every Markdown construct
 * is applied through editor commands: the user never types the markers.
 */
function createToolbar({ root, linkDialog, imageDialog, chooseImage, notify }) {
  const buttons = [...root.querySelectorAll('[data-command]')];
  const blockType = root.querySelector('#block-type');
  const tableTools = root.querySelector('#table-tools');
  const linkUrl = linkDialog.querySelector('#link-url');
  const linkRemove = linkDialog.querySelector('#link-remove');
  const imageSource = imageDialog.querySelector('#image-src');
  const imageAlt = imageDialog.querySelector('#image-alt');
  const imageApply = imageDialog.querySelector('#image-apply');
  let editor = null;
  let refreshQueued = false;
  let editingImage = false;

  /** The image dialog confirms with «apply» for an existing image and «insert» for a new one. */
  function translate() {
    imageApply.textContent = t(editingImage ? 'dialog.apply' : 'dialog.insert');
  }

  function refresh() {
    refreshQueued = false;
    if (!editor || editor.isDestroyed) return;
    const inCode = editor.isActive('codeBlock');
    const inTable = editor.isActive('table');
    const inHeaderRow = editor.isActive('tableHeader');
    const can = editor.can();
    const disabled = {
      undo: !can.undo(),
      redo: !can.redo(),
      bold: inCode, italic: inCode, strike: inCode, code: inCode, link: inCode, image: inCode,
      table: inTable || inCode,
      horizontalRule: inTable || inCode,
      bulletList: inTable, orderedList: inTable, taskList: inTable, blockquote: inTable, codeBlock: inTable,
      rowBefore: inHeaderRow,
      rowDelete: inHeaderRow,
    };
    for (const button of buttons) {
      const name = button.dataset.command;
      const active = button.dataset.active ? editor.isActive(button.dataset.active) : false;
      button.classList.toggle('active', active);
      if (button.dataset.active) button.setAttribute('aria-pressed', String(active));
      button.disabled = Boolean(disabled[name]);
    }
    const level = [1, 2, 3, 4, 5, 6].find((candidate) => editor.isActive('heading', { level: candidate }));
    blockType.value = level ? String(level) : 'paragraph';
    blockType.disabled = !(level || editor.isActive('paragraph')) || inTable;
    tableTools.hidden = !inTable;
  }

  function queueRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(refresh);
  }

  function closeDialog(dialog) {
    if (dialog.open) dialog.close();
    // Synchronous on purpose: a deferred focus would write the old selection back over a click that follows.
    if (editor && !editor.isDestroyed) editor.view.focus();
  }

  function openLink() {
    if (!editor || editor.isActive('codeBlock')) return;
    linkUrl.value = editor.getAttributes('link').href || '';
    linkRemove.hidden = !editor.isActive('link');
    linkDialog.showModal();
    linkUrl.select();
  }

  function applyLink() {
    const href = linkUrl.value.trim();
    if (href && !SAFE_REFERENCE.test(href)) {
      notify(t('toast.linkAddressNotAllowed'), 'warning');
      return;
    }
    closeDialog(linkDialog);
    if (!href) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
    } else if (editor.state.selection.empty && !editor.isActive('link')) {
      editor.chain().focus().insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }).run();
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href, auto: null }).run();
    }
  }

  function removeLink() {
    closeDialog(linkDialog);
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
  }

  function openImage() {
    if (!editor || editor.isActive('codeBlock')) return;
    const selected = editor.state.selection.node;
    editingImage = Boolean(selected && selected.type.name === 'image');
    imageSource.value = editingImage ? selected.attrs.src || '' : '';
    imageAlt.value = editingImage ? selected.attrs.alt || '' : '';
    translate();
    imageDialog.showModal();
    imageSource.focus();
  }

  function applyImage() {
    const src = imageSource.value.trim();
    if (!src) { imageSource.focus(); return; }
    if (!SAFE_REFERENCE.test(src)) {
      notify(t('toast.imagePathNotAllowed'), 'warning');
      return;
    }
    const attributes = { src, alt: imageAlt.value.trim() || null };
    closeDialog(imageDialog);
    if (editingImage) editor.chain().focus().updateAttributes('image', attributes).run();
    else editor.chain().focus().setImage(attributes).run();
  }

  async function browseImage() {
    try {
      const chosen = await chooseImage();
      if (!chosen) return;
      if (chosen.error) { notify(chosen.error, 'warning'); return; }
      imageSource.value = chosen.reference;
      if (!imageAlt.value.trim()) imageAlt.value = chosen.name.replace(/\.[^.]+$/, '');
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  function run(name) {
    if (!editor || editor.isDestroyed) return false;
    if (name === 'link') { openLink(); return true; }
    if (name === 'image') { openImage(); return true; }
    const command = COMMANDS[name];
    return command ? command(editor.chain().focus()).run() : false;
  }

  // Keep the selection in the document while the toolbar is used with the mouse.
  root.addEventListener('mousedown', (event) => {
    if (event.target.closest('button')) event.preventDefault();
  });
  root.addEventListener('click', (event) => {
    const button = event.target.closest('[data-command]');
    if (button && !button.disabled) run(button.dataset.command);
  });
  blockType.addEventListener('change', () => {
    if (!editor) return;
    editor.view.focus();
    if (blockType.value === 'paragraph') editor.chain().setParagraph().run();
    else editor.chain().setHeading({ level: Number(blockType.value) }).run();
  });

  for (const dialog of [linkDialog, imageDialog]) {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog || event.target.closest('[data-dialog-close]')) closeDialog(dialog);
    });
  }
  linkDialog.querySelector('#link-apply').addEventListener('click', applyLink);
  linkRemove.addEventListener('click', removeLink);
  linkUrl.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); applyLink(); } });
  imageApply.addEventListener('click', applyImage);
  imageDialog.querySelector('#image-browse').addEventListener('click', browseImage);
  for (const input of [imageSource, imageAlt]) {
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); applyImage(); } });
  }

  return {
    attach(instance) { editor = instance; refresh(); },
    detach() {
      editor = null;
      for (const dialog of [linkDialog, imageDialog]) if (dialog.open) dialog.close();
    },
    refresh: queueRefresh,
    translate,
    run,
    openLink,
  };
}

module.exports = { createToolbar };
