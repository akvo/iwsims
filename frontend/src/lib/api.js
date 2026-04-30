import axios from "axios";

export const config = {
  baseURL: "/api/v1/",
  headers: {
    "Content-Type": "application/json",
  },
};

// Tracks in-flight requests by opt-in cancelKey. Reusing a key aborts the
// previous request before issuing the new one — callers handle CanceledError
// via api.isCancel(err).
const inflight = {};

const withCancel = (cancelKey, requestConfig) => {
  if (!cancelKey) {
    return requestConfig;
  }
  if (inflight[cancelKey]) {
    inflight[cancelKey].abort();
  }
  const controller = new AbortController();
  inflight[cancelKey] = controller;
  return { ...requestConfig, signal: controller.signal };
};

const API = () => {
  const getConfig = () => {
    return api?.token
      ? {
          ...config,
          headers: {
            ...config.headers,
            Authorization: `Bearer ${api.token}`,
          },
        }
      : config;
  };
  return {
    get: (url, config = {}, cancelKey = null) =>
      axios(withCancel(cancelKey, { url, ...getConfig(), ...config })),
    post: (url, data, config = {}) =>
      axios({ url, method: "POST", data, ...getConfig(), ...config }),
    put: (url, data, config) =>
      axios({ url, method: "PUT", data, ...getConfig(), ...config }),
    patch: (url, data, config) =>
      axios({ url, method: "PATCH", data, ...getConfig(), ...config }),
    delete: (url) => axios({ url, method: "DELETE", ...getConfig() }),
    setToken: (token) => {
      api.token = token;
    },
    isCancel: (error) => axios.isCancel(error),
  };
};

const api = API();

export default api;
