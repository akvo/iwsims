# Plan: Pre-download Photos Command for Flow Data Seeder

## Problem
Currently, `process_photo` downloads images inside the row iteration loop:
- Memory consumed for each download (up to 50MB per image)
- Synchronous downloads slow down the seeder
- No caching - re-running seeder re-downloads same photos
- No way to review/fix failed URLs before seeding

## Solution

Create a **separate management command** `predownload_photos` that:
1. Scans CSV data to extract all photo URLs
2. **Downloads photos concurrently** (configurable workers, default 5)
3. Maintains a **success log** (URL → local path)
4. Creates a **failed log** with context for manual review/correction
5. `flow_data_seeder` uses success log to lookup local paths

## Concurrent Download Design

```
┌─────────────────────────────────────────────────────────────────┐
│                  ThreadPoolExecutor (5 workers)                 │
│                                                                 │
│  Worker 1: download(url_1) ─┐                                   │
│  Worker 2: download(url_2) ─┼─> Thread-safe queue ─> Log Writer │
│  Worker 3: download(url_3) ─┤                                   │
│  Worker 4: download(url_4) ─┤                                   │
│  Worker 5: download(url_5) ─┘                                   │
│                                                                 │
│  Progress: [████████░░░░░░░░░░░░] 45/100 photos                 │
└─────────────────────────────────────────────────────────────────┘
```

- Uses `concurrent.futures.ThreadPoolExecutor` for parallel downloads
- Thread-safe CSV writing with file lock
- Configurable `--workers` parameter (default: 5)
- Progress indicator showing completed/total

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Step 1: python manage.py predownload_photos --form_id=123      │
│                                                                 │
│  - Load CSV data                                                │
│  - Extract photo URLs with context (datapoint_id, question_id)  │
│  - Download each photo                                          │
│  - Write success log (for lookup)                               │
│  - Write failed log (for manual review)                         │
└─────────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Step 2: python manage.py flow_data_seeder --form_id=123        │
│                                                                 │
│  - Load success log into AnswerProcessor.photo_url_map          │
│  - Process rows using local paths from map                      │
└─────────────────────────────────────────────────────────────────┘
```

## Output Files

### Success Log: `storage/akvo-flow/photo_downloads_{form_id}.csv`
```csv
url,local_path,downloaded_at
https://example.com/photo1.jpg,/images/seeder_12345_100.jpg,2026-01-16T10:30:00
https://example.com/photo2.jpg,/images/seeder_12345_200.png,2026-01-16T10:30:05
```

**Filename format**: `seeder_{datapoint_id}_{mis_question_id}.{ext}`
- `datapoint_id`: Akvo Flow datapoint ID from CSV
- `mis_question_id`: MIS question ID (from storage/akvo-flow/data mapping)
- Combination is unique (one answer per datapoint+question)
- Example: `seeder_12345_100.jpg`, `seeder_12345_200.png`

**Note**: `local_path` is the **relative path** stored in `answer.name`.
Photos are saved directly to `STORAGE_PATH/images/` - no need for `storage.upload()`.

**Duplicate URL handling**: Same URL across different datapoints shares the same file.
Each (datapoint_id, question_id) pair is unique, so filenames are deterministic.

**File verification**: When loading success log, each file is verified to exist on disk.
Missing files are removed from the mapping and will be re-downloaded.

**URL Accessibility**: After download, images are accessible at:
- `http://localhost:3000/images/seeder_12345_100.jpg` (via nginx rewrite)
- Nginx config (`frontend/nginx/conf.d/default.conf` line 77-81) rewrites `/images/*` → `/storage/images/*`

### Failed Log: `storage/akvo-flow/{form_id}_predownload_photos_failed.csv`
For manual review and URL correction:
```csv
datapoint_id,mis_form_id,mis_question_id,url,error,failed_at
12345,1,42,https://example.com/broken.jpg,Connection timeout,2026-01-16T10:30:10
67890,1,42,https://invalid-url/photo.jpg,HTTP 404,2026-01-16T10:30:15
```

## Files to Create/Modify

### 1. NEW: `backend/utils/seeder_photo_downloader.py`
```python
import os
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from mis.settings import STORAGE_PATH
from utils.seeder_answer_processor import DownloadPhotoProcessor

class PhotoPreDownloader:
    """Pre-downloads photos concurrently and manages download logs."""

    DEFAULT_WORKERS = 5

    def __init__(self, form_id: int, workers: int = DEFAULT_WORKERS):
        self.form_id = form_id
        self.workers = workers
        self._lock = threading.Lock()  # Thread-safe log writing
        # Use STORAGE_PATH for CI/build compatibility
        self.log_dir = os.path.join(STORAGE_PATH, "akvo-flow")

    def get_success_log_path(self) -> str:
        return os.path.join(
            self.log_dir, f"photo_downloads_{self.form_id}.csv"
        )

    def get_failed_log_path(self) -> str:
        return os.path.join(
            self.log_dir, f"photo_download_failed_{self.form_id}.csv"
        )

    def load_success_log(self) -> Dict[str, str]:
        """Load URL -> local_path mapping from success log.

        Verifies each file exists on disk. Removes entries for missing files.
        This ensures re-download if file was deleted.
        """
        # Read CSV into dict
        # For each entry, verify file exists:
        #   full_path = os.path.join(STORAGE_PATH, local_path.lstrip('/'))
        #   if os.path.exists(full_path):
        #       result[url] = local_path
        # Return only verified entries

    def _append_success_log(self, url: str, local_path: str):
        """Thread-safe append to success log."""
        with self._lock:
            # Append row to CSV

    def _append_failed_log(self, entry: Dict, error: str):
        """Thread-safe append to failed log."""
        with self._lock:
            # Append row to CSV with datapoint_id, mis_form_id, etc.

    def _download_single(self, entry: Dict) -> Tuple[bool, Dict, str]:
        """
        Download single photo directly to STORAGE_PATH/images/.
        Returns: (success, entry, relative_path_or_error)
        """
        url = entry['url']
        try:
            # Download and validate image
            content = DownloadPhotoProcessor.download_image(url)
            if content is None:
                self._append_failed_log(entry, "Download failed")
                return (False, entry, "Download failed")

            # Validate image content
            ext = DownloadPhotoProcessor.validate_image_content(content)
            if ext is None:
                self._append_failed_log(entry, "Invalid image format")
                return (False, entry, "Invalid image format")

            # Generate unique filename: seeder_{datapoint_id}_{mis_question_id}.{ext}
            datapoint_id = entry['datapoint_id']
            question_id = entry['mis_question_id']
            filename = f"seeder_{datapoint_id}_{question_id}.{ext}"
            full_path = os.path.join(STORAGE_PATH, "images", filename)

            # Ensure images directory exists
            os.makedirs(os.path.dirname(full_path), exist_ok=True)

            # Write directly to storage (no temp file, no storage.upload)
            with open(full_path, 'wb') as f:
                f.write(content)

            # Return relative path for database (answer.name)
            relative_path = f"/images/{filename}"
            self._append_success_log(url, relative_path)
            return (True, entry, relative_path)

        except Exception as e:
            self._append_failed_log(entry, str(e))
            return (False, entry, str(e))

    def download_photos(
        self,
        photo_entries: List[Dict],
        existing_success: Dict[str, str],
        progress_callback: Callable = None
    ) -> Tuple[int, int]:
        """
        Download photos concurrently using ThreadPoolExecutor.
        Returns: (success_count, failed_count)
        """
        # Filter out already downloaded
        to_download = [
            e for e in photo_entries
            if e['url'] not in existing_success
        ]

        success_count = 0
        failed_count = 0

        with ThreadPoolExecutor(max_workers=self.workers) as executor:
            futures = {
                executor.submit(self._download_single, entry): entry
                for entry in to_download
            }

            for future in as_completed(futures):
                success, entry, result = future.result()
                if success:
                    success_count += 1
                else:
                    failed_count += 1

                if progress_callback:
                    progress_callback(success_count + failed_count, len(to_download))

        return success_count, failed_count

    @staticmethod
    def extract_photo_urls_with_context(
        df: pd.DataFrame,
        photo_questions: List[Question]
    ) -> List[Dict]:
        """
        Extract photo URLs with context for error tracking.
        Returns: [
            {
                'url': 'https://...',
                'datapoint_id': 12345,
                'mis_form_id': 1,
                'mis_question_id': 42
            },
            ...
        ]
        """
```

### 2. NEW: `backend/api/v1/v1_data/management/commands/predownload_photos.py`
```python
class Command(BaseCommand):
    help = 'Pre-download photos from CSV before running flow_data_seeder'

    def add_arguments(self, parser):
        parser.add_argument('--form_id', type=int, required=True)
        parser.add_argument('--workers', type=int, default=5,
                            help='Number of concurrent download workers')

    def handle(self, *args, **options):
        form_id = options['form_id']
        workers = options['workers']

        # Reuse SeederConfig (source_dir defaults to storage/akvo-flow)
        config = SeederConfig(flow_form_id=form_id)

        # 1. Load CSV data (parent + child) from config.source_dir
        # 2. Get photo questions for the form
        # 3. Extract URLs with context (datapoint_id, mis_form_id, etc.)
        # 4. Initialize downloader with worker count
        downloader = PhotoPreDownloader(form_id=form_id, workers=workers)

        # 5. Load existing success log (skip already downloaded)
        existing = downloader.load_success_log()

        # 6. Download concurrently with progress
        def print_progress(done, total):
            self.stdout.write(f"\rDownloading: {done}/{total}", ending='')

        success, failed = downloader.download_photos(
            photo_entries, existing, progress_callback=print_progress
        )

        # 7. Print summary
        self.stdout.write(f"\n✓ Downloaded: {success}")
        self.stdout.write(f"✗ Failed: {failed}")
        if failed > 0:
            self.stdout.write(f"Review: {downloader.get_failed_log_path()}")
```

### 3. MODIFY: `backend/utils/seeder_answer_processor.py`
```python
class AnswerProcessor:
    # Class-level cache populated before seeding
    photo_url_map: Dict[str, str] = {}

    @classmethod
    def set_photo_url_map(cls, url_map: Dict[str, str]):
        """Set the photo URL mapping from pre-download log."""
        cls.photo_url_map = url_map

    @staticmethod
    def process_photo(row_value):
        # Check pre-downloaded cache first
        if url in AnswerProcessor.photo_url_map:
            return AnswerProcessor.photo_url_map[url], None, None

        # Fallback: download on-demand
        stored_path = DownloadPhotoProcessor.process(url)
        return (stored_path or row_value), None, None
```

### 4. MODIFY: `backend/api/v1/v1_data/management/commands/flow_data_seeder.py`
Add loading of success log before processing:
```python
def handle(self, *args, **options):
    # ... existing setup ...

    # Load photo download log if exists
    photo_log = PhotoPreDownloader.load_success_log(form_id)
    if photo_log:
        AnswerProcessor.set_photo_url_map(photo_log)
        self._log_info(f"Loaded {len(photo_log)} pre-downloaded photos")

    # ... continue with existing flow ...
```

### 5. NEW: `backend/api/v1/v1_data/tests/tests_seeder_photo_downloader.py`
Unit tests for PhotoPreDownloader class (TDD approach - write tests first)

## TDD: Unit Tests (Write First)

### Test File: `backend/api/v1/v1_data/tests/tests_seeder_photo_downloader.py`

```python
"""
TDD Tests for PhotoPreDownloader - Write these BEFORE implementation.
Run: ./dc.sh exec backend python manage.py test \
     api.v1.v1_data.tests.tests_seeder_photo_downloader -v2
"""

import os
import tempfile
from unittest.mock import patch, MagicMock
from django.test import TestCase
from django.test.utils import override_settings


@override_settings(USE_TZ=False, TEST_ENV=True)
class PhotoPreDownloaderPathsTestCase(TestCase):
    """Test log file path generation."""

    def test_get_success_log_path(self):
        """Should return correct success log path for form_id."""
        from utils.seeder_photo_downloader import PhotoPreDownloader
        from mis.settings import STORAGE_PATH
        import os

        downloader = PhotoPreDownloader(form_id=123)
        path = downloader.get_success_log_path()

        expected = os.path.join(
            STORAGE_PATH, "akvo-flow", "photo_downloads_123.csv"
        )
        self.assertEqual(path, expected)

    def test_get_failed_log_path(self):
        """Should return correct failed log path for form_id."""
        from utils.seeder_photo_downloader import PhotoPreDownloader
        from mis.settings import STORAGE_PATH
        import os

        downloader = PhotoPreDownloader(form_id=456)
        path = downloader.get_failed_log_path()

        expected = os.path.join(
            STORAGE_PATH, "akvo-flow", "photo_download_failed_456.csv"
        )
        self.assertEqual(path, expected)


@override_settings(USE_TZ=False, TEST_ENV=True)
class PhotoPreDownloaderLoadLogTestCase(TestCase):
    """Test loading existing success log."""

    def test_load_success_log_returns_empty_dict_when_no_file(self):
        """Should return empty dict when log file doesn't exist."""
        from utils.seeder_photo_downloader import PhotoPreDownloader
        downloader = PhotoPreDownloader(form_id=99999)

        result = downloader.load_success_log()

        self.assertEqual(result, {})

    def test_load_success_log_returns_url_mapping(self):
        """Should return URL->path mapping from existing log."""
        from utils.seeder_photo_downloader import PhotoPreDownloader

        # Create temp CSV file
        with tempfile.NamedTemporaryFile(
            mode='w', suffix='.csv', delete=False
        ) as f:
            f.write("url,local_path,downloaded_at\n")
            f.write("https://example.com/a.jpg,./storage/images/a.jpg,2026-01-16\n")
            f.write("https://example.com/b.png,./storage/images/b.png,2026-01-16\n")
            temp_path = f.name

        try:
            downloader = PhotoPreDownloader(form_id=123)
            with patch.object(
                downloader, 'get_success_log_path', return_value=temp_path
            ):
                result = downloader.load_success_log()

            self.assertEqual(len(result), 2)
            self.assertEqual(
                result['https://example.com/a.jpg'],
                './storage/images/a.jpg'
            )
        finally:
            os.unlink(temp_path)


@override_settings(USE_TZ=False, TEST_ENV=True)
class PhotoPreDownloaderExtractUrlsTestCase(TestCase):
    """Test extracting photo URLs with context from DataFrame."""

    def test_extract_photo_urls_with_context(self):
        """Should extract URLs with datapoint_id, form_id, question_id."""
        import pandas as pd
        from utils.seeder_photo_downloader import PhotoPreDownloader

        # Mock DataFrame with photo column
        df = pd.DataFrame({
            'datapoint_id': [1001, 1002, 1003],
            'photo_question_42': [
                'https://example.com/photo1.jpg',
                'https://example.com/photo2.jpg',
                None,  # Should be skipped
            ]
        })

        # Mock photo question
        mock_question = MagicMock()
        mock_question.pk = 42
        mock_question.form_id = 1
        mock_question.name = 'photo_question_42'

        result = PhotoPreDownloader.extract_photo_urls_with_context(
            df=df,
            photo_questions=[mock_question]
        )

        self.assertEqual(len(result), 2)  # None should be skipped
        self.assertEqual(result[0]['url'], 'https://example.com/photo1.jpg')
        self.assertEqual(result[0]['datapoint_id'], 1001)
        self.assertEqual(result[0]['mis_form_id'], 1)
        self.assertEqual(result[0]['mis_question_id'], 42)

    def test_extract_photo_urls_skips_non_http_values(self):
        """Should skip values that are not HTTP URLs."""
        import pandas as pd
        from utils.seeder_photo_downloader import PhotoPreDownloader

        df = pd.DataFrame({
            'datapoint_id': [1001, 1002],
            'photo_q': [
                'https://example.com/photo.jpg',
                '/local/path/photo.jpg',  # Should be skipped
            ]
        })

        mock_question = MagicMock()
        mock_question.pk = 1
        mock_question.form_id = 1
        mock_question.name = 'photo_q'

        result = PhotoPreDownloader.extract_photo_urls_with_context(
            df=df, photo_questions=[mock_question]
        )

        self.assertEqual(len(result), 1)


@override_settings(USE_TZ=False, TEST_ENV=True)
class PhotoPreDownloaderDownloadTestCase(TestCase):
    """Test concurrent download functionality."""

    @patch('utils.seeder_photo_downloader.DownloadPhotoProcessor.download_image')
    def test_download_photos_skips_existing(self, mock_download):
        """Should skip URLs already in success log."""
        from utils.seeder_photo_downloader import PhotoPreDownloader

        downloader = PhotoPreDownloader(form_id=123, workers=2)

        entries = [
            {'url': 'https://example.com/a.jpg', 'datapoint_id': 1,
             'mis_form_id': 1, 'mis_question_id': 1},
            {'url': 'https://example.com/b.jpg', 'datapoint_id': 2,
             'mis_form_id': 1, 'mis_question_id': 1},
        ]
        # a.jpg already downloaded with relative path
        existing = {'https://example.com/a.jpg': '/images/a.jpg'}

        with patch.object(downloader, '_append_success_log'):
            with patch(
                'utils.seeder_photo_downloader.DownloadPhotoProcessor'
                '.validate_image_content', return_value='jpg'
            ):
                mock_download.return_value = b'\xff\xd8\xff'  # JPEG bytes
                success, failed = downloader.download_photos(entries, existing)

        # Only b.jpg should be downloaded
        mock_download.assert_called_once_with('https://example.com/b.jpg')
        self.assertEqual(success, 1)
        self.assertEqual(failed, 0)

    @patch('utils.seeder_photo_downloader.DownloadPhotoProcessor.download_image')
    def test_download_photos_handles_failure(self, mock_download):
        """Should track failed downloads."""
        from utils.seeder_photo_downloader import PhotoPreDownloader

        downloader = PhotoPreDownloader(form_id=123, workers=2)

        entries = [
            {'url': 'https://example.com/broken.jpg', 'datapoint_id': 1,
             'mis_form_id': 1, 'mis_question_id': 1},
        ]

        with patch.object(downloader, '_append_failed_log'):
            mock_download.return_value = None  # Simulate download failure
            success, failed = downloader.download_photos(entries, {})

        self.assertEqual(success, 0)
        self.assertEqual(failed, 1)

    @patch('utils.seeder_photo_downloader.DownloadPhotoProcessor.download_image')
    def test_download_photos_concurrent_execution(self, mock_download):
        """Should download multiple photos concurrently."""
        from utils.seeder_photo_downloader import PhotoPreDownloader
        import time

        def slow_download(url):
            time.sleep(0.1)  # Simulate network delay
            return b'\xff\xd8\xff'  # JPEG magic bytes

        mock_download.side_effect = slow_download
        downloader = PhotoPreDownloader(form_id=123, workers=5)

        entries = [
            {'url': f'https://example.com/photo{i}.jpg', 'datapoint_id': i,
             'mis_form_id': 1, 'mis_question_id': 1}
            for i in range(5)
        ]

        with patch.object(downloader, '_append_success_log'):
            with patch(
                'utils.seeder_photo_downloader.DownloadPhotoProcessor'
                '.validate_image_content', return_value='jpg'
            ):
                start = time.time()
                success, failed = downloader.download_photos(entries, {})
                elapsed = time.time() - start

        self.assertEqual(success, 5)
        # Should complete in ~0.1s (parallel), not ~0.5s (sequential)
        self.assertLess(elapsed, 0.3)

    def test_download_photos_calls_progress_callback(self):
        """Should call progress callback after each download."""
        from utils.seeder_photo_downloader import PhotoPreDownloader

        downloader = PhotoPreDownloader(form_id=123, workers=1)
        progress_calls = []

        def track_progress(done, total):
            progress_calls.append((done, total))

        entries = [
            {'url': 'https://example.com/a.jpg', 'datapoint_id': 1,
             'mis_form_id': 1, 'mis_question_id': 1},
            {'url': 'https://example.com/b.jpg', 'datapoint_id': 2,
             'mis_form_id': 1, 'mis_question_id': 1},
        ]

        with patch.object(downloader, '_append_success_log'):
            with patch(
                'utils.seeder_photo_downloader.DownloadPhotoProcessor'
                '.download_image', return_value=b'\xff\xd8\xff'
            ):
                with patch(
                    'utils.seeder_photo_downloader.DownloadPhotoProcessor'
                    '.validate_image_content', return_value='jpg'
                ):
                    downloader.download_photos(
                        entries, {}, progress_callback=track_progress
                    )

        self.assertEqual(len(progress_calls), 2)
        self.assertIn((1, 2), progress_calls)
        self.assertIn((2, 2), progress_calls)


@override_settings(USE_TZ=False, TEST_ENV=True)
class PhotoPreDownloaderLogWritingTestCase(TestCase):
    """Test thread-safe log writing."""

    def test_append_success_log_creates_file_with_header(self):
        """Should create CSV with header if file doesn't exist."""
        from utils.seeder_photo_downloader import PhotoPreDownloader

        with tempfile.TemporaryDirectory() as tmpdir:
            log_path = os.path.join(tmpdir, 'success.csv')
            downloader = PhotoPreDownloader(form_id=123)

            with patch.object(
                downloader, 'get_success_log_path', return_value=log_path
            ):
                # Relative path: seeder_{datapoint_id}_{question_id}.{ext}
                downloader._append_success_log(
                    'https://example.com/photo.jpg',
                    '/images/seeder_12345_100.jpg'
                )

            with open(log_path, 'r') as f:
                content = f.read()

            self.assertIn('url,local_path,downloaded_at', content)
            self.assertIn('https://example.com/photo.jpg', content)
            self.assertIn('/images/seeder_12345_100.jpg', content)

    def test_append_failed_log_includes_context(self):
        """Should include datapoint_id, mis_form_id, mis_question_id."""
        from utils.seeder_photo_downloader import PhotoPreDownloader

        with tempfile.TemporaryDirectory() as tmpdir:
            log_path = os.path.join(tmpdir, 'failed.csv')
            downloader = PhotoPreDownloader(form_id=123)

            entry = {
                'url': 'https://example.com/broken.jpg',
                'datapoint_id': 12345,
                'mis_form_id': 1,
                'mis_question_id': 42,
            }

            with patch.object(
                downloader, 'get_failed_log_path', return_value=log_path
            ):
                downloader._append_failed_log(entry, 'Connection timeout')

            with open(log_path, 'r') as f:
                content = f.read()

            self.assertIn('datapoint_id', content)
            self.assertIn('12345', content)
            self.assertIn('Connection timeout', content)
```

## TDD Implementation Order

1. **Write tests first** (above) - they will fail initially
2. **Implement `PhotoPreDownloader`** - make tests pass one by one
3. **Run tests after each method implementation**

```bash
# Run tests during TDD
./dc.sh exec backend python manage.py test \
  api.v1.v1_data.tests.tests_seeder_photo_downloader -v2
```

## Verification

### Unit Tests
```bash
./dc.sh exec backend python manage.py test \
  api.v1.v1_data.tests.tests_seeder_photo_downloader \
  api.v1.v1_data.tests.tests_flow_data_seeder_download_photo \
  --verbosity=2
```

### Manual Testing
```bash
# Step 1: Pre-download photos (default 5 concurrent workers)
./dc.sh exec backend python manage.py predownload_photos --form_id=123

# Or with custom worker count
./dc.sh exec backend python manage.py predownload_photos --form_id=123 --workers=10

# Check output files
cat storage/akvo-flow/photo_downloads_123.csv
cat storage/akvo-flow/123_predownload_photos_failed.csv

# Step 2: Verify images are accessible via browser
# Open: http://localhost:3000/images/seeder_<uuid>.jpg
# (Get filename from success log)

# Step 3: Run seeder (uses pre-downloaded photos)
./dc.sh exec backend python manage.py flow_data_seeder --form_id=123

# Step 4: Re-run predownload (should skip existing)
./dc.sh exec backend python manage.py predownload_photos --form_id=123

# Step 5: Verify in database
./dc.sh exec backend python manage.py shell
>>> from api.v1.v1_data.models import Answers
>>> Answers.objects.filter(name__startswith='/images/seeder_').first()
```

### Lint Check
```bash
cd backend && python -m flake8 \
  utils/seeder_photo_downloader.py \
  api/v1/v1_data/management/commands/predownload_photos.py
```

## Workflow for Users

1. **First time**: Run `predownload_photos` → Review failed log → Fix URLs if needed → Run `flow_data_seeder`
2. **Re-run**: `predownload_photos` skips already downloaded → Only downloads new URLs
3. **After URL fixes**: Delete failed entry, update CSV source, re-run `predownload_photos`
