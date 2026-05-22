import React, { useState, useEffect, useMemo } from "react";
import {
  Table,
  ConfigProvider,
  Empty,
  Button,
  Space,
  Popover,
  List,
} from "antd";
import {
  LoadingOutlined,
  DownloadOutlined,
  ExclamationCircleOutlined,
  FileMarkdownFilled,
  FileWordFilled,
  FileZipFilled,
  FileExcelFilled,
  ReloadOutlined,
} from "@ant-design/icons";
import { api, store, uiText } from "../../../lib";
import { useNotification } from "../../../util/hooks";
import moment from "moment";
import { Link } from "react-router-dom";

const MAX_ITEMS = 3; // Maximum number of items to show before the "more" link

const DownloadIcon = ({ type }) => {
  switch (type) {
    case "download_datapoint_report":
      return <FileWordFilled style={{ color: "#4472C4" }} />;
    case "download_administration":
    case "download_entities":
      return <FileMarkdownFilled style={{ color: "blue" }} />;
    case "download_excel":
      return <FileExcelFilled style={{ color: "green" }} />;
    default:
      return <FileZipFilled style={{ color: "green" }} />;
  }
};

const DownloadTable = ({ type = "download" }) => {
  const [dataset, setDataset] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showLoadMore, setShowLoadMore] = useState(true);
  const [page, setPage] = useState(1);
  const [downloading, setDownloading] = useState(false);
  const [retrying, setRetrying] = useState(null);
  const { notify } = useNotification();
  const { language } = store.useState((s) => s);
  const { active: activeLang } = language;
  const text = useMemo(() => {
    return uiText[activeLang];
  }, [activeLang]);

  useEffect(() => {
    const fetchData = (endpoint) => {
      setLoading(true);
      api
        .get(endpoint)
        .then((res) => {
          setDataset(res.data);
          setLoading(false);
        })
        .catch((e) => {
          setLoading(false);
          setShowLoadMore(false);
          setDataset([]);
          notify({
            type: "error",
            message: text.errorFileList,
          });
          console.error(e);
        });
    };
    if (type) {
      fetchData(`download/list?type=${type}`);
      return;
    }
    fetchData(`download/list`);
  }, [notify, text.errorFileList, type]);

  const handleDownload = (row) => {
    setDownloading(row.result);
    api
      .get(`download/file/${row.result}?type=${row.type}`, {
        responseType: "blob",
      })
      .then((res) => {
        const url = window.URL.createObjectURL(new Blob([res.data]));
        const link = document.createElement("a");
        link.href = url;
        link.setAttribute("download", row.result);
        document.body.appendChild(link);
        link.click();
        setDownloading(null);
      });
  };

  const handleRetry = (row) => {
    setRetrying(row.id);
    api
      .post(`download/retry/${row.id}`)
      .then((res) => {
        const newResult = res.data.file_url.split("/download/file/").pop();
        setDataset((ds) =>
          ds.map((d) =>
            d.id === row.id
              ? {
                  ...d,
                  status: "on_progress",
                  task_id: res.data.task_id,
                  result: newResult,
                }
              : d
          )
        );
      })
      .catch((e) => {
        notify({ type: "error", message: text.retryFailed });
        console.error(e);
      })
      .finally(() => {
        setRetrying(null);
      });
  };

  useEffect(() => {
    const pending = dataset.filter((d) => d.status === "on_progress");
    let timeoutId = null;
    const updateStatus = () => {
      if (pending.length > 0) {
        timeoutId = setTimeout(() => {
          api.get(`download/status/${pending?.[0]?.task_id}`).then((res) => {
            if (["done", "failed"].includes(res?.data?.status)) {
              setDataset((ds) =>
                ds.map((d) =>
                  d.task_id === pending?.[0]?.task_id
                    ? { ...d, status: res.data.status }
                    : d
                )
              );
            }
            updateStatus();
          });
        }, 1000);
        return timeoutId;
      }
    };
    updateStatus();
    return () => {
      clearTimeout(timeoutId);
    };
  }, [dataset]);

  const onLoadMore = () => {
    setLoading(true);
    const url = type
      ? `download/list?type=${type}&page=${page + 1}`
      : `download/list?page=${page + 1}`;
    api
      .get(url)
      .then((res) => {
        setDataset([...dataset, ...res.data]);
        if (res.data.length < 5) {
          setShowLoadMore(false);
        }
        setPage(page + 1);
        setLoading(false);
      })
      .catch((e) => {
        console.error(e);
        setShowLoadMore(false);
        setLoading(false);
      });
  };

  const loadMore = () => {
    return showLoadMore && dataset.length > 0 ? (
      <Button type="link" onClick={onLoadMore}>
        {text.loadMoreLable}
      </Button>
    ) : !loading ? (
      <span className="text-muted">{text.endOfListLabel}</span>
    ) : null;
  };

  const columns = [
    {
      dataIndex: "type",
      render: (value, { attributes }) => {
        const downloadType = attributes?.length ? value : "download_excel";
        return (
          <DownloadIcon type={downloadType} style={{ fontSize: "20px" }} />
        );
      },
      width: 40,
    },
    {
      dataIndex: "category",
      render: (row) => (
        <div>
          <div>
            <strong>{row}</strong>
          </div>
        </div>
      ),
    },
    {
      render: (row) => (
        <div>
          <div>
            <strong>{row?.form || row?.category}</strong>
          </div>
          {row?.download_type && row?.attributes?.length > 0 && (
            <span
              className={`download-filter download-type ${row.download_type.toLowerCase()}`}
            >{`${row.download_type} Data - `}</span>
          )}
          {row?.administration ? (
            <div className="download-filter">{row?.administration}</div>
          ) : null}
          {(row?.date_from || row?.date_to) && (
            <div className="download-filter">
              {row.date_from && `${text.dateFromPlaceholder}: ${row.date_from}`}
              {row.date_from && row.date_to && " – "}
              {row.date_to && `${text.dateToPlaceholder}: ${row.date_to}, `}
            </div>
          )}
          {[...(row.attributes || [])]
            .filter((x) => x)
            .slice(0, MAX_ITEMS)
            .map((x, i, arr) =>
              x?.form_id ? (
                <Link
                  key={`tag-${i}`}
                  to={`/control-center/data/${x?.form_id}/monitoring/${x?.id}`}
                  className="download-filter"
                >
                  {x?.name}
                  {i < arr.length - 1 ? ", " : ""}
                </Link>
              ) : (
                <span key={`tag-${i}`} className="download-filter">
                  {x?.name}
                  {i < arr.length - 1 ? ", " : ""}
                </span>
              )
            )}
          {row.attributes && row.attributes.length > 5 && (
            <Popover
              content={
                <List
                  size="small"
                  dataSource={row.attributes.slice(5)}
                  renderItem={(x, i) => (
                    <List.Item key={`popover-tag-${i}`}>
                      {x?.form_id ? (
                        <Link
                          to={`/control-center/data/${x?.form_id}/monitoring/${x?.id}`}
                        >
                          {x?.name}
                        </Link>
                      ) : (
                        x?.name
                      )}
                    </List.Item>
                  )}
                  style={{ margin: 0, padding: 0 }}
                />
              }
              title={text.moreItems}
              trigger="click"
            >
              <span
                className="download-filter"
                style={{ cursor: "pointer", color: "#1890ff" }}
              >
                {text.moreCount.replace(
                  "{{count}}",
                  row.attributes.length - MAX_ITEMS
                )}
              </span>
            </Popover>
          )}
          {row?.category === "Entities" && !row?.attributes?.length ? (
            <span className="download-filter">{text.allEntities}</span>
          ) : null}
        </div>
      ),
    },
    {
      dataIndex: "date",
      render: (row) => (
        <span>{row ? row : moment().format("MMMM DD, YYYY hh:mm A")}</span>
      ),
    },
    {
      render: (row) => (
        <Space>
          <Button
            icon={
              row.status === "on_progress" || row.result === downloading ? (
                <LoadingOutlined />
              ) : row.status === "done" ? (
                <DownloadOutlined />
              ) : (
                <ExclamationCircleOutlined style={{ color: "red" }} />
              )
            }
            ghost
            disabled={row.status !== "done"}
            onClick={() => {
              handleDownload(row);
            }}
          >
            {row.status === "on_progress"
              ? text.generating
              : row.status === "failed"
              ? text.failed
              : text.download}
          </Button>
          {["failed", "pending"].includes(row.status) && (
            <Button
              ghost
              icon={<ReloadOutlined />}
              loading={retrying === row.id}
              onClick={() => {
                handleRetry(row);
              }}
            >
              {text.retryText}
            </Button>
          )}
          <Button ghost className="dev">
            {text.deleteText}
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <ConfigProvider renderEmpty={() => <Empty description="No data" />}>
      <Table
        columns={columns}
        dataSource={dataset}
        showHeader={false}
        rowClassName={(record) => (record.type === 1 ? "template" : "")}
        rowKey="id"
        loading={loading}
        footer={loadMore}
        pagination={false}
      />
    </ConfigProvider>
  );
};

export default DownloadTable;
