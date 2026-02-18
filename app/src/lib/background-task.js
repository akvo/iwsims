import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import * as Network from 'expo-network';
import * as Sentry from '@sentry/react-native';
import * as SQLite from 'expo-sqlite';
import api from './api';
import { crudForms, crudDataPoints, crudUsers, crudConfig } from '../database/crud';
import notification from './notification';
import crudJobs from '../database/crud/crud-jobs';
import { UIState } from '../store';
import {
  DATABASE_NAME,
  QUESTION_TYPES,
  SYNC_FORM_SUBMISSION_TASK_NAME,
  SYNC_FORM_VERSION_TASK_NAME,
  SYNC_STATUS,
} from './constants';
import MIME_TYPES from './mime_types';

const BATCH_SIZE = 20;
const UPLOAD_CONCURRENCY = 3;

const syncFormVersion = async (
  db,
  { showNotificationOnly = true, sendPushNotification = () => {} },
) => {
  const { isConnected } = await Network.getNetworkStateAsync();
  if (!isConnected) {
    return;
  }
  try {
    // find last session
    const session = await crudUsers.getActiveUser(db);
    if (!session) {
      return;
    }
    const res = await api.post('/auth', { code: session.password });
    const { data } = res;
    let hasNewForms = false;

    await data.formsUrl.reduce(async (prev, form) => {
      await prev;
      const formExist = await crudForms.selectFormByIdAndVersion(db, { ...form });
      if (formExist) {
        return;
      }
      if (showNotificationOnly) {
        hasNewForms = true;
        return;
      }
      const formRes = await api.get(form.url);
      await crudForms.upsertForm(db, {
        ...form,
        userId: session?.id,
        formJSON: formRes?.data,
      });
    }, Promise.resolve());

    if (hasNewForms && showNotificationOnly) {
      sendPushNotification();
    }
    await db.closeAsync();
  } catch (err) {
    Sentry.captureMessage('[background-task] syncFormVersion failed');
    Sentry.captureException(err);
  }
};

const registerBackgroundTask = async (TASK_NAME, settingsValue = null) => {
  try {
    const db = await SQLite.openDatabaseAsync(DATABASE_NAME, {
      useNewConnection: true,
    });
    const config = await crudConfig.getConfig(db);
    const syncInterval = settingsValue || parseInt(config?.syncInterval, 10) || 3600;
    const res = await BackgroundFetch.registerTaskAsync(TASK_NAME, {
      minimumInterval: syncInterval,
      stopOnTerminate: false, // android only,
      startOnBoot: true, // android only
    });
    await db.closeAsync();
    return res;
  } catch (err) {
    return Promise.reject(err);
  }
};

const unregisterBackgroundTask = async (TASK_NAME) => {
  try {
    const res = await BackgroundFetch.unregisterTaskAsync(TASK_NAME);
    return res;
  } catch (err) {
    return Promise.reject(err);
  }
};

const backgroundTaskStatus = async (TASK_NAME) => {
  await BackgroundFetch.getStatusAsync();
  await TaskManager.isTaskRegisteredAsync(TASK_NAME);
};

const handleOnUploadFiles = async (
  data,
  apiURL = '/images',
  questionTypes = [QUESTION_TYPES.photo],
) => {
  // Extract files from submissions
  const allFiles = data.reduce((files, d) => {
    try {
      const answers = JSON.parse(d.json);
      const questions = JSON.parse(d.json_form)?.question_group?.flatMap((qg) => qg.question) || [];
      const questionFiles = questions.filter((q) => questionTypes.includes(q.type));
      if (!questionFiles.length) return files;

      Object.entries(answers).forEach(([key, value]) => {
        const [questionId] = key.split('-');
        const question = questionFiles.find((q) => `${q.id}` === questionId);
        if (question && value?.startsWith('file://')) {
          files.push({ id: key, value, dataID: d.id });
        }
      });
      return files;
    } catch {
      return files;
    }
  }, []);

  if (!allFiles.length) {
    return { uploadedFiles: [], failedDataIDs: new Set() };
  }

  // Prepare lazy upload functions (not executed yet)
  const uploadFns = allFiles.map((f) => () => {
    const extension = f.value.split('.').pop()?.toLowerCase();
    const fileType = MIME_TYPES[extension] || 'application/octet-stream';
    const formData = new FormData();
    formData.append('file', {
      uri: f.value,
      name: `file_${f.id}_${f.dataID}.${extension}`,
      type: fileType,
    });
    return api.post(apiURL, formData, {
      headers: {
        Accept: 'application/json',
        'Content-Type': 'multipart/form-data',
      },
    });
  });

  // Build chunks for concurrency-limited upload
  const chunks = Array.from({ length: Math.ceil(uploadFns.length / UPLOAD_CONCURRENCY) }, (_, i) =>
    uploadFns.slice(i * UPLOAD_CONCURRENCY, (i + 1) * UPLOAD_CONCURRENCY),
  );

  // Execute chunks sequentially, each chunk runs concurrently
  const results = await chunks.reduce(async (prevResults, chunk) => {
    const prev = await prevResults;
    const chunkResults = await Promise.allSettled(chunk.map((fn) => fn()));
    return prev.concat(chunkResults);
  }, Promise.resolve([]));

  const uploadedFiles = [];
  const failedDataIDs = new Set();
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      uploadedFiles.push({ ...allFiles[i], ...result.value.data });
    } else {
      failedDataIDs.add(allFiles[i].dataID);
    }
  });
  return { uploadedFiles, failedDataIDs };
};

// Recursive batch processor: fetches BATCH_SIZE items, processes them,
// then recurses if more remain. Stops on empty result or failures.
const processBatch = async (db, activeJob, session, counts = { success: 0, failed: 0 }) => {
  const data = await crudDataPoints.selectSubmissionToSync(db, BATCH_SIZE);
  if (!data?.length) {
    return counts;
  }

  // Upload files for THIS BATCH only
  const { uploadedFiles: photos, failedDataIDs: failedPhotos } = await handleOnUploadFiles(
    data,
    '/images',
    [QUESTION_TYPES.photo],
  );
  const { uploadedFiles: attachments, failedDataIDs: failedAttachments } =
    await handleOnUploadFiles(data, '/attachments', [QUESTION_TYPES.attachment]);

  const failedUploadIDs = new Set([...failedPhotos, ...failedAttachments]);

  // Process each datapoint sequentially
  await data.reduce(async (previousPromise, d) => {
    await previousPromise;
    if (d?.syncedAt) {
      return;
    }

    // Skip datapoints with failed file uploads — saveAsPending keeps them
    // in the queue so the existing retry paths (timer / manual / background) pick them up
    if (failedUploadIDs.has(d.id)) {
      counts.failed += 1;
      await crudDataPoints.saveAsPending(db, d.id);
      return;
    }

    try {
      const geoVal = d.geo ? { geo: d.geo.split('|')?.map((x) => parseFloat(x)) } : {};
      const answerValues = JSON.parse(d.json.replace(/''/g, "'"));

      // Add photos and attachments to answers
      [...photos, ...attachments]
        .filter((file) => file?.dataID === d.id)
        .forEach((file) => {
          answerValues[file?.id] = file?.file;
        });

      const syncData = {
        formId: d.formId,
        name: d.name,
        duration: Math.round(d.duration),
        submittedAt: d.submittedAt,
        submitter: session.name,
        answers: answerValues,
        ...geoVal,
      };

      // Handle UUID
      const uuidv4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (uuidv4Regex.test(d?.uuid)) {
        syncData.uuid = d.uuid;
      } else if (uuidv4Regex.test(activeJob?.info)) {
        syncData.uuid = activeJob.info;
      }

      // sync data point
      let syncURL = '/sync';
      if (d?.submitted && d?.draftId) {
        syncURL = `/sync?id=${d.draftId}&is_published=true`;
      }
      if (!d?.submitted) {
        syncURL = d?.draftId ? `/sync?id=${d.draftId}&is_draft=true` : '/sync?is_draft=true';
      }
      const res = await api.post(syncURL, syncData);
      if (res.status === 200) {
        await crudDataPoints.updateDataPoint(db, {
          ...d,
          syncedAt: new Date().toISOString(),
        });
      }
      counts.success += 1;
    } catch (error) {
      counts.failed += 1;
      Sentry.captureException(error);
      await crudDataPoints.saveAsPending(db, d.id);
    }
  }, Promise.resolve());

  // If batch was full and no failures, fetch next batch
  if (data.length >= BATCH_SIZE && counts.failed === 0) {
    return processBatch(db, activeJob, session, counts);
  }
  return counts;
};

const syncFormSubmission = async (db, activeJob = {}) => {
  const { isConnected } = await Network.getNetworkStateAsync();
  if (!isConnected) {
    return BackgroundFetch.BackgroundFetchResult.NoData;
  }
  try {
    const session = await crudUsers.getActiveUser(db);
    api.setToken(session.token);

    const { success: totalSuccess, failed: totalFailed } = await processBatch(
      db,
      activeJob,
      session,
    );

    // Status updates ONCE after all batches
    if (activeJob?.id && totalFailed === 0) {
      await crudJobs.deleteJob(db, activeJob.id);
    }

    if (totalSuccess > 0 && totalFailed === 0) {
      UIState.update((s) => {
        s.isManualSynced = false;
        s.refreshPage = true;
        s.statusBar = {
          type: SYNC_STATUS.success,
          bgColor: '#16a34a',
          icon: 'checkmark-done',
        };
      });
      notification.sendPushNotification(SYNC_FORM_SUBMISSION_TASK_NAME);
    }

    if (totalFailed > 0) {
      UIState.update((s) => {
        s.isManualSynced = false;
        s.statusBar = {
          type: SYNC_STATUS.failed,
          bgColor: '#ec003f',
          icon: 'alert-sharp',
          failedCount: totalFailed,
        };
      });
    }

    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch (error) {
    Sentry.captureMessage(`[background-task] syncFormSubmission failed`);
    Sentry.captureException(error);

    if (activeJob?.id) {
      await crudJobs.deleteJob(db, activeJob.id);
    }

    return Promise.reject(
      new Error(
        `syncFormSubmission failed (${error?.response?.status || 'unknown'}): ${error?.message}`,
      ),
    );
  }
};

const backgroundTaskHandler = () => ({
  syncFormVersion,
  registerBackgroundTask,
  unregisterBackgroundTask,
  backgroundTaskStatus,
  syncFormSubmission,
});

const backgroundTask = backgroundTaskHandler();

export const defineSyncFormVersionTask = () =>
  TaskManager.defineTask(SYNC_FORM_VERSION_TASK_NAME, async () => {
    try {
      await syncFormVersion({
        sendPushNotification: notification.sendPushNotification,
        showNotificationOnly: true,
      });
      return BackgroundFetch.BackgroundFetchResult.NewData;
    } catch (err) {
      Sentry.captureMessage(`[${SYNC_FORM_VERSION_TASK_NAME}] defineSyncFormVersionTask failed`);
      Sentry.captureException(err);
      return BackgroundFetch.Result.Failed;
    }
  });

export const defineSyncFormSubmissionTask = () => {
  TaskManager.defineTask(SYNC_FORM_SUBMISSION_TASK_NAME, async () => {
    try {
      await syncFormSubmission();
      return BackgroundFetch.BackgroundFetchResult.NewData;
    } catch (err) {
      Sentry.captureMessage(
        `[${SYNC_FORM_SUBMISSION_TASK_NAME}] defineSyncFormSubmissionTask failed`,
      );
      Sentry.captureException(err);
      return BackgroundFetch.Result.Failed;
    }
  });
};

export default backgroundTask;
