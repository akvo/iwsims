import React from "react";
import IndividualPlantOverview from "./individual-overview/IndividualPlantOverview";
import * as wwtp from "./individual-overview/config/wwtp";

const IndividualWWTPOverview = () => <IndividualPlantOverview config={wwtp} />;

export default IndividualWWTPOverview;
