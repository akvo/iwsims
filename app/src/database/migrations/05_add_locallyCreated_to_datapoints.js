import sql from '../sql';

const tableName = 'datapoints';
const fieldName = 'locallyCreated';
const fieldType = 'TINYINT DEFAULT 0';

const up = async (db) => {
  await sql.addNewColumn(db, tableName, fieldName, fieldType);
  // Back-fill: every row present at migration time is treated as locally created.
  // No server-download tracking existed before this column, so all existing data
  // was either created on-device or indistinguishably mixed. Setting 1 preserves
  // pre-migration submitted/synced counts. Rows inserted after this migration by
  // the server-sync path receive the default 0.
  await db.execAsync(`UPDATE ${tableName} SET ${fieldName} = 1`);
};

// dropColumn uses a DROP TABLE + RENAME pattern with no wrapping transaction.
// A crash between those steps would permanently destroy all datapoints.
// Adding a nullable column with a safe default has no meaningful rollback —
// if the column must be removed, ship a new forward migration instead.
const down = () => {
  throw new Error(
    'Migration 05 is irreversible. To remove locallyCreated, create a new forward migration.',
  );
};

export { up, down };
