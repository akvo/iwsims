import React from "react";
import IndividualPlantOverview from "./individual-overview/IndividualPlantOverview";
import * as wtp from "./individual-overview/config/wtp";

const IndividualWTPOverview = () => <IndividualPlantOverview config={wtp} />;

export default IndividualWTPOverview;
