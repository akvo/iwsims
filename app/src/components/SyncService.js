import { useCallback, useEffect, useRef } from 'react';
import * as Network from 'expo-network';
import { useSQLiteContext } from 'expo-sqlite';
import * as Sentry from '@sentry/react-native';
import { BuildParamsState, DatapointSyncState, UIState, UserState } from '../store';
import { backgroundTask } from '../lib';
import crudJobs from '../database/crud/crud-jobs';
import { crudConfig, crudDataPoints, crudForms, crudSyncQueue } from '../database/crud';
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
  const syncLockRef = useRef(false);

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
    const SYNC_PAGE_SIZE = 20;
    const activeJob = await crudJobs.getActiveJob(db, SYNC_DATAPOINT_JOB_NAME);

    DatapointSyncState.update((s) => {
      s.added = false;
      s.inProgress = !!activeJob;
      s.syncingFormId = null;
      s.formProgress = {};
    });

    if (!activeJob) {
      return;
    }

    // Stale job detection: if ON_PROGRESS, it may be stuck (app was killed mid-sync)
    if (activeJob.status === jobStatus.ON_PROGRESS) {
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
      // Reset to PENDING so the queue can resume
      await crudJobs.updateJob(db, activeJob.id, {
        status: jobStatus.PENDING,
        attempt: activeJob.attempt + 1,
      });
    }

    if (activeJob.status !== jobStatus.PENDING && activeJob.status !== jobStatus.ON_PROGRESS) {
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
      // Quick check: if queue has completed entries and all local counts match, skip
      const hasEntries = await crudSyncQueue.hasEntries(db);
      const hasIncomplete = hasEntries ? await crudSyncQueue.hasIncomplete(db) : false;

      if (hasEntries && !hasIncomplete) {
        const queueForms = await crudSyncQueue.getAllProgress(db);
        const formIds = Object.keys(queueForms);
        let hasNewData = false;

        await formIds.reduce(async (prev, fId) => {
          await prev;
          const localCount = await crudDataPoints.countSyncedByFormId(db, Number(fId));
          if (localCount < queueForms[fId].total) {
            hasNewData = true;
          }
        }, Promise.resolve());

        if (!hasNewData) {
          await crudJobs.deleteJob(db, activeJob.id);
          DatapointSyncState.update((s) => {
            s.inProgress = false;
            s.progress = 0;
            s.syncingFormId = null;
            s.formProgress = {};
          });
          return;
        }
      }

      // Fetch metadata and upsert queue (handles fresh, resume, and re-check)
      const result = await fetchAndGroupDatapointsByForm((currentGroups) => {
        const updatedFormProgress = {};
        currentGroups.forEach((items, formId) => {
          updatedFormProgress[formId] = { total: items.length, processed: 0 };
        });
        DatapointSyncState.update((s) => {
          s.formProgress = updatedFormProgress;
        });
      });
      const { formGroups } = result;

      const formEntries = [];
      formGroups.forEach((items, formId) => {
        formEntries.push({
          formId,
          totalPage: Math.ceil(items.length / SYNC_PAGE_SIZE),
          totalData: items.length,
        });
      });
      await crudSyncQueue.upsertQueue(db, formEntries);

      // Build formProgress from queue
      const allProgress = await crudSyncQueue.getAllProgress(db);
      DatapointSyncState.update((s) => {
        s.formProgress = allProgress;
      });

      // Calculate global totals
      let totalCount = 0;
      let globalProcessed = 0;
      Object.keys(allProgress).forEach((fId) => {
        totalCount += allProgress[fId].total;
        globalProcessed += allProgress[fId].processed;
      });

      // Process incomplete forms
      const incompleteForms = await crudSyncQueue.getIncompleteForms(db);

      await incompleteForms.reduce(async (previousFormPromise, queueRow) => {
        await previousFormPromise;
        const { formId } = queueRow;
        const items = formGroups.get(formId) || [];

        // Skip forms already fully synced locally
        const localSyncedCount = await crudDataPoints.countSyncedByFormId(db, formId);
        if (localSyncedCount >= queueRow.totalData) {
          await crudSyncQueue.updateLastPage(db, formId, queueRow.totalPage);
          DatapointSyncState.update((s) => {
            if (!s.formProgress[formId]) {
              s.formProgress[formId] = { total: queueRow.totalData, processed: 0 };
            }
            s.formProgress[formId].processed = queueRow.totalData;
          });
          globalProcessed += queueRow.totalData;
          return;
        }

        // Signal which form is now syncing
        DatapointSyncState.update((s) => {
          s.syncingFormId = formId;
        });

        // Fresh cache for THIS form only
        const formCache = new Map();

        // Skip completed pages, process remaining
        const startIndex = queueRow.lastPage * SYNC_PAGE_SIZE;
        let currentPage = queueRow.lastPage;

        // Process items page by page
        const remainingItems = items.slice(startIndex);
        let itemsOnPage = 0;

        await remainingItems.reduce(async (previousItemPromise, item) => {
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

          itemsOnPage += 1;
          globalProcessed += 1;

          // Page boundary: update lastPage in DB
          if (itemsOnPage >= SYNC_PAGE_SIZE) {
            currentPage += 1;
            await crudSyncQueue.updateLastPage(db, formId, currentPage);
            itemsOnPage = 0;
          }

          // Update progress (mutate draft in-place to avoid GC pressure)
          DatapointSyncState.update((s) => {
            s.progress = totalCount > 0 ? (globalProcessed / totalCount) * 100 : 0;
            if (!s.formProgress[formId]) {
              s.formProgress[formId] = { total: items.length, processed: 0 };
            }
            s.formProgress[formId].processed =
              startIndex + itemsOnPage + (currentPage - queueRow.lastPage) * SYNC_PAGE_SIZE;
          });
        }, Promise.resolve());

        // Mark final partial page as complete
        if (itemsOnPage > 0) {
          await crudSyncQueue.updateLastPage(db, formId, queueRow.totalPage);
        }

        // Clear cache for this form to free memory
        formCache.clear();

        // Refresh Home page counts (submitted/synced/draft) after each form completes
        UIState.update((s) => {
          s.refreshPage = true;
        });
      }, Promise.resolve());

      // Done — keep queue for next re-check, delete job
      await crudJobs.deleteJob(db, activeJob.id);

      DatapointSyncState.update((s) => {
        s.inProgress = false;
        s.progress = 0;
        s.syncingFormId = null;
        s.formProgress = {};
      });
    } catch (error) {
      // Queue persists for resume on next sync attempt
      DatapointSyncState.update((s) => {
        s.inProgress = false;
        s.progress = 0;
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
    if (syncLockRef.current) {
      return;
    }
    syncLockRef.current = true;

    try {
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
    } finally {
      syncLockRef.current = false;
    }
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
