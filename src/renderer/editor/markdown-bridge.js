const MarkdownIt = require('markdown-it');
const footnote = require('markdown-it-footnote');
const { MarkdownSerializer, MarkdownSerializerState } = require('prosemirror-markdown');

const TASK_PREFIX = /^\[([ xX])\](?: |$)/;
const BULLET_FAMILY = new Set(['bulletList', 'taskList']);

/** The same parser the reader uses, minus the typographic replacements that would rewrite the source. */
function createTokenizer() {
  const markdown = new MarkdownIt({ html: true, linkify: true, typographer: false });
  const defaultValidateLink = markdown.validateLink;
  markdown.validateLink = (url) => /^mdview:/i.test(url) || defaultValidateLink.call(markdown, url);
  return markdown.use(footnote);
}

function indexLines(source) {
  const lines = [];
  const pattern = /\r\n?|\n/g;
  let start = 0;
  let match;
  while ((match = pattern.exec(source))) {
    lines.push({ start, end: match.index });
    start = match.index + match[0].length;
  }
  lines.push({ start, end: source.length });
  return lines;
}

function dominantEol(source) {
  const windows = (source.match(/\r\n/g) || []).length;
  const unix = (source.match(/(?<!\r)\n/g) || []).length;
  return windows > unix ? '\r\n' : '\n';
}

function frontMatterLength(lines) {
  if (lines[0] !== '---') return 0;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index] === '---' || lines[index] === '...') {
      const body = lines.slice(1, index);
      return body.some((line) => /^[\w-]+\s*:/.test(line)) ? index + 1 : 0;
    }
  }
  return 0;
}

function destination(url) {
  const value = url || '';
  if (!value) return '<>';
  if (/[\s<>]/.test(value)) return `<${value.replace(/[<>]/g, '\\$&')}>`;
  return value.replace(/[()]/g, '\\$&');
}

const titleSuffix = (title) => (title ? ` "${String(title).replace(/"/g, '\\"')}"` : '');

function backticksFor(node, side) {
  let longest = 0;
  if (node.isText) for (const run of node.text.match(/`+/g) || []) longest = Math.max(longest, run.length);
  let result = longest > 0 && side > 0 ? ' `' : '`';
  result += '`'.repeat(longest);
  if (longest > 0 && side < 0) result += ' ';
  return result;
}

function rawKind(source) {
  const lines = source.split('\n').filter((line) => line.trim());
  if (lines.length && /^ {0,3}\[\^[^\]]+\]:/.test(lines[0])) return 'footnote';
  if (lines.length && lines.every((line) => /^ {0,3}\[[^\]^][^\]]*\]:/.test(line))) return 'reference';
  return 'markdown';
}

function createMarkdownBridge(schema) {
  const tokenizer = createTokenizer();
  const { nodes, marks } = schema;

  // ---------------------------------------------------------------- Markdown → document

  function closingIndex(tokens, index) {
    let depth = 0;
    for (let cursor = index; cursor < tokens.length; cursor += 1) {
      depth += tokens[cursor].nesting;
      if (depth === 0) return cursor;
    }
    throw new Error('Struttura Markdown non bilanciata');
  }

  function fill(type, attrs, content) {
    const node = type.createAndFill(attrs, content);
    if (!node) throw new Error(`Contenuto non valido per ${type.name}`);
    return node;
  }

  function inlineContent(token, env, skipTaskPrefix = false) {
    const content = [];
    let active = [];
    const children = token ? token.children || [] : [];
    children.forEach((child, index) => {
      switch (child.type) {
        case 'text': {
          let text = child.content;
          if (skipTaskPrefix && index === 0) text = text.replace(TASK_PREFIX, '');
          if (text) content.push(schema.text(text, active));
          break;
        }
        case 'softbreak':
          content.push(schema.text(' ', active));
          break;
        case 'hardbreak':
          content.push(nodes.hardBreak.create());
          break;
        case 'code_inline':
          if (child.content) content.push(schema.text(child.content, marks.code.create().addToSet(active)));
          break;
        case 'strong_open': active = marks.bold.create().addToSet(active); break;
        case 'strong_close': active = marks.bold.removeFromSet(active); break;
        case 'em_open': active = marks.italic.create().addToSet(active); break;
        case 'em_close': active = marks.italic.removeFromSet(active); break;
        case 's_open': active = marks.strike.create().addToSet(active); break;
        case 's_close': active = marks.strike.removeFromSet(active); break;
        case 'link_open':
          active = marks.link.create({
            href: child.attrGet('href') || '',
            title: child.attrGet('title') || null,
            auto: child.markup === 'linkify' || child.markup === 'autolink' ? child.markup : null,
          }).addToSet(active);
          break;
        case 'link_close': active = marks.link.removeFromSet(active); break;
        case 'image':
          content.push(nodes.image.create({ src: child.attrGet('src') || '', alt: child.content || null, title: child.attrGet('title') || null }, null, active));
          break;
        case 'html_inline':
          content.push(nodes.rawInline.create({ kind: 'html', source: child.content }, null, active));
          break;
        case 'footnote_ref': {
          const label = child.meta && child.meta.label;
          const inline = env.footnotes && env.footnotes.list && env.footnotes.list[child.meta.id];
          const source = label != null ? `[^${label}]` : `^[${inline ? inline.content : ''}]`;
          content.push(nodes.rawInline.create({ kind: 'footnote', source }, null, active));
          break;
        }
        default:
          throw new Error(`Elemento in linea non supportato: ${child.type}`);
      }
    });
    return content;
  }

  function isTight(tokens, level) {
    return !tokens.some((token) => token.type === 'paragraph_open' && token.level === level + 2 && !token.hidden);
  }

  function listItems(inner) {
    const items = [];
    for (let index = 0; index < inner.length; index += 1) {
      if (inner[index].type !== 'list_item_open') throw new Error('Elenco non valido');
      const close = closingIndex(inner, index);
      items.push(inner.slice(index + 1, close));
      index = close;
    }
    return items;
  }

  function taskState(itemTokens) {
    if (itemTokens.length < 2 || itemTokens[0].type !== 'paragraph_open' || itemTokens[1].type !== 'inline') return null;
    const first = (itemTokens[1].children || [])[0];
    const match = first && first.type === 'text' ? TASK_PREFIX.exec(first.content) : null;
    return match ? match[1] !== ' ' : null;
  }

  function buildList(token, inner, env) {
    const items = listItems(inner);
    const tight = isTight(inner, token.level);
    if (token.type === 'ordered_list_open') {
      const start = Number(token.attrGet('start'));
      return fill(nodes.orderedList, { start: Number.isFinite(start) && token.attrGet('start') !== null ? start : 1, tight },
        items.map((item) => fill(nodes.listItem, null, buildBlocks(item, env))));
    }
    const states = items.map(taskState);
    if (items.length && states.every((state) => state !== null)) {
      return fill(nodes.taskList, { tight }, items.map((item, index) => {
        const [open, inline, close, ...rest] = item;
        const paragraph = fill(nodes.paragraph, null, inlineContent(inline, env, true));
        void open; void close;
        return fill(nodes.taskItem, { checked: states[index] }, [paragraph, ...buildBlocks(rest, env)]);
      }));
    }
    return fill(nodes.bulletList, { tight }, items.map((item) => fill(nodes.listItem, null, buildBlocks(item, env))));
  }

  function buildTable(inner, env) {
    const rows = [];
    let cells = null;
    for (let index = 0; index < inner.length; index += 1) {
      const token = inner[index];
      if (token.type === 'tr_open') cells = [];
      else if (token.type === 'tr_close') { rows.push(fill(nodes.tableRow, null, cells)); cells = null; }
      else if (token.type === 'th_open' || token.type === 'td_open') {
        const close = closingIndex(inner, index);
        const align = /text-align:\s*(left|center|right)/.exec(token.attrGet('style') || '');
        const paragraph = fill(nodes.paragraph, null, inlineContent(inner[index + 1], env));
        cells.push(fill(token.type === 'th_open' ? nodes.tableHeader : nodes.tableCell, { align: align ? align[1] : null }, [paragraph]));
        index = close;
      } else if (!/^(thead|tbody)_(open|close)$/.test(token.type)) {
        throw new Error(`Tabella non supportata: ${token.type}`);
      }
    }
    return fill(nodes.table, null, rows);
  }

  function buildBlocks(tokens, env) {
    const blocks = [];
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (token.nesting === 1) {
        const close = closingIndex(tokens, index);
        const inner = tokens.slice(index + 1, close);
        switch (token.type) {
          case 'paragraph_open': blocks.push(fill(nodes.paragraph, null, inlineContent(inner[0], env))); break;
          case 'heading_open': blocks.push(fill(nodes.heading, { level: Number(token.tag.slice(1)) }, inlineContent(inner[0], env))); break;
          case 'blockquote_open': blocks.push(fill(nodes.blockquote, null, buildBlocks(inner, env))); break;
          case 'bullet_list_open':
          case 'ordered_list_open': blocks.push(buildList(token, inner, env)); break;
          case 'table_open': blocks.push(buildTable(inner, env)); break;
          default: throw new Error(`Blocco non supportato: ${token.type}`);
        }
        index = close;
      } else if (token.type === 'fence' || token.type === 'code_block') {
        const info = token.type === 'fence' ? token.info.trim() : '';
        const [language, ...meta] = info ? info.split(/\s+/) : [];
        const text = token.content.replace(/\n$/, '');
        blocks.push(nodes.codeBlock.create({ language: language || null, meta: meta.join(' ') || null }, text ? schema.text(text) : null));
      } else if (token.type === 'hr') {
        blocks.push(nodes.horizontalRule.create());
      } else if (token.type === 'html_block') {
        blocks.push(nodes.rawBlock.create({ kind: 'html', source: token.content.replace(/\n+$/, '') }));
      } else {
        throw new Error(`Blocco non supportato: ${token.type}`);
      }
    }
    return blocks;
  }

  function topLevelGroups(tokens) {
    const groups = [];
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      const close = token.nesting === 1 ? closingIndex(tokens, index) : index;
      // Footnote definitions are moved to a trailing block without source lines: they are kept as raw text below.
      if (token.type !== 'footnote_block_open' && token.map) groups.push({ tokens: tokens.slice(index, close + 1), map: token.map });
      index = close;
    }
    return groups;
  }

  /**
   * Parses Markdown into an editor document and remembers the exact source of every top-level block,
   * so that untouched blocks can be written back byte for byte.
   */
  function parse(source) {
    const text = typeof source === 'string' ? source : '';
    const offsets = indexLines(text);
    const lines = offsets.map(({ start, end }) => text.slice(start, end));
    const blank = (line) => !lines[line].trim();
    const frontMatter = frontMatterLength(lines);
    const env = {};
    const tokens = tokenizer.parse(lines.slice(frontMatter).join('\n'), env);

    const segments = [];
    const pushRaw = (from, to, kind) => {
      let start = from;
      let end = to;
      while (start < end && blank(start)) start += 1;
      while (end > start && blank(end - 1)) end -= 1;
      if (start < end) segments.push({ start, end, kind });
    };

    let cursor = 0;
    if (frontMatter) {
      segments.push({ start: 0, end: frontMatter, kind: 'frontmatter' });
      cursor = frontMatter;
    }
    for (const group of topLevelGroups(tokens)) {
      const start = Math.max(cursor, group.map[0] + frontMatter);
      let end = Math.min(lines.length, group.map[1] + frontMatter);
      while (end > start + 1 && blank(end - 1)) end -= 1;
      if (end <= start) continue;
      pushRaw(cursor, start);
      segments.push({ start, end, tokens: group.tokens });
      cursor = end;
    }
    pushRaw(cursor, lines.length);

    const topLevelReferences = new Set();
    const blocks = segments.map((segment, index) => {
      const next = segments[index + 1];
      const blockSource = text.slice(offsets[segment.start].start, offsets[segment.end - 1].end);
      const normalized = lines.slice(segment.start, segment.end).join('\n');
      let node = null;
      if (segment.tokens) {
        try {
          const built = buildBlocks(segment.tokens, env);
          if (built.length === 1) {
            built[0].check();
            node = built[0];
          }
        } catch {
          node = null;
        }
      } else if (!segment.kind) {
        const localEnv = {};
        tokenizer.parse(normalized, localEnv);
        for (const key of Object.keys(localEnv.references || {})) topLevelReferences.add(key);
      }
      if (!node) node = nodes.rawBlock.create({ kind: segment.kind || (segment.tokens ? 'markdown' : rawKind(normalized)), source: normalized });
      return {
        node,
        source: blockSource,
        gapAfter: next ? text.slice(offsets[segment.end - 1].end, offsets[next.start].start) : '',
      };
    });

    const nestedReferences = Object.entries(env.references || {})
      .filter(([key]) => !topLevelReferences.has(key))
      .map(([key, value]) => ({ key, href: value.href, title: value.title }));

    const origin = {
      blocks,
      eol: dominantEol(text),
      prefix: blocks.length ? text.slice(0, offsets[segments[0].start].start) : text,
      suffix: blocks.length ? text.slice(offsets[segments[segments.length - 1].end - 1].end) : '',
      nestedReferences,
      byNode: new WeakMap(),
      bySignature: new Map(),
      generated: new WeakMap(),
    };
    blocks.forEach((block, index) => {
      origin.byNode.set(block.node, index);
      const signature = `${block.node.type.name}:${block.node.nodeSize}`;
      if (!origin.bySignature.has(signature)) origin.bySignature.set(signature, []);
      origin.bySignature.get(signature).push(index);
    });

    const doc = schema.topNodeType.createAndFill(null, blocks.map((block) => block.node));
    return { doc, origin };
  }

  // ---------------------------------------------------------------- document → Markdown

  let context = null;

  function previousSibling(parent, index) {
    if (context && parent === context.doc) return context.previous;
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const sibling = parent.child(cursor);
      if (sibling.type !== nodes.paragraph || sibling.childCount) return sibling;
    }
    return null;
  }

  function listMarker(node, parent, index, ordered) {
    const [preferred, alternative] = ordered ? ['.', ')'] : ['-', '*'];
    const previous = parent ? previousSibling(parent, index) : null;
    const sameFamily = previous && (ordered ? previous.type === nodes.orderedList : BULLET_FAMILY.has(previous.type.name));
    const marker = sameFamily && (context.markers.get(previous) || preferred) === preferred ? alternative : preferred;
    context.markers.set(node, marker);
    return marker;
  }

  // In a tight list a blank line inside an item would make the whole list loose when read again,
  // so blocks that may directly follow a paragraph are written without one.
  function renderItem(state, node) {
    const interrupting = new Set([nodes.codeBlock, nodes.blockquote, nodes.heading, nodes.bulletList, nodes.orderedList, nodes.taskList]);
    node.forEach((child, offset, index) => {
      if (index && state.inTightList && interrupting.has(child.type)) state.flushClose(1);
      state.render(child, node, index);
    });
  }

  function atLineStart(parent, index) {
    return index === 0 || parent.child(index - 1).type === nodes.hardBreak;
  }

  const serializer = new MarkdownSerializer({
    paragraph(state, node) {
      state.renderInline(node);
      state.closeBlock(node);
    },
    heading(state, node) {
      state.write(`${'#'.repeat(node.attrs.level)} `);
      state.renderInline(node, false);
      state.closeBlock(node);
    },
    blockquote(state, node) {
      state.wrapBlock('> ', null, node, () => state.renderContent(node));
    },
    codeBlock(state, node) {
      const text = node.textContent;
      const runs = text.match(/`{3,}/gm);
      const fence = runs ? `${runs.sort().slice(-1)[0]}\`` : '```';
      state.write(`${fence}${[node.attrs.language, node.attrs.meta].filter(Boolean).join(' ')}\n`);
      state.text(text, false);
      state.write('\n');
      state.write(fence);
      state.closeBlock(node);
    },
    horizontalRule(state, node) {
      state.write('---');
      state.closeBlock(node);
    },
    bulletList(state, node, parent, index) {
      const marker = listMarker(node, parent, index, false);
      state.renderList(node, '  ', () => `${marker} `);
    },
    taskList(state, node, parent, index) {
      const marker = listMarker(node, parent, index, false);
      state.renderList(node, '  ', () => `${marker} `);
    },
    orderedList(state, node, parent, index) {
      const marker = listMarker(node, parent, index, true);
      const start = Number.isFinite(node.attrs.start) ? node.attrs.start : 1;
      const width = String(start + node.childCount - 1).length;
      state.renderList(node, ' '.repeat(width + 2), (item) => {
        const number = String(start + item);
        return `${number}${marker}${' '.repeat(width - number.length + 1)}`;
      });
    },
    listItem(state, node) {
      if (node.firstChild && node.firstChild.type === nodes.paragraph) context.literalTask = node.firstChild;
      renderItem(state, node);
    },
    taskItem(state, node) {
      state.write(node.attrs.checked ? '[x] ' : '[ ] ');
      renderItem(state, node);
    },
    table(state, node) {
      const rows = [];
      node.forEach((row) => {
        const cells = [];
        row.forEach((cell) => cells.push(renderCell(cell)));
        rows.push(cells);
      });
      const columns = Math.max(1, ...rows.map((cells) => cells.length));
      const line = (cells) => `| ${Array.from({ length: columns }, (unused, column) => cells[column] || '').join(' | ')} |`;
      const aligns = [];
      node.firstChild.forEach((cell) => aligns.push(cell.attrs.align));
      const rule = { left: ':--', center: ':-:', right: '--:' };
      const output = [line(rows[0]), line(Array.from({ length: columns }, (unused, column) => rule[aligns[column]] || '---')), ...rows.slice(1).map(line)];
      state.text(output.join('\n'), false);
      state.closeBlock(node);
    },
    image(state, node) {
      state.write(`![${state.esc(node.attrs.alt || '')}](${destination(node.attrs.src)}${titleSuffix(node.attrs.title)})`);
    },
    hardBreak(state, node, parent, index) {
      if (context.inTable) { state.write('<br>'); return; }
      if (parent.type === nodes.heading) { state.write(' '); return; }
      for (let cursor = index + 1; cursor < parent.childCount; cursor += 1) {
        if (parent.child(cursor).type !== node.type) { state.write('\\\n'); return; }
      }
    },
    rawBlock(state, node) {
      state.text(node.attrs.source, false);
      state.closeBlock(node);
    },
    rawInline(state, node) {
      state.text(node.attrs.source, false);
    },
    text(state, node, parent, index) {
      let text = node.text;
      if (state.inAutolink) { state.text(text, false); return; }
      if (atLineStart(parent, index)) {
        state.atBlockStart = true;
        if (index === 0 && parent === context.literalTask) {
          const task = TASK_PREFIX.exec(text);
          if (task) {
            const marker = task[0].trimEnd();
            state.write(marker);
            text = text.slice(marker.length);
            state.atBlockStart = false;
          }
        }
        // Leading spaces cannot be represented and would turn the paragraph into a code block.
        if (state.atBlockStart && /^[ \t]+\S/.test(text)) text = text.replace(/^[ \t]+/, '');
      }
      const lineStart = state.atBlockStart;
      let escaped = state.esc(text, lineStart);
      if (lineStart) escaped = escaped.replace(/^(\s*\d+)\)(\s|$)/, '$1\\)$2').replace(/^=+\s*$/, '\\$&');
      state.text(escaped, false);
    },
  }, {
    italic: { open: '*', close: '*', mixable: true, expelEnclosingWhitespace: true },
    bold: { open: '**', close: '**', mixable: true, expelEnclosingWhitespace: true },
    strike: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true },
    code: {
      open: (state, mark, parent, index) => backticksFor(parent.child(index), -1),
      close: (state, mark, parent, index) => backticksFor(parent.child(index - 1), 1),
      escape: false,
    },
    link: {
      open(state, mark, parent, index) {
        const mode = linkMode(mark, parent, index);
        context.linkModes.push(mode);
        state.inAutolink = mode !== 'inline' ? true : undefined;
        return mode === 'inline' ? '[' : mode === 'angle' ? '<' : '';
      },
      close(state, mark) {
        const mode = context.linkModes.pop();
        state.inAutolink = undefined;
        if (mode === 'angle') return '>';
        if (mode === 'bare') return '';
        return `](${destination(mark.attrs.href)}${titleSuffix(mark.attrs.title)})`;
      },
      mixable: true,
    },
  }, {
    hardBreakNodeName: 'hardBreak',
    strict: false,
    // Text that would otherwise start an HTML tag or decode as an entity.
    escapeExtraCharacters: /<(?=[A-Za-z/!?])|&(?=#?\w+;)/g,
  });

  function linkMode(mark, parent, index) {
    const content = parent.child(index);
    const alone = index === parent.childCount - 1 || !mark.isInSet(parent.child(index + 1).marks);
    if (!content.isText || !alone || mark.attrs.title || content.marks[content.marks.length - 1] !== mark) return 'inline';
    if (mark.attrs.auto === 'linkify') {
      const matches = tokenizer.linkify.match(content.text);
      if (matches && matches.length === 1 && matches[0].index === 0 && matches[0].lastIndex === content.text.length
        && tokenizer.normalizeLink(matches[0].url) === mark.attrs.href) return 'bare';
    }
    return /^\w+:/.test(mark.attrs.href) && content.text === mark.attrs.href ? 'angle' : 'inline';
  }

  function renderCell(cell) {
    const state = new MarkdownSerializerState(serializer.nodes, serializer.marks, { ...serializer.options });
    const wasInTable = context.inTable;
    context.inTable = true;
    const parts = [];
    cell.forEach((child) => {
      state.out = '';
      if (child.inlineContent) state.renderInline(child);
      else state.render(child, cell, 0);
      parts.push(state.out);
    });
    context.inTable = wasInTable;
    return parts.join('<br>').replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim();
  }

  function renderBlock(node, doc, index) {
    const state = new MarkdownSerializerState(serializer.nodes, serializer.marks, { ...serializer.options });
    state.render(node, doc, index);
    return state.out;
  }

  function originIndex(node, origin) {
    if (origin.byNode.has(node)) return origin.byNode.get(node);
    let found = null;
    for (const candidate of origin.bySignature.get(`${node.type.name}:${node.nodeSize}`) || []) {
      if (origin.blocks[candidate].node.eq(node)) { found = candidate; break; }
    }
    origin.byNode.set(node, found);
    return found;
  }

  function sourceMarker(node, source) {
    if (BULLET_FAMILY.has(node.type.name)) return (/^\s*([-*+])/.exec(source) || [])[1] || null;
    if (node.type === nodes.orderedList) return (/^\s*\d+([.)])/.exec(source) || [])[1] || null;
    return null;
  }

  function appendLostReferences(text, origin) {
    if (!origin.nestedReferences.length) return text;
    const env = {};
    tokenizer.parse(text.replace(/\r\n?/g, '\n'), env);
    const searchable = text.replace(/\s+/g, ' ').toUpperCase();
    const lost = origin.nestedReferences.filter(({ key }) => !(env.references && key in env.references) && searchable.includes(`[${key}]`));
    if (!lost.length) return text;
    const definitions = lost.map(({ key, href, title }) => `[${key.toLowerCase()}]: ${destination(href)}${titleSuffix(title)}`);
    const separator = text.endsWith('\n') || text.endsWith('\r') ? origin.eol : origin.eol + origin.eol;
    return `${text}${text ? separator : ''}${definitions.join(origin.eol)}${origin.eol}`;
  }

  /**
   * Writes the document back to Markdown. Blocks equal to the ones that were parsed keep their original
   * text and spacing; only new or modified blocks are generated.
   */
  function serialize(doc, origin, options = {}) {
    context = { doc, previous: null, markers: new WeakMap(), linkModes: [], literalTask: null, inTable: false };
    const emitted = [];
    doc.forEach((node, offset, index) => {
      if (node.type === nodes.paragraph && node.childCount === 0) return;
      const previous = context.previous;
      const listFamily = BULLET_FAMILY.has(node.type.name) ? 'bullet' : node.type === nodes.orderedList ? 'ordered' : null;
      const previousFamily = previous && (BULLET_FAMILY.has(previous.type.name) ? 'bullet' : previous.type === nodes.orderedList ? 'ordered' : null);
      let origins = originIndex(node, origin);
      let text;
      if (origins !== null) {
        text = origin.blocks[origins].source;
        const marker = sourceMarker(node, text);
        // Two adjacent lists with the same marker would merge when the file is read again.
        if (listFamily && listFamily === previousFamily && context.markers.get(previous) === marker) origins = null;
        else if (marker) context.markers.set(node, marker);
      }
      if (origins === null) {
        const cacheable = !listFamily;
        text = cacheable ? origin.generated.get(node) : undefined;
        if (text === undefined) {
          text = renderBlock(node, doc, index);
          if (origin.eol !== '\n') text = text.replace(/\n/g, origin.eol);
          if (cacheable) origin.generated.set(node, text);
        }
      }
      emitted.push({ text, origin: origins });
      context.previous = node;
    });
    context = null;

    if (!emitted.length) return origin.blocks.length ? '' : origin.prefix;
    const last = origin.blocks.length - 1;
    let output = emitted[0].origin === 0 ? origin.prefix : '';
    emitted.forEach((block, index) => {
      output += block.text;
      const next = emitted[index + 1];
      if (next) {
        const contiguous = block.origin !== null && next.origin === block.origin + 1;
        output += contiguous ? origin.blocks[block.origin].gapAfter : origin.eol + origin.eol;
      }
    });
    const final = emitted[emitted.length - 1];
    output += final.origin !== null && final.origin === last ? origin.suffix : origin.eol;
    return options.final ? appendLostReferences(output, origin) : output;
  }

  return { parse, serialize };
}

module.exports = { createMarkdownBridge };
