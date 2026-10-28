// In-memory view of your data plus the only functions that change it.
// Every change is saved to the device first, then the sync is scheduled.

import * as db from "./db.js";

const listeners = new Set();
export const live = Object.fromEntries(db.COLLECTIONS.map((name) => [name, new Map()]));
export let revision = 0;

/** Plain arrays of live records: { collection: [records] }. */
export function snapshot() {
    return Object.fromEntries(db.COLLECTIONS.map((name) => [name, [...live[name].values()]]));
}

export const get = (collection, id) => (id ? live[collection].get(id) || null : null);
export const all = (collection) => [...live[collection].values()];

export async function load() {
    const everything = await db.readAll();
    for (const name of db.COLLECTIONS) {
        live[name] = new Map((everything[name] || []).filter((r) => !r.deleted).map((r) => [r.id, r]));
    }
}

/** Call fn() after every local change (used to schedule a sync). */
export function onChange(fn) { listeners.add(fn); }

async function changed() {
    revision += 1;
    await db.setMeta("dirty", true);
    for (const fn of listeners) fn();
}

/**
 * Save several records at once: { collection: [records] }.
 * A record with deleted: true becomes a tombstone (only id + time are kept).
 */
export async function saveMany(changes) {
    const stamp = Date.now();
    const toWrite = {};
    for (const [name, records] of Object.entries(changes)) {
        if (!records?.length) continue;
        toWrite[name] = records.map((record) => (record.deleted
            ? { id: record.id, updatedAt: stamp, deleted: true }
            : { ...record, updatedAt: stamp }));
    }
    if (!Object.keys(toWrite).length) return;
    await db.putRecords(toWrite);
    for (const [name, records] of Object.entries(toWrite)) {
        for (const record of records) {
            if (record.deleted) live[name].delete(record.id);
            else live[name].set(record.id, record);
        }
    }
    await changed();
}

export const save = (collection, record) => saveMany({ [collection]: [record] });
export const remove = (collection, id) => saveMany({ [collection]: [{ id, deleted: true }] });

/** Write records only where newer (imports, starter data); returns count written. */
export async function mergeIn(changes) {
    const written = await db.putIfNewer(changes);
    if (written) {
        await load();
        await changed();
    }
    return written;
}
