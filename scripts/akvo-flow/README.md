# Akvo Flow Data Seeder Guide

This guide provides comprehensive documentation for migrating data from Akvo Flow to Akvo MIS. The process involves downloading forms and data from Akvo Flow, mapping administration and question data, and seeding the final data into Akvo MIS via Docker.

## Table of Contents

- [Environment Configuration](#environment-configuration)
- [Target Survey Configuration](#target-survey-configuration)
- [Prerequisites](#prerequisites)
- [Environment Setup](#environment-setup)
- [Step 1: Download Akvo Flow Forms and Data](#step-1-download-akvo-flow-forms-and-data)
- [Step 2: Map Administration Data](#step-2-map-administration-data)
- [Step 3: Map Akvo Flow Questions](#step-3-map-akvo-flow-questions)
- [Step 4: Generate Parent and Child Data Files](#step-4-generate-parent-and-child-data-files)
- [Step 5: Seed Akvo Flow Data](#step-5-seed-akvo-flow-data)
- [Output Files Reference](#output-files-reference)
- [Troubleshooting](#troubleshooting)

---

## Environment Configuration

Before running any Jupyter notebooks or data seeder commands, you must configure the connection to Akvo Flow instances. This setup is essential for authentication and API access to download forms, data, and perform mapping operations.

### Step 1: Create Environment File

Navigate to the Akvo Flow scripts directory and create a local environment file from the example template:

```bash
cd scripts/akvo-flow
cp env.example .env
```

### Step 2: Configure Environment Variables

Open the newly created [`.env`](./.env) file and populate the following variables with your actual credentials:

| Variable | Description | Example |
|----------|-------------|---------|
| `MIS_AUTH0_USER` | Your Auth0 username for authentication | `your_auth0_username` |
| `MIS_AUTH0_PWD` | Your Auth0 password for authentication | `your_auth0_password` |
| `MIS_AUTH0_CLIENT_ID` | Auth0 client ID for the application | `your_auth0_client_id` |
| `MIS_AUTH0_DOMAIN` | Auth0 domain URL for token endpoint | `https://akvofoundation.eu.auth0.com/oauth/token` |
| `MIS_AKVO_FLOW_INSTANCE_BASE_URL` | Base URL for Akvo Flow API | `https://api-auth0.akvo.org/flow/orgs/` |
| `MIS_CIPHER_KEYS` | Secret key for encryption/decryption operations | `secret` |
| `MIS_CIPHER_CHARS` | Secret characters for encryption/decryption operations | `secret` |

### Variable Details

#### Authentication Variables

- **`MIS_AUTH0_USER`**: Your Akvo Auth0 username. This is used to authenticate your identity when accessing Akvo Flow services.

- **`MIS_AUTH0_PWD`**: Your Akvo Auth0 password. Combined with the username, this provides the credentials needed for OAuth2 authentication.

- **`MIS_AUTH0_CLIENT_ID`**: The unique client identifier assigned to your application in Auth0. This identifies your application when requesting authentication tokens.

- **`MIS_AUTH0_DOMAIN`**: The Auth0 domain endpoint where authentication tokens are generated. This URL points to the OAuth2 token endpoint used for obtaining access tokens.

#### API Connection Variables

- **`MIS_AKVO_FLOW_INSTANCE_BASE_URL`**: The base URL for the Akvo Flow API. This is the root endpoint used to access Akvo Flow organization data, forms, and datapoints. The URL typically ends with `/flow/orgs/` and is used to construct specific API endpoints for different operations.

#### Encryption Variables

- **`MIS_CIPHER_KEYS`**: A secret key used for encryption and decryption operations. This is required for securing sensitive data during the data migration process.

- **`MIS_CIPHER_CHARS`**: Secret characters used in conjunction with the cipher keys for encryption operations. These values must match the configuration used by the Akvo MIS system to ensure proper data handling.

### Step 3: Verify Configuration

After configuring all variables, verify the configuration is correct:

```bash
# Check that the .env file exists
ls -la .env

# Verify the file contents (ensure credentials are set)
cat .env
```

### Important Notes

- **Security**: The [`.env`](./.env) file contains sensitive credentials. Never commit this file to version control. It is already listed in the project's [`.gitignore`](../../.gitignore).

- **Required Before Use**: All variables must be properly configured before running any Jupyter notebooks ([`af_downloader.ipynb`](./af_downloader.ipynb), [`af_administration_mapping.ipynb`](./af_administration_mapping.ipynb), [`af_forms_mapping.ipynb`](./af_forms_mapping.ipynb)) or the data seeder command.

- **Multiple Environments**: If you need to work with different Akvo Flow instances (e.g., staging and production), you can create separate environment files and switch between them as needed.

---

## Target Survey Configuration

Before executing the Jupyter notebooks, you must specify which Akvo Flow surveys/forms to process. This configuration is required for both downloading data and creating question mappings.

### Configure Survey IDs for Download

In [`af_downloader.ipynb`](./af_downloader.ipynb), locate the `flow_ids` list variable and update it with the survey IDs you want to download:

```python
flow_ids = [
    8520967,   # WTP - Water Treatment Plant
    17260923,  # WWTP - Wastewater Treatment Plant
    27040920,  # SPS - Pump Station
    1520924,   # EPS Water quality
    5530933,   # EPS Project Construction
    2490944,   # RWS - Rural Water Supply
]
```

**Purpose**: This list defines which Akvo Flow surveys will be downloaded and processed. Each ID corresponds to a specific survey form in your Akvo Flow instance.

**How to Find Survey IDs**:
1. Log in to your Akvo Flow instance
2. Navigate to the survey you want to download
3. The survey ID is typically visible in the URL or survey properties
4. Add the ID to the `flow_ids` list with a descriptive comment

### Configure Form Pairs for Mapping

In [`af_forms_mapping.ipynb`](./af_forms_mapping.ipynb), locate the `flow_ids` dictionary variable and update it with the form ID pairs:

```python
flow_ids = {
    "8520967": 1749634736797,   # WTP
    "17260923": 1748903240763,  # WWTP
    "27040920": 1749611049520,  # SPS (Pump Station)
    "1520924": 1749623934933,   # EPS Water quality
    "5530933": 1749623934933,   # EPS Project Construction
    "2490944": 1749621221728,   # RWS
}
```

**Purpose**: This dictionary maps Akvo Flow form IDs to their corresponding Akvo MIS form IDs. This mapping is essential for correctly associating questions between the two systems.

**Dictionary Structure**:
- **Key**: Akvo Flow form ID (string) - The ID from your Akvo Flow instance
- **Value**: Akvo MIS form ID (integer) - The corresponding form ID in Akvo MIS

**How to Find Form IDs**:
- **Akvo Flow IDs**: Same as the survey IDs used in [`af_downloader.ipynb`](./af_downloader.ipynb)
- **Akvo MIS IDs**: Log in to Akvo MIS, navigate to Forms, and find the form ID in the form details or URL

### Configuration Requirements

- **Consistency**: Ensure the Akvo Flow IDs in both notebooks match exactly
- **Complete Mapping**: Every survey you download must have a corresponding entry in the mapping dictionary
- **Valid MIS Forms**: The MIS form IDs must exist in your Akvo MIS instance
- **Order Independence**: The order of entries in both variables does not matter

### Verification

After configuring both variables:

1. Verify all Akvo Flow IDs are present in both notebooks
2. Confirm each Akvo Flow ID has a corresponding MIS form ID in [`af_forms_mapping.ipynb`](./af_forms_mapping.ipynb)
3. Check that the MIS form IDs reference valid forms in your Akvo MIS system
4. Run the notebooks and review the output for any mapping errors

### Example Workflow

If you want to add a new survey called "Sanitation Survey" with Flow ID `9999999` and MIS ID `1999999999`:

1. **Update [`af_downloader.ipynb`](./af_downloader.ipynb)**:
   ```python
   flow_ids = [
       8520967,   # WTP
       17260923,  # WWTP
       27040920,  # SPS
       1520924,   # EPS Water quality
       5530933,   # EPS Project Construction
       2490944,   # RWS
       9999999,   # Sanitation Survey
   ]
   ```

2. **Update [`af_forms_mapping.ipynb`](./af_forms_mapping.ipynb)**:
   ```python
   flow_ids = {
       "8520967": 1749634736797,   # WTP
       "17260923": 1748903240763,  # WWTP
       "27040920": 1749611049520,  # SPS
       "1520924": 1749623934933,   # EPS Water quality
       "5530933": 1749623934933,   # EPS Project Construction
       "2490944": 1749621221728,   # RWS
       "9999999": 1999999999,       # Sanitation Survey
   }
   ```

3. **Run the notebooks** in order to download and map the new survey data.

---

## Prerequisites

Before proceeding with the Akvo Flow Data Seeder, ensure the following prerequisites are met:

- **Docker** > v19
- **Docker Compose** > v2.1
- **JupyterLab** installed and accessible
- **Python** environment with required dependencies
- Valid Akvo Flow API credentials
- Properly configured `.env` file with complete setup values
- Docker containers up and running (for the seeding step)

---

## Environment Setup

### Navigate to the Scripts Directory

Begin by navigating to the Akvo Flow scripts directory:

```bash
cd scripts/akvo-flow
```

### Start JupyterLab

Launch JupyterLab to access the interactive notebooks:

```bash
jupyterlab .
```

This will open JupyterLab in your default web browser, typically at `http://localhost:8888`. From here, you can access the following notebooks:

- [`af_downloader.ipynb`](./af_downloader.ipynb) - Downloads forms and data from Akvo Flow
- [`af_administration_mapping.ipynb`](./af_administration_mapping.ipynb) - Maps administration/cascade data
- [`af_forms_mapping.ipynb`](./af_forms_mapping.ipynb) - Maps Akvo Flow questions to MIS forms

---

## Step 1: Download Akvo Flow Forms and Data

### Purpose

This step retrieves all forms and associated data from Akvo Flow, preparing them for mapping and subsequent seeding into Akvo MIS.

### Procedure

1. Open [`af_downloader.ipynb`](./af_downloader.ipynb) in JupyterLab
2. Run all cells in the notebook sequentially

```bash
# In JupyterLab, navigate to af_downloader.ipynb
# Click "Run All" or execute each cell individually
```

### Output Files

After successful execution, the following outputs are generated:

#### Forms Output

Forms are saved to the following directory:

```bash
ls -1 scripts/akvo-flow/output/flow_forms
```

**Expected Output:**
- Form definition files in JSON format
- Each file represents a complete form structure from Akvo Flow
- Files are named according to their survey identifiers

#### Data Output

Data files are saved to the following directory:

```bash
ls -1 backend/source/akvo-flow/data
```

**Expected Output:**
- Raw data files from Akvo Flow datapoints
- Files contain submission data for each form
- Data is structured for subsequent processing and mapping

### Verification

To verify the download was successful:

```bash
# Check forms directory
ls -lh scripts/akvo-flow/output/flow_forms

# Check data directory
ls -lh backend/source/akvo-flow/data
```

Both directories should contain files corresponding to your Akvo Flow surveys.

---

## Step 2: Map Administration Data

### Purpose

This step maps the cascade (hierarchical) administration data from Akvo Flow to the corresponding administrative levels in Akvo MIS. This ensures that geographic and organizational data aligns correctly between the two systems.

### Procedure

1. Open [`af_administration_mapping.ipynb`](./af_administration_mapping.ipynb) in JupyterLab
2. Run all cells in the notebook sequentially

```bash
# In JupyterLab, navigate to af_administration_mapping.ipynb
# Click "Run All" or execute each cell individually
```

### Output Files

After successful execution, the following CSV files are generated in the output directory:

```bash
ls -1 backend/source/akvo-flow
```

#### 1. `administration_mapping.csv`

**Description:** A comprehensive list of all administration data from Akvo Flow, indicating whether each administrative unit exists in Akvo MIS.

**Purpose:**
- Provides a complete mapping between Akvo Flow and Akvo MIS administrative units
- Identifies which administrations have been successfully mapped
- Used as a reference for data integrity verification

**Expected Contents:**
- Columns: Akvo Flow administration ID, name, level, MIS administration ID (if mapped), mapping status
- All administrative levels present in Akvo Flow data

#### 2. `administration_missing.csv`

**Description:** A list of administrative units from Akvo Flow that are **not** available in Akvo MIS.

**Purpose:**
- **Debugging tool** - Identifies gaps in the administration hierarchy
- Highlights which administrative units need to be created in Akvo MIS before seeding
- Helps ensure data completeness and accuracy

**Expected Contents:**
- Columns: Akvo Flow administration ID, name, level, parent hierarchy
- Only contains unmapped/missing administrations

### Handling Missing Administrations

If [`administration_missing.csv`](backend/source/akvo-flow/administration_missing.csv) contains entries:

1. Review the missing administrative units
2. Create the missing administrations in Akvo MIS using the administration management interface
3. Re-run the mapping notebook to verify all units are now mapped
4. Proceed to the next step only when [`administration_missing.csv`](backend/source/akvo-flow/administration_missing.csv) is empty or contains only acceptable omissions

### Verification

```bash
# View administration mapping
cat backend/source/akvo-flow/administration_mapping.csv

# Check for missing administrations
cat backend/source/akvo-flow/administration_missing.csv
```

---

## Step 3: Map Akvo Flow Questions

### Purpose

This step maps Akvo Flow questions to the corresponding form structure in Akvo MIS. It ensures that question types, options, and dependencies are correctly translated between the two systems.

### Procedure

1. Open [`af_forms_mapping.ipynb`](./af_forms_mapping.ipynb) in JupyterLab
2. Run all cells in the notebook sequentially

```bash
# In JupyterLab, navigate to af_forms_mapping.ipynb
# Click "Run All" or execute each cell individually
```

### Output Files

After successful execution, CSV files are generated in the following directory:

```bash
ls -1 backend/source/akvo-flow/forms
```

### File Naming Convention

Each form mapping file is named using the following pattern:

```
{flow_form_id}_mapping_{parent|child}_{mis_form_id}.csv
```

**Examples:**
- `8520967_mapping_parent_1749634736797.csv` - Parent form mappings
- `8520967_mapping_child_1749640508297.csv` - Child form mappings
- `8520967_mapping_child_1749652214711.csv` - Child form mappings

### File Contents

Each CSV file contains the following columns:

| Column | Description |
|--------|-------------|
| `flow_form_id` | Akvo Flow form/survey ID |
| `flow_question_group` | Question group name in Flow |
| `flow_question_label` | Question text from Flow |
| `flow_question_id` | Question ID in Flow |
| `mis_form_id` | MIS form ID (mapped question) |
| `mis_question_group` | Question group name in MIS |
| `mis_question_label` | Question text in MIS |
| `mis_question_id` | Question ID in MIS |
| `match_score` | Similarity score (0-100) |
| `match_confidence` | Confidence level: `high`, `medium`, `low`, `none` |
| `match_method` | Matching method: `text_similarity`, `manual`, `none` |

### Matching Methods

The notebook uses three matching methods:

| Method | Description | When Used |
|--------|-------------|-----------|
| `text_similarity` | Auto-matched via fuzzy text matching (score >= 80%) | Questions with high text similarity |
| `none` | No match found (score < 80%) | Questions without suitable matches |
| `manual` | User manually assigned | Preserved when notebook is re-run |

### Manual Matching Workflow

When the auto-matching produces incorrect or incomplete results, you can manually edit the CSV files:

1. **Run the notebook** - Generate initial mappings
2. **Review the output** - Check `match_method` and `match_confidence` columns
3. **Edit CSV files** - Open in spreadsheet software (Excel, LibreOffice)
4. **Update incorrect matches** - Change `mis_question_id` and other MIS columns
5. **Set `match_method = 'manual'`** - Mark your manual edits
6. **Re-run the notebook** - Manual matches will be preserved!

**Example Manual Edit:**

```csv
flow_form_id,flow_question_label,flow_question_id,mis_question_id,mis_question_label,match_method,match_score
8520967,"What is the pH level?",123456,999999,"pH Level",text_similarity,85.00
8520967,"Water Temperature",123457,888888,"Temperature",none,45.23  <-- Poor match
```

**After Manual Edit:**

```csv
flow_form_id,flow_question_label,flow_question_id,mis_question_id,mis_question_label,match_method,match_score
8520967,"What is the pH level?",123456,999999,"pH Level",text_similarity,85.00
8520967,"Water Temperature",123457,777777,"Water Temp Quality",manual,100.00  <-- Manual override
```

**Next Run:**
- Row 1: Auto-matched (unchanged)
- Row 2: Manual match **preserved** (not overwritten)

### Verification

```bash
# List all generated mapping files
ls -1 backend/source/akvo-flow/forms/*.csv

# View a specific mapping file
head -10 backend/source/akvo-flow/forms/8520967_mapping_parent_1749634736797.csv

# Check match methods in file
cut -d',' -f11 backend/source/akvo-flow/forms/8520967_mapping_parent_1749634736797.csv | sort | uniq -c
```

**Expected Output:**
```
    150 text_similarity
     20 manual
     30 none
```

Ensure that mapping files exist for all forms you intend to seed.

---

## Step 4: Generate Parent and Child Data Files

### Purpose

This step processes the downloaded Flow data and question mappings to generate final parent and child data CSV files. These files are structured for import into Akvo MIS and include proper transformations for different question types (geo, administration, caddisfly, etc.).

### Procedure

1. Open `af_data_registration_monitoring.ipynb` in JupyterLab
2. Update the `flow_form_id` variable with the survey ID you want to process:
   ```python
   flow_form_id = '2490944'  # Update with your target survey ID
   ```
3. Run all cells in the notebook sequentially

```bash
# In JupyterLab, navigate to af_data_registration_monitoring.ipynb
# Click "Run All" or execute each cell individually
```

### Output Files

After successful execution, CSV files are generated in the output directory:

```bash
ls -1 backend/source/akvo-flow/output
```

### File Naming Convention

Two types of files are generated for each form:

```
{flow_form_id}_parent_data.csv
{flow_form_id}_child_data.csv
```

**Example:**
- `2490944_parent_data.csv` - Main form submissions
- `2490944_child_data.csv` - Repeating group submissions

### File Contents

#### Parent Data File

Contains the main form submissions with:
- **Form metadata** - Form ID, identifier, creation date, datapoint ID
- **Name** - Generated from meta questions or display name
- **Administration** - Mapped administrative location
- **Geo coordinates** - Location data in `lat|lon` format
- **Question responses** - All mapped question answers

#### Child Data File

Contains repeating group submissions with:
- **Form metadata** - Form ID, identifier, creation date, datapoint ID
- **Name** - Generated from meta questions
- **Question responses** - All mapped question answers from repeating groups

### Data Transformations

The notebook applies automatic transformations for different question types:

| Question Type | Transformation | Example |
|---------------|----------------|----------|
| **Administration** | Converts to pipe-separated hierarchy | `Region\|District\|Village` |
| **Geo** | Formats as latitude and longitude | `-1.234567\|36.789012` |
| **Photo/Signature** | Converts to base64 data URI or filename | `data:image/png;base64,...` |
| **Multiple Choice** | Converts to pipe-separated option values | `option1\|option2\|other` |
| **Number** | Removes whitespace and converts to float | `123.45` |
| **Caddisfly** | Extracts test results as separate fields | See Caddisfly section below |

### Caddisfly Data Handling

For water quality tests using Caddisfly:

1. Test results are extracted into separate columns
2. Each parameter (e.g., pH, Turbidity) gets its own column
3. Column names include units: `pH -`, `Turbidity NTU`
4. The last result value is stored in the parent/child data
5. Full test data is saved to `backend/source/akvo-flow/caddisfly/{flow_form_id}_caddisfly_data.csv`

### Data Quality Filters

The notebook applies the following filters:

**Parent Data:**
- Removes duplicate records based on name
- Filters out records with missing administration or geo data
- Only includes records with complete location information

**Child Data:**
- Filters based on datapoint_id present in parent data
- Removes empty rows (where all values are null or empty)
- Ensures referential integrity with parent records

### Console Output

The notebook displays processing statistics:

```
total parent records: 150
parent data saved
total child records after filtering: 75
child data saved
caddisfly data saved
```

### Verification

```bash
# Check parent data file
wc -l backend/source/akvo-flow/output/{flow_form_id}_parent_data.csv

# Check child data file
wc -l backend/source/akvo-flow/output/{flow_form_id}_child_data.csv

# View first few rows of parent data
head -5 backend/source/akvo-flow/output/{flow_form_id}_parent_data.csv
```

Ensure:
- Parent data file contains records with complete administration and geo fields
- Child data records reference valid parent datapoint_ids
- No duplicate parent records exist
- All question types are properly transformed

### Common Issues

**Issue:** "No parent records generated"
- **Cause:** All records missing administration or geo data
- **Solution:** Check source data quality and administration mappings

**Issue:** "Child records not filtered"
- **Cause:** Datapoint IDs don't match between parent and child
- **Solution:** Verify data consistency in source Flow data

**Issue:** "Caddisfly data not parsed"
- **Cause:** Caddisfly question not properly identified
- **Solution:** Check question mapping includes caddisfly question type

---

## Step 5: Seed Akvo Flow Data

### Purpose

This final step imports the generated parent and child data files into the Akvo MIS database using Django's management command. It processes the prepared data, validates it, and stores it in the appropriate database tables.

### Prerequisites

Before executing the seeding command, ensure:

1. Docker Compose is running with complete setup
2. The `.env` file contains proper configuration values
3. All previous steps (Steps 1-3) have been completed successfully
4. Administration mappings have been verified and missing units addressed

### Start Docker Containers

If the containers are not already running:

```bash
./dc-mobile.sh up -d
```

This command starts the mobile app development environment, which includes the backend container needed for data seeding.

### Access the Backend Container

Open a bash session within the backend container:

```bash
./dc-mobile.sh exec backend bash
```

You will now be inside the backend container with access to Django management commands.

### Execute the Data Seeder Command

Run the flow data seeder management command:

```bash
python manage.py flow_data_seeder --form=<akvo_flow_survey_id> --email=<youremail@domain.com>
```

#### Command Parameters

| Parameter | Type | Default | Description | Example |
|-----------|------|---------|-------------|---------|
| `--form` | int | required | The Akvo Flow survey ID to seed | `--form=12345` |
| `--email` | string | required | Email address for notifications and logging | `--email=user@example.com` |
| `--limit` | int | None | Limit the number of records to process | `--limit=100` |
| `--revert` | bool | False | Revert previously seeded data for the specified form | `--revert=True` |

#### Example Usage

**Basic seeding:**
```bash
python manage.py flow_data_seeder --form=12345 --email=admin@akvo.org
```

**Seeding with a record limit:**
```bash
python manage.py flow_data_seeder --form=12345 --email=admin@akvo.org --limit=50
```

**Reverting previously seeded data:**
```bash
python manage.py flow_data_seeder --form=12345 --email=admin@akvo.org --revert=True
```

### Process Overview

The seeder performs the following operations:

1. **Data Validation** - Validates the mapped data against MIS schema
2. **Data Transformation** - Converts data formats to match MIS requirements
3. **Database Insertion** - Inserts validated data into MIS tables
4. **Error Handling** - Captures and logs any issues encountered
5. **Status Reporting** - Generates summary reports of the seeding operation

**Optional Processing Modes:**

- **Limited Processing** - When `--limit` is specified, only processes the specified number of records. This is useful for testing or incremental seeding.

- **Revert Mode** - When `--revert=True` is specified, the seeder removes previously seeded data for the specified form from the MIS database. This is useful for:
  - Correcting data import errors
  - Re-running the seeding process after fixing mapping issues
  - Cleaning up test data

### Output Files

After execution, the seeder generates CSV files in the following locations:

```bash
# Output directory location
backend/source/akvo-flow/output/
```

#### 1. `caddisfly.csv`

**Description:** Contains all Caddisfly water quality testing data included in the Akvo Flow datapoints.

**Purpose:**
- Preserves water quality measurement data
- Links Caddisfly test results to specific datapoints
- Enables tracking of water quality metrics over time

**Expected Contents:**
- Caddisfly test IDs, timestamps, test results
- Associated datapoint references
- Water quality parameters (pH, turbidity, etc.)

#### 2. `invalid_values.csv`

**Description:** Contains all Akvo Flow values that are not supported or valid in Akvo MIS.

**Purpose:**
- **Debugging tool** - Identifies data compatibility issues
- Helps refine mapping rules for future imports
- Provides a record of excluded data for audit purposes

**Expected Contents:**
- Datapoint IDs with invalid values
- Question IDs and invalid value details
- Reason for exclusion (e.g., unsupported type, out of range)

#### 3. `seeded.csv`

**Description:** Contains all successfully seeded Akvo Flow datapoints that have been uploaded and stored in the Akvo MIS database.

**Purpose:**
- Confirmation of successful data migration
- Reference for tracking which data has been imported
- Basis for reconciliation between Akvo Flow and Akvo MIS

**Expected Contents:**
- Datapoint IDs from Akvo Flow
- Corresponding MIS data IDs
- Submission timestamps and status

### Verification

After the seeding process completes, verify the results:

```bash
# Check seeded data count
cat backend/source/akvo-flow/output/seeded.csv | wc -l

# Review any invalid values
cat backend/source/akvo-flow/output/invalid_values.csv

# Check Caddisfly data
cat backend/source/akvo-flow/output/caddisfly.csv
```

### Exit the Backend Container

When finished, exit the backend container:

```bash
exit
```

---

## Output Files Reference

### Directory Structure

```
backend/source/akvo-flow/
├── data/                          # Raw Akvo Flow data
│   ├── {survey_id}_data.json
│   └── ...
├── administration_mapping.csv     # Administration mapping status
├── administration_missing.csv     # Missing administrations (debug)
├── {surveyId}_{surveyName}.csv   # Form question mappings
└── output/                        # Seeding output files
    ├── caddisfly.csv              # Caddisfly test data
    ├── invalid_values.csv         # Invalid/unsupported values
    └── seeded.csv                 # Successfully seeded datapoints

scripts/akvo-flow/
└── output/
    └── flow_forms/                # Downloaded form definitions
        ├── {survey_id}_form.json
        └── ...
```

### File Summary

| File | Location | Purpose |
|------|----------|---------|
| Form definitions | `scripts/akvo-flow/output/flow_forms/` | Downloaded Akvo Flow form structures |
| Raw data | `backend/source/akvo-flow/data/` | Downloaded Akvo Flow datapoint data |
| Administration mapping | `backend/source/akvo-flow/administration_mapping.csv` | Maps Akvo Flow administrations to MIS |
| Administration missing | `backend/source/akvo-flow/administration_missing.csv` | Lists unmapped administrations |
| Form question mappings | `backend/source/akvo-flow/{surveyId}_{surveyName}.csv` | Maps questions per form |
| Caddisfly data | `backend/source/akvo-flow/output/caddisfly.csv` | Water quality test results |
| Invalid values | `backend/source/akvo-flow/output/invalid_values.csv` | Unsupported values for debugging |
| Seeded data | `backend/source/akvo-flow/output/seeded.csv` | Successfully imported datapoints |

---

## Troubleshooting

### Common Issues and Solutions

#### Issue: JupyterLab fails to start

**Symptoms:** Command `jupyterlab .` returns an error or fails to open in browser.

**Solutions:**
```bash
# Install JupyterLab if not present
pip install jupyterlab

# Check if port 8888 is already in use
lsof -i :8888

# Use a different port
jupyterlab . --port 8889
```

#### Issue: Administration mapping shows missing entries

**Symptoms:** [`administration_missing.csv`](backend/source/akvo-flow/administration_missing.csv) contains entries after running the mapping notebook.

**Solutions:**
1. Review the missing administrations in the CSV file
2. Create the missing administrative units in Akvo MIS
3. Re-run the [`af_administration_mapping.ipynb`](./af_administration_mapping.ipynb) notebook
4. Verify the CSV is now empty or contains only acceptable omissions

#### Issue: Seeder command fails with database connection error

**Symptoms:** `python manage.py flow_data_seeder` returns a database connection error.

**Solutions:**
```bash
# Verify Docker containers are running
docker ps

# Restart the backend container
./dc-mobile.sh restart backend

# Check database connection in .env
cat .env | grep DB_
```

#### Issue: Invalid values CSV contains many entries

**Symptoms:** [`invalid_values.csv`](backend/source/akvo-flow/output/invalid_values.csv) contains a large number of entries.

**Solutions:**
1. Review the invalid values to understand the pattern
2. Update the mapping rules in [`af_forms_mapping.ipynb`](./af_forms_mapping.ipynb) to handle these cases
3. Consider if the values should be excluded or transformed
4. Re-run the mapping and seeding process

#### Issue: Seeded data count doesn't match expected

**Symptoms:** [`seeded.csv`](backend/source/akvo-flow/output/seeded.csv) contains fewer entries than expected.

**Solutions:**
1. Check [`invalid_values.csv`](backend/source/akvo-flow/output/invalid_values.csv) for excluded data
2. Verify administration mappings are complete
3. Review form question mappings for errors
4. Check backend container logs for errors:
   ```bash
   ./dc-mobile.sh log --follow backend
   ```

#### Issue: Need to re-seed data after fixing mapping issues

**Symptoms:** Data was seeded with incorrect mappings and needs to be removed before re-seeding.

**Solutions:**
1. Use the `--revert=True` parameter to remove previously seeded data:
   ```bash
   python manage.py flow_data_seeder --form=<akvo_flow_survey_id> --email=<youremail@domain.com> --revert=True
   ```
2. Fix the mapping issues in the appropriate Jupyter notebook
3. Re-run the seeding command without the revert flag:
   ```bash
   python manage.py flow_data_seeder --form=<akvo_flow_survey_id> --email=<youremail@domain.com>
   ```

#### Issue: Testing with a subset of data

**Symptoms:** Want to test the seeding process without processing all records.

**Solutions:**
1. Use the `--limit` parameter to process only a specified number of records:
   ```bash
   python manage.py flow_data_seeder --form=<akvo_flow_survey_id> --email=<youremail@domain.com> --limit=10
   ```
2. Verify the output files and results
3. If satisfied, run the full seeding without the limit parameter

### Getting Help

If you encounter issues not covered in this guide:

1. Review the Jupyter notebook cell outputs for detailed error messages
2. Check the backend container logs for runtime errors
3. Verify all prerequisites and configuration values
4. Consult the main [Akvo MIS README](../../README.md) for general setup information

---

## Additional Resources

- [Main Akvo MIS Documentation](../../README.md)
- [Django Management Commands](../../backend/api/v1/v1_data/management/commands/flow_data_seeder.py)
- [Jupyter Notebooks](./)
