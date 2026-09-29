import {
  createPageProgressSaver,
  downloadDatapointsJson,
  finishDatapointSync,
  getIncompleteSyncStatus,
  removeDeletedDatapoints,
} from '../sync-datapoints';
import { crudDataPoints, crudForms, crudSyncQueue } from '../../database/crud';
import sql from '../../database/sql';
import api from '../api';

jest.mock('../../database/crud', () => ({
  crudDataPoints: {
    getByUUID: jest.fn(),
    updateByUUID: jest.fn(),
    saveDataPoint: jest.fn(),
    deleteSyncedByUUIDs: jest.fn(),
  },
  crudForms: { getByFormId: jest.fn(), selectLatestFormVersion: jest.fn() },
  crudSyncQueue: {
    getAllProgress: jest.fn(),
    getFormsProgress: jest.fn(),
    clearQueue: jest.fn(),
    updateLastPage: jest.fn(),
  },
}));
jest.mock('../../database/sql', () => ({
  updateRow: jest.fn(),
  withTransaction: jest.fn((db, fn) => fn(db)),
}));
jest.mock('../api', () => ({ get: jest.fn(), post: jest.fn() }));

const db = {};
const item = {
  formId: 111,
  administrationId: 5,
  url: 'https://x/datapoints/abc-uuid.json',
  lastUpdated: '2026-09-20T00:00:00Z',
};

describe('downloadDatapointsJson marks served rows as downloaded', () => {
  beforeEach(() => {
    crudForms.getByFormId.mockResolvedValue({ id: 7, json: '{"question_group":[]}' });
  });

  test('unchanged row with locallyCreated = 1 is flipped to 0 without a download', async () => {
    crudDataPoints.getByUUID.mockResolvedValue({
      id: 42,
      syncedAt: '2026-09-21T00:00:00Z',
      locallyCreated: 1,
    });
    await downloadDatapointsJson(db, item, 1);
    expect(sql.updateRow).toHaveBeenCalledWith(db, 'datapoints', { id: 42 }, { locallyCreated: 0 });
    expect(api.get).not.toHaveBeenCalled();
  });

  test('unchanged row already downloaded is left alone', async () => {
    crudDataPoints.getByUUID.mockResolvedValue({
      id: 42,
      syncedAt: '2026-09-21T00:00:00Z',
      locallyCreated: 0,
    });
    await downloadDatapointsJson(db, item, 1);
    expect(sql.updateRow).not.toHaveBeenCalled();
    expect(api.get).not.toHaveBeenCalled();
  });

  test('row with unsent local changes is never touched', async () => {
    crudDataPoints.getByUUID.mockResolvedValue({ id: 42, syncedAt: null, locallyCreated: 1 });
    await downloadDatapointsJson(db, item, 1);
    expect(sql.updateRow).not.toHaveBeenCalled();
    expect(crudDataPoints.updateByUUID).not.toHaveBeenCalled();
    expect(api.get).not.toHaveBeenCalled();
  });

  test('changed row is re-downloaded through updateByUUID', async () => {
    crudDataPoints.getByUUID.mockResolvedValue({
      id: 42,
      syncedAt: '2026-09-01T00:00:00Z',
      locallyCreated: 1,
    });
    api.get.mockResolvedValue({ status: 200, data: { answers: { 1: 'a' } } });
    await downloadDatapointsJson(db, item, 1);
    expect(crudDataPoints.updateByUUID).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ uuid: 'abc-uuid', form: 7, syncedAt: item.lastUpdated }),
    );
  });

  test('new row is inserted with the default origin (downloaded)', async () => {
    crudDataPoints.getByUUID.mockResolvedValue(null);
    api.get.mockResolvedValue({ status: 200, data: { datapoint_name: 'DP', answers: {} } });
    await downloadDatapointsJson(db, item, 1);
    expect(crudDataPoints.saveDataPoint).toHaveBeenCalledTimes(1);
    expect(crudDataPoints.saveDataPoint.mock.calls[0][1]).not.toHaveProperty('locallyCreated');
  });
});

describe('removeDeletedDatapoints', () => {
  test('deletes the returned uuids from the local form', async () => {
    api.get.mockResolvedValue({ data: { uuids: ['u1', 'u2'] } });
    crudForms.getByFormId.mockResolvedValue({ id: 7 });
    await removeDeletedDatapoints(db, 111);
    expect(api.get).toHaveBeenCalledWith('/deleted-datapoints?form_id=111');
    expect(crudDataPoints.deleteSyncedByUUIDs).toHaveBeenCalledWith(db, {
      form: 7,
      uuids: ['u1', 'u2'],
    });
  });

  test('does nothing when the server reports no deletions', async () => {
    api.get.mockResolvedValue({ data: { uuids: [] } });
    await removeDeletedDatapoints(db, 111);
    expect(crudDataPoints.deleteSyncedByUUIDs).not.toHaveBeenCalled();
  });

  test('rethrows a failed request so the sync is not marked complete', async () => {
    api.get.mockRejectedValue(new Error('404'));
    await expect(removeDeletedDatapoints(db, 111)).rejects.toThrow('404');
    expect(crudDataPoints.deleteSyncedByUUIDs).not.toHaveBeenCalled();
  });
});

describe('finishDatapointSync', () => {
  beforeEach(() => {
    crudSyncQueue.getAllProgress.mockResolvedValue({ 111: {}, 222: {} });
    crudForms.getByFormId.mockResolvedValue({ id: 7 });
  });

  test('removes deletions for every queued form, then completes and clears the queue', async () => {
    api.get.mockResolvedValue({ data: { uuids: ['u1'] } });
    const order = [];
    crudDataPoints.deleteSyncedByUUIDs.mockImplementation(() => order.push('delete'));
    api.post.mockImplementation(() => order.push('complete'));
    crudSyncQueue.clearQueue.mockImplementation(() => order.push('clear'));

    await finishDatapointSync(db);

    expect(api.get).toHaveBeenCalledWith('/deleted-datapoints?form_id=111');
    expect(api.get).toHaveBeenCalledWith('/deleted-datapoints?form_id=222');
    expect(api.post).toHaveBeenCalledWith('/sync-complete');
    expect(order).toEqual(['delete', 'delete', 'complete', 'clear']);
  });

  test('a failed deletion keeps last_synced_at and the queue', async () => {
    api.get.mockRejectedValue(new Error('offline'));
    await expect(finishDatapointSync(db)).rejects.toThrow('offline');
    expect(api.post).not.toHaveBeenCalled();
    expect(crudSyncQueue.clearQueue).not.toHaveBeenCalled();
  });
});

describe('getIncompleteSyncStatus', () => {
  test('null when the queue is empty', async () => {
    crudSyncQueue.getFormsProgress.mockResolvedValue({ queued: 0, done: 0 });
    expect(await getIncompleteSyncStatus(db, 1)).toBeNull();
    expect(crudForms.selectLatestFormVersion).not.toHaveBeenCalled();
  });

  test('done forms out of the user registration forms', async () => {
    crudSyncQueue.getFormsProgress.mockResolvedValue({ queued: 3, done: 2 });
    crudForms.selectLatestFormVersion.mockResolvedValue([{}, {}, {}, {}, {}]);
    expect(await getIncompleteSyncStatus(db, 1)).toEqual(
      expect.objectContaining({ type: 5, done: 2, total: 5 }),
    );
    expect(crudForms.selectLatestFormVersion).toHaveBeenCalledWith(db, { user: 1 });
  });
});

describe('createPageProgressSaver', () => {
  test('advances lastPage while every page succeeds', async () => {
    const save = createPageProgressSaver(db, 111);
    await save(1, false);
    await save(2, false);
    expect(crudSyncQueue.updateLastPage.mock.calls).toEqual([
      [db, 111, 1],
      [db, 111, 2],
    ]);
  });

  test('a later good page does not skip over a failed one', async () => {
    const save = createPageProgressSaver(db, 111);
    await save(1, false);
    await save(2, true);
    await save(3, false);
    // Stays at 1, so the form remains incomplete and resumes at page 2
    expect(crudSyncQueue.updateLastPage.mock.calls).toEqual([[db, 111, 1]]);
  });
});
