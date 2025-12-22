#!/usr/bin/env python3
"""
ShieldEye Professional - Integrated Launcher
Launches backend (Docker Compose) and GUI as one unified process
"""

import os
import sys
import time
import signal
import subprocess
import threading
from pathlib import Path
import requests
import logging

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s | %(levelname)s | %(message)s')
logger = logging.getLogger('IntegratedLauncher')

class IntegratedLauncher:
    """Launches and manages backend + GUI as unified system"""
    
    def __init__(self):
        self.backend_process = None
        self.gui_process = None
        self.backend_ready = False
        self.shutdown_requested = False
        
        # Paths
        self.shield_dir = Path(__file__).parent.parent.resolve()
        self.gui_dir = Path(__file__).parent.resolve()
        
        logger.info(f"Shield directory: {self.shield_dir}")
        logger.info(f"GUI directory: {self.gui_dir}")
        
        # Setup signal handlers
        signal.signal(signal.SIGINT, self._signal_handler)
        signal.signal(signal.SIGTERM, self._signal_handler)
    
    def _signal_handler(self, signum, frame):
        """Handle shutdown signals"""
        logger.info(f"Received signal {signum}, shutting down...")
        self.shutdown_requested = True
        self.shutdown()
        sys.exit(0)
    
    def start_backend(self):
        """Start Docker Compose backend"""
        logger.info("🐳 Starting ShieldEye backend (Docker Compose)...")
        
        try:
            # Change to shield directory for docker-compose
            os.chdir(self.shield_dir)
            
            # Start Docker Compose in detached mode
            cmd = ["docker", "compose", "up", "-d"]
            result = subprocess.run(cmd, capture_output=True, text=True)
            
            if result.returncode == 0:
                logger.info("✅ Backend containers started successfully")
                return True
            else:
                logger.error(f"❌ Failed to start backend: {result.stderr}")
                return False
                
        except Exception as e:
            logger.error(f"❌ Backend startup error: {e}")
            return False
    
    def wait_for_backend(self, timeout=60):
        """Wait for backend API to be ready"""
        logger.info("⏳ Waiting for backend API to be ready...")
        
        start_time = time.time()
        
        while time.time() - start_time < timeout:
            if self.shutdown_requested:
                return False
                
            try:
                response = requests.get("http://localhost:3000/health", timeout=2)
                if response.status_code == 200:
                    data = response.json()
                    if data.get('status') in ['healthy', 'unhealthy']:  # API responds
                        logger.info("✅ Backend API is ready!")
                        self.backend_ready = True
                        return True
            except Exception:
                pass
            
            # Show progress
            elapsed = int(time.time() - start_time)
            logger.info(f"⏳ Waiting for API... ({elapsed}s/{timeout}s)")
            time.sleep(3)
        
        logger.warning("⚠️ Backend API not ready within timeout, continuing anyway...")
        return False
    
    def start_gui(self):
        """Start GUI application"""
        logger.info("🖥️ Starting ShieldEye GUI...")
        
        try:
            os.chdir(self.gui_dir)
            
            # Set environment variables
            env = os.environ.copy()
            env['SHIELDEYE_API_URL'] = 'http://localhost:3000'
            env['GTK_THEME'] = 'Adwaita:dark'
            env['PYTHONPATH'] = str(self.gui_dir / 'src')
            
            # Start GUI
            cmd = [sys.executable, "main.py"]
            self.gui_process = subprocess.Popen(
                cmd,
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True
            )
            
            logger.info("✅ GUI started successfully")
            return True
            
        except Exception as e:
            logger.error(f"❌ GUI startup error: {e}")
            return False
    
    def monitor_processes(self):
        """Monitor GUI and backend processes"""
        logger.info("👁️ Starting process monitoring...")
        
        def monitor():
            while not self.shutdown_requested:
                try:
                    # Check GUI process
                    if self.gui_process and self.gui_process.poll() is not None:
                        logger.warning("⚠️ GUI process exited")
                        self.shutdown_requested = True
                        break
                    
                    # Check backend health periodically
                    if self.backend_ready:
                        try:
                            response = requests.get("http://localhost:3000/health", timeout=2)
                            if response.status_code != 200:
                                logger.warning("⚠️ Backend API health check failed")
                        except Exception:
                            logger.warning("⚠️ Backend API not responding")
                    
                    time.sleep(5)
                    
                except Exception as e:
                    logger.error(f"Monitoring error: {e}")
                    time.sleep(5)
        
        monitor_thread = threading.Thread(target=monitor, daemon=True)
        monitor_thread.start()
    
    def show_gui_output(self):
        """Show GUI output in real-time"""
        if not self.gui_process:
            return
        
        def read_output():
            try:
                for line in iter(self.gui_process.stdout.readline, ''):
                    if line.strip():
                        print(f"GUI: {line.strip()}")
                    if self.shutdown_requested:
                        break
            except Exception as e:
                logger.error(f"Error reading GUI output: {e}")
        
        output_thread = threading.Thread(target=read_output, daemon=True)
        output_thread.start()
    
    def shutdown(self):
        """Shutdown backend and GUI"""
        logger.info("🛑 Shutting down ShieldEye...")
        
        # Stop GUI
        if self.gui_process:
            logger.info("Stopping GUI...")
            try:
                self.gui_process.terminate()
                self.gui_process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                logger.warning("Force killing GUI...")
                self.gui_process.kill()
            except Exception as e:
                logger.error(f"Error stopping GUI: {e}")
        
        # Stop backend
        logger.info("Stopping backend...")
        try:
            os.chdir(self.shield_dir)
            subprocess.run(["docker", "compose", "down"], 
                         capture_output=True, timeout=30)
            logger.info("✅ Backend stopped")
        except Exception as e:
            logger.error(f"Error stopping backend: {e}")
        
        logger.info("✅ Shutdown complete")
    
    def run(self):
        """Main execution flow"""
        logger.info("🛡️ ShieldEye Professional - Integrated Launcher")
        logger.info("=" * 50)
        
        try:
            # Step 1: Start backend
            if not self.start_backend():
                logger.error("❌ Failed to start backend, exiting")
                return 1
            
            # Step 2: Wait for backend to be ready
            self.wait_for_backend()
            
            # Step 3: Start GUI
            if not self.start_gui():
                logger.error("❌ Failed to start GUI, stopping backend")
                self.shutdown()
                return 1
            
            # Step 4: Monitor processes
            self.monitor_processes()
            self.show_gui_output()
            
            # Step 5: Wait for GUI to finish
            logger.info("🚀 ShieldEye is running! Close the GUI window to stop.")
            logger.info("   Backend: http://localhost:3000")
            logger.info("   API Docs: http://localhost:3000/api-docs")
            logger.info("   Press Ctrl+C to stop")
            
            # Wait for GUI process
            if self.gui_process:
                self.gui_process.wait()
            
            return 0
            
        except KeyboardInterrupt:
            logger.info("Interrupted by user")
            return 0
        except Exception as e:
            logger.error(f"Unexpected error: {e}")
            return 1
        finally:
            self.shutdown()

def main():
    """Entry point"""
    launcher = IntegratedLauncher()
    return launcher.run()

if __name__ == '__main__':
    sys.exit(main())
