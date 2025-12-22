#!/usr/bin/env python3
"""
ShieldEye Professional - Main Entry Point
Enterprise-grade GTK application launcher
"""

import os
import sys
import signal
import time
import json
import subprocess
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError
from pathlib import Path

# Add src directory to Python path
sys.path.insert(0, str(Path(__file__).parent / "src"))

def setup_environment():
    """Setup application environment"""
    # Set GTK theme preferences
    os.environ.setdefault('GTK_THEME', 'Adwaita:dark')
    
    # Set API URL from environment
    api_url = os.environ.get('SHIELDEYE_API_URL', 'http://localhost:3000')
    os.environ['SHIELDEYE_API_URL'] = api_url
    
    # Ensure required directories exist
    app_dir = Path.home() / '.local' / 'share' / 'shieldeye'
    app_dir.mkdir(parents=True, exist_ok=True)
    
    (app_dir / 'logs').mkdir(exist_ok=True)
    (app_dir / 'cache').mkdir(exist_ok=True)
    (app_dir / 'exports').mkdir(exist_ok=True)

def _check_api_health(api_url: str) -> bool:
    try:
        req = Request(api_url.rstrip('/') + '/health', headers={'Accept': 'application/json'})
        with urlopen(req, timeout=3) as resp:
            if resp.status != 200:
                return False
            data = json.loads(resp.read().decode('utf-8') or '{}')
            return data.get('status') == 'healthy'
    except (URLError, HTTPError, TimeoutError, ValueError):
        return False

def ensure_backend_running():
    api_url = os.environ.get('SHIELDEYE_API_URL', 'http://localhost:3000')
    if _check_api_health(api_url):
        return True
    shield_dir = (Path(__file__).parent).parent.resolve()
    compose_file = shield_dir / 'docker-compose.yml'
    if not compose_file.exists():
        return False
    try:
        subprocess.run(
            ['docker', 'compose', 'up', '-d', 'postgres', 'redis', 'minio', 'api', 'renderer', 'analyzer'],
            cwd=str(shield_dir), check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
    except Exception:
        return False
    deadline = time.time() + 120
    while time.time() < deadline:
        if _check_api_health(api_url):
            return True
        time.sleep(3)
    return False

def handle_signal(signum, frame):
    """Handle system signals gracefully"""
    print(f"\nReceived signal {signum}, shutting down gracefully...")
    sys.exit(0)

def main():
    """Main application entry point"""
    # Setup environment
    setup_environment()
    
    # Setup signal handlers
    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)
    
    try:
        # Import and create application
        from src.core.application import create_application
        
        try:
            ensure_backend_running()
        except Exception:
            pass
        
        app = create_application()
        
        # Run application
        exit_code = app.run(sys.argv)
        
        return exit_code
        
    except ImportError as e:
        print(f"Failed to import required modules: {e}")
        print("Please ensure all dependencies are installed:")
        print("  pip install -r requirements.txt")
        return 1
        
    except Exception as e:
        print(f"Application error: {e}")
        return 1

if __name__ == '__main__':
    sys.exit(main())
