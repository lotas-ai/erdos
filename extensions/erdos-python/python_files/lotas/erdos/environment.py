# Copyright (C) 2025 Lotas Inc. All rights reserved.
# Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import subprocess
import sys
from typing import TYPE_CHECKING, Any, Dict, List, Optional

if TYPE_CHECKING:
    from comm.base_comm import BaseComm

logger = logging.getLogger(__name__)


class EnvironmentService:
    """Manages Python package information and installation/uninstallation."""

    def __init__(self):
        # Store active comm channels by comm_id to respond on correct channel
        self._comms: Dict[str, BaseComm] = {}

    def on_comm_open(self, comm: BaseComm, _msg: Dict[str, Any]) -> None:
        logger.info(f"[ENV SERVICE] on_comm_open called for comm_id: {comm.comm_id}")
        self._comms[comm.comm_id] = comm
        
        # Register handler for incoming messages
        comm.on_msg(lambda msg: asyncio.create_task(self.handle_msg(comm, msg)))
        logger.info(f"[ENV SERVICE] Message handler registered for comm_id: {comm.comm_id}")

    async def handle_msg(self, comm: BaseComm, msg: Dict[str, Any]) -> None:
        """Handle comm messages from the client - uses Ark-style format."""
        logger.info(f"[ENV SERVICE] handle_msg called")
        content = msg.get("content", {})
        data = content.get("data", {})
        
        logger.info(f"[ENV SERVICE] Message data: {data}")
        
        # Extract method, id, params (Ark-style format, not JSON-RPC 2.0)
        method = data.get("method")
        request_id = data.get("id")
        params = data.get("params", {})
        
        if not method:
            logger.warning(f"No method in message: {data}")
            return
        
        logger.info(f"[ENV SERVICE] Received request: method={method}, id={request_id}")
        
        result = None
        error = None
        reply_method = None
        
        # Route to appropriate handler
        if method == "list_packages":
            try:
                package_type = params.get("package_type", "python")
                result = self._list_packages(package_type)
                reply_method = "list_packages_reply"
                logger.info(f"[ENV SERVICE] list_packages returned {len(result)} packages")
            except Exception as e:
                logger.error(f"[ENV SERVICE] Error listing packages: {e}", exc_info=True)
                error = f"Error listing packages: {str(e)}"
        
        elif method == "install_package":
            try:
                install_result = await self._install_package(
                    params.get("package_name"),
                    params.get("package_type", "python"),
                    params.get("environment_type")
                )
                result = install_result
                reply_method = "install_package_reply"
            except Exception as e:
                logger.error(f"[ENV SERVICE] Error installing package: {e}", exc_info=True)
                error = f"Error installing package: {str(e)}"
        
        elif method == "uninstall_package":
            try:
                uninstall_result = await self._uninstall_package(
                    params.get("package_name"),
                    params.get("package_type", "python"),
                    params.get("environment_type")
                )
                result = uninstall_result
                reply_method = "uninstall_package_reply"
            except Exception as e:
                logger.error(f"[ENV SERVICE] Error uninstalling package: {e}", exc_info=True)
                error = f"Error uninstalling package: {str(e)}"
        
        elif method == "check_missing_packages":
            try:
                file_path = params.get("file_path", "<unknown>")
                file_content = params.get("file_content", "")
                logger.info(f"[ENV SERVICE] check_missing_packages called for: {file_path} ({len(file_content)} chars)")
                missing_packages = self._check_missing_packages(file_content, file_path)
                logger.info(f"[ENV SERVICE] Found {len(missing_packages)} missing packages: {missing_packages}")
                result = {"missing_packages": missing_packages}
                reply_method = "check_missing_packages_reply"
            except Exception as e:
                logger.error(f"[ENV SERVICE] Error checking missing packages: {e}", exc_info=True)
                error = f"Error checking missing packages: {str(e)}"
        
        else:
            logger.warning(f"Unknown method: {method}")
            error = f"Method not found: {method}"
        
        # Send Ark-style response (not JSON-RPC 2.0)
        response = {}
        
        if error:
            response["error"] = error
        else:
            response["method"] = reply_method
            response["result"] = result
        
        if request_id:
            response["id"] = request_id
        
        logger.info(f"[ENV SERVICE] Sending response: {response.get('method', 'error')}")
        comm.send(response)
        logger.info(f"[ENV SERVICE] Response sent")

    def shutdown(self) -> None:
        for comm in self._comms.values():
            with contextlib.suppress(Exception):
                comm.close()
        self._comms.clear()

    def _list_packages(self, package_type: str) -> List[Dict[str, Any]]:
        """List installed packages."""
        if package_type == "python":
            return self._list_python_packages()
        elif package_type == "r":
            # This is a Python runtime, so we can't list R packages
            logger.warning("R package listing not supported in Python runtime")
            return []
        else:
            logger.error(f"Unknown package type: {package_type}")
            return []

    def _list_python_packages(self) -> List[Dict[str, Any]]:
        """List installed Python packages using pip list."""
        try:
            # Use pip list to get package information
            result = subprocess.run(
                [sys.executable, "-m", "pip", "list", "--format=json"],
                capture_output=True,
                text=True,
                check=True
            )
            
            packages_data = json.loads(result.stdout)
            
            packages = []
            for pkg_data in packages_data:
                packages.append({
                    "name": pkg_data["name"],
                    "version": pkg_data["version"],
                    "description": None,  # Not available from pip list
                    "location": None,     # Not available from pip list
                    "is_loaded": None,    # Not applicable for Python
                    "priority": None,     # Not applicable for Python
                    "editable": False,    # Not available from pip list
                })
            
            return packages
        except Exception as e:
            logger.error(f"Failed to list Python packages: {e}")
            return []

    def _get_package_info(self, package_name: str) -> Dict[str, Any]:
        """Get detailed information about a Python package."""
        try:
            result = subprocess.run(
                [sys.executable, "-m", "pip", "show", package_name],
                capture_output=True,
                text=True,
                check=True
            )
            
            info = {}
            for line in result.stdout.split('\n'):
                if ':' in line:
                    key, value = line.split(':', 1)
                    info[key.strip().lower()] = value.strip()
            
            # Check if package is editable
            info["editable"] = "-e" in info.get("location", "")
            
            return info
        except Exception:
            return {}

    async def _install_package(self, package_name: str, package_type: str, environment_type: Optional[str] = None) -> Dict[str, Any]:
        """Install a package."""
        
        if package_type == "python":
            return await self._install_python_package(package_name, environment_type)
        elif package_type == "r":
            return {
                "success": False,
                "error": "R package installation not supported in Python runtime"
            }
        else:
            return {
                "success": False,
                "error": f"Unknown package type: {package_type}"
            }

    async def _install_python_package(self, package_name: str, environment_type: Optional[str] = None) -> Dict[str, Any]:
        """Install a Python package using the appropriate method for the current environment."""
        try:
            # Always use environment type information - no fallback to inference
            if not environment_type:
                error_msg = f"Environment type is required for Python package installation but was not provided for package {package_name}"
                logger.error(error_msg)
                return {"success": False, "error": error_msg}
            
            install_cmd = self._get_install_command_from_env_type(package_name, environment_type)
            logger.info(f"[ENV SERVICE] Installing {package_name} with command: {' '.join(install_cmd)}")
            
            # Use async subprocess to avoid blocking the event loop
            # This allows the websocket to stay alive during long conda operations
            process = await asyncio.create_subprocess_exec(
                *install_cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            
            # Wait for completion with 300 second timeout
            try:
                stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=300)
            except asyncio.TimeoutError:
                process.kill()
                error_msg = f"Installation of {package_name} timed out after 300 seconds"
                logger.error(error_msg)
                return {"success": False, "error": error_msg}
            
            if process.returncode != 0:
                error_msg = f"Failed to install Python package {package_name}: {stderr.decode()}"
                logger.error(error_msg)
                return {"success": False, "error": error_msg}
            
            logger.info(f"[ENV SERVICE] Successfully installed {package_name}")
            return {"success": True, "error": None}
        except Exception as e:
            error_msg = f"Failed to install Python package {package_name}: {str(e)}"
            logger.error(error_msg)
            return {"success": False, "error": error_msg}

    def _get_install_command(self, package_name: str) -> List[str]:
        """Get the appropriate installation command for the current Python environment."""
        # Check if we're in a conda environment
        if self._is_conda_environment():
            # Try conda first, but fall back to conda's pip if package not found
            return ["conda", "install", "-y", "-c", "conda-forge", package_name]
        
        # Check if we're in a virtual environment
        if self._is_virtual_environment():
            return [sys.executable, "-m", "pip", "install", package_name]
        
        # Check if we can install to user directory
        if self._should_use_user_install():
            return [sys.executable, "-m", "pip", "install", "--user", package_name]
        
        # Last resort: try with --break-system-packages if available
        if self._supports_break_system_packages():
            return [sys.executable, "-m", "pip", "install", "--break-system-packages", package_name]
        
        # Default fallback (will likely fail on externally managed environments)
        return [sys.executable, "-m", "pip", "install", package_name]

    def _get_uninstall_command(self, package_name: str) -> List[str]:
        """Get the appropriate uninstallation command for the current Python environment."""
        # Check if we're in a conda environment
        if self._is_conda_environment():
            return ["conda", "remove", "-y", package_name]
        
        # Check if we're in a virtual environment (safe to uninstall directly)
        if self._is_virtual_environment():
            return [sys.executable, "-m", "pip", "uninstall", "-y", package_name]
        
        # For system environments, may need --break-system-packages for externally managed systems
        if self._supports_break_system_packages():
            return [sys.executable, "-m", "pip", "uninstall", "-y", "--break-system-packages", package_name]
        
        # Default fallback
        return [sys.executable, "-m", "pip", "uninstall", "-y", package_name]

    def _is_conda_environment(self) -> bool:
        """Check if we're running in a conda environment."""
        return (
            "CONDA_DEFAULT_ENV" in os.environ or
            "CONDA_PREFIX" in os.environ or
            os.path.exists(os.path.join(sys.prefix, "conda-meta"))
        )

    def _is_virtual_environment(self) -> bool:
        """Check if we're running in a virtual environment."""
        return (
            hasattr(sys, "real_prefix") or  # virtualenv
            (hasattr(sys, "base_prefix") and sys.base_prefix != sys.prefix)  # venv
        )

    def _should_use_user_install(self) -> bool:
        """Check if we should use --user flag for pip install."""
        # Don't use --user in virtual environments or conda environments
        if self._is_virtual_environment() or self._is_conda_environment():
            return False
        
        # Use --user if we can't write to the system site-packages
        try:
            import site
            system_site_packages = site.getsitepackages()[0] if site.getsitepackages() else None
            if system_site_packages and not os.access(system_site_packages, os.W_OK):
                return True
        except (ImportError, IndexError, AttributeError):
            pass
        
        return False

    def _supports_break_system_packages(self) -> bool:
        """Check if pip supports --break-system-packages flag."""
        try:
            result = subprocess.run(
                [sys.executable, "-m", "pip", "install", "--help"],
                capture_output=True,
                text=True,
                timeout=10
            )
            return "--break-system-packages" in result.stdout
        except (subprocess.TimeoutExpired, subprocess.CalledProcessError, FileNotFoundError):
            return False

    def _install_with_conda_fallback(self, package_name: str) -> Dict[str, Any]:
        """Try to install with conda, fall back to pip if conda fails."""
        # First try conda
        try:
            conda_cmd = ["conda", "install", "-y", "-c", "conda-forge", package_name]
            
            result = subprocess.run(
                conda_cmd,
                capture_output=True,
                text=True,
                check=True
            )
            
            return {"success": True, "error": None}
            
        except subprocess.CalledProcessError as conda_error:
            # Fall back to pip in the conda environment
            try:
                pip_cmd = [sys.executable, "-m", "pip", "install", package_name]
                
                result = subprocess.run(
                    pip_cmd,
                    capture_output=True,
                    text=True,
                    check=True
                )
                
                return {"success": True, "error": None}
                
            except subprocess.CalledProcessError as pip_error:
                combined_error = f"Conda install failed: {conda_error.stderr}. Pip install failed: {pip_error.stderr}"
                logger.error(combined_error)
                return {"success": False, "error": combined_error}

    def _uninstall_with_conda_fallback(self, package_name: str) -> Dict[str, Any]:
        """Try to uninstall with conda, fall back to pip if conda fails."""
        # First try conda
        try:
            conda_cmd = ["conda", "remove", "-y", package_name]
            
            result = subprocess.run(
                conda_cmd,
                capture_output=True,
                text=True,
                check=True
            )
            
            return {"success": True, "error": None}
            
        except subprocess.CalledProcessError as conda_error:
            # Fall back to pip in the conda environment
            try:
                pip_cmd = [sys.executable, "-m", "pip", "uninstall", "-y", package_name]
                
                result = subprocess.run(
                    pip_cmd,
                    capture_output=True,
                    text=True,
                    check=True
                )
                
                return {"success": True, "error": None}
                
            except subprocess.CalledProcessError as pip_error:
                combined_error = f"Conda uninstall failed: {conda_error.stderr}. Pip uninstall failed: {pip_error.stderr}"
                logger.error(combined_error)
                return {"success": False, "error": combined_error}

    async def _uninstall_package(self, package_name: str, package_type: str, environment_type: Optional[str] = None) -> Dict[str, Any]:
        """Uninstall a package."""
        if package_type == "python":
            return await self._uninstall_python_package(package_name, environment_type)
        elif package_type == "r":
            return {
                "success": False,
                "error": "R package uninstallation not supported in Python runtime"
            }
        else:
            return {
                "success": False,
                "error": f"Unknown package type: {package_type}"
            }

    async def _uninstall_python_package(self, package_name: str, environment_type: Optional[str] = None) -> Dict[str, Any]:
        """Uninstall a Python package."""
        try:
            if not environment_type:
                error_msg = f"Environment type is required for Python package uninstallation but was not provided for package {package_name}"
                logger.error(error_msg)
                return {"success": False, "error": error_msg}
            
            uninstall_cmd = self._get_uninstall_command_from_env_type(package_name, environment_type)
            logger.info(f"[ENV SERVICE] Uninstalling {package_name} with command: {' '.join(uninstall_cmd)}")
            
            # Use async subprocess to avoid blocking the event loop
            # This allows the websocket to stay alive during long conda operations
            process = await asyncio.create_subprocess_exec(
                *uninstall_cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            
            # Wait for completion with 300 second timeout
            try:
                stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=300)
            except asyncio.TimeoutError:
                process.kill()
                error_msg = f"Uninstallation of {package_name} timed out after 300 seconds"
                logger.error(error_msg)
                return {"success": False, "error": error_msg}
            
            if process.returncode != 0:
                error_msg = f"Failed to uninstall Python package {package_name}: {stderr.decode()}"
                logger.error(error_msg)
                return {"success": False, "error": error_msg}
            
            logger.info(f"[ENV SERVICE] Successfully uninstalled {package_name}")
            return {"success": True, "error": None}
        except Exception as e:
            error_msg = f"Failed to uninstall Python package {package_name}: {str(e)}"
            logger.error(error_msg)
            return {"success": False, "error": error_msg}

    def _get_install_command_from_env_type(self, package_name: str, environment_type: str) -> List[str]:
        """Get the appropriate installation command based on environment type."""
        
        # Handle exact values from Python extension API: 'Conda', 'VirtualEnvironment', 'Unknown'
        if environment_type == 'Conda':
            # Conda package operations are too slow and unreliable
            error_msg = "Conda package installation is not supported (conda operations take too long)"
            logger.error(error_msg)
            raise NotImplementedError(error_msg)
        elif environment_type == 'VirtualEnvironment':
            # Python extension returns 'VirtualEnvironment' for all virtual environments
            return [sys.executable, "-m", "pip", "install", package_name]
        elif environment_type == 'Unknown':
            # Unknown environment type - use pip with appropriate flags
            if self._should_use_user_install():
                return [sys.executable, "-m", "pip", "install", "--user", package_name]
            elif self._supports_break_system_packages():
                return [sys.executable, "-m", "pip", "install", "--break-system-packages", package_name]
            else:
                return [sys.executable, "-m", "pip", "install", package_name]
        else:
            # This should never happen since Python extension API only returns 'Conda', 'VirtualEnvironment', 'Unknown'
            error_msg = f"Unexpected environment type: {environment_type}. Expected 'Conda', 'VirtualEnvironment', or 'Unknown'"
            logger.error(error_msg)
            raise ValueError(error_msg)

    def _check_missing_packages(self, content: str, file_path: str = "<unknown>") -> List[str]:
        """Check which imported packages are not installed.
        
        Args:
            content: The Python code content to parse
            file_path: The file path (for logging purposes)
        """
        import ast
        missing = []
        
        # Strip IPython magic commands before parsing
        # Magic commands start with % or %% and will cause syntax errors
        cleaned_lines = []
        for line in content.split('\n'):
            stripped = line.lstrip()
            if not stripped.startswith('%'):
                cleaned_lines.append(line)
        
        cleaned_content = '\n'.join(cleaned_lines)
        
        try:
            tree = ast.parse(cleaned_content)
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    for alias in node.names:
                        pkg = alias.name.split('.')[0]
                        if not self._is_package_installed(pkg):
                            missing.append(pkg)
                elif isinstance(node, ast.ImportFrom):
                    if node.module:
                        pkg = node.module.split('.')[0]
                        if not self._is_package_installed(pkg):
                            missing.append(pkg)
        except SyntaxError as e:
            logger.warning(f"Syntax error parsing Python code from {file_path}: {e}")
        
        return list(set(missing))

    def _is_package_installed(self, package_name: str) -> bool:
        """Check if a package is installed."""
        import sys
        # Filter out stdlib modules
        if package_name in sys.stdlib_module_names:
            return True
        try:
            __import__(package_name)
            return True
        except ImportError:
            return False

    def _get_uninstall_command_from_env_type(self, package_name: str, environment_type: str) -> List[str]:
        """Get the appropriate uninstallation command based on environment type."""
        
        # Handle exact values from Python extension API: 'Conda', 'VirtualEnvironment', 'Unknown'
        if environment_type == 'Conda':
            # Conda package operations are too slow and unreliable
            error_msg = "Conda package uninstallation is not supported (conda operations take too long)"
            logger.error(error_msg)
            raise NotImplementedError(error_msg)
        elif environment_type == 'VirtualEnvironment':
            # Python extension returns 'VirtualEnvironment' for all virtual environments
            return [sys.executable, "-m", "pip", "uninstall", "-y", package_name]
        elif environment_type == 'Unknown':
            # Unknown environment type - might need special handling
            if self._supports_break_system_packages():
                return [sys.executable, "-m", "pip", "uninstall", "-y", "--break-system-packages", package_name]
            else:
                return [sys.executable, "-m", "pip", "uninstall", "-y", package_name]
        else:
            # This should never happen since Python extension API only returns 'Conda', 'VirtualEnvironment', 'Unknown'
            error_msg = f"Unexpected environment type for uninstall: {environment_type}. Expected 'Conda', 'VirtualEnvironment', or 'Unknown'"
            logger.error(error_msg)
            raise ValueError(error_msg)