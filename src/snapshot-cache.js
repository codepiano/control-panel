function createSnapshotCache(load, { ttlMs = 30000, now = Date.now } = {}) {
  let snapshot;
  let checkedAt = 0;
  let revision = 0;
  let snapshotRevision = -1;
  let inFlight = null;

  return {
    async get({ force = false } = {}) {
      if (force) revision += 1;
      for (;;) {
        if (snapshotRevision === revision && snapshot && now() - checkedAt < ttlMs) return snapshot;
        if (!inFlight) {
          const loadRevision = revision;
          inFlight = Promise.resolve().then(load).then((value) => {
            if (revision === loadRevision) {
              snapshot = value;
              checkedAt = now();
              snapshotRevision = loadRevision;
            }
          }).finally(() => { inFlight = null; });
        }
        await inFlight;
        // An operation may invalidate a scan while it is running; only return the new snapshot.
      }
    },
  };
}
module.exports = { createSnapshotCache };
