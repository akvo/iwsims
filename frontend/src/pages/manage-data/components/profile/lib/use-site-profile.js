import { useEffect, useMemo, useState } from "react";

import { api } from "../../../../../lib";
import { collectSiteProfileQueries } from "./site-profile-queries";

const join = (items) => items.join(",");

const buildUrl = (parentId, parentFormId, config) => {
  const query = collectSiteProfileQueries(config);
  const params = new URLSearchParams();
  params.set("parent_form_id", parentFormId);
  if (query.questions.length) {
    params.set("questions", join(query.questions));
  }
  if (query.history.length) {
    params.set("history", join(query.history));
  }
  if (query.records.length) {
    params.set("records", join(query.records));
  }
  return `/visualization/site-profile/${parentId}?${params.toString()}`;
};

const useSiteProfile = ({ parentId, parentFormId, config, enabled }) => {
  const [state, setState] = useState({
    data: null,
    loading: false,
    error: null,
  });
  const url = useMemo(() => {
    if (!parentId || !parentFormId || !config) {
      return null;
    }
    return buildUrl(parentId, parentFormId, config);
  }, [parentId, parentFormId, config]);

  useEffect(() => {
    if (!enabled || !url) {
      return;
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

  return state;
};

export default useSiteProfile;
