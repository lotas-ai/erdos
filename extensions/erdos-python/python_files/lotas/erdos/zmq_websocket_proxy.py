# Copyright (C) 2025 Lotas Inc. All rights reserved.
# Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.

"""Minimal ZMQ-to-WebSocket proxy for standard ipykernel."""

import asyncio
import json
import logging
import os
import sys
import threading
import queue
from typing import Any, Dict, Set
from jupyter_client import KernelManager

logger = logging.getLogger(__name__)


class ZMQWebSocketProxy:
    """Forwards messages between WebSocket clients and a standard ipykernel via ZMQ."""
    
    def __init__(self, shell_port: int, control_port: int, session_mode: str = "console"):
        self.shell_port = shell_port
        self.control_port = control_port
        self.session_mode = session_mode
        
        self.shell_clients: Set[Any] = set()
        self.control_clients: Set[Any] = set()
        
        self.kernel_manager = None
        self.kernel_client = None
        
        self._stop_event_async = None  # asyncio.Event, created in start()
        self._stop_event_thread = threading.Event()
        self._zmq_thread = None
        
        # Thread-safe queues for messages from ZMQ thread to WebSocket
        self._shell_msg_queue = queue.Queue()
        self._control_msg_queue = queue.Queue()
        self._stdin_msg_queue = queue.Queue()
        
    async def start(self):
        """Start the kernel and proxy servers."""
        # Create asyncio event for the WebSocket loop
        self._stop_event_async = asyncio.Event()
        
        self.kernel_manager = KernelManager()
        self.kernel_manager.kernel_cmd = [sys.executable, '-m', 'ipykernel_launcher', '-f', '{connection_file}']
        
        env = os.environ.copy()
        env['PYDEVD_DISABLE_FILE_VALIDATION'] = '1'
        
        self.kernel_manager.start_kernel(env=env)
        
        self.kernel_client = self.kernel_manager.client()
        self.kernel_client.start_channels()
        
        # Wait for kernel to be ready (run in executor since wait_for_ready is blocking)
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, self.kernel_client.wait_for_ready, 10.0)
        
        self._register_custom_comms()
        self._start_zmq_forwarding()
        
        # Start background task to broadcast messages from queue
        asyncio.create_task(self._queue_broadcaster())
        
        await self._start_websocket_servers()
        
    def _register_custom_comms(self):
        """Register custom comm targets by executing code in the kernel."""
        setup_code = f"""
import sys
import os

if not os.environ.get("MPLBACKEND"):
    os.environ["MPLBACKEND"] = "module://erdos.plotting"
try:
    import matplotlib
    matplotlib.use(os.environ["MPLBACKEND"])
except Exception:
    pass

# Add lotas directory (parent of erdos) to path so we can import erdos module
lotas_dir = {repr(os.path.dirname(os.path.dirname(__file__)))}
sys.path.insert(0, lotas_dir)

from erdos.environment import EnvironmentService
from erdos.ui import UiService
from erdos.help import HelpService

from IPython import get_ipython
kernel = get_ipython().kernel

env_service = EnvironmentService()
kernel.comm_manager.register_target('environment', env_service.on_comm_open)

ui_service = UiService()
kernel.comm_manager.register_target('erdos.ui', ui_service.on_comm_open)

help_service = HelpService()
kernel.comm_manager.register_target('help', help_service.on_comm_open)
help_service.start()

kernel.session_mode = {repr(self.session_mode)}
kernel.ui_service = ui_service
kernel.environment_service = env_service
kernel.help_service = help_service

# Track working directory changes
kernel._erdos_last_cwd = os.getcwd()

def check_cwd_change():
    \"\"\"Post-execute hook to detect working directory changes.\"\"\"
    current_cwd = os.getcwd()
    if current_cwd != kernel._erdos_last_cwd:
        kernel._erdos_last_cwd = current_cwd
        # Emit working_directory event to all UI comms
        if hasattr(kernel, 'ui_service') and kernel.ui_service._comms:
            for comm in kernel.ui_service._comms.values():
                try:
                    comm.send({{
                        "method": "working_directory",
                        "params": {{
                            "directory": current_cwd
                        }}
                    }})
                except Exception:
                    pass

get_ipython().events.register('post_execute', check_cwd_change)

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
"""
        
        msg_id = self.kernel_client.execute(setup_code, silent=False, store_history=False)
        
        # Wait for execute_reply to confirm setup is complete
        import time
        got_reply = False
        start_time = time.time()
        timeout = 5.0  # 5 second timeout for setup
        
        while not got_reply and (time.time() - start_time) < timeout:
            # Check IOPub for status and error messages (consume them)
            if self.kernel_client.iopub_channel.msg_ready():
                self.kernel_client.get_iopub_msg(timeout=0.1)
            
            # Check for execute_reply on shell channel
            if self.kernel_client.shell_channel.msg_ready():
                reply = self.kernel_client.get_shell_msg(timeout=0.1)
                if reply['parent_header'].get('msg_id') == msg_id:
                    got_reply = True
                    break
            
            # Small sleep to avoid busy-waiting
            time.sleep(0.01)
        
    def _start_zmq_forwarding(self):
        """Start thread to forward ZMQ messages to WebSocket."""
        self._zmq_thread = threading.Thread(target=self._zmq_forwarding_thread, daemon=True)
        self._zmq_thread.start()
    
    async def _queue_broadcaster(self):
        """Background task to read from message queues and broadcast to WebSocket clients."""
        while True:
            # Check shell message queue
            try:
                while not self._shell_msg_queue.empty():
                    msg = self._shell_msg_queue.get_nowait()
                    await self._broadcast_to_shell_clients(msg)
            except queue.Empty:
                pass
            
            # Check control message queue
            try:
                while not self._control_msg_queue.empty():
                    msg = self._control_msg_queue.get_nowait()
                    await self._broadcast_to_control_clients(msg)
            except queue.Empty:
                pass
            
            # Check stdin message queue (input_request from kernel)
            try:
                while not self._stdin_msg_queue.empty():
                    msg = self._stdin_msg_queue.get_nowait()
                    await self._broadcast_to_shell_clients(msg)
            except queue.Empty:
                pass
            
            # Small sleep to avoid busy-waiting
            await asyncio.sleep(0.001)
        
    def _zmq_forwarding_thread(self):
        """Thread that reads from ZMQ and puts messages in queues."""
        while not self._stop_event_thread.is_set():
            messages_this_loop = 0
            
            # Forward IOPub messages (status, stream, execute_result, etc.)
            while True:
                try:
                    msg = self.kernel_client.get_iopub_msg(timeout=0.001)
                    messages_this_loop += 1
                    self._shell_msg_queue.put(msg)
                except queue.Empty:
                    break
            
            # Forward Shell replies (execute_reply, complete_reply, etc.)
            while True:
                try:
                    msg = self.kernel_client.get_shell_msg(timeout=0.001)
                    messages_this_loop += 1
                    self._shell_msg_queue.put(msg)
                except queue.Empty:
                    break
            
            # Forward Control replies (interrupt_reply, etc.)
            while True:
                try:
                    msg = self.kernel_client.get_control_msg(timeout=0.001)
                    messages_this_loop += 1
                    self._control_msg_queue.put(msg)
                except queue.Empty:
                    break
            
            # Forward Stdin messages (input_request from kernel)
            while True:
                try:
                    msg = self.kernel_client.get_stdin_msg(timeout=0.001)
                    messages_this_loop += 1
                    self._stdin_msg_queue.put(msg)
                except queue.Empty:
                    break
            
            # Only sleep if no messages were processed
            if messages_this_loop == 0:
                import time
                time.sleep(0.01)
        
    async def _broadcast_to_shell_clients(self, msg: Dict[str, Any]):
        """Broadcast message to all shell WebSocket clients."""
        if not self.shell_clients:
            return
        
        # Convert datetime objects to ISO format for JSON serialization
        msg_copy = dict(msg)
        if 'header' in msg_copy and 'date' in msg_copy['header']:
            date = msg_copy['header']['date']
            if hasattr(date, 'isoformat'):
                msg_copy['header']['date'] = date.isoformat()
        if 'parent_header' in msg_copy and isinstance(msg_copy['parent_header'], dict) and 'date' in msg_copy['parent_header']:
            date = msg_copy['parent_header']['date']
            if hasattr(date, 'isoformat'):
                msg_copy['parent_header']['date'] = date.isoformat()
        
        json_msg = json.dumps(msg_copy)
        disconnected = set()
        
        for client in self.shell_clients:
            try:
                await client.send(json_msg)
            except Exception:
                disconnected.add(client)
                
        for client in disconnected:
            self.shell_clients.discard(client)
            
    async def _broadcast_to_control_clients(self, msg: Dict[str, Any]):
        """Broadcast message to all control WebSocket clients."""
        if not self.control_clients:
            return
        
        # Convert datetime objects to ISO format for JSON serialization
        msg_copy = dict(msg)
        if 'header' in msg_copy and 'date' in msg_copy['header']:
            date = msg_copy['header']['date']
            if hasattr(date, 'isoformat'):
                msg_copy['header']['date'] = date.isoformat()
        if 'parent_header' in msg_copy and isinstance(msg_copy['parent_header'], dict) and 'date' in msg_copy['parent_header']:
            date = msg_copy['parent_header']['date']
            if hasattr(date, 'isoformat'):
                msg_copy['parent_header']['date'] = date.isoformat()
        
        json_msg = json.dumps(msg_copy)
        disconnected = set()
        
        for client in self.control_clients:
            try:
                await client.send(json_msg)
            except Exception:
                disconnected.add(client)
                
        for client in disconnected:
            self.control_clients.discard(client)
            
    async def _start_websocket_servers(self):
        """Start WebSocket servers for shell and control channels."""
        from ._vendor.websockets.asyncio.server import serve
        
        async def run_servers():
            async with serve(
                self._handle_shell_client,
                "localhost",
                self.shell_port,
                max_size=10 * 1024 * 1024
            ):
                async with serve(
                    self._handle_control_client,
                    "localhost",
                    self.control_port,
                    max_size=10 * 1024 * 1024
                ):
                    await self._stop_event_async.wait()
                    
        await run_servers()
        
    async def _handle_shell_client(self, websocket):
        """Handle WebSocket client for shell channel."""
        self.shell_clients.add(websocket)
        
        async for message in websocket:
            msg = json.loads(message)
            msg_type = msg.get('header', {}).get('msg_type')
            
            # Route input_reply to stdin channel, everything else to shell channel
            if msg_type == 'input_reply':
                self.kernel_client.stdin_channel.send(msg)
            else:
                self.kernel_client.shell_channel.send(msg)
            
        self.shell_clients.discard(websocket)
            
    async def _handle_control_client(self, websocket):
        """Handle WebSocket client for control channel."""
        self.control_clients.add(websocket)
        
        async for message in websocket:
            msg = json.loads(message)
            # Forward all control messages to ZMQ (including interrupt_request)
            self.kernel_client.control_channel.send(msg)
                
        self.control_clients.discard(websocket)
        
    async def stop(self):
        """Stop the proxy and kernel."""
        self._stop_event_async.set()
        self._stop_event_thread.set()
        
        if self.kernel_client:
            self.kernel_client.stop_channels()
            
        if self.kernel_manager:
            self.kernel_manager.shutdown_kernel()
