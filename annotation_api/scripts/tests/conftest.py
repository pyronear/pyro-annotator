"""
Isolated conftest for script tests - no app dependencies needed.
"""

# This conftest exists to prevent pytest from loading the parent conftest.py
# which has database and app dependencies that we don't need for script tests.
