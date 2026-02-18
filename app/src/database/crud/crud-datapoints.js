import sql from '../sql';

const selectDataPointById = async (db, { id }) => {
  const current = await sql.getFirstRow(db, 'datapoints', { id });
  if (!current) {
    return false;
  }
  let jsonVal = JSON.parse(current.json.replace(/''/g, "'"));
  // If json is a string that starts with '{', parse it as JSON
  if (typeof jsonVal === 'string' && jsonVal.startsWith('{')) {
    jsonVal = JSON.parse(jsonVal);
  }
  return {
    ...current,
    json: jsonVal,
  };
};

const dataPointsQuery = () => ({
  selectDataPointById,
  selectDataPointsByFormAndSubmitted: async (db, { form, submitted, user, uuid }) => {
    const uuidVal = uuid ? { uuid } : {};
    const userVal = user ? { user } : {};
    const columns = { form, submitted, ...userVal, ...uuidVal };
    const rows = await sql.getFilteredRows(db, 'datapoints', { ...columns }, 'id', 'DESC', true);
    return rows;
  },
  selectSubmissionToSync: async (db, limit = null) => {
    const rows = await sql.executeQuery(
      db,
      `SELECT
          datapoints.*,
          forms.formId,
          forms.json AS json_form
        FROM datapoints
        JOIN forms ON datapoints.form = forms.id
        WHERE datapoints.syncedAt IS NULL
        ORDER BY datapoints.createdAt ASC
        ${limit ? `LIMIT ${parseInt(limit, 10)}` : ''}`,
    );
    return rows;
  },
  saveDataPoint: async (
    db,
    {
      uuid,
      form,
      user,
      name,
      geo,
      submitted,
      duration,
      json,
      repeats,
      syncedAt,
      administrationId,
      draftId,
      id,
    },
  ) => {
    try {
      const repeatsVal = repeats ? { repeats } : {};
      const submittedAt = submitted ? { submittedAt: new Date().toISOString() } : {};
      const geoVal = geo ? { geo } : {};
      const uuidVal = uuid ? { uuid } : {};
      const syncedAtVal = syncedAt ? { syncedAt } : {};
      const admVal = administrationId ? { administrationId } : {};
      const draftVal = draftId ? { draftId } : {};
      const idVal = id ? { id } : {};

      const dataToInsert = {
        form,
        user,
        name,
        submitted,
        duration: duration || 0,
        createdAt: new Date().toISOString(),
        json: json ? JSON.stringify(json).replace(/'/g, "''") : null,
        ...geoVal,
        ...submittedAt,
        ...repeatsVal,
        ...uuidVal,
        ...syncedAtVal,
        ...admVal,
        ...draftVal,
        ...idVal,
      };

      const res = await sql.insertRow(db, 'datapoints', dataToInsert);
      return res;
    } catch (error) {
      throw new Error(`Error saving datapoint: ${error.message}`);
    }
  },
  updateDataPoint: async (
    db,
    { id, name, geo, submitted, duration, submittedAt, syncedAt, json, repeats },
  ) => {
    try {
      const repeatsVal = repeats ? { repeats } : {};
      const submittedVal = submitted !== undefined ? { submitted } : {};
      const syncedAtVal = syncedAt !== undefined ? { syncedAt } : {};
      const res = await sql.updateRow(
        db,
        'datapoints',
        { id },
        {
          name,
          geo,
          duration,
          syncedAt,
          submittedAt: submitted && !submittedAt ? new Date().toISOString() : submittedAt,
          json: json ? JSON.stringify(json).replace(/'/g, "''") : null,
          ...submittedVal,
          ...repeatsVal,
          ...syncedAtVal,
        },
      );
      return res;
    } catch (error) {
      throw new Error(`Error updating datapoint: ${error.message}`);
    }
  },
  saveAsPending: async (db, id) => {
    const res = await sql.updateRow(
      db,
      'datapoints',
      { id },
      {
        syncedAt: null,
      },
    );
    return res;
  },
  getDraftPendingSync: async (db) => {
    const rows = await sql.safeExecuteQuery(
      db,
      `SELECT * FROM datapoints WHERE submitted = ? AND draftId IS NULL AND syncedAt IS NOT NULL`,
      [0],
      'getDraftPendingSync',
    );
    return rows;
  },
  getByDraftId: async (db, { draftId }) => {
    const res = await sql.getFirstRow(db, 'datapoints', { draftId });
    if (!res) {
      return false;
    }
    return {
      ...res,
      json: res?.json ? JSON.parse(res.json.replace(/''/g, "'")) : null,
    };
  },
  deleteDraftIdIsNull: async (db) => {
    const res = await sql.safeExecuteQuery(
      db,
      'DELETE FROM datapoints WHERE submitted = ? AND draftId IS NULL AND syncedAt IS NOT NULL',
      [0],
      'deleteDraftIdIsNull',
    );
    return res;
  },
  deleteById: async (db, { id }) => {
    const res = await sql.deleteRow(db, 'datapoints', id);
    return res;
  },
  deleteDraftSynced: async (db) => {
    const res = await sql.safeExecuteQuery(
      db,
      'DELETE FROM datapoints WHERE draftId IS NOT NULL AND syncedAt IS NOT NULL',
      [],
      'deleteDraftSynced',
    );
    return res;
  },
  getByUUID: async (db, { uuid, form }) => {
    const formVal = form ? { form } : {};
    const res = await sql.getFirstRow(db, 'datapoints', { uuid, ...formVal });
    return res;
  },
  updateByUUID: async (db, { uuid, form, json, syncedAt, repeats }) => {
    if (!json || typeof json !== 'object') {
      return false;
    }
    const repeatsVal = repeats ? { repeats } : {};
    const formVal = form ? { form } : {};
    const res = await sql.updateRow(
      db,
      'datapoints',
      { uuid, ...formVal },
      {
        json: JSON.stringify(json).replace(/'/g, "''"),
        syncedAt: syncedAt || new Date().toISOString(),
        ...repeatsVal,
      },
    );
    return res;
  },
  totalSavedData: async (db, formDBId, uuid = null) => {
    try {
      if (uuid) {
        const res = await sql.safeGetFirstRow(
          db,
          'SELECT COUNT(*) AS total FROM datapoints WHERE submitted = ? AND form = ? AND uuid = ?',
          [0, formDBId, uuid],
          'totalSavedData with uuid',
        );
        return res?.total || 0;
      }
      const res = await sql.safeGetFirstRow(
        db,
        'SELECT COUNT(*) AS total FROM datapoints WHERE submitted = ? AND form = ?',
        [0, formDBId],
        'totalSavedData without uuid',
      );
      return res?.total || 0;
    } catch (error) {
      throw new Error(`Error in totalSavedData: ${error.message}`);
    }
  },
});

const crudDataPoints = dataPointsQuery();

export default crudDataPoints;
