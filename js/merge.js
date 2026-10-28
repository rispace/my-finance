// Record-level merge used by sync. Pure functions, no browser APIs, so it can
// be unit-tested in Node.
//
// Rule: for each record id, the copy with the later `updatedAt` wins.
// On an exact tie, a deletion wins; otherwise the copies are compared as JSON
// so every device picks the same one.

export function pickNewer(a, b) {
    if (!a) return b;
    if (!b) return a;
    if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
    if (!!a.deleted !== !!b.deleted) return a.deleted ? a : b;
    return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}

function same(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * local, remote: { collection: [records] }
 * Returns {
 *   merged:        { collection: [records] },
 *   localChanges:  { collection: [records] }  — what this device must save,
 *   remoteChanged: boolean                    — whether Drive needs a new copy,
 * }
 */
export function mergeData(local, remote, collections) {
    const merged = {};
    const localChanges = {};
    let remoteChanged = false;

    for (const name of collections) {
        const localById = new Map((local[name] || []).map((r) => [r.id, r]));
        const remoteById = new Map((remote[name] || []).map((r) => [r.id, r]));
        const ids = new Set([...localById.keys(), ...remoteById.keys()]);
        merged[name] = [];
        localChanges[name] = [];
        for (const id of ids) {
            const mine = localById.get(id);
            const theirs = remoteById.get(id);
            const winner = pickNewer(mine, theirs);
            merged[name].push(winner);
            if (!mine || !same(mine, winner)) localChanges[name].push(winner);
            if (!theirs || !same(theirs, winner)) remoteChanged = true;
        }
        merged[name].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    }
    return { merged, localChanges, remoteChanged };
}
