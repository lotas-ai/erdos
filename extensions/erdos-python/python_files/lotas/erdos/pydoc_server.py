# Copyright (C) 2025 Lotas Inc. All rights reserved.
# Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.

"""
Pydoc HTTP server for Python documentation.
"""

import html
import http.server
import logging
import pydoc
import socketserver
import threading
from typing import Optional
from urllib.parse import parse_qs, urlparse

logger = logging.getLogger(__name__)

HELP_SCRIPT = """<script>
(function() {
    document.addEventListener('keydown', function(e) {
        if (window.parent !== window) {
            window.parent.postMessage({
                id: 'erdos-help-keydown',
                code: e.code,
                key: e.key,
                ctrlKey: e.ctrlKey,
                metaKey: e.metaKey,
                shiftKey: e.shiftKey,
                altKey: e.altKey
            }, '*');
        }
    });
    
    window.addEventListener('message', function(e) {
        if (e.data.id === 'erdos-help-copy-selection') {
            window.parent.postMessage({
                id: 'erdos-help-copy-selection',
                selection: window.getSelection().toString()
            }, '*');
        }
    });
    
    window.parent.postMessage({ id: 'erdos-help-complete' }, '*');
})();
</script>"""


class PydocHTTPRequestHandler(http.server.BaseHTTPRequestHandler):
    """HTTP request handler for serving pydoc documentation."""
    
    def log_message(self, format, *args):
        """Override to use Python logging instead of stderr."""
        logger.debug("%s - - [%s] %s\n" % (
            self.address_string(),
            self.log_date_time_string(),
            format % args
        ))
    
    def do_GET(self):
        """Handle GET requests for pydoc documentation."""
        parsed = urlparse(self.path)
        
        if parsed.path == '/get':
            # Extract the 'key' parameter
            query = parse_qs(parsed.query)
            key = query.get('key', [''])[0]
            
            if not key:
                self.send_error(400, "Missing 'key' parameter")
                return
            
            try:
                # Use pydoc to get the documentation
                logger.info(f"Fetching pydoc for key: {key}")
                
                # Try to locate and document the object
                obj = pydoc.locate(key)
                if obj is None:
                    logger.warning(f"Could not locate object: {key}")
                    self.send_error(404, f"Documentation not found for: {html.escape(key)}")
                    return
                
                # Generate HTML documentation
                doc_html = pydoc.html.page(key, pydoc.html.document(obj, key))
                
                # Inject help script before </head> or </body> or </html>
                if '</head>' in doc_html:
                    doc_html = doc_html.replace('</head>', f'{HELP_SCRIPT}</head>', 1)
                elif '</body>' in doc_html:
                    doc_html = doc_html.replace('</body>', f'{HELP_SCRIPT}</body>', 1)
                elif '</html>' in doc_html:
                    doc_html = doc_html.replace('</html>', f'{HELP_SCRIPT}</html>', 1)
                else:
                    # No tags found, append at end
                    doc_html += HELP_SCRIPT
                
                # Send the response
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(doc_html)))
                self.end_headers()
                self.wfile.write(doc_html.encode('utf-8'))
                
            except Exception as e:
                logger.error(f"Error serving pydoc for {key}: {e}", exc_info=True)
                self.send_error(500, f"Internal server error: {html.escape(str(e))}")
        
        elif parsed.path == '/':
            # Serve a simple index page
            index_html = """
            <html>
            <head><title>Python Documentation Server</title></head>
            <body>
            <h1>Python Documentation Server</h1>
            <p>Use <code>/get?key=module.name</code> to fetch documentation.</p>
            </body>
            </html>
            """
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(index_html)))
            self.end_headers()
            self.wfile.write(index_html.encode('utf-8'))
        
        else:
            self.send_error(404, "Not found")


class PydocServer:
    """Wrapper for the pydoc HTTP server that runs in a background thread."""
    
    def __init__(self, port: int = 0):
        """
        Initialize the pydoc server.
        
        Args:
            port: Port to bind to (0 for automatic port selection)
        """
        self.port = port
        self.server: Optional[socketserver.TCPServer] = None
        self.thread: Optional[threading.Thread] = None
        self.serving = False
        self.url = ""
    
    def start(self):
        """Start the pydoc server in a background thread."""
        try:
            # Create a TCPServer with SO_REUSEADDR
            socketserver.TCPServer.allow_reuse_address = True
            self.server = socketserver.TCPServer(
                ('127.0.0.1', self.port),
                PydocHTTPRequestHandler
            )
            
            # Get the actual port (in case we used port 0)
            actual_port = self.server.server_address[1]
            self.url = f"http://127.0.0.1:{actual_port}/"
            
            logger.info(f"Pydoc server starting on {self.url}")
            
            # Start serving in a background thread
            self.thread = threading.Thread(
                target=self._serve_forever,
                daemon=True,
                name="PydocServer"
            )
            self.serving = True
            self.thread.start()
            
            # Wait a moment for the server to actually start listening
            import time
            time.sleep(0.1)
            
            logger.info(f"Pydoc server started on {self.url}")
            
        except Exception as e:
            logger.error(f"Failed to start pydoc server: {e}", exc_info=True)
            self.serving = False
            raise
    
    def _serve_forever(self):
        """Run the server forever (called in background thread)."""
        try:
            self.server.serve_forever()
        except Exception as e:
            logger.error(f"Pydoc server error: {e}", exc_info=True)
        finally:
            self.serving = False
    
    def stop(self):
        """Stop the pydoc server."""
        if self.server:
            logger.info("Shutting down pydoc server")
            self.server.shutdown()
            self.server.server_close()
            self.serving = False
            logger.info("Pydoc server shut down")


def start_server(port: int = 0) -> Optional[PydocServer]:
    """
    Start a pydoc HTTP server in a background thread.
    
    Args:
        port: Port to bind to (0 for automatic port selection)
        
    Returns:
        The PydocServer instance, or None if server failed to start
    """
    try:
        server = PydocServer(port)
        server.start()
        return server
    except Exception as e:
        logger.error(f"Failed to start pydoc server: {e}")
        return None

