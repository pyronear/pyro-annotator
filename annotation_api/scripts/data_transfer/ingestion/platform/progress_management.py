"""
Progress management utilities for platform data import scripts.

This module provides Rich-based progress tracking, error collection, and log management
components that can be reused across different data import and processing scripts.

Classes:
    ErrorCollector: Collects and reports errors/warnings with clean summaries
    StepManager: Manages step-by-step progress with Rich formatting and timing
    LogSuppressor: Context manager to suppress logging during progress displays

Example:
    >>> from progress_management import ErrorCollector, StepManager
    >>> from rich.console import Console
    >>> 
    >>> console = Console()
    >>> step_manager = StepManager(console)
    >>> error_collector = ErrorCollector()
    >>> 
    >>> step_manager.start_step(1, "Data Processing", "Loading data files...")
    >>> # ... do work ...
    >>> step_manager.complete_step(True, "Data loaded successfully", {"Files": 10})
"""

import logging
import time
from datetime import datetime
from typing import Dict, List, Any, Optional

from rich.console import Console
from rich.panel import Panel


class ErrorCollector:
    """
    Collects errors and warnings during processing for clean summary reporting.
    
    This class allows scripts to collect errors and warnings during progress display
    without interrupting progress bars, then show a clean summary at the end.
    
    Attributes:
        errors: List of error dictionaries with message, context, and timestamp
        warnings: List of warning dictionaries with message, context, and timestamp
    
    Example:
        >>> collector = ErrorCollector()
        >>> collector.add_error("Failed to process file X", {"file_id": 123})
        >>> collector.add_warning("Skipped malformed data", {"line": 45})
        >>> collector.print_summary(console, "Processing Issues")
    """
    
    def __init__(self) -> None:
        """Initialize empty error and warning collections."""
        self.errors: List[Dict[str, Any]] = []
        self.warnings: List[Dict[str, Any]] = []
    
    def add_error(self, message: str, context: Optional[Dict[str, Any]] = None) -> None:
        """
        Add an error to the collection.
        
        Args:
            message: Human-readable error description
            context: Optional dictionary with additional context (IDs, parameters, etc.)
        """
        self.errors.append({
            "message": message, 
            "context": context or {}, 
            "timestamp": datetime.now()
        })
    
    def add_warning(self, message: str, context: Optional[Dict[str, Any]] = None) -> None:
        """
        Add a warning to the collection.
        
        Args:
            message: Human-readable warning description
            context: Optional dictionary with additional context (IDs, parameters, etc.)
        """
        self.warnings.append({
            "message": message, 
            "context": context or {}, 
            "timestamp": datetime.now()
        })
    
    def has_issues(self) -> bool:
        """
        Check if there are any errors or warnings.
        
        Returns:
            True if there are any errors or warnings, False otherwise
        """
        return len(self.errors) > 0 or len(self.warnings) > 0
    
    def print_summary(self, console: Console, title: str = "Issues Encountered") -> None:
        """
        Print a formatted summary of errors and warnings using Rich panels.
        
        Args:
            console: Rich console instance for output
            title: Title for the summary panel
        """
        if not self.has_issues():
            return
            
        console.print()
        summary_text = ""
        
        if self.errors:
            summary_text += f"[red]❌ {len(self.errors)} error(s):[/]\n"
            for error in self.errors[-5:]:  # Show last 5 errors
                summary_text += f"  • {error['message']}\n"
            if len(self.errors) > 5:
                summary_text += f"  ... and {len(self.errors) - 5} more error(s)\n"
        
        if self.warnings:
            if summary_text:
                summary_text += "\n"
            summary_text += f"[yellow]⚠️  {len(self.warnings)} warning(s):[/]\n"
            for warning in self.warnings[-3:]:  # Show last 3 warnings
                summary_text += f"  • {warning['message']}\n"
            if len(self.warnings) > 3:
                summary_text += f"  ... and {len(self.warnings) - 3} more warning(s)\n"
        
        panel = Panel(
            summary_text.strip(), 
            title=title, 
            border_style="red" if self.errors else "yellow",
            padding=(1, 2)
        )
        console.print(panel)
    
    def clear(self) -> None:
        """Clear all collected errors and warnings."""
        self.errors.clear()
        self.warnings.clear()

    def get_error_count(self) -> int:
        """Get the total number of errors."""
        return len(self.errors)
    
    def get_warning_count(self) -> int:
        """Get the total number of warnings."""
        return len(self.warnings)


class StepManager:
    """
    Manages step-by-step progress with Rich formatting and timing.
    
    This class provides a consistent way to display multi-step processes with
    professional formatting, timing information, and status indicators.
    
    Attributes:
        console: Rich console instance for output
        show_timing: Whether to display step duration
        current_step: Current step number
        step_start_time: Timestamp when current step started
    
    Example:
        >>> manager = StepManager(console, show_timing=True)
        >>> manager.start_step(1, "Data Loading", "Loading configuration files...")
        >>> # ... do work ...
        >>> manager.complete_step(True, "Configuration loaded", {"Files": 3})
    """
    
    def __init__(self, console: Console, show_timing: bool = True) -> None:
        """
        Initialize the step manager.
        
        Args:
            console: Rich console instance for output
            show_timing: Whether to show step duration in completion messages
        """
        self.console = console
        self.show_timing = show_timing
        self.current_step = 0
        self.step_start_time: Optional[float] = None
        
    def start_step(self, step_number: int, title: str, description: Optional[str] = None) -> None:
        """
        Start a new step with Rich panel formatting.
        
        Args:
            step_number: Sequential step number (1, 2, 3, etc.)
            title: Brief title for the step (e.g., "Data Processing")
            description: Optional detailed description of what the step will do
        """
        self.current_step = step_number
        self.step_start_time = time.time()
        
        panel_title = f"📋 Step {step_number}: {title}"
        panel_content = description or f"Starting {title.lower()}..."
        
        self.console.print()
        self.console.print(Panel(
            f"[bold blue]{panel_content}[/]",
            title=panel_title,
            border_style="blue",
            padding=(0, 2)
        ))
    
    def complete_step(
        self, 
        success: bool = True, 
        message: Optional[str] = None, 
        stats: Optional[Dict[str, Any]] = None
    ) -> None:
        """
        Mark the current step as completed with timing and status.
        
        Args:
            success: Whether the step completed successfully
            message: Optional completion message
            stats: Optional dictionary of statistics to display (e.g., {"Files": 10, "Errors": 0})
        """
        if self.step_start_time is None:
            return
            
        duration = time.time() - self.step_start_time
        status_icon = "✅" if success else "❌"
        status_color = "green" if success else "red"
        
        completion_text = f"[{status_color}]{status_icon} Step {self.current_step} {'completed' if success else 'failed'}[/]"
        
        if self.show_timing:
            completion_text += f" [dim]({duration:.1f}s)[/]"
        
        if message:
            completion_text += f"\n{message}"
            
        if stats:
            completion_text += "\n"
            for key, value in stats.items():
                completion_text += f"• {key}: [bold]{value}[/]\n"
        
        self.console.print(Panel(
            completion_text.strip(),
            border_style=status_color,
            padding=(0, 2)
        ))
        
        self.step_start_time = None


class LogSuppressor:
    """
    Context manager to suppress logging during progress displays.
    
    This class temporarily raises the log level for all loggers to prevent
    log messages from interfering with Rich progress bars and status displays.
    When the context exits, original log levels are restored.
    
    Attributes:
        suppress: Whether to actually suppress logs (allows disabling for debug mode)
        original_levels: Dictionary storing original log levels for restoration
    
    Example:
        >>> with LogSuppressor(suppress=True):
        ...     with Progress() as progress:
        ...         # Progress bar displays cleanly without log interference
        ...         pass
    """
    
    def __init__(self, suppress: bool = True) -> None:
        """
        Initialize the log suppressor.
        
        Args:
            suppress: Whether to actually suppress logs. Set to False for debug mode.
        """
        self.suppress = suppress
        self.original_levels: Dict[str, int] = {}
        
    def __enter__(self) -> 'LogSuppressor':
        """
        Enter the context and suppress logging if enabled.
        
        Returns:
            Self for use in with statements
        """
        if self.suppress:
            # Store original levels and suppress ALL loggers except CRITICAL level
            loggers_to_suppress = [
                '',  # root logger - most important
                '__main__',
                'root',
                'scripts.data_transfer.ingestion.platform.import',
                'scripts.data_transfer.ingestion.platform.shared',
                'scripts.data_transfer.ingestion.platform.client',
                'scripts.data_transfer.ingestion.platform.utils',
                'app.clients.annotation_api',
                'requests',
                'urllib3',
                'urllib3.connectionpool',
                'asyncio',
                'concurrent.futures',
                'multiprocessing'
            ]
            
            for logger_name in loggers_to_suppress:
                logger = logging.getLogger(logger_name)
                self.original_levels[logger_name] = logger.level
                logger.setLevel(logging.CRITICAL)  # Only show critical errors
                
            # Also suppress all existing loggers to catch any dynamically created ones
            for logger_name in logging.getLogger().manager.loggerDict:
                if logger_name not in self.original_levels:
                    logger = logging.getLogger(logger_name)
                    self.original_levels[logger_name] = logger.level
                    logger.setLevel(logging.CRITICAL)
                    
        return self
        
    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        """
        Exit the context and restore original log levels.
        
        Args:
            exc_type: Exception type (if any)
            exc_val: Exception value (if any) 
            exc_tb: Exception traceback (if any)
        """
        if self.suppress:
            # Restore original log levels
            for logger_name, original_level in self.original_levels.items():
                logging.getLogger(logger_name).setLevel(original_level)