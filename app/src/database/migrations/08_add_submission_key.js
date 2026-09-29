import sql from '../sql';

const tableName = 'datapoints';

const up = async (db) => {
  // Per-submission idempotency token. Minted on-device at submit time and resent
  // unchanged on every retry, so the backend can recognise a replay.
  //
  // locallyCreated is deliberately NOT touched here. Migration 05 back-filled it
  // onto downloaded rows too; a full datapoint sync repairs those, since every
  // row the server lists is set back to 0 (see downloadDatapointsJson).
  await sql.addNewColumn(db, tableName, 'submissionKey', 'TEXT');
};

const down = () => {
  throw new Error('Migration 08 is irreversible. Create a new forward migration instead.');
};

export { up, down };
