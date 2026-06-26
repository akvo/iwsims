import api from "./api";
import store from "./store";

// In-flight requests keyed by datapoint id, so concurrent callers (the
// Registration Data tab and the Site Profile header, which mount together)
// share a single GET /data/{id} request instead of racing.
const inflight = {};

/**
 * Resolve the registration answers for a datapoint, fetching GET /data/{id}
 * at most once and caching the result in the global store as
 * { id, data }. Returns a Promise of the raw answers array.
 */
export const getDataPointDetails = (id) => {
  const cached = store.getRawState().dataPointDetails;
  if (`${cached?.id}` === `${id}`) {
    return Promise.resolve(cached.data);
  }
  if (inflight[id]) {
    return inflight[id];
  }
  const promise = api
    .get(`data/${id}`)
    .then(({ data }) => {
      store.update((s) => {
        s.dataPointDetails = { id, data };
      });
      delete inflight[id];
      return data;
    })
    .catch((error) => {
      delete inflight[id];
      throw error;
    });
  inflight[id] = promise;
  return promise;
};

export default getDataPointDetails;
