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

        downloader = PhotoPreDownloader(form_id=456)
        path = downloader.get_failed_log_path()

        expected = os.path.join(
            STORAGE_PATH, "akvo-flow", "456_predownload_photos_failed.csv"
        )
        self.assertEqual(path, expected)

    def test_custom_workers_count(self):
        """Should accept custom worker count."""
        from utils.seeder_photo_downloader import PhotoPreDownloader

        downloader = PhotoPreDownloader(form_id=123, workers=10)
        self.assertEqual(downloader.workers, 10)

    def test_default_workers_count(self):
        """Should use default 5 workers."""
        from utils.seeder_photo_downloader import PhotoPreDownloader

        downloader = PhotoPreDownloader(form_id=123)
        self.assertEqual(downloader.workers, 5)


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

        # Create temp dir structure
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create images directory and dummy files
            images_dir = os.path.join(tmpdir, 'images')
            os.makedirs(images_dir)

            # Create actual image files (required for verification)
            file_a = os.path.join(images_dir, 'seeder_1001_42.jpg')
            file_b = os.path.join(images_dir, 'seeder_1002_42.png')
            with open(file_a, 'wb') as f:
                f.write(b'fake_jpg')
            with open(file_b, 'wb') as f:
                f.write(b'fake_png')

            # Create CSV log
            log_path = os.path.join(tmpdir, 'photo_downloads_123.csv')
            with open(log_path, 'w') as f:
                f.write("url,local_path,downloaded_at\n")
                f.write(
                    "https://example.com/a.jpg,"
                    "/images/seeder_1001_42.jpg,2026-01-16\n"
                )
                f.write(
                    "https://example.com/b.png,"
                    "/images/seeder_1002_42.png,2026-01-16\n"
                )

            with patch.object(
                PhotoPreDownloader, '__init__', lambda self, **kwargs: None
            ):
                downloader = PhotoPreDownloader(form_id=123)
                downloader.form_id = 123
                downloader.log_dir = tmpdir

                # Patch STORAGE_PATH to use tmpdir
                with patch(
                    'utils.seeder_photo_downloader.STORAGE_PATH', tmpdir
                ):
                    with patch.object(
                        downloader, 'get_success_log_path',
                        return_value=log_path
                    ):
                        result = downloader.load_success_log()

            self.assertEqual(len(result), 2)
            self.assertEqual(
                result['https://example.com/a.jpg'],
                '/images/seeder_1001_42.jpg'
            )
            self.assertEqual(
                result['https://example.com/b.png'],
                '/images/seeder_1002_42.png'
            )

    def test_load_success_log_skips_missing_files(self):
        """Should skip entries where file doesn't exist on disk."""
        from utils.seeder_photo_downloader import PhotoPreDownloader

        with tempfile.TemporaryDirectory() as tmpdir:
            # Create images directory with only one file
            images_dir = os.path.join(tmpdir, 'images')
            os.makedirs(images_dir)

            # Only create file_a, not file_b
            file_a = os.path.join(images_dir, 'seeder_1001_42.jpg')
            with open(file_a, 'wb') as f:
                f.write(b'fake_jpg')

            # CSV has two entries but only one file exists
            log_path = os.path.join(tmpdir, 'photo_downloads_123.csv')
            with open(log_path, 'w') as f:
                f.write("url,local_path,downloaded_at\n")
                f.write(
                    "https://example.com/a.jpg,"
                    "/images/seeder_1001_42.jpg,2026-01-16\n"
                )
                f.write(
                    "https://example.com/b.png,"
                    "/images/seeder_1002_42.png,2026-01-16\n"
                )

            with patch.object(
                PhotoPreDownloader, '__init__', lambda self, **kwargs: None
            ):
                downloader = PhotoPreDownloader(form_id=123)
                downloader.form_id = 123
                downloader.log_dir = tmpdir

                with patch(
                    'utils.seeder_photo_downloader.STORAGE_PATH', tmpdir
                ):
                    with patch.object(
                        downloader, 'get_success_log_path',
                        return_value=log_path
                    ):
                        result = downloader.load_success_log()

            # Only the entry with existing file should be returned
            self.assertEqual(len(result), 1)
            self.assertIn('https://example.com/a.jpg', result)
            self.assertNotIn('https://example.com/b.png', result)


@override_settings(USE_TZ=False, TEST_ENV=True)
class PhotoPreDownloaderExtractUrlsTestCase(TestCase):
    """Test extracting photo URLs with context from DataFrame."""

    def test_extract_photo_urls_with_context(self):
        """Should extract URLs with datapoint_id, form_id, question_id."""
        import pandas as pd
        from utils.seeder_photo_downloader import PhotoPreDownloader

        # Mock DataFrame with photo column (column name is question ID)
        df = pd.DataFrame({
            'datapoint_id': [1001, 1002, 1003],
            '42': [
                'https://example.com/photo1.jpg',
                'https://example.com/photo2.jpg',
                None,  # Should be skipped
            ]
        })

        # Mock photo question
        mock_question = MagicMock()
        mock_question.pk = 42
        mock_question.form_id = 1

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
            '1': [
                'https://example.com/photo.jpg',
                '/local/path/photo.jpg',  # Should be skipped
            ]
        })

        mock_question = MagicMock()
        mock_question.pk = 1
        mock_question.form_id = 1

        result = PhotoPreDownloader.extract_photo_urls_with_context(
            df=df, photo_questions=[mock_question]
        )

        self.assertEqual(len(result), 1)

    def test_extract_photo_urls_handles_multiple_questions(self):
        """Should extract URLs from multiple photo questions."""
        import pandas as pd
        from utils.seeder_photo_downloader import PhotoPreDownloader

        df = pd.DataFrame({
            'datapoint_id': [1001],
            '1': ['https://example.com/photo1.jpg'],
            '2': ['https://example.com/photo2.jpg'],
        })

        mock_q1 = MagicMock()
        mock_q1.pk = 1
        mock_q1.form_id = 1

        mock_q2 = MagicMock()
        mock_q2.pk = 2
        mock_q2.form_id = 1

        result = PhotoPreDownloader.extract_photo_urls_with_context(
            df=df, photo_questions=[mock_q1, mock_q2]
        )

        self.assertEqual(len(result), 2)
        urls = [r['url'] for r in result]
        self.assertIn('https://example.com/photo1.jpg', urls)
        self.assertIn('https://example.com/photo2.jpg', urls)


@override_settings(USE_TZ=False, TEST_ENV=True)
class PhotoPreDownloaderDownloadTestCase(TestCase):
    """Test concurrent download functionality."""

    @patch(
        'utils.seeder_photo_downloader.DownloadPhotoProcessor.download_image'
    )
    def test_download_photos_skips_existing(self, mock_download):
        """Should skip URLs already in success log."""
        from utils.seeder_photo_downloader import PhotoPreDownloader

        with tempfile.TemporaryDirectory() as tmpdir:
            downloader = PhotoPreDownloader(form_id=123, workers=2)
            downloader.log_dir = tmpdir

            entries = [
                {'url': 'https://example.com/a.jpg', 'datapoint_id': 1,
                 'mis_form_id': 1, 'mis_question_id': 1},
                {'url': 'https://example.com/b.jpg', 'datapoint_id': 2,
                 'mis_form_id': 1, 'mis_question_id': 2},
            ]
            # a.jpg already downloaded with relative path
            existing = {'https://example.com/a.jpg': '/images/seeder_1_1.jpg'}

            with patch.object(downloader, '_append_success_log'):
                with patch(
                    'utils.seeder_photo_downloader.DownloadPhotoProcessor'
                    '.validate_image_content', return_value='jpg'
                ):
                    with patch(
                        'utils.seeder_photo_downloader.STORAGE_PATH', tmpdir
                    ):
                        # Create images directory
                        os.makedirs(os.path.join(tmpdir, 'images'))
                        mock_download.return_value = b'\xff\xd8\xff'
                        success, failed = downloader.download_photos(
                            entries, existing
                        )

            # Only b.jpg should be downloaded
            mock_download.assert_called_once_with('https://example.com/b.jpg')
            self.assertEqual(success, 1)
            self.assertEqual(failed, 0)

    @patch(
        'utils.seeder_photo_downloader.DownloadPhotoProcessor.download_image'
    )
    def test_download_photos_handles_failure(self, mock_download):
        """Should track failed downloads."""
        from utils.seeder_photo_downloader import PhotoPreDownloader

        with tempfile.TemporaryDirectory() as tmpdir:
            downloader = PhotoPreDownloader(form_id=123, workers=2)
            downloader.log_dir = tmpdir

            entries = [
                {'url': 'https://example.com/broken.jpg', 'datapoint_id': 1,
                 'mis_form_id': 1, 'mis_question_id': 1},
            ]

            with patch.object(downloader, '_append_failed_log'):
                mock_download.return_value = None  # Simulate download failure
                success, failed = downloader.download_photos(entries, {})

            self.assertEqual(success, 0)
            self.assertEqual(failed, 1)

    @patch(
        'utils.seeder_photo_downloader.DownloadPhotoProcessor.download_image'
    )
    def test_download_photos_handles_invalid_image(self, mock_download):
        """Should track downloads that are not valid images."""
        from utils.seeder_photo_downloader import PhotoPreDownloader

        with tempfile.TemporaryDirectory() as tmpdir:
            downloader = PhotoPreDownloader(form_id=123, workers=2)
            downloader.log_dir = tmpdir

            entries = [
                {'url': 'https://example.com/fake.jpg', 'datapoint_id': 1,
                 'mis_form_id': 1, 'mis_question_id': 1},
            ]

            with patch.object(downloader, '_append_failed_log'):
                with patch(
                    'utils.seeder_photo_downloader.DownloadPhotoProcessor'
                    '.validate_image_content', return_value=None
                ):
                    mock_download.return_value = b'not an image'
                    success, failed = downloader.download_photos(entries, {})

            self.assertEqual(success, 0)
            self.assertEqual(failed, 1)

    @patch(
        'utils.seeder_photo_downloader.DownloadPhotoProcessor.download_image'
    )
    def test_download_photos_concurrent_execution(self, mock_download):
        """Should download multiple photos concurrently."""
        from utils.seeder_photo_downloader import PhotoPreDownloader
        import time

        def slow_download(url):
            time.sleep(0.1)  # Simulate network delay
            return b'\xff\xd8\xff'  # JPEG magic bytes

        with tempfile.TemporaryDirectory() as tmpdir:
            mock_download.side_effect = slow_download
            downloader = PhotoPreDownloader(form_id=123, workers=5)
            downloader.log_dir = tmpdir

            entries = [
                {'url': f'https://example.com/photo{i}.jpg', 'datapoint_id': i,
                 'mis_form_id': 1, 'mis_question_id': i}
                for i in range(5)
            ]

            with patch.object(downloader, '_append_success_log'):
                with patch(
                    'utils.seeder_photo_downloader.DownloadPhotoProcessor'
                    '.validate_image_content', return_value='jpg'
                ):
                    with patch(
                        'utils.seeder_photo_downloader.STORAGE_PATH', tmpdir
                    ):
                        os.makedirs(os.path.join(tmpdir, 'images'))
                        start = time.time()
                        success, failed = downloader.download_photos(
                            entries, {}
                        )
                        elapsed = time.time() - start

            self.assertEqual(success, 5)
            # Should complete in ~0.1s (parallel), not ~0.5s (sequential)
            self.assertLess(elapsed, 0.3)

    @patch(
        'utils.seeder_photo_downloader.DownloadPhotoProcessor.download_image'
    )
    def test_download_photos_calls_progress_callback(self, mock_download):
        """Should call progress callback after each download."""
        from utils.seeder_photo_downloader import PhotoPreDownloader

        with tempfile.TemporaryDirectory() as tmpdir:
            downloader = PhotoPreDownloader(form_id=123, workers=1)
            downloader.log_dir = tmpdir
            progress_calls = []

            def track_progress(done, total):
                progress_calls.append((done, total))

            entries = [
                {'url': 'https://example.com/a.jpg', 'datapoint_id': 1,
                 'mis_form_id': 1, 'mis_question_id': 1},
                {'url': 'https://example.com/b.jpg', 'datapoint_id': 2,
                 'mis_form_id': 1, 'mis_question_id': 2},
            ]

            with patch.object(downloader, '_append_success_log'):
                with patch(
                    'utils.seeder_photo_downloader.DownloadPhotoProcessor'
                    '.validate_image_content', return_value='jpg'
                ):
                    with patch(
                        'utils.seeder_photo_downloader.STORAGE_PATH', tmpdir
                    ):
                        os.makedirs(os.path.join(tmpdir, 'images'))
                        mock_download.return_value = b'\xff\xd8\xff'
                        downloader.download_photos(
                            entries, {}, progress_callback=track_progress
                        )

            self.assertEqual(len(progress_calls), 2)
            self.assertIn((1, 2), progress_calls)
            self.assertIn((2, 2), progress_calls)


@override_settings(USE_TZ=False, TEST_ENV=True)
class PhotoPreDownloaderDownloadSingleTestCase(TestCase):
    """Test single photo download functionality."""

    @patch(
        'utils.seeder_photo_downloader.DownloadPhotoProcessor.download_image'
    )
    def test_download_single_creates_correct_filename(self, mock_download):
        """Should create filename as seeder_{datapoint_id}_{question_id}.ext"""
        from utils.seeder_photo_downloader import PhotoPreDownloader

        with tempfile.TemporaryDirectory() as tmpdir:
            downloader = PhotoPreDownloader(form_id=123)
            downloader.log_dir = tmpdir

            entry = {
                'url': 'https://example.com/photo.jpg',
                'datapoint_id': 12345,
                'mis_form_id': 1,
                'mis_question_id': 100
            }

            mock_download.return_value = b'\xff\xd8\xff'  # JPEG magic bytes

            with patch(
                'utils.seeder_photo_downloader.DownloadPhotoProcessor'
                '.validate_image_content', return_value='jpg'
            ):
                with patch(
                    'utils.seeder_photo_downloader.STORAGE_PATH', tmpdir
                ):
                    os.makedirs(os.path.join(tmpdir, 'images'))
                    success, entry_result, path = downloader._download_single(
                        entry
                    )

            self.assertTrue(success)
            self.assertEqual(path, '/images/seeder_12345_100.jpg')

            # Verify file was created
            full_path = os.path.join(tmpdir, 'images', 'seeder_12345_100.jpg')
            self.assertTrue(os.path.exists(full_path))


@override_settings(USE_TZ=False, TEST_ENV=True)
class PhotoPreDownloaderLogWritingTestCase(TestCase):
    """Test thread-safe log writing."""

    def test_append_success_log_creates_file_with_header(self):
        """Should create CSV with header if file doesn't exist."""
        from utils.seeder_photo_downloader import PhotoPreDownloader

        with tempfile.TemporaryDirectory() as tmpdir:
            log_path = os.path.join(tmpdir, 'success.csv')
            downloader = PhotoPreDownloader(form_id=123)
            downloader.log_dir = tmpdir

            with patch.object(
                downloader, 'get_success_log_path', return_value=log_path
            ):
                downloader._append_success_log(
                    'https://example.com/photo.jpg',
                    '/images/seeder_12345_100.jpg'
                )

            with open(log_path, 'r') as f:
                content = f.read()

            self.assertIn('url,local_path,downloaded_at', content)
            self.assertIn('https://example.com/photo.jpg', content)
            self.assertIn('/images/seeder_12345_100.jpg', content)

    def test_append_success_log_appends_to_existing(self):
        """Should append to existing CSV without adding new header."""
        from utils.seeder_photo_downloader import PhotoPreDownloader

        with tempfile.TemporaryDirectory() as tmpdir:
            log_path = os.path.join(tmpdir, 'success.csv')
            downloader = PhotoPreDownloader(form_id=123)
            downloader.log_dir = tmpdir

            # Create existing file
            with open(log_path, 'w') as f:
                f.write("url,local_path,downloaded_at\n")
                f.write(
                    "https://existing.com/a.jpg,/images/a.jpg,2026-01-15\n"
                )

            with patch.object(
                downloader, 'get_success_log_path', return_value=log_path
            ):
                downloader._append_success_log(
                    'https://example.com/photo.jpg',
                    '/images/seeder_12345_100.jpg'
                )

            with open(log_path, 'r') as f:
                lines = f.readlines()

            # Should have header + 2 data rows
            self.assertEqual(len(lines), 3)
            # Header should appear only once
            header_count = sum(
                1 for line in lines if 'url,local_path,downloaded_at' in line
            )
            self.assertEqual(header_count, 1)

    def test_append_failed_log_includes_context(self):
        """Should include datapoint_id, mis_form_id, mis_question_id."""
        from utils.seeder_photo_downloader import PhotoPreDownloader

        with tempfile.TemporaryDirectory() as tmpdir:
            log_path = os.path.join(
                tmpdir, '123_predownload_photos_failed.csv'
            )
            downloader = PhotoPreDownloader(form_id=123)
            downloader.log_dir = tmpdir

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
            self.assertIn('42', content)
            self.assertIn('Connection timeout', content)

    def test_append_failed_log_creates_header(self):
        """Should create CSV with correct header columns."""
        from utils.seeder_photo_downloader import PhotoPreDownloader

        with tempfile.TemporaryDirectory() as tmpdir:
            log_path = os.path.join(
                tmpdir, '123_predownload_photos_failed.csv'
            )
            downloader = PhotoPreDownloader(form_id=123)
            downloader.log_dir = tmpdir

            entry = {
                'url': 'https://example.com/broken.jpg',
                'datapoint_id': 12345,
                'mis_form_id': 1,
                'mis_question_id': 42,
            }

            with patch.object(
                downloader, 'get_failed_log_path', return_value=log_path
            ):
                downloader._append_failed_log(entry, 'Error')

            with open(log_path, 'r') as f:
                header = f.readline()

            expected_cols = [
                'datapoint_id', 'mis_form_id', 'mis_question_id',
                'url', 'error', 'failed_at'
            ]
            for col in expected_cols:
                self.assertIn(col, header)
