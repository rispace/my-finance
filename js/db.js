// On-device storage (IndexedDB). Every record looks like:
//   { id, updatedAt (ms since epoch), deleted?: true, ...fields }
// Deleted records are kept as "tombstones" so a delete on one device
// can reach the others through sync.

import { pickNewer } from "./merge.js";

const DB_NAME = "finance-drive";
const DB_VERSION = 2;
// Order doesn't matter. New collections can be added any time: bump
// DB_VERSION and the upgrade below creates the missing stores.
export const COLLECTIONS = [
    "categories", "subcategories", "accounts", "transactions",   // v1
    "budgets",
    "cards", "cardActivity", "limitChanges",
    "loans", "loanPayments",
    "assets", "assetValuations",
    "stocks", "quotes",
    "prefs",                                                     // small settings, e.g. investment cash, Finnhub key
];

let dbPromise = null;

function openDb() {
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = () => {
                const db = request.result;
                for (const name of COLLECTIONS) {
                    if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "id" });
                }
                if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
    return dbPromise;
}

function done(transaction) {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
    });
}

function result(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

/** Every record of every collection, tombstones included: { name: [records] }. */
export async function readAll() {
    const db = await openDb();
    const tx = db.transaction(COLLECTIONS, "readonly");
    const out = {};
    await Promise.all(COLLECTIONS.map(async (name) => {
        out[name] = await result(tx.objectStore(name).getAll());
    }));
    return out;
}

/** Write records: { name: [records] }. */
export async function putRecords(changes) {
    const names = Object.keys(changes).filter((n) => changes[n]?.length);
    if (!names.length) return;
    const db = await openDb();
    const tx = db.transaction(names, "readwrite");
    for (const name of names) {
        const store = tx.objectStore(name);
        for (const record of changes[name]) store.put(record);
    }
    await done(tx);
}

/**
 * Write records only where they are newer than what's stored (same rule as
 * sync). Protects an edit made while a sync or import was in flight.
 * Returns how many records were actually written.
 */
export async function putIfNewer(changes) {
    const names = Object.keys(changes).filter((n) => changes[n]?.length);
    if (!names.length) return 0;
    const db = await openDb();
    const tx = db.transaction(names, "readwrite");
    let written = 0;
    for (const name of names) {
        const store = tx.objectStore(name);
        for (const incoming of changes[name]) {
            const request = store.get(incoming.id);
            request.onsuccess = () => {
                if (pickNewer(request.result, incoming) === incoming && JSON.stringify(request.result) !== JSON.stringify(incoming)) {
                    store.put(incoming);
                    written += 1;
                }
            };
        }
    }
    await done(tx);
    return written;
}

export async function getMeta(key, fallback = null) {
    const db = await openDb();
    const value = await result(db.transaction("meta").objectStore("meta").get(key));
    return value === undefined ? fallback : value;
}

export async function setMeta(key, value) {
    const db = await openDb();
    const tx = db.transaction("meta", "readwrite");
    tx.objectStore("meta").put(value, key);
    await done(tx);
}

/** Forget everything stored on this device (Drive is untouched). */
export async function eraseDevice() {
    const db = await openDb();
    const tx = db.transaction([...COLLECTIONS, "meta"], "readwrite");
    for (const name of [...COLLECTIONS, "meta"]) tx.objectStore(name).clear();
    await done(tx);
}
