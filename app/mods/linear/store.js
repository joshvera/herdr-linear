// The popup's cache files on disk (the rules are cache.js's): read when the
// popup opens or an issue or project does, written one at a time per copy
// with herdr's compare-and-swap, and never under `herdr-app check`, which
// runs init for real.
import { appHome, readTextFile, writeTextFile, checking } from "herdr";
import { parse, empty, writeWith, serial } from "./cache.js";

const io = { read: (path) => readTextFile(path), write: (path, text, expected) => writeTextFile(path, text, expected) };

// One per copy of the popup: copies share the module, not their queues.
export class Store {
  constructor() {
    this.paths = { lists: `${appHome()}/linear-lists.json`, details: `${appHome()}/linear-details.json` };
    this.queue = serial();
  }

  // The file of `kind` ("lists", "details"); an empty one if it's missing,
  // bad, or this is a check.
  async read(kind) {
    if (checking()) return empty(kind);
    return parse(await readTextFile(this.paths[kind]).catch(() => null), kind);
  }

  // A patch (cache.js applyPatch) onto the file; whether it was written.
  write(kind, patch) {
    if (checking()) return Promise.resolve(false);
    return this.queue(() => writeWith(io, this.paths[kind], kind, patch, Date.now));
  }
}
