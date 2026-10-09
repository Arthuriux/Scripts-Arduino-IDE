'use strict';
/**
 * Almacenamiento persistente sencillo basado en un archivo JSON.
 * Suficiente para decenas de pantallas y miles de archivos multimedia,
 * sin dependencias nativas (funciona igual en Windows, Linux o Raspberry Pi).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EMPTY = () => ({
  meta: { contentVersion: 1, createdAt: new Date().toISOString() },
  users: [],
  media: [],
  playlists: [],
  layouts: [],
  walls: [],
  displays: [],
  schedules: [],
  stats: [],
});

class Store {
  constructor(file) {
    this.file = file;
    this.data = EMPTY();
    this._timer = null;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      this.data = Object.assign(EMPTY(), raw);
    }
    this.flushSync();
  }

  get(collection) {
    return this.data[collection];
  }

  find(collection, id) {
    return this.data[collection].find((x) => x.id === id) || null;
  }

  insert(collection, doc) {
    const now = new Date().toISOString();
    const rec = { id: newId(), createdAt: now, updatedAt: now, ...doc };
    this.data[collection].push(rec);
    this.save();
    return rec;
  }

  update(collection, id, patch) {
    const rec = this.find(collection, id);
    if (!rec) return null;
    Object.assign(rec, patch, { id, updatedAt: new Date().toISOString() });
    this.save();
    return rec;
  }

  remove(collection, id) {
    const list = this.data[collection];
    const idx = list.findIndex((x) => x.id === id);
    if (idx === -1) return false;
    list.splice(idx, 1);
    this.save();
    return true;
  }

  /** Incrementa la versión de contenido: los reproductores sabrán que deben sincronizar. */
  bumpVersion() {
    this.data.meta.contentVersion += 1;
    this.save();
    return this.data.meta.contentVersion;
  }

  get contentVersion() {
    return this.data.meta.contentVersion;
  }

  save() {
    if (this._timer) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      this.flushSync();
    }, 200);
  }

  flushSync() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}

function newId() {
  return crypto.randomBytes(9).toString('base64url');
}

module.exports = { Store, newId };
