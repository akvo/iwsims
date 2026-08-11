import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import PropTypes from "prop-types";

import { api, store, getDataPointDetails } from "../../../../lib";
import { collectSiteProfileQueries } from "./utils";

/**
 * Owns the site-profile data fetch and exposes it to the whole subtree so
 * widgets read state from context instead of a drilled prop.
 *
 * Provided value: { config, text, parentFormId, payload, loading, error,
 *                   recordContext }
 */
const ProfileContext = createContext({});

export const useProfile = () => useContext(ProfileContext);

const buildUrl = (parentId, parentFormId, config) => {
  const query = collectSiteProfileQueries(config);
  const params = new URLSearchParams();
  params.set("parent_form_id", parentFormId);
  if (query.questions.length) {
    params.set("questions", query.questions.join(","));
  }
  if (query.history.length) {
    params.set("history", query.history.join(","));
  }
  if (query.records.length) {
    params.set("records", query.records.join(","));
  }
  return `/visualization/site-profile/${parentId}?${params.toString()}`;
};

export const ProfileProvider = ({
  parentId,
  parentFormId,
  config,
  text,
  enabled,
  children,
}) => {
  const [state, setState] = useState({
    data: null,
    loading: false,
    error: null,
  });
  // Registration answers (GET /data/{id}) cached in the global store so the
  // Registration Data tab and this header share one fetch per datapoint.
  const registration = store.useState((s) =>
    `${s.dataPointDetails?.id}` === `${parentId}`
      ? s.dataPointDetails.data
      : null
  );

  const url = useMemo(() => {
    if (!parentId || !parentFormId || !config) {
      return null;
    }
    return buildUrl(parentId, parentFormId, config);
  }, [parentId, parentFormId, config]);

  useEffect(() => {
    if (!enabled || !url) {
      return () => {};
    }
    let ignore = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    api
      .get(url)
      .then(({ data }) => {
        if (!ignore) {
          setState({ data, loading: false, error: null });
        }
      })
      .catch((error) => {
        if (!ignore) {
          setState({ data: null, loading: false, error });
        }
      });
    return () => {
      ignore = true;
    };
  }, [enabled, url]);

  useEffect(() => {
    if (enabled && parentId) {
      // Shared, deduped fetch — updates store.dataPointDetails, which the
      // `registration` selector above reads.
      getDataPointDetails(parentId).catch(() => {});
    }
  }, [enabled, parentId]);

  const value = useMemo(() => {
    const resolvedText = text || {};
    return {
      config,
      text: resolvedText,
      parentId,
      parentFormId,
      payload: state.data,
      registration,
      loading: state.loading,
      error: state.error,
      recordContext: {
        payload: state.data,
        registration,
        parentId,
        parentFormId,
        text: resolvedText,
      },
    };
  }, [config, text, parentId, parentFormId, state, registration]);

  return (
    <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>
  );
};

ProfileProvider.propTypes = {
  parentId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  parentFormId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  config: PropTypes.object,
  text: PropTypes.object,
  enabled: PropTypes.bool,
  children: PropTypes.node,
};

ProfileProvider.defaultProps = {
  enabled: true,
};

export default ProfileContext;
