# Copyright (C) 2025 Lotas Inc. All rights reserved.
# Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.

"""Kernel session mode enumeration."""

from enum import IntEnum


class KernelMode(IntEnum):
    """The mode that the kernel session was started in."""
    
    CONSOLE = 0
    NOTEBOOK = 1
    BACKGROUND = 2

