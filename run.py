import subprocess
import sys
import os
import threading
import time
import webbrowser
from http.server import SimpleHTTPRequestHandler, HTTPServer

def start_backend_api():
    """Launches the primary Python API backend."""
    try:
        import backend.sensor_monitor as monitor
        monitor.main()
    except Exception as e:
        print(f"[CRITICAL] Failed to execute telemetry backend: {e}")

class FrontendHTTPHandler(SimpleHTTPRequestHandler):
    """Custom simple server with CORS allowing quick local testing asset delivery."""
    def log_message(self, format, *args):
        # Prevent logs terminal flooding
        pass

def start_frontend_server():
    """Hosts the React/TypeScript frontend on a local static port."""
    base_dir = os.path.dirname(os.path.abspath(__file__))
    frontend_dir = os.path.join(base_dir, "frontend")
    os.chdir(frontend_dir)
    
    server_address = ("127.0.0.1", 3000)
    httpd = HTTPServer(server_address, FrontendHTTPHandler)
    print("[INFO] Local UI file host running at http://127.0.0.1:3000")
    
    try:
        httpd.serve_forever()
    except Exception as e:
        print(f"[CRITICAL] UI Host failed: {e}")

def main():
    print("=========================================================")
    print("      PC FIRMWARE / HARDWARE / OS DIAGNOSTIC TOOL")
    print("=========================================================")
    
    # 1. Start backend process loop
    backend_thread = threading.Thread(target=start_backend_api, daemon=True)
    backend_thread.start()
    
    # Allow port binding to safely allocate sockets
    time.sleep(1.0)
    
    # 2. Start frontend static asset delivery loop
    frontend_thread = threading.Thread(target=start_frontend_server, daemon=True)
    frontend_thread.start()
    
    # 3. Fire the standard platform browser interface link
    time.sleep(1.0)
    url = "http://127.0.0.1:3000/index.html"
    print(f"[INFO] Spawning client browser workspace link at: {url}")
    webbrowser.open(url)
    
    print("\n[ACTIVE] Application running. Press [Ctrl+C] to exit safely.")
    
    try:
        while True:
            time.sleep(1.0)
    except KeyboardInterrupt:
        print("\n[SHUTDOWN] Terminating diagnostics telemetry systems.")
        sys.exit(0)

if __name__ == "__main__":
    main()