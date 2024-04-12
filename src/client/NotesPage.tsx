import { RouteMatch } from './router.jsx';
import React, { useCallback, useState, useEffect, useRef, memo } from 'react';
import type * as t from '../common/types.js';
import * as cutil from '../common/util.js';
import * as storage from './storage.js';
import * as appStore from './appStore.js';
import * as util from './util.jsx';
import * as actions from './appStoreActions.jsx';
import { Editor, EditorContext } from './Editor.jsx';
import { DemoPopup } from './DemoPopup.jsx';
import { PageLayout, PageHeader, PageBody, PageAction } from './PageLayout.jsx';
import _ from 'lodash';
import { v4 as uuid } from 'uuid';
import * as icons from './icons.js';
import log from './logger.js';

type NotesPageProps = {};

export function NotesPage(props: NotesPageProps) {
  const app = appStore.use();
  const [newNote, setNewNote] = useState<t.Note>();
  // const [newNoteText, setNewNoteText] = useState('');
  // const [newNotePinned, setNewNotePinned] = useState(false);
  const [editing, setEditing] = useState(false);
  const [stickyEditor, setStickyEditor] = useState(false);
  const editorRef = useRef<EditorContext | null>(null);
  util.useStoreAndRestoreScrollY();

  function saveNewNote(changes: { text?: string | null; pinned?: number; not_deleted?: number }) {
    let savedNote = {
      ...(newNote ?? createNewNote()),
      ...changes,
      modification_date: new Date().toISOString(),
    };
    setNewNote(savedNote);
    actions.saveNote(savedNote);
  }

  function confirmNewNoteCb() {
    if (newNote?.text?.trim()) {
      actions.showMessage('Note added', { type: 'info' });
      editorRef.current!.focus();
    } else {
      setEditing(false);
    }
    setNewNote(undefined);
    actions.updateNotesIfDirty();
  }

  async function cancelNewNoteCb() {
    if (newNote) {
      // It's possible that before we confirmed or cancelled the new note,
      // it was changed from another session. In that case, we don't want
      // to delete the note.
      const noteInStorage = await storage.getNote(newNote.id);
      if (!noteInStorage || !cutil.isNoteNewerThan(noteInStorage, newNote)) {
        saveNewNote({ text: null, not_deleted: 0 });
      }
    }
    setNewNote(undefined);
    setEditing(false);
    actions.updateNotesIfDirty();
  }

  function newNoteTextChanged(text: string) {
    saveNewNote({ text });
  }

  // Set editor's stickiness on mount and on scroll.
  useEffect(() => {
    function scrolled() {
      setStickyEditor(window.scrollY > 64);
      reduceNotePagesDebounced();
    }

    scrolled();
    window.addEventListener('scroll', scrolled);
    return () => window.removeEventListener('scroll', scrolled);
  }, []);

  function editorFocusCb() {
    setEditing(true);
  }

  function editorBlurCb() {
    // setEditing(false);
  }

  function togglePinned() {
    editorRef.current!.focus();
    saveNewNote({ pinned: newNote?.pinned ? 0 : 1 });
  }

  function toggleHidePinnedNotes() {
    const value = !app.hidePinnedNotes;
    storage.setSetting(value, 'hidePinnedNotes');
    appStore.update(app => {
      app.hidePinnedNotes = value;
    });
    actions.updateNotes();
    actions.showMessage(value ? 'Hiding pinned notes' : 'Showing pinned notes');
  }

  function loadMore() {
    appStore.update(app => {
      app.notePages++;
    });
    actions.updateNotes();
  }

  function toggleSearchCb() {
    appStore.update(app => {
      app.search = app.search === undefined ? '' : undefined;
    });
    actions.updateNotes();
  }

  function searchChangeCb(e: React.ChangeEvent<HTMLInputElement>) {
    appStore.update(app => {
      app.search = e.target.value;
    });
    actions.updateNotesDebounced();
  }

  function cycleListStyleCb() {
    editorRef.current!.cycleListStyle();
  }

  function editNoteCb() {
    setEditing(true);
    editorRef.current!.focus();
  }

  const pageActions: React.ReactNode[] = [];
  if (editing) {
    pageActions.push(
      <PageAction icon={icons.bulletpointWhite} onClick={cycleListStyleCb} title="Cycle list style" />,

      <PageAction
        icon={newNote?.pinned ? icons.pinFilledWhite : icons.pinEmptyWhite}
        onClick={togglePinned}
        title={newNote?.pinned ? 'Unpin' : 'Pin'}
      />,
      <PageAction icon={icons.xWhite} onClick={cancelNewNoteCb} title="Cancel" />,
      <PageAction icon={icons.checkWhite} onClick={confirmNewNoteCb} title="Done" />,
    );
  } else if (app.search === undefined) {
    pageActions.push(
      <PageAction icon={icons.searchWhite} onClick={toggleSearchCb} title="Search" />,
      <PageAction
        icon={app.hidePinnedNotes ? icons.hidePinnedWhite : icons.showPinnedWhite}
        onClick={toggleHidePinnedNotes}
        title={app.hidePinnedNotes ? 'Show pinned notes' : 'Hide pinned notes'}
      />,
      <PageAction icon={icons.addWhite} onClick={editNoteCb} title="New note" />,
    );
  } else {
    pageActions.push(
      <input
        placeholder={app.showArchive ? 'Search archive ...' : 'Search ...'}
        className="search action"
        value={app.search}
        onChange={searchChangeCb}
        autoFocus
      />,
      <PageAction className="close-search" icon={icons.xWhite} onClick={toggleSearchCb} title="Close search" />,
    );
  }

  return (
    <PageLayout>
      <PageHeader
        actions={pageActions}
        title={app.showArchive ? '/ archive' : undefined}
        hasSticky={stickyEditor && editing}
        hasSearch={app.search !== undefined}
      />
      <PageBody>
        <div className="notes-page">
          <div
            className={`new-note-container ${stickyEditor ? 'sticky' : ''} ${
              stickyEditor && !editing ? 'invisible' : ''
            }`}
          >
            <Editor
              ref={editorRef}
              id="new-note-editor"
              className="text-input"
              placeholder="What's on you mind?"
              value={newNote?.text ?? ''}
              onChange={newNoteTextChanged}
              autoExpand
              onFocus={editorFocusCb}
              onBlur={editorBlurCb}
            />
          </div>
          <Notes />
          {!app.allNotePagesLoaded && (
            <button className="load-more primary button-row" onClick={loadMore}>
              Load more
            </button>
          )}
          {app.user?.username === 'demo' && <DemoPopup />}
        </div>
      </PageBody>
    </PageLayout>
  );
}

const Notes = memo(function Notes() {
  const app = appStore.use();
  return (
    <div className="notes">
      {app.notes.map(note => (
        <Note key={note.id} note={note} />
      ))}
    </div>
  );
});

const Note = memo(function Note(props: { note: t.Note }) {
  let text = props.note.text;
  // if (text && text.length > 1500) {
  //   text = text.substring(0, 1500) + '\n..........';
  // }
  const lineLimit = 30;
  if (text && countLines(text) > lineLimit) {
    text = text.split(/\r?\n/).slice(0, lineLimit).join('\n') + '\n..........';
  }
  // const titleBodyMatch = text?.match(/^([^\r\n]+)\r?\n\r?\n(.+)$/s);
  // let title = titleBodyMatch?.[1];
  // let body = titleBodyMatch?.[2] ?? text ?? '';
  const lines = cutil.parseLines(text ?? '');
  const hasTitle = lines.length > 2 && !lines[0].bullet && lines[1].wholeLine === '';

  function clickCb(e: React.MouseEvent) {
    history.pushState(null, '', `/n/${props.note.id}`);
  }

  const { onClick, onMouseDown } = util.useClickWithoutDrag(clickCb);

  function inputChangeCb(e: React.ChangeEvent<HTMLInputElement>) {
    const lineIndex = Number(e.target.dataset.lineIndex);
    const line = lines[lineIndex];
    const newLineText = cutil.setLineCheckbox(line, e.target.checked);
    const newText = cutil.insertText(props.note.text!, newLineText, line.start, line.end);
    const newNote: t.Note = { ...props.note, text: newText, modification_date: new Date().toISOString() };
    actions.saveNoteAndQuickUpdateNotes(newNote);
  }

  function inputClickCb(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  function renderLine(line: t.ParsedLine, i: number): React.ReactNode {
    let res = [];

    if (hasTitle && i === 0) {
      // Render title.
      res.push(<span className="title">{lines[0].wholeLine}</span>);
    } else if (!hasTitle || i >= 2) {
      // Render body line.

      if (i > 0) res.push('\n');

      if (!line.bullet) {
        res.push(line.wholeLine);
      } else {
        res.push(' '.repeat(line.padding * 2));
        if (line.checkbox) {
          res.push(
            <input
              type="checkbox"
              key={`input-${props.note.id}-${i}`}
              onChange={inputChangeCb}
              onClick={inputClickCb}
              data-line-index={i}
              checked={line.checked}
            />,
          );
          res.push(' ');
        } else {
          res.push('• ');
        }
        res.push(line.body);
      }
    }

    return res;
  }

  // const bodyLines = hasTitle ? lines.slice(2) : lines;

  return (
    <pre className="note" onMouseDown={onMouseDown} onClick={onClick}>
      {Boolean(props.note.pinned) && <img className="pin" src={icons.pinFilled} />}
      {lines.map(renderLine)}
    </pre>
  );
});

function createNewNote(): t.Note {
  return {
    id: uuid(),
    text: '',
    creation_date: new Date().toISOString(),
    modification_date: new Date().toISOString(),
    order: Date.now(),
    not_deleted: 1,
    not_archived: 1,
    pinned: 0,
  };
}

export async function notesPageLoader(match: RouteMatch) {
  // When transitioning to / or /archive, we only want to update the notes if necessary.
  appStore.update(app => {
    const showArchive = match.pathname === '/archive';
    if (showArchive !== app.showArchive) {
      app.showArchive = showArchive;
      app.notesUpdateRequestTimestamp = Date.now();
    }
  });

  // Not awaiting this causes glitches especially when going from / to /archive and back with scroll restoration.
  await actions.updateNotesIfDirty();
}

function countLines(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') count++;
  return count;
}

function reduceNotePagesImmediately() {
  const notes = document.querySelectorAll('.note');
  for (const [i, note] of notes.entries()) {
    const rect = note.getBoundingClientRect();
    if (rect.top > window.innerHeight * 2 + window.scrollY) {
      actions.reduceNotePages(i);
      break;
    }
  }
}

const reduceNotePagesDebounced = _.debounce(reduceNotePagesImmediately, 1000);
