# Config qid -> question_name maps (Task 6 Part J)

Reference for converting the two OLD hand-authored dashboard configs to question_name. Built from `backend/source/forms/*.json` (question_id is globally unique). Both configs resolve 100%.

## EPS -- 1749623934933.json (31 ids)

| question_id | question_name |
|---|---|
| `1749624452105` | `water_committee` |
| `1749624452910` | `construction_start_date` |
| `1749624452911` | `inspection_date` |
| `1749624452991` | `village_name` |
| `1749624452993` | `implementing_agency` |
| `1749624452994` | `eps_name` |
| `1749624505915` | `project_scope` |
| `1749630516825` | `proposed_completion_date` |
| `1749630516826` | `is_project_completed` |
| `1749632545235` | `inspection_date` |
| `1749632647507` | `can_collect_water_sample` |
| `1749633001462` | `water_testing_method` |
| `1749633220745` | `turbidity_ntu` |
| `1749633220746` | `e_coli_lab_count` |
| `1749633259392` | `total_coliform_cfu_100ml` |
| `1749633295165` | `fecal_coliform_cfu_100ml` |
| `1749633373968` | `system_status` |
| `1797307852531` | `temperature_c` |
| `1797307852532` | `ph` |
| `1797307852533` | `conductivity` |
| `1797307852534` | `salinity` |
| `1849633497777` | `concrete_base_construction_300mm_vertical_offset_between_eps_and_storage` |
| `1849633498888` | `concrete_base_construction_300mm_vertical_offset_between_urf_and_eps` |
| `1849633499999` | `concrete_base_construction_2m_x_2m_square_base` |
| `1849633720001` | `urf_tank_current_status` |
| `1849633900003` | `eps_tank_current_status` |
| `1849634300002` | `balance_tank_current_status` |
| `1849634690001` | `storage_tank_current_status` |
| `1849634950001` | `number_of_standpipes_to_be_implemented` |
| `1849635200001` | `existing_number_of_implemented_standpipes` |
| `1849635500001` | `site_security_and_perimeter_details` |

## RWS -- 1749621221728.json (37 ids)

| question_id | question_name |
|---|---|
| `1723459210015` | `dam_construction_implementation` |
| `1723459240022` | `installation_of_communal_rwh_system` |
| `1723459250020` | `installation_of_household_rwh_system` |
| `1723459310020` | `raw_water_main_implementation` |
| `1723459310033` | `reservoir_implementation` |
| `1723459310036` | `distribution_main_implementation` |
| `1723459310040` | `reticulation_implementation` |
| `1749621221731` | `project_name` |
| `1749621329696` | `village_name` |
| `1749621851234` | `type_of_project` |
| `1749621962298` | `inspection_date` |
| `1749622111239` | `borehole_implementation` |
| `1749622163234` | `desalination_implementation` |
| `1749622191234` | `pumps_implementation` |
| `1749622229234` | `gutters_implementation` |
| `1749622266234` | `tanks_implementation` |
| `1749622291234` | `project_target_group` |
| `1749622301234` | `base_construction_status` |
| `1749622571775` | `implementing_agencies` |
| `1749622695675` | `proposed_completion_date` |
| `1749622701234` | `construction_start_date` |
| `1749622715678` | `water_committee` |
| `1749622785185` | `can_take_sample` |
| `1749623661234` | `improvement_action` |
| `1749631041127` | `inspection_date` |
| `1749631041135` | `water_sample_collected` |
| `1749631041138` | `water_testing_method` |
| `1749631041143` | `lab_ecoli_count` |
| `1749631041144` | `lab_turbidity_ntu` |
| `1749631041145` | `lab_total_coliform` |
| `1749631041146` | `lab_fecal_coliform` |
| `1749631041147` | `lab_temperature_c` |
| `1749631041148` | `lab_ph` |
| `1749631041149` | `lab_conductivity` |
| `1749631041150` | `lab_salinity_ppt` |
| `1749631041155` | `infrastructure_status` |
| `1749631041156` | `major_issues` |

## Field-rename rules (config -> config)

- question_id (int) -> question_name = map[id]
- question_ids (list) -> question_names = [map[id]...]
- completion_qid / deadline_qid -> completion_qname / deadline_qname
- *_question_id (date/filter/scope/start_date/deadline/completion/sample/test_method) -> *_question_name
- date_question_ids (dict) -> date_question_names (values mapped)
- map formula.buckets[].all_of[].question_id -> question_name
- map filter question_id -> question_name

## Frontend readers to move in lockstep

- api blocks pass through expandApiHints `...rest` -- no code change, just config rename (question_name / date_question_name / option_value).
- expandApiHints overdue: completion_question_name -> out.question_name; deadline_question_name -> out.date_question_name.
- applyDashboardFilters option-filter: def.question_name -> criteria=option_equals:<question_name>:value.
- useMapByParent / DashboardMap: map-filter question_name + formula.
- serializeCriteria/Columns/Components -- DONE.
- custom components (IndividualEPSOverview, individual-overview/config/eps.js), water_quality_globals (sample_question_name / test_method_question_name), progress_definition (start_date_question_name / scope_question_name).
