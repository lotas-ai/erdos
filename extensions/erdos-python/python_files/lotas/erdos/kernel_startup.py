# Copyright (C) 2025 Lotas Inc. All rights reserved.
# Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.

"""Kernel startup utilities for configuring Erdos environment in IPython kernel."""

import os
import sys


def configure_kernel(session_mode: str = 'console'):
    """
    Configure the IPython kernel with Erdos services and custom magics.
    
    This function should be called during kernel initialization to set up:
    - Custom comm targets (environment, ui, help)
    - Working directory change tracking
    - Custom IPython magics
    - Matplotlib backend configuration
    
    Args:
        session_mode: Session mode ('console', 'notebook', or 'background')
    """
    # Set matplotlib backend if not already set
    if not os.environ.get("MPLBACKEND"):
        os.environ["MPLBACKEND"] = "module://erdos.plotting"
    
    try:
        import matplotlib
        matplotlib.use(os.environ["MPLBACKEND"])
    except Exception:
        pass
    
    # Import and register services
    from erdos.environment import EnvironmentService
    from erdos.ui import UiService
    from erdos.help import HelpService
    from IPython import get_ipython
    
    kernel = get_ipython().kernel
    
    # Register comm targets
    env_service = EnvironmentService()
    kernel.comm_manager.register_target('environment', env_service.on_comm_open)
    
    ui_service = UiService()
    kernel.comm_manager.register_target('erdos.ui', ui_service.on_comm_open)
    
    help_service = HelpService()
    kernel.comm_manager.register_target('help', help_service.on_comm_open)
    help_service.start()
    
    # Attach services to kernel
    kernel.session_mode = session_mode
    kernel.ui_service = ui_service
    kernel.environment_service = env_service
    kernel.help_service = help_service
    
    # Track working directory changes
    kernel._erdos_last_cwd = os.getcwd()
    
    def check_cwd_change():
        """Post-execute hook to detect working directory changes."""
        current_cwd = os.getcwd()
        if current_cwd != kernel._erdos_last_cwd:
            kernel._erdos_last_cwd = current_cwd
            if hasattr(kernel, 'ui_service') and kernel.ui_service._comms:
                for comm in kernel.ui_service._comms.values():
                    try:
                        comm.send({
                            "method": "working_directory",
                            "params": {
                                "directory": current_cwd
                            }
                        })
                    except Exception:
                        pass
    
    get_ipython().events.register('post_execute', check_cwd_change)
    
    # Register custom magics
    from IPython.core.magic import Magics, magics_class, line_magic
    
    @magics_class
    class ErdosMagics(Magics):
        @line_magic
        def clear(self, line):
            kernel = self.shell.kernel
            if hasattr(kernel, 'ui_service'):
                session_mode = getattr(kernel, 'session_mode', 'console')
                kernel.ui_service.clear_console(session_mode=session_mode)
    
    get_ipython().register_magics(ErdosMagics)

