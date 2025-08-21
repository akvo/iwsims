import * as Network from 'expo-network';
import * as Sentry from '@sentry/react-native';
import api from './api';
import { crudForms, crudDataPoints, crudUsers } from '../database/crud';
import notification from './notification';
import { UIState } from '../store';
import { QUESTION_TYPES, SYNC_FORM_SUBMISSION_TASK_NAME, SYNC_STATUS } from './constants';
import MIME_TYPES from './mime_types';

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
    api.post('/auth', { code: session.password }).then(async (res) => {
      const { data } = res;
      const promises = data.formsUrl.map(async (form) => {
        const formExist = await crudForms.selectFormByIdAndVersion(db, { ...form });
        if (formExist) {
          return false;
        }
        if (showNotificationOnly) {
          return { id: form.id, version: form.version };
        }
        const formRes = await api.get(form.url);
        // update previous form latest value to 0
        await crudForms.updateForm(db, { ...form });
        const savedForm = await crudForms.addForm(db, {
          ...form,
          userId: session?.id,
          formJSON: formRes?.data,
        });
        return savedForm;
      });
      Promise.all(promises).then((r) => {
        const exist = r.filter((x) => x);
        if (!exist.length || !showNotificationOnly) {
          return;
        }
        sendPushNotification();
      });
      await db.closeAsync();
    });
  } catch (err) {
    Sentry.captureMessage('[background-task] syncFormVersion failed');
    Sentry.captureException(err);
  }
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

  if (!allFiles.length) return [];

  // Prepare file uploads
  const uploads = allFiles.map((f) => {
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

  // Upload all and return merged results
  const results = await Promise.allSettled(uploads);
  const responses = results
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value);
  return responses.map((res, i) => ({ ...allFiles[i], ...res.data }));
};

const syncFormSubmission = async (db, activeJob = {}) => {
  const { isConnected } = await Network.getNetworkStateAsync();
  if (!isConnected) {
    return;
  }
  try {
    // get token
    const session = await crudUsers.getActiveUser(db);
    // set token
    api.setToken(session.token);
    // get all datapoints to sync
    const data = await crudDataPoints.selectSubmissionToSync(db);
    /**
     * Upload all photo of questions first
     */
    const photos = await handleOnUploadFiles(data, '/images', [QUESTION_TYPES.photo]);
    const attachments = await handleOnUploadFiles(data, '/attachments', [
      QUESTION_TYPES.attachment,
    ]);
    const totalData = data.length;
    let success = 0;
    let failed = 0;
    data.forEach(async (d) => {
      if (d?.syncedAt) {
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
        const uuidv4Regex =
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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
          // update data point
          await crudDataPoints.updateDataPoint(db, {
            ...d,
            syncedAt: new Date().toISOString(),
          });
        }
        success += 1;
      } catch (error) {
        failed += 1;
        Sentry.captureException(error);
        // Mark datapoint as not submitted
        await crudDataPoints.saveAsPending(db, d.id);
      }

      if (success === totalData) {
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

      if (failed) {
        UIState.update((s) => {
          s.isManualSynced = false;
          s.statusBar = {
            type: SYNC_STATUS.failed,
            bgColor: '#ec003f',
            icon: 'alert-sharp',
            failedCount: failed,
          };
        });
      }
    });
  } catch (error) {
    Sentry.captureMessage(`[background-task] syncFormSubmission failed`);
    Sentry.captureException(error);
  }
};

const backgroundTaskHandler = () => ({
  syncFormVersion,
  syncFormSubmission,
});

const backgroundTask = backgroundTaskHandler();

export default backgroundTask;
