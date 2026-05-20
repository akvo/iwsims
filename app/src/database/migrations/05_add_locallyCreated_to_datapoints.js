import sql from '../sql';

const tableName = 'datapoints';
const fieldName = 'locallyCreated';
const fieldType = 'TINYINT DEFAULT 0';

const up = (db) => sql.addNewColumn(db, tableName, fieldName, fieldType);

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
