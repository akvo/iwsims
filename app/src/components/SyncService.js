import { useCallback, useEffect } from 'react';
import * as Network from 'expo-network';
import { useSQLiteContext } from 'expo-sqlite';
import * as Sentry from '@sentry/react-native';
import { BuildParamsState, DatapointSyncState, UIState, UserState } from '../store';
import { backgroundTask } from '../lib';
import crudJobs from '../database/crud/crud-jobs';
import { crudConfig, crudDataPoints, crudForms } from '../database/crud';
import {
  downloadDatapointsJson,
  fetchDatapointsPageByPage,
  fetchDraftDatapointsPageByPage,
} from '../lib/sync-datapoints';
import {
  jobStatus,
  MAX_ATTEMPT,
  SYNC_DATAPOINT_JOB_NAME,
  SYNC_FORM_SUBMISSION_TASK_NAME,
  SYNC_STATUS,
} from '../lib/constants';

/**
 * This sync only works in the foreground service
 */
const SyncService = () => {
  const isOnline = UIState.useState((s) => s.online);
  const isManualSynced = UIState.useState((s) => s.isManualSynced);
  const syncInterval = BuildParamsState.useState((s) => s.dataSyncInterval);
  const syncInSecond = parseInt(syncInterval, 10) * 1000;
  const userId = UserState.useState((s) => s.id);
  const db = useSQLiteContext();

  const onSync = useCallback(async () => {
    const activeJob = await crudJobs.getActiveJob(db, SYNC_FORM_SUBMISSION_TASK_NAME);
    if (!activeJob) {
      return;
    }

    const pendingToSync = await crudDataPoints.selectSubmissionToSync(db, 1);

    // No pending data → clean up the job
    if (!pendingToSync?.length) {
      await crudJobs.deleteJob(db, activeJob.id);
      UIState.update((s) => {
        s.statusBar = {
          type: SYNC_STATUS.success,
          bgColor: '#16a34a',
          icon: 'checkmark-done',
        };
        s.refreshPage = true;
      });
      return;
    }

    // Check network constraints
    const settings = await crudConfig.getConfig(db);
    const { type: networkType } = await Network.getNetworkStateAsync();
    if (settings?.syncWifiOnly && networkType !== Network.NetworkStateType.WIFI) {
      return;
    }

    // Stale job detection: if ON_PROGRESS, it may be stuck (app crashed)
    if (activeJob.status === jobStatus.ON_PROGRESS) {
      if (activeJob.attempt >= MAX_ATTEMPT) {
        await crudJobs.deleteJob(db, activeJob.id);
        UIState.update((s) => {
          s.statusBar = {
            type: SYNC_STATUS.failed,
            bgColor: '#ec003f',
            icon: 'alert',
          };
        });
      } else {
        await crudJobs.updateJob(db, activeJob.id, {
          status: jobStatus.PENDING,
          attempt: activeJob.attempt + 1,
        });
        UIState.update((s) => {
          s.statusBar = {
            type: SYNC_STATUS.re_sync,
            bgColor: '#d97706',
            icon: 'repeat',
          };
        });
      }
      return;
    }

    // PENDING → execute sync
    if (activeJob.status === jobStatus.PENDING && activeJob.attempt < MAX_ATTEMPT) {
      UIState.update((s) => {
        s.statusBar = {
          type: SYNC_STATUS.on_progress,
          bgColor: '#2563eb',
          icon: 'sync',
        };
      });
      await crudJobs.updateJob(db, activeJob.id, {
        status: jobStatus.ON_PROGRESS,
      });
      await backgroundTask.syncFormSubmission(db, activeJob);
    }
  }, [db]);

  useEffect(() => {
    if (!syncInSecond || !isOnline) {
      return;
    }
    const syncTimer = setInterval(() => {
      onSync();
    }, syncInSecond);

    // eslint-disable-next-line consistent-return
    return () => clearInterval(syncTimer);
  }, [syncInSecond, isOnline, isManualSynced, onSync]);

  const onSyncDataPoint = useCallback(async () => {
    const activeJob = await crudJobs.getActiveJob(db, SYNC_DATAPOINT_JOB_NAME);

    DatapointSyncState.update((s) => {
      s.added = false;
      s.inProgress = !!activeJob;
    });

    if (!activeJob || activeJob.status !== jobStatus.PENDING) {
      return;
    }
    if (activeJob.attempt >= MAX_ATTEMPT) {
      await crudJobs.deleteJob(db, activeJob.id);
      DatapointSyncState.update((s) => {
        s.inProgress = false;
        s.progress = 0;
      });
      return;
    }

    await crudJobs.updateJob(db, activeJob.id, {
      status: jobStatus.ON_PROGRESS,
    });

    UIState.update((s) => {
      s.statusBar = {
        type: SYNC_STATUS.on_progress,
        bgColor: '#2563eb',
        icon: 'sync',
      };
    });

    try {
      const formCache = new Map();

      await fetchDatapointsPageByPage(async (pageData, pageNumber, totalPages) => {
        await pageData.reduce(async (previousPromise, item, index) => {
          await previousPromise;
          const {
            url,
            form_id: formId,
            administration_id: administrationId,
            last_updated: lastUpdated,
          } = item;
          try {
            await downloadDatapointsJson(
              db,
              { url, formId, administrationId, lastUpdated },
              activeJob.user,
              formCache,
            );
            // Granular progress: page + item within page
            const pageProgress = ((pageNumber - 1) / totalPages) * 100;
            const itemProgress = ((index + 1) / pageData.length) * (100 / totalPages);
            DatapointSyncState.update((s) => {
              s.progress = pageProgress + itemProgress;
            });
          } catch (error) {
            Sentry.captureMessage(`Error downloading datapoint JSON for URL ${url}`);
            Sentry.captureException(error);
          }
        }, Promise.resolve());
      });

      await crudJobs.deleteJob(db, activeJob.id);

      DatapointSyncState.update((s) => {
        s.inProgress = false;
        s.progress = 0;
      });

      UIState.update((s) => {
        s.refreshPage = true;
        s.statusBar = {
          type: SYNC_STATUS.success,
          bgColor: '#16a34a',
          icon: 'checkmark-done',
        };
      });
    } catch (error) {
      DatapointSyncState.update((s) => {
        s.added = true;
      });
      await crudJobs.updateJob(db, activeJob.id, {
        status: jobStatus.PENDING,
        attempt: activeJob.attempt + 1,
        info: String(error),
      });
    }
  }, [db]);

  const onSyncDraftDatapoint = useCallback(async () => {
    const allDraftSynced = await crudDataPoints.getDraftPendingSync(db);
    if (allDraftSynced?.length || (allDraftSynced?.length === 0 && isManualSynced)) {
      try {
        await crudDataPoints.deleteDraftSynced(db);
        DatapointSyncState.update((s) => {
          s.draftInProgress = true;
        });

        await fetchDraftDatapointsPageByPage(async (pageData) => {
          await pageData.reduce(async (previousPromise, draftData) => {
            await previousPromise;

            const {
              administration: administrationId,
              datapoint_name: name,
              geolocation: geo,
              form: formId,
              id: draftId,
              repeats,
              ...d
            } = draftData;

            const existingDraft = await crudDataPoints.getByDraftId(db, { draftId });

            if (existingDraft && existingDraft?.syncedAt) {
              await crudDataPoints.updateDataPoint(db, {
                ...d,
                id: existingDraft.id,
                name,
                geo,
                repeats: JSON.stringify(repeats),
                submitted: 0,
                syncedAt: new Date().toISOString(),
              });
            } else {
              const form = await crudForms.getByFormId(db, { formId });
              if (!form) {
                return;
              }

              const draftDatapoint = {
                ...d,
                administrationId,
                name,
                geo,
                draftId,
                repeats: JSON.stringify(repeats),
                form: form.id,
                submitted: 0,
                user: userId,
                createdAt: new Date().toISOString(),
                syncedAt: new Date().toISOString(),
              };
              await crudDataPoints.saveDataPoint(db, draftDatapoint);
            }
          }, Promise.resolve());
        });

        await crudDataPoints.deleteDraftIdIsNull(db);

        DatapointSyncState.update((s) => {
          s.draftInProgress = false;
        });

        UIState.update((s) => {
          s.refreshPage = true;
        });
      } catch (error) {
        UIState.update((s) => {
          s.statusBar = {
            type: SYNC_STATUS.failed,
            bgColor: '#ec003f',
            icon: 'alert',
            error: String(error),
          };
        });
      }
    }
  }, [db, userId, isManualSynced]);

  useEffect(() => {
    const unsubsDataSync = DatapointSyncState.subscribe(
      (s) => s.added,
      (added) => {
        if (added) {
          onSyncDataPoint();
          onSyncDraftDatapoint();
        }
      },
    );

    return () => {
      unsubsDataSync();
    };
  }, [onSyncDataPoint, onSyncDraftDatapoint]);

  useEffect(() => {
    if (isManualSynced) {
      onSync();
    }
  }, [isManualSynced, onSync]);

  return null;
};

export default SyncService;
