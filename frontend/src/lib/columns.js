import { Row, Col, Tag, Popover, Button } from "antd";
import {
  FileTextFilled,
  InfoCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  CheckCircleFilled,
} from "@ant-design/icons";

export const columnsBatch = [
  {
    title: "",
    dataIndex: "id",
    key: "id",
    align: "center",
    render: () => <InfoCircleOutlined />,
    width: 50,
  },
  {
    title: "Batch Name",
    dataIndex: "name",
    key: "name",
    render: (name, row) => (
      <Row align="middle">
        <Col>
          <FileTextFilled
            style={{ color: "#666666", fontSize: 28, paddingRight: "1rem" }}
          />
        </Col>
        <Col>
          <div>{name}</div>
          <div>{row.created}</div>
        </Col>
      </Row>
    ),
  },
  {
    title: "Form",
    dataIndex: "form",
    key: "form",
    render: (form) => form.name || "",
  },
  {
    title: "Administration",
    dataIndex: "administration",
    key: "administration",
    render: (administration) => administration.name || "",
  },
  {
    title: "Status",
    dataIndex: "approvers",
    key: "approvers",
    align: "center",
    render: (approvers) => {
      if (approvers?.length) {
        const isRejected = approvers.find((a) => a?.status_text === "Rejected");
        const status_text = isRejected?.status_text || approvers[0].status_text;
        return (
          <span>
            <Tag
              icon={
                status_text === "Pending" ? (
                  <ClockCircleOutlined />
                ) : status_text === "Rejected" ? (
                  <CloseCircleOutlined />
                ) : (
                  <CheckCircleOutlined />
                )
              }
              color={
                status_text === "Pending"
                  ? "default"
                  : status_text === "Rejected"
                  ? "error"
                  : "success"
              }
            >
              {status_text}
            </Tag>
          </span>
        );
      }
      return (
        <span>
          <Popover
            content="There is no approvers for this data, please contact admin"
            title="No Approver"
          >
            <Tag color="warning" icon={<ExclamationCircleOutlined />}>
              No Approver
            </Tag>
          </Popover>
        </span>
      );
    },
  },
  {
    title: "Total Data",
    dataIndex: "total_data",
    key: "total_data",
    align: "center",
  },
];

export const columnsPending = [
  {
    title: "Submitted Date",
    dataIndex: "created",
    key: "created",
    render: (created) => created || "",
    align: "center",
    width: 200,
  },
  {
    title: "Type",
    dataIndex: "parent",
    key: "parent",
    render: (parent) => {
      if (parent === null) {
        return <Tag color="purple">Registration</Tag>;
      }
      if (parent?.id) {
        return <Tag color="orange">Monitoring</Tag>;
      }
      return <Tag color="red">INVALID</Tag>;
    },
  },
  {
    title: "Name",
    dataIndex: "name",
    key: "name",
    render: (name, row) =>
      row?.parent?.id ? (
        row.parent.is_pending ? (
          <div>{row.parent.name}</div>
        ) : (
          <Button
            type="link"
            href={`/control-center/data/${row.parent.form}/monitoring/${row.parent.id}`}
            target="_blank"
            rel="noopener noreferrer"
            icon={<CheckCircleFilled />}
            style={{ padding: 0, marginLeft: 8, color: "#52c41a" }}
          >
            {row?.parent?.name}
          </Button>
        )
      ) : (
        <div>{name}</div>
      ),
  },
  {
    title: "Administration",
    dataIndex: "administration",
    key: "administration",
    width: 200,
  },
  {
    title: "Submitter Name",
    dataIndex: "submitter",
    key: "submitter",
    render: (submitter, dt) => {
      return submitter || dt.created_by;
    },
    width: 200,
  },
  {
    title: "Duration",
    dataIndex: "duration",
    key: "duration",
    render: (duration) => duration || "",
    align: "center",
    width: 100,
  },
];

export const columnsRawData = [
  {
    title: "",
    dataIndex: "key",
    key: "key",
    render: (_, __, a) => {
      return a + 1;
    },
  },
  {
    title: "Type",
    dataIndex: "parent",
    key: "parent",
    render: (parent) =>
      parent?.id ? (
        <Tag color="orange">Monitoring</Tag>
      ) : (
        <Tag color="purple">Registration</Tag>
      ),
  },
  {
    title: "Name",
    dataIndex: "name",
    key: "name",
    render: (name, row) =>
      row?.parent ? (
        row.parent.is_pending ? (
          <div>{row.parent.name}</div>
        ) : (
          <Button
            type="link"
            href={`/control-center/data/${row.parent.form}/monitoring/${row.parent.id}`}
            target="_blank"
            rel="noopener noreferrer"
            icon={<CheckCircleFilled />}
            style={{ padding: 0, marginLeft: 8, color: "#52c41a" }}
          >
            {row?.parent?.name}
          </Button>
        )
      ) : (
        <div>{name}</div>
      ),
  },
  {
    title: "Administration",
    dataIndex: "administration",
    key: "administration",
    align: "center",
  },
  {
    title: "Date",
    dataIndex: "created",
    key: "created",
  },
  {
    title: "Upload By",
    dataIndex: "created_by",
    key: "created_by",
  },
];
