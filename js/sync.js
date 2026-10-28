// One sync round: pull the Drive copy, merge record by record, save what's
// new on this device, and push the merged copy back if Drive is behind.

import * as db from "./db.js";
import * as drive from "./drive.js";
import { mergeData } from "./merge.js";

const FORMAT = "finance-drive-sync";
const MAX_ATTEMPTS = 3;

function payloadFor(data) {
    return { format: FORMAT, version: 1, savedAt: new Date().toISOString(), data };
}

/**
 * Returns { pulled: number of records changed on this device, pushed: boolean }.
 * Throws drive.AuthError when the token has expired.
 */
export async function syncNow(token) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        let file = null;
        const cachedId = await db.getMeta("driveFileId");
        if (cachedId) {
            try {
                file = { id: cachedId, version: await drive.getVersion(token, cachedId) };
            } catch (error) {
                if (!(error instanceof drive.NotFoundError)) throw error;
                await db.setMeta("driveFileId", null); // removed from Drive: look again
            }
        }
        if (!file) file = await drive.findFile(token);

        let remote = {};
        if (file) {
            const payload = await drive.download(token, file.id);
            if (payload.format && payload.format !== FORMAT) {
                throw new Error("The file in Drive isn't from this app.");
            }
            remote = payload.data || {};
        }

        const local = await db.readAll();
        const { merged, localChanges, remoteChanged } = mergeData(local, remote, db.COLLECTIONS);
        const pulled = await db.putIfNewer(localChanges);
        // Keep collections this version doesn't know about (from a newer
        // version on another device) instead of dropping them from Drive.
        const extras = Object.fromEntries(Object.entries(remote).filter(([name]) => !db.COLLECTIONS.includes(name)));
        const upload = { ...extras, ...merged };

        if (file && !remoteChanged) {
            await db.setMeta("driveFileId", file.id);
            return { pulled, pushed: false };
        }

        if (file) {
            // Another device saved while we were merging? Start over with its copy.
            const latest = await drive.getVersion(token, file.id);
            if (latest !== file.version) continue;
            await drive.update(token, file.id, payloadFor(upload));
            await db.setMeta("driveFileId", file.id);
        } else {
            const created = await drive.create(token, payloadFor(upload));
            await db.setMeta("driveFileId", created.id);
        }
        return { pulled, pushed: true };
    }
    throw new Error("Another device kept saving at the same time. Try again in a moment.");
}
