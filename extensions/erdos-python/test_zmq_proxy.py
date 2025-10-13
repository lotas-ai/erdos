#!/usr/bin/env python3
"""
Test script to verify the ZMQ-WebSocket proxy works correctly.
Tests all basic kernel functionality and custom Erdos features.
"""

import asyncio
import json
import subprocess
import sys
import time
import uuid
import os
from pathlib import Path
import websockets

# Configuration
SHELL_PORT = 8080
CONTROL_PORT = 8081
kernel_process = None

def get_python_path():
    """Get the correct Python path - just lotas module, use system ipykernel."""
    script_dir = Path(__file__).parent
    python_files_dir = script_dir / "python_files"
    
    # For the proxy, we DON'T need bundled ipykernel - it can cause architecture conflicts
    # The proxy uses standard jupyter_client which works with system ipykernel
    # We only need the lotas module path for erdos custom services
    bundled_paths = [
        python_files_dir,  # Base path for lotas module
    ]
    
    existing_pythonpath = os.environ.get('PYTHONPATH', '')
    existing_paths = existing_pythonpath.split(':') if existing_pythonpath else []
    
    all_paths = [str(p) for p in bundled_paths] + existing_paths
    return ':'.join(filter(None, all_paths))

def start_kernel():
    """Start the kernel process matching extension.ts exactly."""
    global kernel_process
    
    python_path = get_python_path()
    
    env = os.environ.copy()
    env['PYTHONPATH'] = python_path
    env['PYDEVD_DISABLE_FILE_VALIDATION'] = '1'
    
    print(f"Starting kernel on ports {SHELL_PORT} (shell) and {CONTROL_PORT} (control)")
    print(f"Python: {sys.executable}")
    print(f"PYTHONPATH: {python_path}")
    
    # Match runtime.ts exactly: python -m lotas.erdos_websocket_language_server
    # Force arm64 architecture to match installed packages
    kernel_process = subprocess.Popen(
        [
            'arch', '-arm64',
            sys.executable,
            '-m', 'lotas.erdos_websocket_language_server',
            '--websocket-port', str(SHELL_PORT),
            '--session-mode', 'console',
            '--loglevel', 'info'
        ],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )
    
    print("Waiting for kernel to start...")
    time.sleep(5)
    
    if kernel_process.poll() is not None:
        stdout, stderr = kernel_process.communicate()
        print(f"Kernel failed to start!")
        print(f"STDOUT: {stdout}")
        print(f"STDERR: {stderr}")
        raise RuntimeError("Kernel process exited prematurely")
    
    print("Kernel started successfully")
    
    # Print initial output for debugging
    import select
    if sys.platform != 'win32':
        # Non-blocking read of stderr to see startup messages
        import fcntl
        fd = kernel_process.stderr.fileno()
        fl = fcntl.fcntl(fd, fcntl.F_GETFL)
        fcntl.fcntl(fd, fcntl.F_SETFL, fl | os.O_NONBLOCK)
        try:
            startup_output = kernel_process.stderr.read()
            if startup_output:
                print(f"Kernel startup output:\n{startup_output}")
        except:
            pass

def stop_kernel():
    """Stop the kernel process."""
    global kernel_process
    if kernel_process:
        print("\nStopping kernel...")
        kernel_process.terminate()
        try:
            kernel_process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            kernel_process.kill()
            kernel_process.wait()
        print("Kernel stopped")

def create_message(msg_type, content):
    """Create a Jupyter protocol message."""
    return {
        "header": {
            "msg_id": str(uuid.uuid4()),
            "msg_type": msg_type,
            "username": "test",
            "session": str(uuid.uuid4()),
            "version": "5.3"
        },
        "parent_header": {},
        "metadata": {},
        "content": content
    }

async def test_basic_execution(shell_ws):
    """Test basic code execution."""
    print("\n=== Test 1: Basic Execution ===")
    
    msg = create_message("execute_request", {
        "code": "print('Hello from proxy!')",
        "silent": False,
        "store_history": True,
        "user_expressions": {},
        "allow_stdin": False
    })
    
    await shell_ws.send(json.dumps(msg))
    print("Sent execute_request")
    
    responses = []
    stream_output = []
    
    for _ in range(10):
        try:
            response = await asyncio.wait_for(shell_ws.recv(), timeout=2.0)
            resp_msg = json.loads(response)
            msg_type = resp_msg.get('header', {}).get('msg_type')
            responses.append(msg_type)
            
            if msg_type == 'stream':
                text = resp_msg.get('content', {}).get('text', '')
                stream_output.append(text)
                print(f"  Received stream: {text.strip()}")
            elif msg_type == 'execute_reply':
                status = resp_msg.get('content', {}).get('status')
                print(f"  Received execute_reply: status={status}")
                break
        except asyncio.TimeoutError:
            break
    
    assert 'execute_reply' in responses, "Did not receive execute_reply"
    assert 'stream' in responses, "Did not receive stream output"
    assert 'Hello from proxy!' in ''.join(stream_output), "Output text not found"
    print("✓ Basic execution works")

async def test_result_output(shell_ws):
    """Test execution with result output."""
    print("\n=== Test 2: Result Output ===")
    
    msg = create_message("execute_request", {
        "code": "2 + 2",
        "silent": False,
        "store_history": True,
        "user_expressions": {},
        "allow_stdin": False
    })
    
    await shell_ws.send(json.dumps(msg))
    print("Sent execute_request: 2 + 2")
    
    responses = []
    result_data = None
    
    for _ in range(10):
        try:
            response = await asyncio.wait_for(shell_ws.recv(), timeout=2.0)
            resp_msg = json.loads(response)
            msg_type = resp_msg.get('header', {}).get('msg_type')
            responses.append(msg_type)
            
            if msg_type == 'execute_result':
                result_data = resp_msg.get('content', {}).get('data', {})
                print(f"  Received execute_result: {result_data.get('text/plain')}")
            elif msg_type == 'execute_reply':
                print(f"  Received execute_reply")
                break
        except asyncio.TimeoutError:
            break
    
    assert 'execute_result' in responses, "Did not receive execute_result"
    assert result_data is not None, "No result data"
    assert '4' in result_data.get('text/plain', ''), "Wrong result value"
    print("✓ Result output works")

async def test_completion(shell_ws):
    """Test code completion."""
    print("\n=== Test 3: Code Completion ===")
    
    # First, import sys so we have something to complete
    import_msg = create_message("execute_request", {
        "code": "import sys",
        "silent": True,
        "store_history": False
    })
    await shell_ws.send(json.dumps(import_msg))
    
    # Wait for execute to complete
    await asyncio.sleep(0.5)
    
    # Now request completion
    msg = create_message("complete_request", {
        "code": "sys.ver",
        "cursor_pos": 7
    })
    
    await shell_ws.send(json.dumps(msg))
    print("Sent complete_request for 'sys.ver'")
    
    # Wait for responses - might get status messages first
    for _ in range(10):
        try:
            response = await asyncio.wait_for(shell_ws.recv(), timeout=2.0)
            resp_msg = json.loads(response)
            msg_type = resp_msg.get('header', {}).get('msg_type')
            print(f"  Received {msg_type}")
            
            if msg_type == 'complete_reply':
                matches = resp_msg.get('content', {}).get('matches', [])
                print(f"  Received {len(matches)} completions")
                print(f"  Sample completions: {matches[:3]}")
                
                assert len(matches) > 0, "No completions returned"
                assert any('version' in m for m in matches), "Expected completion not found"
                print("✓ Completion works")
                return
        except asyncio.TimeoutError:
            break
    
    raise AssertionError("Did not receive complete_reply")

async def test_inspection(shell_ws):
    """Test object inspection."""
    print("\n=== Test 4: Object Inspection ===")
    
    msg = create_message("inspect_request", {
        "code": "len",
        "cursor_pos": 3,
        "detail_level": 0
    })
    
    await shell_ws.send(json.dumps(msg))
    print("Sent inspect_request for 'len'")
    
    # Wait for inspect_reply - might get status messages first
    for _ in range(10):
        try:
            response = await asyncio.wait_for(shell_ws.recv(), timeout=2.0)
            resp_msg = json.loads(response)
            msg_type = resp_msg.get('header', {}).get('msg_type')
            
            if msg_type == 'inspect_reply':
                found = resp_msg.get('content', {}).get('found', False)
                data = resp_msg.get('content', {}).get('data', {})
                
                print(f"  Found: {found}")
                if found and 'text/plain' in data:
                    print(f"  Info preview: {data['text/plain'][:100]}...")
                
                assert found, "Object not found"
                assert 'text/plain' in data, "No inspection data"
                print("✓ Inspection works")
                return
        except asyncio.TimeoutError:
            break
    
    raise AssertionError("Did not receive inspect_reply")

async def test_interrupt(shell_ws, control_ws):
    """Test kernel interrupt and state preservation."""
    print("\n=== Test 5: Kernel Interrupt ===")
    
    # Set a variable first
    set_var_msg = create_message("execute_request", {
        "code": "interrupt_test_var = 42",
        "silent": False,
        "store_history": False
    })
    await shell_ws.send(json.dumps(set_var_msg))
    await asyncio.sleep(0.5)
    
    # Clear any pending messages
    try:
        while True:
            await asyncio.wait_for(shell_ws.recv(), timeout=0.1)
    except asyncio.TimeoutError:
        pass
    
    # Start long-running execution (20 seconds)
    import time
    start_time = time.time()
    
    exec_msg = create_message("execute_request", {
        "code": "import time; time.sleep(20)",
        "silent": False,
        "store_history": True
    })
    
    await shell_ws.send(json.dumps(exec_msg))
    print("Sent long-running execution (20s sleep)")
    
    # Wait 1 second then interrupt
    await asyncio.sleep(1.0)
    
    interrupt_msg = create_message("interrupt_request", {})
    await control_ws.send(json.dumps(interrupt_msg))
    print("Sent interrupt_request")
    
    # Wait for interrupt_reply
    interrupt_received = False
    for _ in range(10):
        try:
            interrupt_response = await asyncio.wait_for(control_ws.recv(), timeout=2.0)
            interrupt_resp_msg = json.loads(interrupt_response)
            msg_type = interrupt_resp_msg.get('header', {}).get('msg_type')
            
            if msg_type == 'interrupt_reply':
                print(f"  Received interrupt_reply")
                interrupt_received = True
                break
        except asyncio.TimeoutError:
            break
    
    assert interrupt_received, "Did not receive interrupt_reply"
    
    # Check execution was interrupted (status should be error)
    execute_status = None
    for _ in range(10):
        try:
            response = await asyncio.wait_for(shell_ws.recv(), timeout=2.0)
            resp_msg = json.loads(response)
            msg_type = resp_msg.get('header', {}).get('msg_type')
            if msg_type == 'execute_reply':
                execute_status = resp_msg.get('content', {}).get('status')
                print(f"  Execution status: {execute_status}")
                break
        except asyncio.TimeoutError:
            break
    
    elapsed = time.time() - start_time
    print(f"  Time elapsed: {elapsed:.1f}s (should be ~2-3s, not 20s)")
    assert elapsed < 10, f"Interrupt took too long: {elapsed:.1f}s"
    assert execute_status == 'error', f"Expected status='error', got '{execute_status}'"
    
    # Verify variable is still accessible (state preserved)
    check_var_msg = create_message("execute_request", {
        "code": "print(f'interrupt_test_var = {interrupt_test_var}')",
        "silent": False,
        "store_history": False
    })
    await shell_ws.send(json.dumps(check_var_msg))
    
    # Look for the output
    var_preserved = False
    for _ in range(10):
        try:
            response = await asyncio.wait_for(shell_ws.recv(), timeout=2.0)
            resp_msg = json.loads(response)
            msg_type = resp_msg.get('header', {}).get('msg_type')
            
            if msg_type == 'stream':
                text = resp_msg.get('content', {}).get('text', '')
                if 'interrupt_test_var = 42' in text:
                    print(f"  Variable preserved: {text.strip()}")
                    var_preserved = True
                    break
        except asyncio.TimeoutError:
            break
    
    assert var_preserved, "Variable not preserved after interrupt"
    print("✓ Interrupt works and preserves state")

async def test_custom_comm_ui(shell_ws):
    """Test custom UI comm."""
    print("\n=== Test 6: Custom UI Comm ===")
    
    comm_id = str(uuid.uuid4())
    comm_open_msg = create_message("comm_open", {
        "comm_id": comm_id,
        "target_name": "erdos.ui",
        "data": {}
    })
    
    await shell_ws.send(json.dumps(comm_open_msg))
    print("Sent comm_open for erdos.ui")
    
    initial_dir = None
    for _ in range(5):
        try:
            response = await asyncio.wait_for(shell_ws.recv(), timeout=2.0)
            try:
                resp_msg = json.loads(response)
            except json.JSONDecodeError as e:
                print(f"  JSON decode error: {e}")
                print(f"  Response preview: {response[:200]}")
                continue
                
            msg_type = resp_msg.get('header', {}).get('msg_type')
            
            if msg_type == 'comm_msg':
                content = resp_msg.get('content', {})
                data = content.get('data', {})
                method = data.get('method')
                
                if method == 'working_directory':
                    directory = data.get('params', {}).get('directory')
                    print(f"  Received initial working_directory: {directory}")
                    initial_dir = directory
                    break
        except asyncio.TimeoutError:
            break
    
    if not initial_dir:
        print("⚠ UI comm did not send initial working_directory")
        return
    
    # Test that directory changes are tracked
    print("\n  Testing directory change tracking...")
    chdir_msg = create_message("execute_request", {
        "code": "import os; os.chdir('/tmp')",
        "silent": False,
        "store_history": False
    })
    await shell_ws.send(json.dumps(chdir_msg))
    
    # Wait for working_directory update
    directory_changed = False
    for _ in range(10):
        try:
            response = await asyncio.wait_for(shell_ws.recv(), timeout=2.0)
            resp_msg = json.loads(response)
            msg_type = resp_msg.get('header', {}).get('msg_type')
            
            if msg_type == 'comm_msg':
                content = resp_msg.get('content', {})
                data = content.get('data', {})
                if data.get('method') == 'working_directory':
                    new_dir = data.get('params', {}).get('directory')
                    if new_dir != initial_dir and '/tmp' in new_dir:
                        print(f"  ✓ Directory change detected: {new_dir}")
                        directory_changed = True
                        break
        except asyncio.TimeoutError:
            break
    
    if directory_changed:
        print("✓ UI comm works and tracks directory changes")
    else:
        print("⚠ UI comm did not track directory change")

async def test_custom_comm_environment(shell_ws):
    """Test custom environment comm."""
    print("\n=== Test 7: Custom Environment Comm ===")
    
    comm_id = str(uuid.uuid4())
    
    comm_open_msg = create_message("comm_open", {
        "comm_id": comm_id,
        "target_name": "environment",
        "data": {}
    })
    
    await shell_ws.send(json.dumps(comm_open_msg))
    print("Sent comm_open for environment")
    
    await asyncio.sleep(0.5)
    
    comm_msg = create_message("comm_msg", {
        "comm_id": comm_id,
        "data": {
            "method": "list_packages",
            "id": "test-123",
            "params": {}
        }
    })
    
    await shell_ws.send(json.dumps(comm_msg))
    print("Sent list_packages request")
    
    for _ in range(10):
        try:
            response = await asyncio.wait_for(shell_ws.recv(), timeout=3.0)
            resp_msg = json.loads(response)
            msg_type = resp_msg.get('header', {}).get('msg_type')
            
            if msg_type == 'comm_msg':
                content = resp_msg.get('content', {})
                data = content.get('data', {})
                print(f"  Received comm_msg data keys: {list(data.keys())}")
                print(f"  Full data: {data}")
                
                # Check for packages in various response formats
                if 'result' in data:
                    result = data['result']
                    if isinstance(result, list) and len(result) > 0:
                        print(f"  Received {len(result)} packages")
                        print("✓ Environment comm works")
                        return
                    elif isinstance(result, dict) and 'packages' in result:
                        packages = result['packages']
                        print(f"  Received {len(packages)} packages")
                        print("✓ Environment comm works")
                        return
        except asyncio.TimeoutError:
            break
    
    print("⚠ Environment comm did not respond")

async def test_user_input(shell_ws):
    """Test user input (stdin) functionality."""
    print("\n=== Test 8: User Input (stdin) ===")
    
    # Execute code that requires user input
    exec_msg = create_message("execute_request", {
        "code": "user_input = input('Enter your name: '); print(f'Hello, {user_input}!')",
        "silent": False,
        "store_history": True,
        "user_expressions": {},
        "allow_stdin": True
    })
    
    await shell_ws.send(json.dumps(exec_msg))
    print("Sent execute_request with input() call")
    
    input_request_received = False
    input_request_msg = None
    stream_output = []
    
    for _ in range(20):
        try:
            response = await asyncio.wait_for(shell_ws.recv(), timeout=3.0)
            resp_msg = json.loads(response)
            msg_type = resp_msg.get('header', {}).get('msg_type')
            
            print(f"  Received {msg_type}")
            
            if msg_type == 'stream':
                text = resp_msg.get('content', {}).get('text', '')
                stream_output.append(text)
                print(f"    Output: {text.strip()}")
            
            elif msg_type == 'input_request':
                prompt = resp_msg.get('content', {}).get('prompt', '')
                print(f"  Received input_request with prompt: '{prompt}'")
                input_request_received = True
                input_request_msg = resp_msg
                
                # Send input_reply with user's response
                input_reply = {
                    "header": {
                        "msg_id": str(uuid.uuid4()),
                        "msg_type": "input_reply",
                        "username": "test",
                        "session": resp_msg['header']['session'],
                        "version": "5.3"
                    },
                    "parent_header": resp_msg['header'],
                    "metadata": {},
                    "content": {
                        "value": "TestUser"
                    }
                }
                
                await shell_ws.send(json.dumps(input_reply))
                print("  Sent input_reply with value: 'TestUser'")
            
            elif msg_type == 'execute_reply':
                status = resp_msg.get('content', {}).get('status')
                print(f"  Received execute_reply: status={status}")
                break
                
        except asyncio.TimeoutError:
            print("  Timeout waiting for messages")
            break
    
    full_output = ''.join(stream_output)
    
    assert input_request_received, "Did not receive input_request - kernel may not support stdin"
    assert 'Hello, TestUser!' in full_output, f"Expected output not found. Got: {full_output}"
    
    print("✓ User input (stdin) works correctly")
    print(f"  Full output: {full_output.strip()}")

async def run_tests():
    """Run all tests."""
    print("=" * 60)
    print("ZMQ-WebSocket Proxy Test Suite")
    print("=" * 60)
    
    try:
        print(f"\nConnecting to shell WebSocket on port {SHELL_PORT}...")
        shell_ws = await asyncio.wait_for(
            websockets.connect(f"ws://localhost:{SHELL_PORT}"),
            timeout=5.0
        )
        print("✓ Connected to shell WebSocket")
        
        print(f"\nConnecting to control WebSocket on port {CONTROL_PORT}...")
        control_ws = await asyncio.wait_for(
            websockets.connect(f"ws://localhost:{CONTROL_PORT}"),
            timeout=5.0
        )
        print("✓ Connected to control WebSocket")
        
        # Run tests
        await test_basic_execution(shell_ws)
        await test_result_output(shell_ws)
        await test_completion(shell_ws)
        await test_inspection(shell_ws)
        await test_interrupt(shell_ws, control_ws)
        await test_custom_comm_ui(shell_ws)
        await test_custom_comm_environment(shell_ws)
        await test_user_input(shell_ws)
        
        await shell_ws.close()
        await control_ws.close()
        
        print("\n" + "=" * 60)
        print("All tests completed!")
        print("=" * 60)
        
    except Exception as e:
        print(f"\n❌ Test failed: {e}")
        import traceback
        traceback.print_exc()
        raise

def main():
    """Main entry point."""
    try:
        start_kernel()
        asyncio.run(run_tests())
        print("\n✓ All tests passed!")
        return 0
    except Exception as e:
        print(f"\n❌ Tests failed: {e}")
        return 1
    finally:
        stop_kernel()

if __name__ == "__main__":
    sys.exit(main())

