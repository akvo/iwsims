import sql from '../sql';
import tables from '../tables';

const table = tables.find((t) => t.name === 'datapoint_sync_queue');

const up = (db) => sql.createTable(db, table.name, table.fields);

const down = (db) => sql.dropTable(db, table.name);

export { up, down };
