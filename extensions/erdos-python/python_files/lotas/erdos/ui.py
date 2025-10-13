# Copyright (C) 2025 Lotas Inc. All rights reserved.
# Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.

"""UI service for handling UI comm messages."""

import logging
import os
from typing import Any, Dict

logger = logging.getLogger(__name__)


class UiService:
    """Manages the UI comm and handles JSON-RPC requests from frontend."""

    def __init__(self):
        # Store active comm channels by comm_id to respond on correct channel
        self._comms: Dict[str, Any] = {}

    def on_comm_open(self, comm: Any, _msg: Dict[str, Any]) -> None:
        """Handle comm_open - register message handler."""
        logger.info(f"[PYTHON UI] UI comm opened: {comm.comm_id}")
        self._comms[comm.comm_id] = comm
        
        # Register handler for incoming messages
        comm.on_msg(lambda msg: self.handle_msg(comm, msg))
        
        # Emit initial working directory
        current_dir = os.getcwd()
        logger.info(f"[PYTHON UI] Emitting initial working_directory: {current_dir}")
        comm.send({
            "method": "working_directory",
            "params": {
                "directory": current_dir
            }
        })

    def handle_msg(self, comm: Any, msg: Dict[str, Any]) -> None:
        """Handle JSON-RPC messages received from the client."""
        logger.info(f"[PYTHON UI] handle_msg called")
        content = msg.get("content", {})
        data = content.get("data", {})
        
        logger.info(f"[PYTHON UI] Message data: {data}")
        
        # Check if this is a JSON-RPC request (call_method format)
        if data.get("jsonrpc") != "2.0":
            logger.warning(f"[PYTHON UI] Non-JSON-RPC message received: {data}")
            return
        
        request_id = data.get("id")
        
        # Check for call_method format
        if data.get("method") == "call_method":
            params = data.get("params", {})
            method = params.get("method")
            method_params = params.get("params", [])
            
            logger.info(f"[PYTHON UI] Received call_method request: method={method}, id={request_id}, params={method_params}")
            
            result = None
            error = None
            
            # Route to appropriate handler
            if method == "set_working_directory":
                try:
                    if len(method_params) > 0:
                        directory = method_params[0]
                        logger.info(f"[PYTHON UI] Setting working directory to: {directory}")
                        os.chdir(directory)
                        result = True
                        logger.info(f"[PYTHON UI] Working directory set successfully")
                        
                        # Emit working_directory event to notify frontend
                        current_dir = os.getcwd()
                        logger.info(f"[PYTHON UI] Emitting working_directory event: {current_dir}")
                        comm.send({
                            "method": "working_directory",
                            "params": {
                                "directory": current_dir
                            }
                        })
                    else:
                        error = {"code": -32602, "message": "Missing directory parameter"}
                except Exception as e:
                    logger.error(f"[PYTHON UI] Error setting working directory: {e}")
                    error = {"code": -32603, "message": str(e)}
            else:
                error = {"code": -32601, "message": f"Method not found: {method}"}
            
            # Send JSON-RPC response
            response = {
                "jsonrpc": "2.0",
                "id": request_id,
            }
            
            if error:
                response["error"] = error
            else:
                response["result"] = result
            
            logger.info(f"[PYTHON UI] Sending JSON-RPC response: {response}")
            comm.send(response)
        else:
            logger.warning(f"[PYTHON UI] Unsupported message format: {data}")

    def clear_console(self, session_mode: str = "console") -> None:
        """Send clear_console event to all connected clients."""
        logger.info(f"[PYTHON UI] Clearing console (mode: {session_mode})")
        for comm in self._comms.values():
            try:
                comm.send({
                    "method": "clear_console",
                    "params": {
                        "session_mode": session_mode
                    }
                })
            except Exception as e:
                logger.error(f"[PYTHON UI] Error sending clear_console: {e}")

    def shutdown(self) -> None:
        """Shutdown UI service and close all comms."""
        for comm in self._comms.values():
            try:
                comm.close()
            except Exception:
                pass
        self._comms.clear()

