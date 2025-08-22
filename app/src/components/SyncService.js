import { useCallback, useEffect } from 'react';
import * as Network from 'expo-network';
import { useSQLiteContext } from 'expo-sqlite';
import * as Sentry from '@sentry/react-native';
import Storage from 'expo-sqlite/kv-store';
import { BuildParamsState, DatapointSyncState, UIState, UserState } from '../store';
import { backgroundTask } from '../lib';
import { crudDataPoints, crudForms } from '../database/crud';
import {
  downloadDatapointsJson,
  fetchDatapoints,
  fetchDraftDatapoints,
} from '../lib/sync-datapoints';
import { SYNC_STATUS } from '../lib/constants';
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
    const statement = await db.prepareAsync(
      `SELECT
          datapoints.*,
          forms.formId,
          forms.json AS json_form
        FROM datapoints
        JOIN forms ON datapoints.form = forms.id
        WHERE datapoints.syncedAt IS NULL
        ORDER BY datapoints.createdAt ASC`,
    );
    try {
      const result = await statement.executeAsync();
      const pendingToSync = await result.getAllAsync();
      const syncWifiOnly = (await Storage.getItem('syncWifiOnly')) === '1';
      if (pendingToSync?.length === 0) {
        return;
      }

      const { type: networkType } = await Network.getNetworkStateAsync();
      if (syncWifiOnly && networkType !== Network.NetworkStateType.WIFI) {
        return;
      }

      await backgroundTask.syncFormSubmission(db, pendingToSync);
    } catch (error) {
      Sentry.captureException(error, {
        extra: { message: 'Error fetching unsynced datapoints', error },
      });
    } finally {
      await statement.finalizeAsync();
    }
  }, [db]);

  useEffect(() => {
    if (!syncInSecond || !isOnline) {
      return;
    }
    const syncTimer = setInterval(() => {
      // Perform sync operation
      onSync();
    }, syncInSecond);

    // eslint-disable-next-line consistent-return
    return () =>
      // Clear the interval when the component unmounts
      clearInterval(syncTimer);
  }, [syncInSecond, isOnline, isManualSynced, onSync]);

  const onSyncDataPoint = useCallback(async () => {
    DatapointSyncState.update((s) => {
      s.added = false;
      s.inProgress = true;
    });

    try {
      const monitoringRes = await fetchDatapoints();
      const apiURLs = monitoringRes.map(
        ({
          url,
          form_id: formId,
          administration_id: administrationId,
          last_updated: lastUpdated,
        }) => ({
          url,
          formId,
          administrationId,
          lastUpdated,
        }),
      );

      // Process all datapoints sequentially without transaction wrapper
      // Individual datapoint operations will handle their own transactions
      const processDatapointSequentially = async (urls) => {
        // Process URLs sequentially using reduce to avoid for...of loop
        await urls.reduce(async (previousPromise, urlData, index) => {
          await previousPromise;
          try {
            await downloadDatapointsJson(db, urlData, userId);
            // Update progress
            DatapointSyncState.update((s) => {
              s.progress = ((index + 1) / urls.length) * 100;
            });
          } catch (error) {
            // Continue processing other datapoints even if one fails
            Sentry.captureMessage(`Error downloading datapoint JSON for URL ${urlData.url}`);
            Sentry.captureException(error);
          }
        }, Promise.resolve());
      };

      await processDatapointSequentially(apiURLs);

      DatapointSyncState.update((s) => {
        s.inProgress = false;
      });

      UIState.update((s) => {
        s.refreshPage = true;
      });
    } catch (error) {
      DatapointSyncState.update((s) => {
        s.added = true;
      });
      DatapointSyncState.update((s) => {
        s.inProgress = false;
      });
    }
  }, [db, userId]);

  const onSyncDraftDatapoint = useCallback(async () => {
    const statement = await db.prepareAsync(
      `SELECT * FROM datapoints WHERE submitted = 0 AND draftId IS NULL AND syncedAt IS NOT NULL`,
    );
    try {
      const result = await statement.executeAsync();
      const allDraftSynced = await result.getAllAsync();
      await result.resetAsync();
      if (allDraftSynced?.length || (allDraftSynced?.length === 0 && isManualSynced)) {
        try {
          await crudDataPoints.deleteDraftSynced(db);
          DatapointSyncState.update((s) => {
            s.draftInProgress = true;
          });

          const draftRes = await fetchDraftDatapoints();
          // Process draft datapoints sequentially without transaction wrapper
          // Individual operations will handle their own database safety
          await draftRes.reduce(async (previousPromise, draftData) => {
            await previousPromise;
            // Add a small delay to prevent overwhelming the database connection
            await new Promise((resolve) => {
              setTimeout(resolve, 1000);
            });

            const {
              administration: administrationId,
              datapoint_name: name,
              geolocation: geo,
              form: formId,
              id: draftId,
              repeats,
              ...d
            } = draftData;

            // Check if draft already exists by draftId
            const existingDraft = await crudDataPoints.getByDraftId(db, { draftId });

            if (existingDraft && existingDraft?.syncedAt) {
              // If the draft already exists, update it
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
              // Get the form for this draft
              const form = await crudForms.getByFormId(db, { formId });
              if (!form) {
                return; // Skip if form not found
              }

              // Create new draft datapoint without specifying id to avoid conflicts
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

          // Delete all records with draftId = NULL and syncedAt NOT NULL to prevent duplication
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
    } catch (error) {
      Sentry.captureException(error, {
        extra: { message: 'Error fetching draft datapoints', error },
      });
    } finally {
      await statement.finalizeAsync();
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
      // If manual sync is triggered, run the sync immediately
      onSync();
    }
  }, [isManualSynced, onSync]);

  return null; // This is a service component, no rendering is needed
};

export default SyncService;
