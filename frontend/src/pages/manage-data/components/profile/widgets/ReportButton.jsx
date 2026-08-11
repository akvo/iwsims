import React, { useCallback, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { useNavigate } from "react-router-dom";
import { Button } from "antd";
import { FileWordOutlined } from "@ant-design/icons";
import api from "../../../../../lib/api";
import { useNotification } from "../../../../../util/hooks";
import { getText } from "../utils";

/**
 * Request the Word report for this datapoint.
 *
 * The endpoint queues a background job rather than streaming a file — it
 * returns {task_id, file_url} and the document appears on the Downloads page
 * once the worker finishes. So this button reports "queued" and sends the user
 * there, exactly as the bulk export in DataFilters does; promising an
 * immediate download would misrepresent what happens.
 *
 * Child (monitoring) form ids are included so the report carries monitoring
 * answers, not just the registration record.
 */
const ReportButton = ({ parentId, parentFormId, text }) => {
  const navigate = useNavigate();
  const { notify } = useNotification();
  const [loading, setLoading] = useState(false);

  const childFormIds = useMemo(() => {
    const parent = Number(parentFormId);
    return (window.forms || [])
      .filter((f) => Number(f?.content?.parent) === parent)
      .map((f) => f.id);
  }, [parentFormId]);

  const onClick = useCallback(async () => {
    setLoading(true);
    try {
      let url = `/download/datapoint-report?form_id=${parentFormId}&selection_ids=${parentId}`;
      if (childFormIds.length) {
        url += `&${childFormIds.map((id) => `child_form_ids=${id}`).join("&")}`;
      }
      await api.get(url);
      notify({
        type: "success",
        message: getText(
          text,
          "siteProfileReportQueued",
          "Report queued — collect it from the Downloads page when it is ready"
        ),
      });
      navigate("/downloads");
    } catch {
      notify({
        type: "error",
        message: getText(
          text,
          "downloadReportError",
          "Unable to download report"
        ),
      });
    } finally {
      setLoading(false);
    }
  }, [parentId, parentFormId, childFormIds, notify, navigate, text]);

  if (!parentId || !parentFormId) {
    return null;
  }

  return (
    <Button
      size="small"
      icon={<FileWordOutlined />}
      onClick={onClick}
      loading={loading}
      className="site-profile-report-button"
    >
      {getText(text, "siteProfileWordReport", "Word Report")}
    </Button>
  );
};

ReportButton.propTypes = {
  parentId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  parentFormId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  text: PropTypes.object,
};

export default ReportButton;
