import sql from '../sql';

const usersQuery = () => ({
  getAllUsers: async (db) => {
    const rows = await sql.getEachRow(db, 'users');
    return rows;
  },
  getActiveUser: async (db) => {
    try {
      const active = 1;
      const row = await sql.getFirstRow(db, 'users', { active });
      return row;
    } catch (error) {
      return false;
    }
  },
  addNew: async (db, payload) => {
    const params = {
      ...payload,
    };
    const row = await sql.insertRow(db, 'users', params);
    return row;
  },
  toggleActive: async (db, { id, active }) => {
    try {
      const row = await sql.updateRow(db, 'users', { id }, { active: !active });
      return row;
    } catch (error) {
      return false;
    }
  },
  checkPasscode: async (db, passcode) => {
    const row = await sql.getFirstRow(db, 'users', { password: passcode });
    return row;
  },
  updateLastSynced: async (db, id) => {
    const row = await sql.updateRow(
      db,
      'users',
      { id },
      { lastSyncedAt: new Date().toISOString() },
    );
    return row;
  },
});

const crudUsers = usersQuery();

export default crudUsers;
