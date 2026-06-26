import { Store } from "pullstate";
import { sortArray } from "../util/form";

const defaultUIState = {
  isLoggedIn: false,
  user: null,
  filters: {
    trained: null,
    role: null,
    organisation: null,
    query: null,
    attributeType: null,
    entityType: [],
  },
  language: {
    active: "en",
    langs: { en: "English", de: "German" },
  },
  administration: [],
  selectedAdministration: null,
  loadingMap: false,
  forms: window.forms.sort(sortArray),
  levels: window.levels,
  selectedForm: null,
  selectedFormData: null,
  loadingForm: false,
  questionGroups: [],
  showAdvancedFilters: false,
  advancedFilters: [],
  dateRange: null,
  administrationLevel: null,
  showContactFormModal: false,
  masterData: {
    administration: {},
    attribute: {},
    entity: {},
  },
  options: {
    entityTypes: [],
  },
  initialValue: [],
  monitoring: null,
  // Cached GET /data/{id} response (registration answers) for the datapoint
  // currently open — shared by the Registration Data tab and the Site Profile
  // header so it is fetched once. Shape: { id, data }.
  dataPointDetails: null,
};

const store = new Store(defaultUIState);

export default store;
