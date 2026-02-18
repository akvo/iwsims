import sql from '../sql';

const tableName = 'datapoint_sync_queue';

const syncQueueQuery = () => ({
  hasIncomplete: async (db) => {
    const res = await sql.safeGetFirstRow(
      db,
      `SELECT COUNT(*) AS total FROM ${tableName} WHERE lastPage < totalPage`,
      [],
      'hasIncomplete',
    );
    return (res?.total || 0) > 0;
  },
  hasEntries: async (db) => {
    const res = await sql.safeGetFirstRow(
      db,
      `SELECT COUNT(*) AS total FROM ${tableName}`,
      [],
      'hasEntries',
    );
    return (res?.total || 0) > 0;
  },
  getIncompleteForms: async (db) => {
    const rows = await sql.safeExecuteQuery(
      db,
      `SELECT * FROM ${tableName} WHERE lastPage < totalPage`,
      [],
      'getIncompleteForms',
    );
    return rows;
  },
  getAllProgress: async (db) => {
    const rows = await sql.safeExecuteQuery(db, `SELECT * FROM ${tableName}`, [], 'getAllProgress');
    const result = {};
    rows.forEach((r) => {
      result[r.formId] = {
        total: r.totalData,
        processed: r.lastPage * 20,
      };
    });
    return result;
  },
  upsertQueue: async (db, formEntries) => {
    if (!formEntries || formEntries.length === 0) {
      return;
    }
    await formEntries.reduce(async (prev, entry) => {
      await prev;
      const existing = await sql.safeGetFirstRow(
        db,
        `SELECT * FROM ${tableName} WHERE formId = ?`,
        [entry.formId],
        'upsertQueue-check',
      );
      if (existing) {
        if (existing.totalData !== entry.totalData) {
          // Data changed — reset progress for this form
          await sql.updateRow(
            db,
            tableName,
            { formId: entry.formId },
            {
              lastPage: 0,
              totalPage: entry.totalPage,
              totalData: entry.totalData,
            },
          );
        }
        // If totalData matches, leave as-is (completed — will be skipped)
      } else {
        // New form — insert
        await sql.insertRow(db, tableName, {
          formId: entry.formId,
          lastPage: 0,
          totalPage: entry.totalPage,
          totalData: entry.totalData,
        });
      }
    }, Promise.resolve());
  },
  updateLastPage: async (db, formId, lastPage) => {
    await sql.updateRow(db, tableName, { formId }, { lastPage });
  },
});

const crudSyncQueue = syncQueueQuery();

export default crudSyncQueue;
