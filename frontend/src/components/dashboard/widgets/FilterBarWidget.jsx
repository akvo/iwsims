import React from "react";
import PropTypes from "prop-types";
import { Card } from "antd";
import DashboardFilters from "../DashboardFilters";

/**
 * Renders a `filter_bar` container item.
 *
 * Extracts the nested filter items from `item.items[]` and passes them to
 * `<DashboardFilters>` which dispatches by chart_type.
 *
 * @param {object} item         A config item with chart_type "filter_bar" and items[]
 * @param {object} filters      Return value of useDashboardFilters
 * @param {object} onChange     { setDateRange, setAdministrationId, setCustomFilter }
 */
const FilterBarWidget = ({ item, filters, onChange }) => {
  const filterItems = item.items || [];

  return (
    <Card size="small" className="dashboard-filter-bar">
      <DashboardFilters
        filterItems={filterItems}
        filters={filters}
        onChange={onChange}
      />
    </Card>
  );
};

FilterBarWidget.propTypes = {
  item: PropTypes.shape({
    items: PropTypes.arrayOf(PropTypes.object),
  }).isRequired,
  filters: PropTypes.object.isRequired,
  onChange: PropTypes.shape({
    setDateRange: PropTypes.func.isRequired,
    setAdministrationId: PropTypes.func.isRequired,
    setCustomFilter: PropTypes.func.isRequired,
  }).isRequired,
};

export default FilterBarWidget;
