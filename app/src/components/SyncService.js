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
  fetchAndGroupDatapointsByForm,
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
  }, [syncInSecond, isOnline, onSync]);

  const onSyncDataPoint = useCallback(async () => {
    const activeJob = await crudJobs.getActiveJob(db, SYNC_DATAPOINT_JOB_NAME);

    DatapointSyncState.update((s) => {
      s.added = false;
      s.inProgress = !!activeJob;
      s.syncingFormId = null;
      s.formProgress = {};
    });

    if (!activeJob || activeJob.status !== jobStatus.PENDING) {
      return;
    }
    if (activeJob.attempt >= MAX_ATTEMPT) {
      await crudJobs.deleteJob(db, activeJob.id);
      DatapointSyncState.update((s) => {
        s.inProgress = false;
        s.progress = 0;
        s.syncingFormId = null;
        s.formProgress = {};
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
      // Phase 1: Fetch all metadata and group by form (lightweight)
      // Update formProgress incrementally as each page arrives
      const { formGroups, totalCount } = await fetchAndGroupDatapointsByForm((currentGroups) => {
        const updatedFormProgress = {};
        currentGroups.forEach((items, formId) => {
          updatedFormProgress[formId] = { total: items.length, processed: 0 };
        });
        DatapointSyncState.update((s) => {
          s.formProgress = updatedFormProgress;
        });
      });

      // Phase 2: Process one form at a time
      let globalProcessed = 0;
      const formEntries = Array.from(formGroups.entries());

      await formEntries.reduce(async (previousFormPromise, [formId, items]) => {
        await previousFormPromise;

        // Signal which form is now syncing
        DatapointSyncState.update((s) => {
          s.syncingFormId = formId;
        });

        // Fresh cache for THIS form only - max 1 entry, released after this form
        const formCache = new Map();

        // Process each datapoint in this form sequentially
        await items.reduce(async (previousItemPromise, item, index) => {
          await previousItemPromise;
          try {
            await downloadDatapointsJson(
              db,
              {
                url: item.url,
                formId: item.formId,
                administrationId: item.administrationId,
                lastUpdated: item.lastUpdated,
              },
              activeJob.user,
              formCache,
            );
          } catch (error) {
            Sentry.captureMessage(`Error downloading datapoint JSON for URL ${item.url}`);
            Sentry.captureException(error);
          }

          // Update per-form and global progress
          globalProcessed += 1;
          DatapointSyncState.update((s) => {
            s.progress = totalCount > 0 ? (globalProcessed / totalCount) * 100 : 0;
            s.formProgress = {
              ...s.formProgress,
              [formId]: {
                ...s.formProgress[formId],
                processed: index + 1,
              },
            };
          });
        }, Promise.resolve());

        // Explicitly clear cache for this form to free memory before next form
        formCache.clear();
      }, Promise.resolve());

      await crudJobs.deleteJob(db, activeJob.id);

      DatapointSyncState.update((s) => {
        s.inProgress = false;
        s.progress = 0;
        s.syncingFormId = null;
        s.formProgress = {};
      });
    } catch (error) {
      DatapointSyncState.update((s) => {
        s.added = true;
        s.syncingFormId = null;
        s.formProgress = {};
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

  const runSyncSequence = useCallback(async () => {
    // Prevent premature success statusBar from syncFormSubmission
    DatapointSyncState.update((s) => {
      s.inProgress = true;
    });

    // Phase 1: Upload submitted datapoints
    UIState.update((s) => {
      s.statusBar = {
        type: SYNC_STATUS.on_progress,
        bgColor: '#2563eb',
        icon: 'cloud-upload',
        syncPhase: 'uploading',
      };
    });
    try {
      await onSync();
    } catch (error) {
      Sentry.captureException(error);
    }

    // Phase 2: Sync draft datapoints
    UIState.update((s) => {
      s.statusBar = {
        type: SYNC_STATUS.on_progress,
        bgColor: '#2563eb',
        icon: 'cloud-upload',
        syncPhase: 'syncing_drafts',
      };
    });
    try {
      await onSyncDraftDatapoint();
    } catch (error) {
      Sentry.captureException(error);
    }

    // Phase 3: Download all datapoints from server
    UIState.update((s) => {
      s.statusBar = {
        type: SYNC_STATUS.on_progress,
        bgColor: '#2563eb',
        icon: 'cloud-download',
        syncPhase: 'downloading',
      };
    });
    try {
      await onSyncDataPoint();
    } catch (error) {
      Sentry.captureException(error);
    }

    // All phases complete
    UIState.update((s) => {
      s.isManualSynced = false;
      s.refreshPage = true;
      s.statusBar = {
        type: SYNC_STATUS.success,
        bgColor: '#16a34a',
        icon: 'checkmark-done',
      };
    });
  }, [onSync, onSyncDraftDatapoint, onSyncDataPoint]);

  useEffect(() => {
    const unsubsDataSync = DatapointSyncState.subscribe(
      (s) => s.added,
      (added) => {
        if (added) {
          runSyncSequence();
        }
      },
    );

    return () => {
      unsubsDataSync();
    };
  }, [runSyncSequence]);

  return null;
};

export default SyncService;
