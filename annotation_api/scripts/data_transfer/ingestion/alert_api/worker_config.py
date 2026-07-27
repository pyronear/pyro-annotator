"""
Worker configuration and scaling utilities for parallel processing.

This module provides intelligent worker scaling based on operation types and system resources.
It simplifies parallel processing configuration by automatically determining optimal worker
counts for different types of operations from a single base parameter.

Classes:
    WorkerConfig: Intelligent worker scaling configuration

Example:
    >>> config = WorkerConfig(max_workers=4)
    >>> print(f"Detection fetching: {config.detection_fetching} workers")
    >>> print(f"API posting: {config.api_posting} workers")
    >>> print(f"CPU processing: {config.annotation_processing} workers")
"""

from typing import Dict, Any


class WorkerConfig:
    """
    Intelligent worker scaling configuration based on single max_workers parameter.

    This class automatically determines optimal worker counts for different types of operations
    based on their characteristics (I/O bound, CPU bound, API rate limits, etc.).

    Attributes:
        base_workers: The base number of workers provided by the user

    Properties:
        detection_fetching: Workers for platform API detection fetching (I/O bound)
        api_posting: Workers for sequence creation API calls (rate-limited)
        annotation_processing: Workers for CPU-bound annotation processing
        detection_per_sequence: Workers for detection creation within each sequence
        page_fetching: Workers for paginated API calls

    Example:
        >>> config = WorkerConfig(max_workers=8)
        >>> # Use for different operations
        >>> with ThreadPoolExecutor(max_workers=config.detection_fetching) as executor:
        ...     # Fetch data from platform API
        ...     pass
        >>> with ThreadPoolExecutor(max_workers=config.api_posting) as executor:
        ...     # Post to annotation API (more conservative due to rate limits)
        ...     pass
    """

    def __init__(self, max_workers: int) -> None:
        """
        Initialize worker configuration.

        Args:
            max_workers: Base number of workers to scale from (should be > 0)

        Raises:
            ValueError: If max_workers is less than 1
        """
        if max_workers < 1:
            raise ValueError("max_workers must be at least 1")

        self.base_workers = max_workers

    @property
    def detection_fetching(self) -> int:
        """
        Workers for platform API detection fetching.

        This operation is I/O bound (HTTP requests) so we can use the full
        base worker count as network requests can run concurrently.

        Returns:
            Number of workers for detection fetching operations
        """
        return self.base_workers

    @property
    def api_posting(self) -> int:
        """
        Workers for sequence creation API calls.

        This operation hits API rate limits more easily, so we use a slightly
        more conservative worker count (75% of base) to avoid overwhelming
        the annotation API.

        Returns:
            Number of workers for API posting operations (minimum 1)
        """
        return max(1, int(self.base_workers * 0.75))

    @property
    def annotation_processing(self) -> int:
        """
        Workers for CPU-bound annotation processing.

        This operation involves AI prediction processing, bounding box clustering,
        and other CPU-intensive tasks. We can use more workers (150% of base)
        since modern systems often have good multi-core performance.

        Returns:
            Number of workers for annotation processing operations
        """
        return int(self.base_workers * 1.5)

    @property
    def detection_per_sequence(self) -> int:
        """
        Workers for detection creation within each sequence.

        This is a sub-operation that happens within sequence processing.
        We use the base worker count as it involves both I/O (image downloads)
        and API calls (detection creation).

        Returns:
            Number of workers for detection creation within sequences
        """
        return self.base_workers

    @property
    def page_fetching(self) -> int:
        """
        Workers for paginated API calls.

        This operation involves fetching multiple pages of data from APIs.
        We use a conservative approach (75% of base) to avoid overwhelming
        APIs with too many concurrent page requests.

        Returns:
            Number of workers for paginated API operations (minimum 1)
        """
        return max(1, int(self.base_workers * 0.75))

    def get_config_summary(self) -> Dict[str, Any]:
        """
        Get a summary of all worker configuration values.

        Useful for logging, debugging, or displaying configuration to users.

        Returns:
            Dictionary containing all worker counts and configuration details

        Example:
            >>> config = WorkerConfig(4)
            >>> summary = config.get_config_summary()
            >>> print(f"Base workers: {summary['base_workers']}")
            >>> print(f"Detection fetching: {summary['detection_fetching']}")
        """
        return {
            "base_workers": self.base_workers,
            "detection_fetching": self.detection_fetching,
            "api_posting": self.api_posting,
            "annotation_processing": self.annotation_processing,
            "detection_per_sequence": self.detection_per_sequence,
            "page_fetching": self.page_fetching,
        }

    def __str__(self) -> str:
        """
        String representation of the worker configuration.

        Returns:
            Human-readable string showing worker counts for each operation type
        """
        return (
            f"WorkerConfig(base={self.base_workers}, "
            f"detection_fetch={self.detection_fetching}, "
            f"api_post={self.api_posting}, "
            f"annotation={self.annotation_processing}, "
            f"detection_per_seq={self.detection_per_sequence}, "
            f"page_fetch={self.page_fetching})"
        )

    def __repr__(self) -> str:
        """
        Detailed representation of the worker configuration.

        Returns:
            String that could be used to recreate the object
        """
        return f"WorkerConfig(max_workers={self.base_workers})"
