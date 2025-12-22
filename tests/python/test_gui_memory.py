#!/usr/bin/env python3
"""GUI Memory leak test"""

import sys
import psutil
import time
from pathlib import Path

# Add src directory to Python path
sys.path.insert(0, str(Path(__file__).parent / "gui" / "src"))

def monitor_memory():
    """Monitor memory usage of the current process"""
    process = psutil.Process()
    initial_memory = process.memory_info().rss / 1024 / 1024  # MB
    print(f"Initial memory usage: {initial_memory:.2f} MB")
    
    for i in range(10):
        time.sleep(2)
        current_memory = process.memory_info().rss / 1024 / 1024  # MB
        print(f"Memory after {(i+1)*2}s: {current_memory:.2f} MB (diff: {current_memory-initial_memory:+.2f} MB)")
        
        # Simulate some GUI operations
        try:
            # Import heavy modules to test memory
            import requests
            import json
            # Make some API calls
            requests.get("http://localhost:3000/health", timeout=1)
        except:
            pass
    
    final_memory = process.memory_info().rss / 1024 / 1024  # MB
    print(f"Final memory usage: {final_memory:.2f} MB")
    print(f"Total memory increase: {final_memory-initial_memory:+.2f} MB")

if __name__ == "__main__":
    monitor_memory()
