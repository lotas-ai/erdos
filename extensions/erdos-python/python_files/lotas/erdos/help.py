# Copyright (C) 2025 Lotas Inc. All rights reserved.
# Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.

"""Help service for Python kernel - handles JSON-RPC help requests."""

from __future__ import annotations

import contextlib
import logging
import pydoc
from typing import TYPE_CHECKING, Any, Dict

from .function_parser import parse_functions_rpc
from .help_search import search_help_topics_rpc
from .pydoc_server import start_server

if TYPE_CHECKING:
    from comm.base_comm import BaseComm

logger = logging.getLogger(__name__)


def help(topic="help"):
    """
    Show help for the given topic.

    Examples
    --------

    Show help for the `help` function itself:

    >>> help()

    Show help for a type:

    >>> import pandas
    >>> help(pandas.DataFrame)

    A string import path works too:

    >>> help("pandas.DataFrame")

    Show help for a type given an instance:

    >>> df = pandas.DataFrame()
    >>> help(df)
    """
    from .erdos_websocket_ipkernel import ErdosWebSocketKernel

    if ErdosWebSocketKernel.initialized():
        kernel = ErdosWebSocketKernel.instance()
        kernel.help_service.show_help(topic)
    else:
        raise Exception("Unexpected error. No ErdosWebSocketKernel has been initialized.")


class HelpService:
    """Manages the help server and handles JSON-RPC requests from frontend."""

    _QUALNAME_OVERRIDES = {
        "pandas.core.frame": "pandas",
        "pandas.core.series": "pandas",
    }

    def __init__(self):
        # Store active comm channels by comm_id to respond on correct channel
        self._comms: Dict[str, BaseComm] = {}
        self._pydoc_thread = None

    def on_comm_open(self, comm: BaseComm, _msg: Dict[str, Any]) -> None:
        """Handle comm_open - register message handler."""
        self._comms[comm.comm_id] = comm
        
        # Register handler for incoming messages
        comm.on_msg(lambda msg: self.handle_msg(comm, msg))

    def handle_msg(self, comm: BaseComm, msg: Dict[str, Any]) -> None:
        """Handle JSON-RPC messages received from the client."""
        logger.info(f"[PYTHON HELP] handle_msg called")
        content = msg.get("content", {})
        data = content.get("data", {})
        
        logger.info(f"[PYTHON HELP] Message data: {data}")
        
        # Check if this is a JSON-RPC request
        if data.get("jsonrpc") != "2.0":
            logger.warning(f"[PYTHON HELP] Non-JSON-RPC message received: {data}")
            return
        
        request_id = data.get("id")
        method = data.get("method")
        params = data.get("params", {})
        
        logger.info(f"[PYTHON HELP] Received JSON-RPC request: method={method}, id={request_id}, params={params}")
        
        result = None
        error = None
        
        # Route to appropriate handler
        try:
            if method == "show_help_topic":
                topic = params.get("topic")
                logger.info(f"[PYTHON HELP] Calling show_help with topic: {topic}")
                self.show_help(topic)
                result = True
                logger.info(f"[PYTHON HELP] show_help completed, returning result: {result}")
            
            elif method == "search_help_topics":
                query = params.get("query")
                result = search_help_topics_rpc(query)
            
            elif method == "parse_functions":
                code = params.get("code")
                language = params.get("language")
                result = parse_functions_rpc(code, language)
            
            else:
                error = {
                    "code": -32601,
                    "message": f"Method not found: {method}"
                }
        except Exception as e:
            logger.error(f"[PYTHON HELP] ERROR in handler: {e}", exc_info=True)
            error = {
                "code": -32603,
                "message": f"Internal error: {str(e)}"
            }
        
        # Send JSON-RPC response
        response = {
            "jsonrpc": "2.0",
            "id": request_id,
        }
        
        if error:
            response["error"] = error
        else:
            response["result"] = result
        
        logger.info(f"Sending JSON-RPC response: {response}")
        comm.send(response)

    def shutdown(self) -> None:
        """Shutdown help service and close all comms."""
        if self._pydoc_thread is not None and self._pydoc_thread.serving:
            logger.info("Stopping pydoc server thread")
            self._pydoc_thread.stop()
            logger.info("Pydoc server thread stopped")
        
        for comm in self._comms.values():
            with contextlib.suppress(Exception):
                comm.close()
        
        self._comms.clear()

    def start(self):
        """Start the help service and pydoc server."""
        self._pydoc_thread = start_server()
        
        # Warm the help cache in background (non-blocking, AST-based)
        try:
            from .help_search import warm_help_cache
            warm_help_cache()
        except Exception as e:
            logger.warning(f"Failed to start help cache warming: {e}")

    def show_help(self, request: str | Any | None) -> None:
        """Show help for a topic by sending URL to frontend."""
        logger.info(f"[PYTHON HELP] show_help called with request: {request}")
        
        if self._pydoc_thread is None or not self._pydoc_thread.serving:
            logger.warning("[PYTHON HELP] Ignoring help request, the pydoc server is not serving")
            logger.warning(f"[PYTHON HELP] _pydoc_thread is None: {self._pydoc_thread is None}")
            if self._pydoc_thread is not None:
                logger.warning(f"[PYTHON HELP] _pydoc_thread.serving: {self._pydoc_thread.serving}")
            return

        logger.info(f"[PYTHON HELP] Pydoc server is running at: {self._pydoc_thread.url}")

        result = None
        with contextlib.suppress(ImportError):
            result = pydoc.resolve(thing=request)

        logger.info(f"[PYTHON HELP] pydoc.resolve returned: {result}")

        if result is None:
            key = request
            logger.info(f"[PYTHON HELP] No resolve result, using request as key: {key}")
        else:
            obj = result[0]
            # Get the qualified name
            if hasattr(obj, '__module__') and hasattr(obj, '__qualname__'):
                key = f"{obj.__module__}.{obj.__qualname__}"
            elif hasattr(obj, '__module__') and hasattr(obj, '__name__'):
                key = f"{obj.__module__}.{obj.__name__}"
            elif hasattr(obj, '__name__'):
                key = obj.__name__
            else:
                key = str(obj)

            logger.info(f"[PYTHON HELP] Resolved object to key: {key}")

            # Apply overrides
            for old, new in self._QUALNAME_OVERRIDES.items():
                if key.startswith(old):
                    key = key.replace(old, new)
                    logger.info(f"[PYTHON HELP] Applied override: {old} -> {new}, new key: {key}")
                    break

        # Ensure proper URL construction with trailing slash
        base_url = self._pydoc_thread.url
        if not base_url.endswith('/'):
            base_url += '/'
        url = f"{base_url}get?key={key}"

        logger.info(f"[PYTHON HELP] Built help URL: {url}")
        logger.info(f"[PYTHON HELP] Number of registered comms: {len(self._comms)}")

        # Send event to all registered comms
        event = {
            "method": "show_help",
            "params": {
                "content": url,
                "kind": "url",
                "focus": True
            }
        }
        
        logger.info(f"[PYTHON HELP] Sending show_help event to comms: {event}")
        
        for comm_id, comm in self._comms.items():
            try:
                logger.info(f"[PYTHON HELP] Sending to comm {comm_id}")
                comm.send(event)
                logger.info(f"[PYTHON HELP] Successfully sent to comm {comm_id}")
            except Exception as e:
                logger.error(f"[PYTHON HELP] Failed to send to comm {comm_id}: {e}")

