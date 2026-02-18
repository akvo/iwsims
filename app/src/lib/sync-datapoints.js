import { crudDataPoints, crudForms } from '../database/crud';
import sql from '../database/sql';
import api from './api';

/**
 * Iteratively fetches datapoints page by page, calling the processor callback
 * for each page's data before fetching the next page.
 * Uses page_size=100 (backend max) to reduce HTTP round-trips.
 *
 * @param {Function} onPageReceived - async callback(pageData, pageNumber, totalPages)
 * @param {number} pageSize - page size to request (default 100, backend max)
 * @returns {Promise<{totalProcessed: number}>}
 */
export const fetchDatapointsPageByPage = async (onPageReceived, pageSize = 100) => {
  let totalProcessed = 0;

  // Async recursion is stack-safe: each `await` unwinds the call frame,
  // so recursion depth equals 1 regardless of page count.
  // At page_size=100, 10,000 datapoints = 100 pages.
  const fetchPage = async (currentPage, totalPages) => {
    if (currentPage > totalPages) {
      return;
    }
    const { data: apiData } = await api.get(
      `/datapoint-list?page=${currentPage}&page_size=${pageSize}`,
    );
    const { data, total_page: totalPage, current: page } = apiData;

    await onPageReceived(data, page, totalPage);
    totalProcessed += data.length;
    await fetchPage(page + 1, totalPage);
  };

  await fetchPage(1, 1);
  return { totalProcessed };
};

/**
 * Iteratively fetches draft datapoints page by page.
 *
 * @param {Function} onPageReceived - async callback(pageData, pageNumber, totalPages)
 * @param {number} pageSize - page size to request (default 100, backend max)
 * @returns {Promise<{totalProcessed: number}>}
 */
export const fetchDraftDatapointsPageByPage = async (onPageReceived, pageSize = 100) => {
  let totalProcessed = 0;

  // Async recursion is stack-safe: each `await` unwinds the call frame,
  // so recursion depth equals 1 regardless of page count.
  // At page_size=100, 10,000 datapoints = 100 pages.
  const fetchPage = async (currentPage, totalPages) => {
    if (currentPage > totalPages) {
      return;
    }
    const { data: apiData } = await api.get(
      `/draft-list?page=${currentPage}&page_size=${pageSize}`,
    );
    const { data, total_page: totalPage, current: page } = apiData;

    await onPageReceived(data, page, totalPage);
    totalProcessed += data.length;
    await fetchPage(page + 1, totalPage);
  };

  await fetchPage(1, 1);
  return { totalProcessed };
};

/**
 * Fetches ALL datapoint metadata page-by-page and groups by form_id.
 * Only lightweight metadata is stored (~100 bytes/item), not the heavy JSON payloads.
 * This enables per-form processing: download one form's data at a time to reduce
 * peak memory usage.
 *
 * @param {Function|null} onPageReceived - optional callback(formGroups, totalCount)
 *   called after each page so the UI can show incremental progress during metadata collection
 * @param {number} pageSize - page size to request (default 20)
 * @returns {Promise<{ formGroups: Map<number, Array>, totalCount: number }>}
 */
export const fetchAndGroupDatapointsByForm = async (onPageReceived = null, pageSize = 20) => {
  const formGroups = new Map();
  let totalCount = 0;

  const fetchPage = async (currentPage, totalPages) => {
    if (currentPage > totalPages) {
      return;
    }
    const { data: apiData } = await api.get(
      `/datapoint-list?page=${currentPage}&page_size=${pageSize}`,
    );
    const { data, total_page: totalPage, current: page } = apiData;

    data.forEach((item) => {
      const { form_id: formId } = item;
      if (!formGroups.has(formId)) {
        formGroups.set(formId, []);
      }
      formGroups.get(formId).push({
        url: item.url,
        formId,
        administrationId: item.administration_id,
        lastUpdated: item.last_updated,
      });
    });
    totalCount += data.length;

    if (onPageReceived) {
      await onPageReceived(formGroups, totalCount);
    }

    await fetchPage(page + 1, totalPage);
  };

  await fetchPage(1, 1);
  return { formGroups, totalCount };
};

/**
 * Downloads and saves a single datapoint's JSON data.
 * Network call is outside the transaction to avoid holding DB lock during I/O.
 *
 * @param {Object} db - database connection
 * @param {Object} datapointInfo - { formId, administrationId, url, lastUpdated }
 * @param {string|number} user - user id
 * @param {Map|null} formCache - optional Map<formId, { dbRecord, parsedGroups }> for caching
 */
export const downloadDatapointsJson = async (
  db,
  { formId, administrationId, url, lastUpdated },
  user,
  formCache = null,
) => {
  // Resolve form from cache FIRST (before any network call)
  let form;
  let parsedGroups;

  if (formCache?.has(formId)) {
    ({ dbRecord: form, parsedGroups } = formCache.get(formId));
  } else {
    form = await crudForms.getByFormId(db, { formId });
    parsedGroups = JSON.parse(form?.json || '{}')?.question_group || [];
    formCache?.set(formId, { dbRecord: form, parsedGroups });
  }

  // Skip-unchanged: check if local datapoint is already up-to-date
  const uuid = url.split('/').pop().replace('.json', '');
  const existing = await crudDataPoints.getByUUID(db, { uuid, form: form?.id });
  if (existing?.syncedAt && lastUpdated && existing.syncedAt >= lastUpdated) {
    return;
  }

  // Network call OUTSIDE the transaction
  const response = await api.get(url);
  if (response.status !== 200) {
    return;
  }

  const jsonData = response.data;
  const { datapoint_name: name, geolocation: geo, answers, id: dpID } = jsonData || {};

  // DB operations INSIDE the transaction
  await sql.withTransaction(db, async (txDb) => {
    const repeats = {};
    let repeatIndex = 0;
    parsedGroups.forEach((group) => {
      if (group.repeatable) {
        const qIDs = group.question.map((q) => `${q.id}`);
        const maxRepeats = Object.keys(answers)
          .filter((k) => k?.includes('-'))
          .filter((k) => {
            const [qId] = k.split('-');
            return qIDs.includes(qId);
          })
          .reduce((acc, key) => {
            const match = key.match(/-(\d+)$/);
            if (match) {
              const num = parseInt(match[1], 10);
              return Math.max(acc, num);
            }
            return acc;
          }, 0);
        repeats[repeatIndex] = Array.from({ length: maxRepeats + 1 }, (_, i) => i);
        repeatIndex += 1;
      }
    });

    if (existing) {
      await crudDataPoints.updateByUUID(txDb, {
        uuid,
        form: form?.id,
        json: answers,
        syncedAt: lastUpdated,
        repeats: JSON.stringify(repeats),
      });
      return;
    }

    // Insert new datapoint only if it doesn't exist
    const datapointData = {
      uuid,
      user,
      geo,
      name,
      administrationId,
      form: form?.id,
      submitted: 1,
      duration: 0,
      createdAt: new Date().toISOString(),
      json: answers,
      syncedAt: lastUpdated,
      repeats: JSON.stringify(repeats),
      id: dpID,
    };

    await crudDataPoints.deleteById(txDb, { id: dpID });
    await crudDataPoints.saveDataPoint(txDb, datapointData);
  });
};
