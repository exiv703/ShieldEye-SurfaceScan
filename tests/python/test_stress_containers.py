#!/usr/bin/env python3
"""Container stress testing"""

import requests
import threading
import time
import json

def stress_api_endpoint(endpoint, payload, num_requests=50):
    """Stress test a specific API endpoint"""
    errors = []
    successful = 0
    
    def make_request():
        nonlocal successful, errors
        try:
            if payload:
                response = requests.post(f"http://localhost:3000{endpoint}", 
                                       json=payload, timeout=5)
            else:
                response = requests.get(f"http://localhost:3000{endpoint}", timeout=5)
            
            if response.status_code == 200 or response.status_code == 201:
                successful += 1
            else:
                errors.append(f"HTTP {response.status_code}: {response.text[:100]}")
        except Exception as e:
            errors.append(f"Exception: {str(e)}")
    
    # Create threads for concurrent requests
    threads = []
    for i in range(num_requests):
        thread = threading.Thread(target=make_request)
        threads.append(thread)
        thread.start()
    
    # Wait for all threads to complete
    for thread in threads:
        thread.join()
    
    return successful, errors

def test_concurrent_scans():
    """Test concurrent scan creation"""
    print("Testing concurrent scan creation...")
    payload = {"url": "https://concurrent-test.com"}
    successful, errors = stress_api_endpoint("/api/scans", payload, 20)
    
    print(f"Concurrent scans - Successful: {successful}, Errors: {len(errors)}")
    if errors:
        print("Sample errors:")
        for error in errors[:3]:
            print(f"  - {error}")
    return successful, len(errors)

def test_health_endpoint_stress():
    """Test health endpoint under stress"""
    print("Testing health endpoint stress...")
    successful, errors = stress_api_endpoint("/health", None, 30)
    
    print(f"Health endpoint - Successful: {successful}, Errors: {len(errors)}")
    if errors:
        print("Sample errors:")
        for error in errors[:3]:
            print(f"  - {error}")
    return successful, len(errors)

def test_websocket_connections():
    """Test multiple WebSocket connections"""
    print("Testing WebSocket connection limits...")
    
    try:
        import websockets
        import asyncio
        
        async def test_ws_connections():
            connections = []
            errors = []
            
            for i in range(20):
                try:
                    ws = await asyncio.wait_for(
                        websockets.connect("ws://localhost:3000/ws"), 
                        timeout=2
                    )
                    connections.append(ws)
                    print(f"WebSocket {i+1}: Connected")
                except Exception as e:
                    errors.append(str(e))
                    print(f"WebSocket {i+1}: Failed - {e}")
            
            # Close all connections
            for ws in connections:
                try:
                    await ws.close()
                except:
                    pass
            
            return len(connections), len(errors)
        
        successful, failed = asyncio.run(test_ws_connections())
        print(f"WebSocket connections - Successful: {successful}, Failed: {failed}")
        return successful, failed
        
    except ImportError:
        print("WebSocket testing skipped - websockets module not available")
        return 0, 0

if __name__ == "__main__":
    print("=== Container Stress Testing ===")
    print("Testing API under concurrent load...\n")
    
    # Wait for rate limit to reset
    print("Waiting for rate limit reset...")
    time.sleep(15)
    
    total_successful = 0
    total_errors = 0
    
    # Test 1: Concurrent scans
    s1, e1 = test_concurrent_scans()
    total_successful += s1
    total_errors += e1
    
    time.sleep(2)
    
    # Test 2: Health endpoint stress
    s2, e2 = test_health_endpoint_stress()
    total_successful += s2
    total_errors += e2
    
    time.sleep(2)
    
    # Test 3: WebSocket connections
    s3, e3 = test_websocket_connections()
    total_successful += s3
    total_errors += e3
    
    print(f"\n=== FINAL RESULTS ===")
    print(f"Total Successful Operations: {total_successful}")
    print(f"Total Errors: {total_errors}")
    print(f"Success Rate: {(total_successful/(total_successful+total_errors)*100):.1f}%" if (total_successful+total_errors) > 0 else "N/A")
