"""
Seeder Configuration Module

This module provides configuration management and validation for the
Flow Complete Seeder command.
"""

import os
from dataclasses import dataclass
from typing import TYPE_CHECKING, Optional

from django.conf import settings
from api.v1.v1_forms.models import Forms
from mis.settings import STORAGE_PATH

if TYPE_CHECKING:
    from api.v1.v1_users.models import SystemUser


# =============================================================================
# Custom Exceptions
# =============================================================================


class SeedingError(Exception):
    """Base exception for seeding errors."""

    pass


class DataLoadError(SeedingError):
    """Error loading data files."""

    pass


class ValidationError(SeedingError):
    """Error validating inputs."""

    pass


class AdministrationMappingError(SeedingError):
    """Error with administration mappings."""

    pass


class ConfigurationError(SeedingError):
    """Error with configuration."""

    pass


# =============================================================================
# Constants
# =============================================================================


class FilePaths:
    """File path constants."""

    OUTPUT_DIR = "data"
    SOURCE_DIR = "storage/akvo-flow"
    ADMINISTRATION_MAPPING = "administration_mapping.csv"
    # Pattern for child data files: {flow_id}_child_data_{form_id}.csv
    CHILD_FILE_PATTERN = "{flow_id}_child_data_*.csv"


class CsvColumns:
    """CSV column name constants."""

    DATAPOINT_ID = "datapoint_id"
    NAME = "name"
    SUBMITTER = "submitter"
    IDENTIFIER = "identifier"
    CREATED_AT = "created_at"
    FORM_ID = "form_id"
    ADMINISTRATION = "administration"
    GEO = "geo"
    PARENT = "parent"


class QuestionTypeGroups:
    """Question type groups for processing."""

    OPTION_TYPES = [
        "option",
        "multiple_option",
    ]
    VALUE_TYPES = [
        "administration",
        "geo",
    ]


# Non-question columns to exclude from question processing
NON_QUESTION_COLUMNS = [
    CsvColumns.FORM_ID,
    CsvColumns.IDENTIFIER,
    CsvColumns.CREATED_AT,
    CsvColumns.DATAPOINT_ID,
    CsvColumns.SUBMITTER,
    CsvColumns.NAME,
    CsvColumns.ADMINISTRATION,
    CsvColumns.GEO,
    CsvColumns.PARENT,
    "success",  # Added by seeder to track insertion status
]

FLOW_PREFIX = "FLOW-"


# =============================================================================
# Configuration
# =============================================================================


@dataclass
class SeederConfig:
    """Configuration for data seeding operation."""

    flow_form_id: int
    limit: Optional[int] = None
    user: Optional["SystemUser"] = None
    source_dir: str = None
    batch_size: int = 1000
    encoding: str = "utf-8"

    def __post_init__(self):
        if self.source_dir is None:
            default_source_dir = os.path.join(STORAGE_PATH, "akvo-flow")
            self.source_dir = getattr(
                settings, "FLOW_SOURCE_DIR", default_source_dir
            )


# =============================================================================
# Configuration Validation
# =============================================================================


def validate_configuration(config: SeederConfig):
    """Validate that required configuration is present.

    Args:
        config: SeederConfig instance to validate

    Raises:
        ConfigurationError: If configuration is invalid
    """
    if not os.path.exists(config.source_dir):
        raise ConfigurationError(
            f"FLOW_SOURCE_DIR does not exist: {config.source_dir}"
        )

    output_dir = os.path.join(config.source_dir, FilePaths.OUTPUT_DIR)
    if not os.path.exists(output_dir):
        raise ConfigurationError(
            f"Output directory does not exist: {output_dir}"
        )


def validate_and_prepare_config(options: dict) -> SeederConfig:
    """Validate inputs and prepare configuration.

    Args:
        options: Command-line options dictionary

    Returns:
        SeederConfig instance with validated values

    Raises:
        ValidationError: If validation fails
        ConfigurationError: If configuration is invalid
    """
    flow_form_id = options.get("form")
    limit = options.get("limit")
    revert = options.get("revert", False)
    email = options.get("email", None)

    # Validate form_id
    if flow_form_id <= 0:
        raise ValidationError("Form ID must be a positive integer")

    # Validate limit
    if limit is not None and limit <= 0:
        raise ValidationError("Limit must be a positive integer")

    # Validate email for non-revert operations
    if not email and not revert:
        raise ValidationError(
            "Email argument is required when not reverting"
        )

    # Get user
    user = get_user(email) if email else None

    # Create config
    config = SeederConfig(
        flow_form_id=flow_form_id,
        limit=limit,
        user=user,
    )

    # Validate configuration
    validate_configuration(config)

    return config


def get_user(email: str) -> "SystemUser":
    """Retrieve and validate user by email.

    Args:
        email: User email address

    Returns:
        SystemUser instance

    Raises:
        ValidationError: If user not found
    """
    from api.v1.v1_users.models import SystemUser

    user = SystemUser.objects.filter(email=email).first()
    if not user:
        raise ValidationError(f"User with email {email} not found")
    return user


def get_form_by_flow_id(flow_form_id: int) -> Forms:
    flow_ids = {
        "8520967": 1749634736797,
        "17260923": 1748903240763,
        "27040920": 1749611049520,
        "1520924": 1749623934933,
        "5530933": 1749623934933,
        "2490944": 1749621221728,
    }
    if str(flow_form_id) not in flow_ids:
        raise ValidationError(
            f"Flow form ID {flow_form_id} not mapped to any form"
        )
    form_id = flow_ids[str(flow_form_id)]
    form = Forms.objects.filter(id=form_id).first()
    if not form:
        raise ValidationError(f"Form with ID {form_id} not found")
    return form
