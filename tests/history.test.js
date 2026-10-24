import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import definition from "../module.js";
import { WorkStore } from "../core/store.js";

test("elapsed room bookings archive without false cancellation while future reservations stay protected", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-25T12:00:00Z") });
  const folder = mkdtempSync(join(tmpdir(), "roomgrid-history-")), path = join(folder, "workspace.sqlite");
  let store = new WorkStore(definition, path);
  const save = (collection, data, id) => {
    const next = store.transact({ operation: "save", collection, data, id, revision: store.read().revision });
    return id || next.data[collection].at(-1).id;
  };
  const archive = (collection, id) => store.transact({ operation: "archive", collection, id, revision: store.read().revision });
  const reject = (collection, id) => {
    const before = store.read(), events = store.db.prepare("SELECT * FROM audit ORDER BY rowid").all();
    assert.throws(() => archive(collection, id), /действующая комната/);
    assert.deepEqual(store.read(), before);
    assert.deepEqual(store.db.prepare("SELECT * FROM audit ORDER BY rowid").all(), events);
  };
  try {
    const room = save("rooms", { name: "SYNTHETIC historical room", capacity: 10 });
    const activeRoom = save("rooms", { name: "SYNTHETIC future room", capacity: 10 });
    const booking = (parent, start, end) => ({ room: parent, purpose: "SYNTHETIC group", people: 5, start, end, status: "booked" });
    const past = save("bookings", booking(room, "2026-10-25T10:00:00Z", "2026-10-25T11:00:00Z"));
    const future = save("bookings", booking(activeRoom, "2026-10-25T13:00:00Z", "2026-10-25T14:00:00Z"));
    const original = store.read().data.bookings.find((x) => x.id === past);
    reject("bookings", future); reject("rooms", activeRoom);
    archive("bookings", past); archive("rooms", room);
    let saved = store.read().data.bookings.find((x) => x.id === past);
    assert.equal(saved.status, "booked"); assert.equal(saved.archived, true);
    for (const key of ["room", "purpose", "people", "start", "end", "createdAt", "createdBy"])
      assert.equal(saved[key], original[key]);
    const beforeRestart = store.read(), copy = store.export();
    store.close(); store = new WorkStore(definition, path);
    assert.deepEqual(store.read(), beforeRestart);
    const restored = new WorkStore(definition);
    try { restored.restore(copy); assert.deepEqual(restored.read().data, beforeRestart.data); }
    finally { restored.close(); }
    // At the exact end, the booked interval is elapsed; this is not proof of attendance.
    t.mock.timers.setTime(Date.parse("2026-10-25T14:00:00Z"));
    archive("rooms", activeRoom); archive("bookings", future);
    saved = store.read().data.bookings.find((x) => x.id === future);
    assert.equal(saved.status, "booked"); assert.equal(saved.archived, true);
    const currentRoom = save("rooms", { name: "SYNTHETIC current room", capacity: 10 });
    assert.throws(() => save("bookings", booking(room, "2026-10-26T10:00:00Z", "2026-10-26T11:00:00Z")), /действующая комната/);
    assert.throws(() => save("bookings", booking(room, "2026-10-24T10:00:00Z", "2026-10-24T11:00:00Z")), /действующая комната/);
    save("bookings", booking(currentRoom, "2026-10-26T10:00:00Z", "2026-10-26T11:00:00Z"));
  } finally { store.close(); rmSync(folder, { recursive: true, force: true }); }
});
