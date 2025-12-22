#!/usr/bin/env python3
"""WebSocket flood test for ShieldEye"""

import asyncio
import websockets
import json
import time

async def flood_test():
    connections = []
    errors = []
    
    print("Starting WebSocket flood test...")
    
    # Try to create 50 connections rapidly
    for i in range(50):
        try:
            ws = await websockets.connect("ws://localhost:3000/ws")
            connections.append(ws)
            print(f"Connection {i+1}: SUCCESS")
            
            # Send a test message
            await ws.send(json.dumps({"type": "test", "data": f"flood_test_{i}"}))
            
        except Exception as e:
            errors.append(f"Connection {i+1}: ERROR - {str(e)}")
            print(f"Connection {i+1}: ERROR - {str(e)}")
    
    print(f"\nResults:")
    print(f"Successful connections: {len(connections)}")
    print(f"Failed connections: {len(errors)}")
    
    # Close all connections
    for ws in connections:
        try:
            await ws.close()
        except:
            pass
    
    return len(connections), len(errors)

if __name__ == "__main__":
    successful, failed = asyncio.run(flood_test())
    print(f"\nFinal Results: {successful} successful, {failed} failed")
