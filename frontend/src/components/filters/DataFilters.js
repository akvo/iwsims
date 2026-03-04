import React, { useState, useMemo, useCallback } from "react";
import "./style.scss";
import {
  Row,
  Col,
  Space,
  Button,
  Dropdown,
  Checkbox,
  Badge,
  Tooltip,
  Radio,
  Input,
  DatePicker,
} from "antd";
import { useLocation, useNavigate } from "react-router-dom";
import AdministrationDropdown from "./AdministrationDropdown";
import FormDropdown from "./FormDropdown.js";
import { useNotification } from "../../util/hooks";
import { api, store, uiText } from "../../lib";
import { takeRight } from "lodash";
import RemoveFiltersButton from "./RemoveFiltersButton";
import AdvancedFilters from "./AdvancedFilters";
import {
  PlusOutlined,
  DownloadOutlined,
  // UploadOutlined,
  FileWordOutlined,
  DownOutlined,
  SearchOutlined,
  CalendarOutlined,
} from "@ant-design/icons";
import { Can } from "../can/index.js";

const DataFilters = ({
  loading,
  showAdm = true,
  resetFilter = true,
  selectedRowKeys = [],
  search = "",
  onSearchChange = () => {},
}) => {
  const {
    user: authUser,
    selectedForm,
    loadingForm,
    administration,
    showAdvancedFilters,
    dateRange,
  } = store.useState((s) => s);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { notify } = useNotification();
  const [exporting, setExporting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [selectedChildForms, setSelectedChildForms] = useState([]);
  const [openDocx, setOpenDocx] = useState(false);
  const [openExcel, setOpenExcel] = useState(false);
  const [downloadType, setDownloadType] = useState("recent");
  const isUserHasForms = authUser?.is_superuser || authUser?.forms?.length || 0;
  const language = store.useState((s) => s.language);
  const { active: activeLang } = language;

  const text = useMemo(() => {
    return uiText[activeLang];
  }, [activeLang]);

  const childForms = useMemo(() => {
    return window.forms?.filter((f) => f?.content?.parent === selectedForm);
  }, [selectedForm]);

  const selectedAdm = takeRight(administration, 1)[0];

  const export2Excel = useCallback(async () => {
    setExporting(true);
    try {
      const adm_id = selectedAdm?.id;
      const childFormIds = selectedChildForms
        .map((id) => `child_form_ids=${id}`)
        .join("&");
      const urls = [`download/generate?form_id=${selectedForm}`];
      if (adm_id && selectedAdm?.parent) {
        urls.push(`administration_id=${adm_id}`);
      }
      if (selectedChildForms.length) {
        urls.push(childFormIds);
      }
      if (["all", "recent"].includes(downloadType)) {
        urls.push(`type=${downloadType}`);
      }
      const apiURL = `/${urls.join("&")}`;
      await api.get(apiURL);
      notify({
        type: "success",
        message: text.export2ExcelSuccess,
      });
      setExporting(false);
      setOpenExcel(false); // Close dropdown after successful export
      navigate("/downloads");
    } catch (error) {
      setExporting(false);
      notify({
        type: "error",
        message: text.export2ExcelError,
      });
    }
  }, [
    selectedAdm,
    selectedForm,
    selectedChildForms,
    notify,
    downloadType,
    text.export2ExcelSuccess,
    text.export2ExcelError,
    navigate,
  ]);

  const export2Docx = useCallback(async () => {
    setDownloading(true);
    try {
      // Create parameters list URL for selection_ids based on selectedRowKeys
      const selectionIds = selectedRowKeys
        .map((id) => `selection_ids=${id}`)
        .join("&");
      const childFormIds = selectedChildForms
        .map((id) => `child_form_ids=${id}`)
        .join("&");
      // If no child forms are selected, use the selected form
      let apiURL = `/download/datapoint-report?form_id=${selectedForm}&${selectionIds}`;
      if (selectedChildForms.length) {
        apiURL += `&${childFormIds}`;
      }
      await api.get(apiURL);
      setDownloading(false);
      setOpenDocx(false); // Close dropdown after successful download
      notify({
        type: "success",
        message: text.downloadReportSuccess,
      });
      navigate("/downloads");
    } catch (error) {
      setDownloading(false);
      setOpenDocx(false); // Close dropdown even on error
      notify({
        type: "error",
        message: text.downloadReportError,
      });
    }
  }, [
    selectedRowKeys,
    selectedChildForms,
    notify,
    selectedForm,
    text.downloadReportError,
    text.downloadReportSuccess,
    navigate,
  ]);

  const goToAddForm = () => {
    /***
     * reset initial value
     */
    store.update((s) => {
      s.initialValue = [];
    });
    navigate(`/control-center/form/${selectedForm}`);
  };

  const handleDateRangeChange = useCallback((dates) => {
    store.update((s) => {
      s.dateRange = dates;
    });
  }, []);

  const childFormMenuItems = useMemo(() => {
    const formItems = childForms.map((form) => ({
      key: form.id,
      label: (
        <Checkbox
          checked={selectedChildForms.includes(form.id)}
          onChange={(e) => {
            const { checked } = e.target;
            if (checked) {
              setSelectedChildForms([...selectedChildForms, form.id]);
            } else {
              setSelectedChildForms(
                selectedChildForms.filter((id) => id !== form.id)
              );
            }
          }}
        >
          {form.content.name}
        </Checkbox>
      ),
    }));

    const menuItems = [];

    if (childForms.length > 0) {
      menuItems.push(
        {
          key: "header",
          label: (
            <div
              style={{ fontWeight: 500, color: "#262626", padding: "4px 0" }}
            >
              {text.selectChildForms}
            </div>
          ),
          disabled: true,
        },
        ...formItems,
        {
          key: "divider",
          type: "divider",
        }
      );
    }

    if (openExcel) {
      menuItems.push({
        key: "download-type",
        label: (
          <Radio.Group
            onChange={(e) => setDownloadType(e.target.value)}
            value={downloadType}
          >
            <Radio value="all">{text.allData}</Radio>
            <Radio value="recent">{text.latestData}</Radio>
          </Radio.Group>
        ),
      });
    }

    return [
      ...menuItems,
      {
        key: "download-footer",
        label: (
          <Button
            type="primary"
            icon={<FileWordOutlined />}
            loading={downloading}
            onClick={() => {
              if (openExcel) {
                export2Excel();
              } else {
                export2Docx();
              }
            }}
            disabled={openDocx && !selectedRowKeys?.length}
            style={{ width: "100%" }}
          >
            {text.downloadReport}
          </Button>
        ),
        disabled: true,
      },
    ];
  }, [
    childForms,
    selectedChildForms,
    downloading,
    openExcel,
    openDocx,
    downloadType,
    selectedRowKeys,
    text.downloadReport,
    text.selectChildForms,
    text.allData,
    text.latestData,
    export2Docx,
    export2Excel,
  ]);

  return (
    <>
      <Row style={{ marginBottom: "16px" }}>
        <Col flex={1}>
          <Space>
            <FormDropdown
              loading={loading}
              width="100%"
              style={{ minWidth: 300 }}
            />
            {/* <AdvancedFiltersButton /> */}
          </Space>
        </Col>
        <Col>
          <Space>
            {/* <Can I="upload" a="data">
              <Link to="/control-center/data/upload">
                <Button shape="round" icon={<UploadOutlined />}>
                  {text.bulkUpload}
                </Button>
              </Link>
            </Can> */}
            {pathname === "/control-center/data" && (
              <Space>
                {selectedRowKeys.length === 0 ? (
                  <Tooltip
                    title={text.selectRowsToDownload}
                    trigger="hover"
                    placement="top"
                  >
                    <Button shape="round" icon={<FileWordOutlined />} disabled>
                      {text.downloadReport}
                    </Button>
                  </Tooltip>
                ) : (
                  <Dropdown
                    trigger={["click"]}
                    placement="bottomLeft"
                    open={openDocx}
                    onOpenChange={setOpenDocx}
                    menu={{
                      items: childFormMenuItems,
                      style: { minWidth: "200px" },
                    }}
                    disabled={!selectedRowKeys.length}
                  >
                    <Badge count={selectedRowKeys.length}>
                      <Button
                        shape="round"
                        icon={<FileWordOutlined />}
                        loading={downloading}
                        disabled={!selectedRowKeys.length}
                      >
                        {text.downloadReport} <DownOutlined />
                      </Button>
                    </Badge>
                  </Dropdown>
                )}
              </Space>
            )}
            {pathname === "/control-center/data" && (
              <Can I="create" a="downloads">
                <Dropdown
                  trigger={["click"]}
                  open={openExcel}
                  onOpenChange={setOpenExcel}
                  menu={{
                    items: childFormMenuItems,
                    style: { minWidth: "200px" },
                  }}
                  placement="bottomRight"
                >
                  <Button
                    icon={<DownloadOutlined />}
                    shape="round"
                    loading={exporting}
                  >
                    {text.download}
                  </Button>
                </Dropdown>
              </Can>
            )}
            <Can I="manage" a="submissions">
              <Button
                shape="round"
                icon={<PlusOutlined />}
                type="primary"
                disabled={!isUserHasForms}
                onClick={goToAddForm}
              >
                {text.addNewButton}
              </Button>
            </Can>
          </Space>
        </Col>
      </Row>
      <Row>
        <Col>
          <Space>
            <Input
              prefix={<SearchOutlined />}
              placeholder={text.searchPlaceholder}
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              allowClear
              style={{ width: 200 }}
            />
            <DatePicker.RangePicker
              value={dateRange}
              onChange={handleDateRangeChange}
              allowClear
              placeholder={[text.dateFromPlaceholder, text.dateToPlaceholder]}
              suffixIcon={<CalendarOutlined />}
            />
            {showAdm && (
              <AdministrationDropdown loading={loading || loadingForm} />
            )}
            {resetFilter && <RemoveFiltersButton />}
          </Space>
        </Col>
      </Row>
      {showAdvancedFilters && <AdvancedFilters />}
    </>
  );
};

export default React.memo(DataFilters);
