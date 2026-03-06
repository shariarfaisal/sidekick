import { Editor, Node, mergeAttributes, InputRule } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { Slice, Fragment } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import ImageExtension from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Underline from '@tiptap/extension-underline';
import Placeholder from '@tiptap/extension-placeholder';
import Typography from '@tiptap/extension-typography';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';
import { Markdown } from 'tiptap-markdown';
import {
  storeImageFile,
  trackBlobUrl,
  derefImageUrls,
  resolveImageRefs,
  extractAndStoreBase64Images,
} from './imageStore.js';

let editor = null;
let onUpdateCallback = null;
const lowlight = createLowlight(common);

// Custom Image with hover overlay (copy + expand buttons)
const CustomImage = ImageExtension.extend({
  addNodeView() {
    return ({ node }) => {
      const wrapper = document.createElement('span');
      wrapper.classList.add('image-wrapper');

      const img = document.createElement('img');
      img.src = node.attrs.src || '';
      if (node.attrs.alt) img.alt = node.attrs.alt;
      if (node.attrs.title) img.title = node.attrs.title;

      const overlay = document.createElement('span');
      overlay.classList.add('image-overlay');
      overlay.contentEditable = 'false';

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.classList.add('image-action-btn');
      copyBtn.title = 'Copy image';
      copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M3 11V3a1.5 1.5 0 011.5-1.5H11"/></svg>`;
      copyBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        copyImageToClipboard(img, copyBtn);
      });

      const expandBtn = document.createElement('button');
      expandBtn.type = 'button';
      expandBtn.classList.add('image-action-btn');
      expandBtn.title = 'View full size';
      expandBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="10,2 14,2 14,6"/><polyline points="6,14 2,14 2,10"/><line x1="14" y1="2" x2="9" y2="7"/><line x1="2" y1="14" x2="7" y2="9"/></svg>`;
      expandBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openImageFullscreen(img.src);
      });

      overlay.appendChild(copyBtn);
      overlay.appendChild(expandBtn);
      wrapper.appendChild(img);
      wrapper.appendChild(overlay);

      return {
        dom: wrapper,
        update: (updatedNode) => {
          if (updatedNode.type.name !== 'image') return false;
          img.src = updatedNode.attrs.src || '';
          if (updatedNode.attrs.alt) img.alt = updatedNode.attrs.alt;
          if (updatedNode.attrs.title) img.title = updatedNode.attrs.title;
          return true;
        },
      };
    };
  },
});

async function copyImageToClipboard(img, btn) {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    btn.classList.add('copied');
    setTimeout(() => btn.classList.remove('copied'), 1500);
  } catch (e) {
    console.error('Failed to copy image:', e);
  }
}

function openImageFullscreen(src) {
  let overlay = document.getElementById('image-fullscreen-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'image-fullscreen-overlay';
    overlay.innerHTML = `<img /><button id="image-fullscreen-close" type="button" title="Close">&times;</button>`;
    document.getElementById('app').appendChild(overlay);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.id === 'image-fullscreen-close') {
        overlay.classList.remove('active');
      }
    });
  }
  overlay.querySelector('img').src = src;
  overlay.classList.add('active');
}

// Close fullscreen on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const overlay = document.getElementById('image-fullscreen-overlay');
    if (overlay) overlay.classList.remove('active');
  }
});

// Custom CodeBlock with language label + copy button
const CustomCodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ({ node, editor: ed, getPos }) => {
      const wrapper = document.createElement('div');
      wrapper.classList.add('code-block-wrapper');

      const header = document.createElement('div');
      header.classList.add('code-block-header');

      const langLabel = document.createElement('span');
      langLabel.classList.add('code-block-lang');
      langLabel.textContent = node.attrs.language || 'plaintext';

      const copyBtn = document.createElement('button');
      copyBtn.classList.add('code-block-copy');
      copyBtn.type = 'button';
      copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M3 11V3a1.5 1.5 0 011.5-1.5H11"/></svg><span>Copy</span>`;
      copyBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const text = node.textContent || '';
        navigator.clipboard.writeText(text).then(() => {
          const span = copyBtn.querySelector('span');
          span.textContent = 'Copied!';
          copyBtn.classList.add('copied');
          setTimeout(() => {
            span.textContent = 'Copy';
            copyBtn.classList.remove('copied');
          }, 2000);
        });
      });

      header.appendChild(langLabel);
      header.appendChild(copyBtn);

      const pre = document.createElement('pre');
      const code = document.createElement('code');
      pre.appendChild(code);

      wrapper.appendChild(header);
      wrapper.appendChild(pre);

      return {
        dom: wrapper,
        contentDOM: code,
        update: (updatedNode) => {
          if (updatedNode.type.name !== 'codeBlock') return false;
          langLabel.textContent = updatedNode.attrs.language || 'plaintext';
          return true;
        },
      };
    };
  },
});

// Task Card Node
const STATUS_CYCLE = ['todo', 'doing', 'done'];
const STATUS_LABELS = { todo: 'TODO', doing: 'DOING', done: 'DONE' };

const TaskCard = Node.create({
  name: 'taskCard',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      status: { default: 'todo' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="task-card"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-type': 'task-card' }, HTMLAttributes), 0];
  },

  addNodeView() {
    return ({ node, editor: ed, getPos }) => {
      const wrapper = document.createElement('div');
      wrapper.classList.add('task-card');
      wrapper.dataset.status = node.attrs.status;

      const badge = document.createElement('button');
      badge.type = 'button';
      badge.classList.add('task-card-badge');
      badge.contentEditable = 'false';
      badge.textContent = STATUS_LABELS[node.attrs.status] || 'TODO';
      badge.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof getPos !== 'function') return;
        const pos = getPos();
        const currentStatus = ed.state.doc.nodeAt(pos)?.attrs.status || 'todo';
        const nextIdx = (STATUS_CYCLE.indexOf(currentStatus) + 1) % STATUS_CYCLE.length;
        const nextStatus = STATUS_CYCLE[nextIdx];
        ed.chain().focus().command(({ tr }) => {
          tr.setNodeMarkup(pos, undefined, { status: nextStatus });
          return true;
        }).run();
      });

      const content = document.createElement('div');
      content.classList.add('task-card-content');

      wrapper.appendChild(badge);
      wrapper.appendChild(content);

      return {
        dom: wrapper,
        contentDOM: content,
        update: (updatedNode) => {
          if (updatedNode.type.name !== 'taskCard') return false;
          wrapper.dataset.status = updatedNode.attrs.status;
          badge.textContent = STATUS_LABELS[updatedNode.attrs.status] || 'TODO';
          return true;
        },
      };
    };
  },

  addInputRules() {
    return [
      new InputRule({
        find: /^\/task\s$/,
        handler: ({ state, range }) => {
          const { tr } = state;
          const paragraph = state.schema.nodes.paragraph.create();
          const node = this.type.create({ status: 'todo' }, paragraph);
          tr.replaceWith(range.from, range.to, node);
          // Place cursor inside the new task card's paragraph
          tr.setSelection(TextSelection.near(tr.doc.resolve(range.from + 2)));
        },
      }),
    ];
  },

  addKeyboardShortcuts() {
    const findTaskCardDepth = ($pos) => {
      for (let d = $pos.depth; d >= 1; d--) {
        if ($pos.node(d).type.name === 'taskCard') return d;
      }
      return null;
    };

    const exitCardAfter = (ed) => {
      const { $from } = ed.state.selection;
      const depth = findTaskCardDepth($from);
      if (depth === null) return false;
      const afterPos = $from.after(depth);
      let tr = ed.state.tr;
      // If card is the last block, insert a paragraph after it
      if (afterPos >= ed.state.doc.content.size) {
        tr = tr.insert(afterPos, ed.state.schema.nodes.paragraph.create());
      }
      tr = tr.setSelection(TextSelection.near(tr.doc.resolve(afterPos + 1)));
      ed.view.dispatch(tr);
      return true;
    };

    return {
      Enter: ({ editor: ed }) => {
        const { $from } = ed.state.selection;
        const depth = findTaskCardDepth($from);
        if (depth === null) return false;
        const cardNode = $from.node(depth);
        // If inside the card with only one empty paragraph, exit the card
        if (cardNode.childCount === 1 && cardNode.firstChild.type.name === 'paragraph' && cardNode.firstChild.content.size === 0) {
          return false; // let default behavior handle (stay inside for new cards)
        }
        // If cursor is at end of the last block in the card and that block is an empty paragraph, exit
        const lastChild = cardNode.lastChild;
        if (lastChild && lastChild.type.name === 'paragraph' && lastChild.content.size === 0 && $from.pos === $from.end($from.depth)) {
          // Remove the empty paragraph and exit
          const emptyParaPos = $from.before($from.depth);
          let tr = ed.state.tr.delete(emptyParaPos, emptyParaPos + lastChild.nodeSize);
          const afterPos = $from.after(depth) - lastChild.nodeSize;
          if (afterPos >= tr.doc.content.size) {
            tr = tr.insert(afterPos, ed.state.schema.nodes.paragraph.create());
          }
          tr = tr.setSelection(TextSelection.near(tr.doc.resolve(afterPos + 1)));
          ed.view.dispatch(tr);
          return true;
        }
        return false; // let default Enter behavior create new blocks inside
      },
      ArrowDown: ({ editor: ed }) => {
        const { $from } = ed.state.selection;
        const depth = findTaskCardDepth($from);
        if (depth === null) return false;
        // Only at end of card content
        if ($from.pos !== $from.end(depth)) return false;
        return exitCardAfter(ed);
      },
      'Mod-Alt-t': ({ editor: ed }) => {
        const { $from } = ed.state.selection;
        const pos = $from.before($from.depth);
        const node = $from.node($from.depth);
        const paragraph = ed.state.schema.nodes.paragraph.create();
        const taskNode = ed.state.schema.nodes.taskCard.create({ status: 'todo' }, paragraph);
        let tr = ed.state.tr.replaceWith(pos, pos + node.nodeSize, taskNode);
        tr = tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 2)));
        ed.view.dispatch(tr);
        return true;
      },
      Backspace: ({ editor: ed }) => {
        const { $from } = ed.state.selection;
        const depth = findTaskCardDepth($from);
        if (depth === null) return false;
        const cardNode = $from.node(depth);
        // Only convert back to paragraph if card has single empty paragraph
        const isEmpty = cardNode.childCount === 1 && cardNode.firstChild.type.name === 'paragraph' && cardNode.firstChild.content.size === 0;
        if (!isEmpty) return false;
        const pos = $from.before(depth);
        const tr = ed.state.tr.replaceWith(pos, pos + cardNode.nodeSize, ed.state.schema.nodes.paragraph.create());
        ed.view.dispatch(tr);
        return true;
      },
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize(state, node) {
          state.write(`::task[${node.attrs.status}]\n`);
          state.renderContent(node);
          state.write('::endtask\n');
        },
        parse: {},
      },
    };
  },
});

function normalizeTaskCards(ed) {
  const taskStartRegex = /^::task\[(todo|doing|done)\]\s*$/;
  const taskInlineRegex = /^::task\[(todo|doing|done)\]\s+/;
  const endTaskRegex = /^::endtask\s*$/;
  const replacements = [];
  const taskCardType = ed.state.schema.nodes.taskCard;
  if (!taskCardType) return false;

  // Collect only top-level children of the document
  const topNodes = [];
  let offset = 0;
  ed.state.doc.forEach((node, pos) => {
    topNodes.push({ node, pos });
  });

  let i = 0;
  while (i < topNodes.length) {
    const { node, pos } = topNodes[i];
    if (node.type.name === 'paragraph') {
      const text = node.textContent || '';

      // Check for block format: ::task[status] on its own line
      const blockMatch = text.match(taskStartRegex);
      if (blockMatch) {
        const status = blockMatch[1];
        // Find the matching ::endtask among siblings
        let endIdx = -1;
        const contentNodes = [];
        for (let j = i + 1; j < topNodes.length; j++) {
          const sibling = topNodes[j];
          if (sibling.node.type.name === 'paragraph' && endTaskRegex.test(sibling.node.textContent || '')) {
            endIdx = j;
            break;
          }
          contentNodes.push(sibling.node);
        }
        if (endIdx !== -1) {
          const endNode = topNodes[endIdx];
          const from = pos;
          const to = endNode.pos + endNode.node.nodeSize;
          const content = contentNodes.length > 0
            ? contentNodes
            : [ed.state.schema.nodes.paragraph.create()];
          const taskNode = taskCardType.create({ status }, content);
          replacements.push({ from, to, node: taskNode });
          i = endIdx + 1;
          continue;
        }
      }

      // Check for legacy inline format: ::task[status] content text
      const inlineMatch = text.match(taskInlineRegex);
      if (inlineMatch) {
        const status = inlineMatch[1];
        const prefixLen = inlineMatch[0].length;
        const inlineContent = node.content.cut(prefixLen);
        const paragraph = ed.state.schema.nodes.paragraph.create(null, inlineContent.content);
        const taskNode = taskCardType.create({ status }, paragraph);
        replacements.push({ from: pos, to: pos + node.nodeSize, node: taskNode });
      }
    }
    i++;
  }

  if (replacements.length === 0) return false;

  // Apply replacements from end to start to preserve positions
  let tr = ed.state.tr;
  for (let j = replacements.length - 1; j >= 0; j--) {
    const { from, to, node } = replacements[j];
    tr = tr.replaceWith(from, to, node);
  }
  ed.view.dispatch(tr);
  return true;
}

export function createEditor(element, onChange) {
  onUpdateCallback = onChange;

  editor = new Editor({
    element,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: false,
      }),
      CustomCodeBlock.configure({
        lowlight,
      }),
      CustomImage.configure({
        inline: true,
        allowBase64: true,
      }),
      Link.configure({
        openOnClick: true,
        autolink: true,
        HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TaskCard,
      Underline,
      Placeholder.configure({
        placeholder: ({ node, pos, editor: ed }) => {
          if (node.type.name === 'paragraph') {
            // Check if parent is a task card
            const $pos = ed.state.doc.resolve(pos);
            if ($pos.depth > 0 && $pos.parent.type.name === 'taskCard') {
              return 'Type a task...';
            }
          }
          if (node.type.name === 'heading') return '';
          return 'Start writing...';
        },
        includeChildren: true,
      }),
      Typography,
      Markdown.configure({
        html: true,
        tightLists: true,
        bulletListMarker: '-',
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    editorProps: {
      attributes: {
        class: 'sidekick-editor',
        spellcheck: 'true',
      },
      handleDrop(view, event) {
        const files = event.dataTransfer?.files;
        if (files && files.length > 0) {
          event.preventDefault();
          Array.from(files).forEach((file) => {
            if (file.type.startsWith('image/')) {
              insertImageFromFile(file);
            }
          });
          return true;
        }
        return false;
      },
      handlePaste(view, event) {
        const items = event.clipboardData?.items;
        if (items) {
          for (const item of items) {
            if (item.type.startsWith('image/')) {
              event.preventDefault();
              const file = item.getAsFile();
              if (file) insertImageFromFile(file);
              return true;
            }
          }
        }

        // Keep pasted block content inside task cards
        const { $from } = view.state.selection;
        let insideTaskCard = false;
        for (let d = $from.depth; d >= 1; d--) {
          if ($from.node(d).type.name === 'taskCard') {
            insideTaskCard = true;
            break;
          }
        }
        if (insideTaskCard) {
          const text = event.clipboardData?.getData('text/plain');
          if (text && text.includes('\n')) {
            event.preventDefault();
            const schema = view.state.schema;
            const lines = text.split('\n');
            const nodes = lines.map(line =>
              schema.nodes.paragraph.create(null, line ? schema.text(line) : null)
            );
            const { tr } = view.state;
            const slice = new Slice(Fragment.from(nodes), 0, 0);
            tr.replaceSelection(slice);
            view.dispatch(tr);
            return true;
          }
        }

        return false;
      },
    },
    onUpdate({ editor: ed }) {
      if (normalizeRawChecklistMarkdown(ed)) return;
      if (normalizeTaskCards(ed)) return;
      autoDetectCodeBlockLanguage(ed);
      if (onUpdateCallback) onUpdateCallback(getMarkdownForStorage());
    },
  });

  return editor;
}

async function insertImageFromFile(file) {
  try {
    const { id, blobUrl } = await storeImageFile(file);
    trackBlobUrl(id, blobUrl);
    if (editor) {
      editor.chain().focus().setImage({ src: blobUrl }).run();
    }
  } catch (e) {
    console.error('Failed to store image:', e);
    // Fallback to base64
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (editor) editor.chain().focus().setImage({ src: ev.target.result }).run();
    };
    reader.readAsDataURL(file);
  }
}

// Get markdown with blob URLs replaced by sbn: references for storage
export function getMarkdownForStorage() {
  if (!editor) return '';
  const md = editor.storage.markdown.getMarkdown();
  return derefImageUrls(md);
}

// Set content, resolving sbn: references to blob URLs
export async function setContentWithImages(markdown) {
  if (!editor) return;
  let resolved = markdown || '';
  if (resolved.includes('sbn:')) {
    resolved = await resolveImageRefs(resolved);
  }
  // Also handle any leftover base64 images from old data
  if (resolved.includes('data:image/')) {
    resolved = await extractAndStoreBase64Images(resolved);
    resolved = await resolveImageRefs(resolved);
  }
  editor.commands.setContent(resolved || '');
  normalizeTaskCards(editor);
}

export function getMarkdown() {
  if (!editor) return '';
  return editor.storage.markdown.getMarkdown();
}

export function setContent(markdown) {
  if (!editor) return;
  editor.commands.setContent(markdown || '');
  normalizeTaskCards(editor);
}

export function getEditor() {
  return editor;
}

export function focusEditor() {
  if (editor) editor.commands.focus();
}

export function isActive(name, attrs) {
  if (!editor) return false;
  return editor.isActive(name, attrs);
}

export function toggleBold() { editor?.chain().focus().toggleBold().run(); }
export function toggleItalic() { editor?.chain().focus().toggleItalic().run(); }
export function toggleUnderline() { editor?.chain().focus().toggleUnderline().run(); }
export function toggleStrike() { editor?.chain().focus().toggleStrike().run(); }
export function toggleCode() { editor?.chain().focus().toggleCode().run(); }
export function toggleTaskList() { editor?.chain().focus().toggleTaskList().run(); }
export function toggleLink() {
  if (!editor) return;
  if (editor.isActive('link')) {
    editor.chain().focus().unsetLink().run();
    return;
  }
  const url = prompt('Enter URL:');
  if (url) {
    editor.chain().focus().setLink({ href: url }).run();
  }
}

function autoDetectCodeBlockLanguage(ed) {
  let tr = ed.state.tr;
  let changed = false;

  ed.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return;
    if (node.attrs.language) return;

    const text = node.textContent || '';
    if (!text.trim()) return;

    const result = lowlight.highlightAuto(text);
    const language = result?.data?.language || 'plaintext';
    tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, language });
    changed = true;
  });

  if (changed) {
    ed.view.dispatch(tr);
  }
}

function normalizeRawChecklistMarkdown(ed) {
  let hasRawChecklist = false;
  ed.state.doc.descendants((node) => {
    if (node.type.name !== 'paragraph') return;
    if (/^\s*-\s\[(?: |x|X)\]\s+/.test(node.textContent || '')) {
      hasRawChecklist = true;
    }
  });

  if (!hasRawChecklist) return false;
  const markdown = ed.storage.markdown.getMarkdown();
  ed.commands.setContent(markdown, false);
  return true;
}
