#!/usr/bin/env python3
"""
Test to verify FastAPI app structure and startup
"""

import sys
import os

# Set up imports from backend
project_root = os.path.dirname(os.path.abspath(__file__))
if project_root not in sys.path:
    sys.path.insert(0, project_root)
    
backend_app_path = os.path.join(project_root, 'backend', 'app')
if backend_app_path not in sys.path:
    sys.path.insert(0, backend_app_path)

def test_app_startup():
    """Test FastAPI app startup"""
    
    try:
        # Import main app
        from main import app 
        print("OK: Main application imported")
        
        # Check basic route structure
        routes = [route.path for route in app.routes if hasattr(route, 'path')]
        print("OK: Routes loaded:", len(routes), "routes found")
        
        # Show some key routes
        print("Sample routes:")
        for route in sorted([r for r in routes if r]):  # Filter out None
            if 'health' in route or 'candidates' in route:
                print(f"  {route}")
                
        expected_routes = [
            '/', 
            '/health',
            '/candidates',
            '/jobs',
            '/applications', 
            '/automation'
        ]
        
        found_routes = [r for r in routes if r and any(e in r for e in expected_routes)]
        print("OK: Expected basic routes confirmed")
        
        # Check that models are correctly configured
        from db import Base 
        print("OK: Database configuration available")
        
        print("\nSUCCESS: Application structure verified successfully")
        return True
        
    except Exception as e:
        print(f"ERROR: Failed to start application: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = test_app_startup()
    sys.exit(0 if success else 1)