"""
Seeder Answer Processor Module

This module provides answer processing functionality for Flow Complete Seeder.
"""

from typing import Optional, Tuple

from api.v1.v1_forms.models import QuestionTypes


# =============================================================================
# Strategy Pattern for Answer Processing
# =============================================================================


class AnswerProcessor:
    """Strategy pattern for processing different question types."""

    OPTION_TYPES = [
        QuestionTypes.option,
        QuestionTypes.multiple_option,
    ]

    @staticmethod
    def process_administration(
        row_value,
        administration_id: Optional[int],
    ) -> Tuple[Optional[str], Optional[int], Optional[list]]:
        """Process administration-type questions.

        Args:
            row_value: The value from the CSV row
            administration_id: Administration ID to use

        Returns:
            Tuple of (name, value, options)
        """
        return None, administration_id, None

    @staticmethod
    def process_geo(
        row_value,
    ) -> Tuple[Optional[str], Optional[int], Optional[list]]:
        """Process geo-type questions.

        Args:
            row_value: The value from the CSV row

        Returns:
            Tuple of (name, value, options)
        """
        if row_value is None:
            return None, None, None
        options = [
            float(g) for g in str(row_value).split("|")
        ]
        return None, None, options

    @staticmethod
    def process_option(
        row_value,
        opt_list: Optional[list] = [],
    ) -> Tuple[Optional[str], Optional[int], Optional[list]]:
        """Process option-type questions.

        Args:
            row_value: The value from the CSV row

        Returns:
            Tuple of (name, value, options)
        """
        if row_value is None:
            return None, None, None
        if row_value not in opt_list:
            return None, None, None
        return None, None, str(row_value).split("|")

    @staticmethod
    def process_number(
        row_value,
    ) -> Tuple[Optional[str], Optional[int], Optional[list]]:
        """Process number-type questions.

        Args:
            row_value: The value from the CSV row

        Returns:
            Tuple of (name, value, options)
        """
        try:
            number_value = float(row_value)
            return None, number_value, None
        except (ValueError, TypeError):
            return None, None, None

    @staticmethod
    def process_default(
        row_value,
    ) -> Tuple[Optional[str], Optional[int], Optional[list]]:
        """Process default question types.

        Args:
            row_value: The value from the CSV row

        Returns:
            Tuple of (name, value, options)
        """
        return row_value, None, None

    @classmethod
    def process(
        cls,
        question_type: str,
        row_value,
        administration_id: Optional[int] = None,
        opt_list: Optional[list] = [],
    ) -> Tuple[Optional[str], Optional[int], Optional[list]]:
        """Process answer based on question type.

        Args:
            question_type: The type of question
            row_value: The value from the CSV row
            administration_id: Administration ID for admin-type questions

        Returns:
            Tuple of (name, value, options)
        """
        if question_type == QuestionTypes.administration:
            return cls.process_administration(row_value, administration_id)
        elif question_type == QuestionTypes.geo:
            return cls.process_geo(row_value)
        elif question_type in cls.OPTION_TYPES:
            return cls.process_option(row_value, opt_list)
        elif question_type == QuestionTypes.number:
            return cls.process_number(row_value)
        else:
            return cls.process_default(row_value)
