import { storage } from './storage.js';

const NOTES_KEY = 'sidekick_notes';
const ACTIVE_KEY = 'sidebar_active_note';

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export async function getAllNotes() {
  const notes = await storage.get(NOTES_KEY);
  return notes || [];
}

export async function saveAllNotes(notes) {
  await storage.set(NOTES_KEY, notes);
}

export async function getActiveNoteId() {
  return await storage.get(ACTIVE_KEY);
}

export async function setActiveNoteId(id) {
  await storage.set(ACTIVE_KEY, id);
}

export async function createNote() {
  const notes = await getAllNotes();
  const note = {
    id: generateId(),
    title: `Note — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
    content: '',
    pinned: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  notes.unshift(note);
  await saveAllNotes(notes);
  await setActiveNoteId(note.id);
  return note;
}

export async function updateNote(id, updates) {
  const notes = await getAllNotes();
  const idx = notes.findIndex((n) => n.id === id);
  if (idx === -1) return null;
  notes[idx] = { ...notes[idx], ...updates, updatedAt: Date.now() };
  await saveAllNotes(notes);
  return notes[idx];
}

export async function deleteNote(id) {
  let notes = await getAllNotes();
  notes = notes.filter((n) => n.id !== id);
  await saveAllNotes(notes);
  return notes;
}

export async function duplicateNote(id) {
  const notes = await getAllNotes();
  const original = notes.find((n) => n.id === id);
  if (!original) return null;
  const copy = {
    ...original,
    id: generateId(),
    title: original.title ? `${original.title} (copy)` : '',
    pinned: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  notes.unshift(copy);
  await saveAllNotes(notes);
  await setActiveNoteId(copy.id);
  return copy;
}

export async function togglePin(id) {
  const notes = await getAllNotes();
  const note = notes.find((n) => n.id === id);
  if (!note) return null;
  note.pinned = !note.pinned;
  note.updatedAt = Date.now();
  await saveAllNotes(notes);
  return note;
}

export function sortNotes(notes) {
  return [...notes].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return b.updatedAt - a.updatedAt;
  });
}

export function searchNotes(notes, query) {
  if (!query) return notes;
  const q = query.toLowerCase();
  return notes.filter(
    (n) =>
      (n.title && n.title.toLowerCase().includes(q)) ||
      (n.content && n.content.toLowerCase().includes(q))
  );
}

export function extractPreview(content, maxLen = 80) {
  if (!content) return 'No content';
  const plain = content
    .replace(/::task\[(todo|doing|done)\]\s*/g, '')
    .replace(/#{1,3}\s/g, '')
    .replace(/[*_~`>\-\[\]()!]/g, '')
    .replace(/\n+/g, ' ')
    .trim();
  return plain.length > maxLen ? plain.slice(0, maxLen) + '...' : plain || 'No content';
}

export function formatDate(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: days > 365 ? 'numeric' : undefined,
  });
}
