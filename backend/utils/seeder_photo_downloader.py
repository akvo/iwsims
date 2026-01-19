"""
Photo Pre-Downloader Module

This module provides concurrent photo downloading functionality for the
Flow Data Seeder. It downloads photos before seeding to optimize memory
usage and provides success/failed logs for tracking.
"""

import csv
import os
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from typing import Callable, Dict, List, Optional, Tuple

import pandas as pd

from mis.settings import STORAGE_PATH
from utils.seeder_answer_processor import DownloadPhotoProcessor


class PhotoPreDownloader:
    """Pre-downloads photos concurrently and manages download logs."""

    DEFAULT_WORKERS = 5

    def __init__(self, form_id: int, workers: int = DEFAULT_WORKERS):
        """Initialize the photo pre-downloader.

        Args:
            form_id: The form ID for log file naming
            workers: Number of concurrent download workers (default: 5)
        """
        self.form_id = form_id
        self.workers = workers
        self._lock = threading.Lock()  # Thread-safe log writing
        self.log_dir = os.path.join(STORAGE_PATH, "akvo-flow")

    def get_success_log_path(self) -> str:
        """Get the path to the success log file.

        Returns:
            Full path to the success log CSV file
        """
        return os.path.join(
            self.log_dir, f"photo_downloads_{self.form_id}.csv"
        )

    def get_failed_log_path(self) -> str:
        """Get the path to the failed log file.

        Returns:
            Full path to the failed log CSV file
        """
        return os.path.join(
            self.log_dir, f"{self.form_id}_predownload_photos_failed.csv"
        )

    def load_success_log(self) -> Dict[str, str]:
        """Load URL -> local_path mapping from success log.

        Verifies each file exists on disk. Removes entries for missing files.
        This ensures re-download if file was deleted.

        Returns:
            Dictionary mapping URLs to their local storage paths
        """
        log_path = self.get_success_log_path()
        if not os.path.exists(log_path):
            return {}

        result = {}
        try:
            with open(log_path, 'r', newline='') as f:
                reader = csv.DictReader(f)
                for row in reader:
                    url = row.get('url', '')
                    local_path = row.get('local_path', '')

                    if not url or not local_path:
                        continue

                    # Verify file exists on disk
                    # local_path is like /images/seeder_xxx.jpg
                    full_path = os.path.join(
                        STORAGE_PATH, local_path.lstrip('/')
                    )
                    if os.path.exists(full_path):
                        result[url] = local_path

        except Exception:
            # If file is corrupted, return empty dict
            return {}

        return result

    def _append_success_log(self, url: str, local_path: str):
        """Thread-safe append to success log.

        Args:
            url: The original URL that was downloaded
            local_path: The relative path where the file was stored
        """
        with self._lock:
            log_path = self.get_success_log_path()
            file_exists = os.path.exists(log_path)

            # Ensure directory exists
            os.makedirs(os.path.dirname(log_path), exist_ok=True)

            with open(log_path, 'a', newline='') as f:
                writer = csv.writer(f)
                if not file_exists:
                    writer.writerow(['url', 'local_path', 'downloaded_at'])
                writer.writerow([
                    url,
                    local_path,
                    datetime.now().isoformat()
                ])

    def _append_failed_log(self, entry: Dict, error: str):
        """Thread-safe append to failed log.

        Args:
            entry: Dictionary with url, datapoint_id, mis_form_id, etc.
            error: Error message describing the failure
        """
        with self._lock:
            log_path = self.get_failed_log_path()
            file_exists = os.path.exists(log_path)

            # Ensure directory exists
            os.makedirs(os.path.dirname(log_path), exist_ok=True)

            with open(log_path, 'a', newline='') as f:
                writer = csv.writer(f)
                if not file_exists:
                    writer.writerow([
                        'datapoint_id', 'mis_form_id', 'mis_question_id',
                        'url', 'error', 'failed_at'
                    ])
                writer.writerow([
                    entry.get('datapoint_id', ''),
                    entry.get('mis_form_id', ''),
                    entry.get('mis_question_id', ''),
                    entry.get('url', ''),
                    error,
                    datetime.now().isoformat()
                ])

    def _download_single(self, entry: Dict) -> Tuple[bool, Dict, str]:
        """Download single photo directly to STORAGE_PATH/images/.

        Args:
            entry: Dictionary with url, datapoint_id, mis_form_id, etc.

        Returns:
            Tuple of (success, entry, relative_path_or_error)
        """
        url = entry['url']
        try:
            # Download image
            content = DownloadPhotoProcessor.download_image(url)
            if content is None:
                self._append_failed_log(entry, "Download failed")
                return (False, entry, "Download failed")

            # Validate image content
            ext = DownloadPhotoProcessor.validate_image_content(content)
            if ext is None:
                self._append_failed_log(entry, "Invalid image format")
                return (False, entry, "Invalid image format")

            # Generate filename: seeder_{datapoint_id}_{question_id}.{ext}
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
        progress_callback: Optional[Callable[[int, int], None]] = None
    ) -> Tuple[int, int]:
        """Download photos concurrently using ThreadPoolExecutor.

        Args:
            photo_entries: List of dicts with url, datapoint_id, etc.
            existing_success: Dict of already downloaded URL -> local_path
            progress_callback: Optional callback(done, total) for progress

        Returns:
            Tuple of (success_count, failed_count)
        """
        # Filter out already downloaded
        to_download = [
            e for e in photo_entries
            if e['url'] not in existing_success
        ]

        if not to_download:
            return (0, 0)

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
                    progress_callback(
                        success_count + failed_count, len(to_download)
                    )

        return success_count, failed_count

    @staticmethod
    def extract_photo_urls_with_context(
        df: pd.DataFrame,
        photo_questions: List
    ) -> List[Dict]:
        """Extract photo URLs with context for error tracking.

        Args:
            df: DataFrame containing the CSV data
            photo_questions: List of Question objects for photo columns

        Returns:
            List of dicts with url, datapoint_id, mis_form_id, mis_question_id
        """
        result = []

        for question in photo_questions:
            col_id = str(question.pk)
            if col_id not in df.columns:
                continue

            for idx, row in df.iterrows():
                value = row.get(col_id)
                # Skip None/NaN values
                if pd.isna(value) or value is None:
                    continue

                url = str(value).strip()

                # Skip non-HTTP URLs (local paths)
                if not url.startswith(('http://', 'https://')):
                    continue

                result.append({
                    'url': url,
                    'datapoint_id': row.get('datapoint_id'),
                    'mis_form_id': question.form_id,
                    'mis_question_id': question.pk,
                })

        return result
