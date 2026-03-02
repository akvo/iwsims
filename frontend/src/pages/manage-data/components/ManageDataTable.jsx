import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Table, ConfigProvider, Empty } from "antd";
import { useNavigate } from "react-router-dom";
import { isEmpty, union, xor, without } from "lodash";

import { api, store, uiText } from "../../../lib";
import { generateAdvanceFilterURL } from "../../../util/filter";

const ManageDataTable = ({
  selectedRowKeys,
  setSelectedRowKeys,
  formIdFromUrl = null,
  search = "",
}) => {
  const [loading, setLoading] = useState(false);
  const [dataset, setDataset] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [updateRecord, setUpdateRecord] = useState(true);
  const [activeFilter, setActiveFilter] = useState(null);
  const [sortBy, setSortBy] = useState("created");
  const [sortType, setSortType] = useState(null);

  const navigate = useNavigate();

  const { administration, selectedForm, user } = store.useState(
    (state) => state
  );
  const { language, advancedFilters } = store.useState((s) => s);
  const { active: activeLang } = language;
  const text = useMemo(() => {
    return uiText[activeLang];
  }, [activeLang]);

  const goToMonitoring = (record) => {
    store.update((s) => {
      s.selectedFormData = record;
    });
    navigate(`/control-center/data/${selectedForm}/monitoring/${record.id}`);
  };

  const selectedAdministration = useMemo(() => {
    return administration?.[administration.length - 1];
  }, [administration]);

  const isAdministrationLoaded = useMemo(() => {
    return (
      selectedAdministration?.id === user?.administration?.id ||
      administration?.length > 1
    );
  }, [selectedAdministration, administration, user?.administration?.id]);

  const handleChange = (e, _, sorter) => {
    const newPage = e.current;
    const newSortBy = sorter?.field;
    const newSortType = sorter?.order;

    if (sortType !== newSortType) {
      // setSelectedRowKeys([]);
      setSortBy(newSortBy);
      setSortType(newSortType);
      setCurrentPage(1);
    } else if (newPage !== currentPage) {
      setCurrentPage(newPage);
    }
    setUpdateRecord(true);
  };

  const onSelectTableRow = ({ id }) => {
    selectedRowKeys.includes(id)
      ? setSelectedRowKeys(without(selectedRowKeys, id))
      : setSelectedRowKeys([...selectedRowKeys, id]);
  };

  const onSelectAllTableRow = (isSelected) => {
    const hasSelected = !isEmpty(selectedRowKeys);
    const ids = dataset.filter((x) => !x?.disabled).map((x) => x.id);
    if (!isSelected && hasSelected) {
      setSelectedRowKeys(xor(selectedRowKeys, ids));
    }
    if (isSelected && !hasSelected) {
      setSelectedRowKeys(ids);
    }
    if (isSelected && hasSelected) {
      setSelectedRowKeys(union(selectedRowKeys, ids));
    }
  };

  useEffect(() => {
    if (isAdministrationLoaded && activeFilter !== selectedAdministration?.id) {
      setActiveFilter(selectedAdministration.id);
      if (!updateRecord) {
        setCurrentPage(1);
        setUpdateRecord(true);
      }
    }
  }, [
    activeFilter,
    selectedAdministration,
    isAdministrationLoaded,
    updateRecord,
  ]);

  const fetchData = useCallback(() => {
    const formId = formIdFromUrl || selectedForm;
    if (formIdFromUrl) {
      store.update((s) => {
        s.selectedForm = parseInt(formIdFromUrl, 10);
      });
    }
    if (formId && isAdministrationLoaded && updateRecord) {
      setUpdateRecord(false);
      setLoading(true);
      let url = `/form-data/${formId}/?page=${currentPage}`;
      if (selectedAdministration?.id) {
        url += `&administration=${selectedAdministration.id}`;
      }
      if (search) {
        url += `&search=${encodeURIComponent(search)}`;
      }
      if (advancedFilters && advancedFilters.length) {
        url = generateAdvanceFilterURL(advancedFilters, url);
      }
      if (sortBy) {
        url += `&sort_by=${sortBy}`;
      }
      if (sortType) {
        url += `&sort_type=${sortType}`;
      }
      api
        .get(url)
        .then((res) => {
          setDataset(res.data.data);
          setTotalCount(res.data.total);
          if (res.data.total < currentPage) {
            setCurrentPage(1);
          }
          setLoading(false);
        })
        .catch(() => {
          setDataset([]);
          setTotalCount(0);
          setLoading(false);
        });
    }
  }, [
    selectedForm,
    selectedAdministration,
    currentPage,
    isAdministrationLoaded,
    advancedFilters,
    updateRecord,
    formIdFromUrl,
    search,
    sortBy,
    sortType,
  ]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    const unsubscribe = store.subscribe(
      (s) => s.selectedForm,
      () => {
        setUpdateRecord(true);
        setCurrentPage(1);
        setSelectedRowKeys([]);
      }
    );
    return () => {
      unsubscribe();
    };
  }, [setSelectedRowKeys]);

  useEffect(() => {
    setCurrentPage(1);
    setUpdateRecord(true);
  }, [search]);

  return (
    <div>
      <ConfigProvider
        renderEmpty={() => (
          <Empty
            description={
              selectedForm ? text.noFormText : text.noFormSelectedText
            }
          />
        )}
      >
        <Table
          columns={[
            {
              title: text.lastUpdatedCol,
              dataIndex: "updated",
              render: (cell, row) => cell || row.created,
              onCell: (record) => ({
                onClick: () => goToMonitoring(record),
              }),
            },
            {
              title: text.nameCol,
              dataIndex: "name",
              key: "name",
              filtered: true,
              onFilter: (value, filters) =>
                filters.name.toLowerCase().includes(value.toLowerCase()),
              onCell: (record) => ({
                onClick: () => goToMonitoring(record),
              }),
            },
            {
              title: text.userCol,
              dataIndex: "created_by",
              onCell: (record) => ({
                onClick: () => goToMonitoring(record),
              }),
            },
            {
              title: text.regionCol,
              dataIndex: "administration",
              onCell: (record) => ({
                onClick: () => goToMonitoring(record),
              }),
            },
            {
              title: text.totalMonitoring,
              dataIndex: "total_children",
              width: 120,
              sorter: true,
              sortDirections: ["descend", "ascend"],
              sortOrder: sortBy === "total_children" ? sortType : null,
              onCell: (record) => ({
                onClick: () => goToMonitoring(record),
              }),
            },
          ]}
          dataSource={dataset}
          loading={loading}
          onChange={handleChange}
          pagination={{
            current: currentPage,
            total: totalCount,
            pageSize: 10,
            showSizeChanger: false,
            showTotal: (total, range) =>
              `Results: ${range[0]} - ${range[1]} of ${total} data`,
          }}
          rowClassName="row-normal sticky"
          rowKey="id"
          rowSelection={{
            selectedRowKeys: selectedRowKeys,
            onSelect: onSelectTableRow,
            onSelectAll: onSelectAllTableRow,
          }}
        />
      </ConfigProvider>
    </div>
  );
};

export default ManageDataTable;
