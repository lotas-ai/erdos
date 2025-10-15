# Copyright (C) 2025 Lotas Inc. All rights reserved.
# Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.

"""Variables service for Python kernel - manages variable list and updates."""

from __future__ import annotations

import contextlib
import logging
import sys
import time
from typing import TYPE_CHECKING, Any, Dict, List, Optional, Set

if TYPE_CHECKING:
    from comm.base_comm import BaseComm

logger = logging.getLogger(__name__)


class Variable:
    """Represents a single variable in the runtime."""
    
    def __init__(
        self,
        access_key: str,
        display_name: str,
        display_value: str,
        display_type: str,
        type_info: str,
        size: int,
        kind: str,
        length: int,
        has_children: bool,
        has_viewer: bool,
        is_truncated: bool,
        updated_time: int
    ):
        self.access_key = access_key
        self.display_name = display_name
        self.display_value = display_value
        self.display_type = display_type
        self.type_info = type_info
        self.size = size
        self.kind = kind
        self.length = length
        self.has_children = has_children
        self.has_viewer = has_viewer
        self.is_truncated = is_truncated
        self.updated_time = updated_time
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "access_key": self.access_key,
            "display_name": self.display_name,
            "display_value": self.display_value,
            "display_type": self.display_type,
            "type_info": self.type_info,
            "size": self.size,
            "kind": self.kind,
            "length": self.length,
            "has_children": self.has_children,
            "has_viewer": self.has_viewer,
            "is_truncated": self.is_truncated,
            "updated_time": self.updated_time,
        }


class VariablesService:
    """Manages Python variables and handles JSON-RPC requests from frontend."""
    
    # Constants for display value formatting
    MAX_DISPLAY_VALUE_LENGTH = 100
    MAX_DISPLAY_VALUE_ENTRIES = 1000
    
    # Snapshot of initial kernel namespace to filter out built-in variables
    _initial_namespace: Optional[Set[str]] = None
    
    def __init__(self):
        # Store active comm channels by comm_id
        self._comms: Dict[str, BaseComm] = {}
        
        # Track current variables and their object IDs for change detection
        self._current_bindings: Dict[str, int] = {}  # name -> id(obj)
        self._version: int = 0
        
        # Capture initial namespace snapshot if not already done
        if VariablesService._initial_namespace is None:
            self._capture_initial_namespace()
    
    def on_comm_open(self, comm: BaseComm, _msg: Dict[str, Any]) -> None:
        """Handle comm_open - register message handler."""
        logger.info(f"[VARIABLES] on_comm_open called for comm_id: {comm.comm_id}")
        self._comms[comm.comm_id] = comm
        
        # Register handler for incoming messages
        comm.on_msg(lambda msg: self.handle_msg(comm, msg))
        
        # Send initial refresh with all variables
        variables = self._list_variables()
        self._send_event(comm, "refresh", {
            "variables": [v.to_dict() for v in variables],
            "length": len(variables),
            "version": self._version
        })
    
    def handle_msg(self, comm: BaseComm, msg: Dict[str, Any]) -> None:
        """Handle JSON-RPC messages received from the client."""
        logger.info(f"[VARIABLES] handle_msg called")
        content = msg.get("content", {})
        data = content.get("data", {})
        
        logger.info(f"[VARIABLES] Message data: {data}")
        
        # Extract method, id, params
        method = data.get("method")
        request_id = data.get("id")
        params = data.get("params", {})
        
        if not method:
            logger.warning(f"[VARIABLES] No method in message: {data}")
            return
        
        logger.info(f"[VARIABLES] Received request: method={method}, id={request_id}")
        
        result = None
        error = None
        reply_method = None
        
        # Route to appropriate handler
        try:
            if method == "list":
                variables = self._list_variables()
                result = {
                    "variables": [v.to_dict() for v in variables],
                    "length": len(variables),
                    "version": self._version
                }
                reply_method = "list_reply"
            
            elif method == "clear":
                include_hidden = params.get("include_hidden_objects", False)
                self._clear(include_hidden)
                # Send update after clearing
                self.update()
                result = {}
                reply_method = "clear_reply"
            
            elif method == "delete":
                names = params.get("names", [])
                self._delete(names)
                # Send update after deleting
                self.update()
                result = {}
                reply_method = "delete_reply"
            
            elif method == "inspect":
                path = params.get("path", [])
                children = self._inspect(path)
                result = {
                    "children": [v.to_dict() for v in children],
                    "length": len(children)
                }
                reply_method = "inspect_reply"
            
            elif method == "clipboard_format":
                path = params.get("path", [])
                format_type = params.get("format", "text/plain")
                content = self._clipboard_format(path, format_type)
                result = {"content": content}
                reply_method = "clipboard_format_reply"
            
            elif method == "view":
                path = params.get("path", [])
                viewer_id = self._view(path)
                result = viewer_id
                reply_method = "view_reply"
            
            elif method == "query_table_summary":
                path = params.get("path", [])
                query_types = params.get("query_types", [])
                summary = self._query_table_summary(path, query_types)
                result = summary
                reply_method = "query_table_summary_reply"
            
            else:
                error = f"Method not found: {method}"
        
        except Exception as e:
            logger.error(f"[VARIABLES] Error in handler: {e}", exc_info=True)
            error = f"Internal error: {str(e)}"
        
        # Send response
        response = {
            "jsonrpc": "2.0"
        }
        
        if error:
            response["error"] = {"message": error}
        else:
            # Wrap result to match Ark's adjacently-tagged enum format:
            # { method: "InspectReply", result: { actual data } }
            # Convert snake_case reply_method to PascalCase to match Rust enum variants
            method_name = ''.join(word.capitalize() for word in reply_method.split('_'))
            response["result"] = {
                "method": method_name,
                "result": result
            }
        
        if request_id:
            response["id"] = request_id
        
        comm.send(response)
    
    def shutdown(self) -> None:
        """Shutdown variables service and close all comms."""
        for comm in self._comms.values():
            with contextlib.suppress(Exception):
                comm.close()
        self._comms.clear()
    
    def update(self) -> None:
        """Check for variable changes and send update events."""
        logger.info(f"[VARIABLES] update() called")
        
        # Get current variable state
        current_vars = self._get_user_variables()
        new_bindings: Dict[str, int] = {}
        
        assigned: List[Variable] = []
        removed: List[str] = []
        
        # Build new bindings and detect changes
        for name, obj in current_vars.items():
            obj_id = id(obj)
            new_bindings[name] = obj_id
            
            # Check if variable is new or changed
            if name not in self._current_bindings or self._current_bindings[name] != obj_id:
                var = self._format_variable(name, obj)
                assigned.append(var)
        
        # Detect removed variables
        for name in self._current_bindings:
            if name not in new_bindings:
                removed.append(name)
        
        # Update state
        if assigned or removed:
            self._current_bindings = new_bindings
            self._version += 1
            
            # Send update event to all comms
            event_params = {
                "assigned": [v.to_dict() for v in assigned],
                "removed": removed,
                "unevaluated": [],
                "version": self._version
            }
            
            for comm in self._comms.values():
                self._send_event(comm, "update", event_params)
            
            logger.info(f"[VARIABLES] Sent update: {len(assigned)} assigned, {len(removed)} removed")
    
    def _send_event(self, comm: BaseComm, method: str, params: Dict[str, Any]) -> None:
        """Send an event to the frontend."""
        event = {
            "method": method,
            "params": params
        }
        
        try:
            comm.send(event)
        except Exception as e:
            logger.error(f"[VARIABLES] Failed to send event: {e}")
    
    def _list_variables(self) -> List[Variable]:
        """List all user variables in the global namespace."""
        variables: List[Variable] = []
        current_vars = self._get_user_variables()
        
        # Update bindings
        self._current_bindings = {name: id(obj) for name, obj in current_vars.items()}
        
        # Convert to Variable objects
        for name, obj in sorted(current_vars.items()):
            var = self._format_variable(name, obj)
            variables.append(var)
        
        return variables
    
    def _capture_initial_namespace(self) -> None:
        """Capture the initial kernel namespace to filter out kernel-injected variables."""
        try:
            from IPython import get_ipython
            ipython = get_ipython()
            if ipython is None:
                VariablesService._initial_namespace = set()
                return
            
            # Capture all current namespace keys as the initial "system" variables
            VariablesService._initial_namespace = set(ipython.user_ns.keys())
            logger.info(f"[VARIABLES] Captured initial namespace with {len(VariablesService._initial_namespace)} variables")
        except Exception as e:
            logger.error(f"[VARIABLES] Failed to capture initial namespace: {e}")
            VariablesService._initial_namespace = set()
    
    def _get_user_variables(self) -> Dict[str, Any]:
        """Get user-defined variables from the kernel's user namespace."""
        import types
        
        try:
            from IPython import get_ipython
            ipython = get_ipython()
            if ipython is None:
                return {}
            user_ns = ipython.user_ns
        except Exception:
            return {}
        
        # Filter out built-ins, private variables, and kernel-injected variables
        filtered = {}
        for name, obj in user_ns.items():
            # Skip if name starts with underscore (private/internal)
            if name.startswith('_'):
                continue
            
            # Skip variables that were present in initial kernel namespace
            if VariablesService._initial_namespace and name in VariablesService._initial_namespace:
                continue
            
            # Skip ALL module objects (both with and without __file__)
            if isinstance(obj, types.ModuleType):
                continue
            
            filtered[name] = obj
        
        return filtered
    
    def _format_variable(self, name: str, obj: Any) -> Variable:
        """Format a Python object as a Variable."""
        # Get basic type information
        obj_type = type(obj)
        type_name = obj_type.__name__
        
        # Determine kind based on type
        kind = self._determine_kind(obj)
        
        # Get display value (truncated representation)
        display_value, is_truncated = self._format_display_value(obj)
        
        # Get display type
        display_type = self._format_display_type(obj)
        
        # Get type info (full module path)
        type_info = f"{obj_type.__module__}.{type_name}" if hasattr(obj_type, '__module__') else type_name
        
        # Calculate size in bytes (approximate)
        size = self._calculate_size(obj)
        
        # Get length if applicable
        length = self._get_length(obj)
        
        # Determine if has children
        has_children = self._has_children(obj)
        
        # Determine if has viewer (data frames, arrays, etc.)
        has_viewer = self._has_viewer(obj)
        
        # Current timestamp
        updated_time = int(time.time() * 1000)
        
        return Variable(
            access_key=name,
            display_name=name,
            display_value=display_value,
            display_type=display_type,
            type_info=type_info,
            size=size,
            kind=kind,
            length=length,
            has_children=has_children,
            has_viewer=has_viewer,
            is_truncated=is_truncated,
            updated_time=updated_time
        )
    
    def _determine_kind(self, obj: Any) -> str:
        """Determine the VariableKind for a Python object."""
        obj_type = type(obj)
        
        # Check for None
        if obj is None:
            return "empty"
        
        # Check for booleans (must come before numbers since bool is subclass of int)
        if isinstance(obj, bool):
            return "boolean"
        
        # Check for numbers
        if isinstance(obj, (int, float, complex)):
            return "number"
        
        # Check for strings
        if isinstance(obj, str):
            return "string"
        
        # Check for bytes
        if isinstance(obj, (bytes, bytearray)):
            return "bytes"
        
        # Check for functions/callables
        if callable(obj):
            return "function"
        
        # Check for pandas DataFrames
        if obj_type.__name__ == 'DataFrame':
            return "table"
        
        # Check for numpy arrays or other array-like objects
        if obj_type.__name__ in ('ndarray', 'Array', 'Tensor'):
            return "collection"
        
        # Check for dictionaries
        if isinstance(obj, dict):
            return "map"
        
        # Check for other collections
        if isinstance(obj, (list, tuple, set, frozenset)):
            return "collection"
        
        # Check for classes
        if isinstance(obj, type):
            return "class"
        
        # Default to other
        return "other"
    
    def _format_display_value(self, obj: Any) -> tuple[str, bool]:
        """Format the display value for an object, returning (value, is_truncated)."""
        # Handle None
        if obj is None:
            return "None", False
        
        # Handle booleans
        if isinstance(obj, bool):
            return str(obj), False
        
        # Handle numbers
        if isinstance(obj, (int, float)):
            return str(obj), False
        
        if isinstance(obj, complex):
            return str(obj), False
        
        # Handle strings
        if isinstance(obj, str):
            if len(obj) > self.MAX_DISPLAY_VALUE_LENGTH:
                truncated = obj[:self.MAX_DISPLAY_VALUE_LENGTH] + "..."
                return repr(truncated), True
            return repr(obj), False
        
        # Handle bytes
        if isinstance(obj, (bytes, bytearray)):
            display = repr(obj)
            if len(display) > self.MAX_DISPLAY_VALUE_LENGTH:
                return display[:self.MAX_DISPLAY_VALUE_LENGTH] + "...", True
            return display, False
        
        # Handle functions
        if callable(obj) and not isinstance(obj, type):
            try:
                module = getattr(obj, '__module__', '')
                name = getattr(obj, '__name__', repr(obj))
                if module and module != '__main__':
                    return f"<function {module}.{name}>", False
                return f"<function {name}>", False
            except Exception:
                return "<function>", False
        
        # Handle pandas DataFrames
        if type(obj).__name__ == 'DataFrame':
            try:
                rows, cols = obj.shape
                return f"[{rows} rows x {cols} columns]", False
            except Exception:
                return "<DataFrame>", False
        
        # Handle numpy arrays
        if type(obj).__name__ in ('ndarray', 'Array'):
            try:
                import numpy as np
                if hasattr(obj, 'shape'):
                    return f"<{type(obj).__name__} shape={obj.shape} dtype={getattr(obj, 'dtype', 'unknown')}>", False
                return f"<{type(obj).__name__}>", False
            except Exception:
                return f"<{type(obj).__name__}>", False
        
        # Handle lists, tuples, sets
        if isinstance(obj, (list, tuple, set)):
            length = len(obj)
            if length == 0:
                return "[]" if isinstance(obj, list) else "()" if isinstance(obj, tuple) else "set()", False
            
            try:
                # Try to show a preview
                items_str = []
                for i, item in enumerate(obj):
                    if i >= 5:  # Show max 5 items
                        items_str.append("...")
                        break
                    items_str.append(repr(item))
                
                if isinstance(obj, list):
                    preview = f"[{', '.join(items_str)}]"
                elif isinstance(obj, tuple):
                    preview = f"({', '.join(items_str)})"
                else:
                    preview = f"{{{', '.join(items_str)}}}"
                
                if len(preview) > self.MAX_DISPLAY_VALUE_LENGTH:
                    return preview[:self.MAX_DISPLAY_VALUE_LENGTH] + "...", True
                return preview, len(obj) > 5
            except Exception:
                return f"<{type(obj).__name__} length={length}>", False
        
        # Handle dictionaries
        if isinstance(obj, dict):
            length = len(obj)
            if length == 0:
                return "{}", False
            
            try:
                # Show a preview
                items_str = []
                for i, (key, value) in enumerate(obj.items()):
                    if i >= 3:  # Show max 3 items for dicts
                        items_str.append("...")
                        break
                    items_str.append(f"{repr(key)}: {repr(value)}")
                
                preview = f"{{{', '.join(items_str)}}}"
                if len(preview) > self.MAX_DISPLAY_VALUE_LENGTH:
                    return preview[:self.MAX_DISPLAY_VALUE_LENGTH] + "...", True
                return preview, len(obj) > 3
            except Exception:
                return f"<dict length={length}>", False
        
        # Handle classes
        if isinstance(obj, type):
            return f"<class '{obj.__name__}'>", False
        
        # Default: use repr() with truncation
        try:
            display = repr(obj)
            if len(display) > self.MAX_DISPLAY_VALUE_LENGTH:
                return display[:self.MAX_DISPLAY_VALUE_LENGTH] + "...", True
            return display, False
        except Exception:
            return f"<{type(obj).__name__} object>", False
    
    def _format_display_type(self, obj: Any) -> str:
        """Format the display type for an object."""
        obj_type = type(obj)
        type_name = obj_type.__name__
        
        # Special handling for numpy types
        if type_name in ('ndarray', 'Array'):
            if hasattr(obj, 'dtype'):
                return f"{type_name}[{obj.dtype}]"
        
        # Special handling for DataFrames
        if type_name == 'DataFrame':
            return "DataFrame"
        
        # For generic types, just return the type name
        return type_name
    
    def _calculate_size(self, obj: Any) -> int:
        """Calculate approximate size in bytes."""
        try:
            return sys.getsizeof(obj)
        except Exception:
            return 0
    
    def _get_length(self, obj: Any) -> int:
        """Get the length of the object if applicable."""
        try:
            return len(obj)
        except Exception:
            return 0
    
    def _has_children(self, obj: Any) -> bool:
        """Determine if the object has inspectable children."""
        # Lists, tuples, sets, dicts have children
        if isinstance(obj, (list, tuple, set, dict)):
            return len(obj) > 0
        
        # DataFrames have children (columns)
        if type(obj).__name__ == 'DataFrame':
            return True
        
        # Objects with __dict__ have children
        if hasattr(obj, '__dict__') and not isinstance(obj, type):
            return len(obj.__dict__) > 0
        
        return False
    
    def _has_viewer(self, obj: Any) -> bool:
        """Determine if object has a data viewer available."""
        # DataFrames can be viewed
        if type(obj).__name__ == 'DataFrame':
            return True
        
        # Numpy arrays can be viewed
        if type(obj).__name__ in ('ndarray', 'Array'):
            return True
        
        return False
    
    def _clear(self, include_hidden: bool) -> None:
        """Clear all user variables."""
        try:
            from IPython import get_ipython
            ipython = get_ipython()
            if ipython is None:
                return
            user_ns = ipython.user_ns
        except Exception:
            return
        
        # Collect variables to delete
        to_delete = []
        for name in list(user_ns.keys()):
            # Always skip IPython built-ins
            if name in ('In', 'Out', 'get_ipython', 'exit', 'quit', 'help'):
                continue
            
            # Check if hidden
            if name.startswith('_'):
                if include_hidden:
                    to_delete.append(name)
            else:
                to_delete.append(name)
        
        # Delete variables
        for name in to_delete:
            try:
                del user_ns[name]
            except Exception as e:
                logger.warning(f"Failed to delete variable {name}: {e}")
    
    def _delete(self, names: List[str]) -> None:
        """Delete specific variables."""
        try:
            from IPython import get_ipython
            ipython = get_ipython()
            if ipython is None:
                return
            user_ns = ipython.user_ns
        except Exception:
            return
        
        for name in names:
            try:
                if name in user_ns:
                    del user_ns[name]
            except Exception as e:
                logger.warning(f"Failed to delete variable {name}: {e}")
    
    def _inspect(self, path: List[str]) -> List[Variable]:
        """Inspect a variable and return its children."""
        logger.info(f"[VARIABLES] _inspect called with path: {path}")
        if not path:
            logger.warning("[VARIABLES] _inspect: Empty path provided")
            return []
        
        # Resolve the object from the path
        logger.info(f"[VARIABLES] _inspect: Resolving path")
        obj = self._resolve_path(path)
        if obj is None:
            logger.warning(f"[VARIABLES] _inspect: Failed to resolve path {path}")
            return []
        
        logger.info(f"[VARIABLES] _inspect: Resolved object type: {type(obj).__name__}")
        children: List[Variable] = []
        
        # Handle dictionaries
        if isinstance(obj, dict):
            logger.info(f"[VARIABLES] _inspect: Object is dict with {len(obj)} items")
            for key, value in obj.items():
                child_name = str(key)
                var = self._format_variable(child_name, value)
                children.append(var)
        
        # Handle lists/tuples
        elif isinstance(obj, (list, tuple)):
            logger.info(f"[VARIABLES] _inspect: Object is list/tuple with {len(obj)} items")
            for i, item in enumerate(obj):
                child_name = f"[{i}]"
                var = self._format_variable(child_name, item)
                children.append(var)
        
        # Handle DataFrames (columns)
        elif type(obj).__name__ == 'DataFrame':
            logger.info(f"[VARIABLES] _inspect: Object is DataFrame with {len(obj.columns)} columns")
            for col_name in obj.columns:
                try:
                    col_data = obj[col_name]
                    var = self._format_variable(str(col_name), col_data)
                    children.append(var)
                except Exception as e:
                    logger.warning(f"Failed to inspect DataFrame column {col_name}: {e}")
        
        # Handle objects with __dict__
        elif hasattr(obj, '__dict__'):
            logger.info(f"[VARIABLES] _inspect: Object has __dict__ with {len(obj.__dict__)} attributes")
            for attr_name, attr_value in obj.__dict__.items():
                if not attr_name.startswith('_'):
                    var = self._format_variable(attr_name, attr_value)
                    children.append(var)
        else:
            logger.warning(f"[VARIABLES] _inspect: Object type {type(obj).__name__} not handled")
        
        logger.info(f"[VARIABLES] _inspect: Returning {len(children)} children")
        return children
    
    def _resolve_path(self, path: List[str]) -> Optional[Any]:
        """Resolve an object from a path of access keys."""
        logger.info(f"[VARIABLES] _resolve_path called with path: {path}")
        if not path:
            logger.warning("[VARIABLES] _resolve_path: Empty path")
            return None
        
        try:
            from IPython import get_ipython
            ipython = get_ipython()
            if ipython is None:
                logger.warning("[VARIABLES] _resolve_path: IPython is None")
                return None
            user_ns = ipython.user_ns
        except Exception as e:
            logger.error(f"[VARIABLES] _resolve_path: Failed to get IPython: {e}")
            return None
        
        # Start with the root variable
        if path[0] not in user_ns:
            logger.warning(f"[VARIABLES] _resolve_path: Root variable '{path[0]}' not found in namespace")
            logger.info(f"[VARIABLES] _resolve_path: Available variables: {list(user_ns.keys())}")
            return None
        
        obj = user_ns[path[0]]
        logger.info(f"[VARIABLES] _resolve_path: Found root variable '{path[0]}' with type {type(obj).__name__}")
        
        # Traverse the path
        for i, key in enumerate(path[1:], 1):
            logger.info(f"[VARIABLES] _resolve_path: Traversing path[{i}] = '{key}'")
            try:
                # Try dictionary access
                if isinstance(obj, dict):
                    logger.info(f"[VARIABLES] _resolve_path: Trying dict access for key '{key}'")
                    obj = obj[key]
                # Try attribute access
                elif hasattr(obj, key):
                    logger.info(f"[VARIABLES] _resolve_path: Trying attribute access for key '{key}'")
                    obj = getattr(obj, key)
                # Try list/tuple index
                elif isinstance(obj, (list, tuple)):
                    logger.info(f"[VARIABLES] _resolve_path: Trying list/tuple index for key '{key}'")
                    # Remove brackets from key like "[0]"
                    index = int(key.strip('[]'))
                    obj = obj[index]
                # Try DataFrame column access
                elif type(obj).__name__ == 'DataFrame':
                    logger.info(f"[VARIABLES] _resolve_path: Trying DataFrame column access for key '{key}'")
                    obj = obj[key]
                else:
                    logger.warning(f"[VARIABLES] _resolve_path: Cannot access key '{key}' on type {type(obj).__name__}")
                    return None
                logger.info(f"[VARIABLES] _resolve_path: Successfully accessed '{key}', now at type {type(obj).__name__}")
            except Exception as e:
                logger.error(f"[VARIABLES] Failed to resolve path {path} at key {key}: {e}", exc_info=True)
                return None
        
        logger.info(f"[VARIABLES] _resolve_path: Successfully resolved path, final type: {type(obj).__name__}")
        return obj
    
    def _clipboard_format(self, path: List[str], format_type: str) -> str:
        """Format a variable for clipboard copying."""
        obj = self._resolve_path(path)
        if obj is None:
            return ""
        
        if format_type == "text/plain":
            # Return plain text representation
            return str(obj)
        elif format_type == "text/html":
            # For DataFrames, return HTML representation
            if type(obj).__name__ == 'DataFrame':
                try:
                    return obj.to_html()
                except Exception:
                    return str(obj)
            return str(obj)
        
        return str(obj)
    
    def _view(self, path: List[str]) -> Optional[str]:
        """Open a viewer for the variable."""
        # This would integrate with the data explorer/viewer system
        # For now, just return None (no viewer opened)
        logger.info(f"[VARIABLES] View requested for path: {path}")
        return None
    
    def _query_table_summary(self, path: List[str], query_types: List[str]) -> Dict[str, Any]:
        """Query table summary information."""
        obj = self._resolve_path(path)
        if obj is None:
            return {
                "num_rows": 0,
                "num_columns": 0,
                "column_schemas": [],
                "column_profiles": []
            }
        
        # Handle DataFrames
        if type(obj).__name__ == 'DataFrame':
            try:
                num_rows, num_columns = obj.shape
                
                # Get column schemas
                column_schemas = []
                for col_name in obj.columns:
                    schema = {
                        "column_name": str(col_name),
                        "type_display": str(obj[col_name].dtype)
                    }
                    column_schemas.append(schema)
                
                # Get column profiles if requested
                column_profiles = []
                if "summary_stats" in query_types:
                    for col_name in obj.columns:
                        try:
                            col_data = obj[col_name]
                            profile = {
                                "column_name": str(col_name),
                                "type_display": str(col_data.dtype),
                                "summary_stats": self._get_column_summary_stats(col_data)
                            }
                            column_profiles.append(profile)
                        except Exception as e:
                            logger.warning(f"Failed to get summary for column {col_name}: {e}")
                
                return {
                    "num_rows": int(num_rows),
                    "num_columns": int(num_columns),
                    "column_schemas": [str(s) for s in column_schemas],
                    "column_profiles": [str(p) for p in column_profiles]
                }
            except Exception as e:
                logger.error(f"Failed to query table summary: {e}")
        
        return {
            "num_rows": 0,
            "num_columns": 0,
            "column_schemas": [],
            "column_profiles": []
        }
    
    def _get_column_summary_stats(self, series: Any) -> Dict[str, Any]:
        """Get summary statistics for a pandas Series."""
        try:
            # Use pandas describe() if available
            if hasattr(series, 'describe'):
                desc = series.describe()
                return desc.to_dict()
        except Exception:
            pass
        
        return {}

