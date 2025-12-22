#!/usr/bin/env python3
"""
ShieldEye Professional - Design System Colors
Corporate-grade color palette with accessibility compliance
"""

from dataclasses import dataclass
from typing import Dict, Tuple
import colorsys

@dataclass
class ColorPalette:
    """Professional color palette with semantic naming"""
    
    # Primary Brand Colors
    primary_50: str = "#f0fdf4"    # Lightest green
    primary_100: str = "#dcfce7"   
    primary_200: str = "#bbf7d0"   
    primary_300: str = "#86efac"   
    primary_400: str = "#26b18e"   
    primary_500: str = "#1f8f73"   # Main brand green (aligned with charts)
    primary_600: str = "#18775f"   
    primary_700: str = "#125c4a"   
    primary_800: str = "#0f4a3c"   
    primary_900: str = "#0c3a2f"   # Darkest green
    
    # Secondary Colors (Blue-Gray)
    secondary_50: str = "#f8fafc"
    secondary_100: str = "#f1f5f9"
    secondary_200: str = "#e2e8f0"
    secondary_300: str = "#cbd5e1"
    secondary_400: str = "#94a3b8"
    secondary_500: str = "#64748b"
    secondary_600: str = "#475569"
    secondary_700: str = "#334155"
    secondary_800: str = "#1e293b"
    secondary_900: str = "#0f172a"
    
    # Semantic Colors
    success: str = "#1f8f73"
    warning: str = "#f59e0b"
    error: str = "#ef4444"
    info: str = "#3b82f6"
    
    # Dark Theme Base
    dark_bg_primary: str = "#0a0e1a"      # Deepest background
    dark_bg_secondary: str = "#0f1419"    # Card backgrounds
    dark_bg_tertiary: str = "#1a1f2e"     # Elevated surfaces
    dark_surface: str = "#242938"         # Interactive surfaces
    dark_border: str = "#2d3748"          # Borders and dividers
    
    # Text Colors
    text_primary: str = "#f8fafc"         # Primary text on dark
    text_secondary: str = "#cbd5e1"       # Secondary text
    text_tertiary: str = "#94a3b8"        # Tertiary/disabled text
    text_inverse: str = "#1e293b"         # Text on light backgrounds
    
    # Status Colors with variants
    status_online: str = "#1f8f73"
    status_offline: str = "#ef4444"
    status_pending: str = "#f59e0b"
    status_processing: str = "#3b82f6"
    
    # Severity Colors (for vulnerabilities)
    severity_critical: str = "#dc2626"
    severity_high: str = "#ea580c"
    severity_medium: str = "#d97706"
    severity_low: str = "#65a30d"
    severity_info: str = "#0891b2"

class ThemeManager:
    """Manages theme switching and color calculations"""
    
    def __init__(self):
        self.colors = ColorPalette()
        self.current_theme = "dark"
    
    def get_color(self, color_name: str) -> str:
        """Get color by semantic name"""
        return getattr(self.colors, color_name, "#ffffff")
    
    def get_rgba(self, color_hex: str, alpha: float = 1.0) -> str:
        """Convert hex to RGBA string for GTK"""
        hex_color = color_hex.lstrip('#')
        r = int(hex_color[0:2], 16) / 255.0
        g = int(hex_color[2:4], 16) / 255.0
        b = int(hex_color[4:6], 16) / 255.0
        return f"rgba({r:.3f}, {g:.3f}, {b:.3f}, {alpha:.3f})"
    
    def lighten_color(self, color_hex: str, amount: float = 0.1) -> str:
        """Lighten a color by specified amount"""
        hex_color = color_hex.lstrip('#')
        r, g, b = [int(hex_color[i:i+2], 16) / 255.0 for i in (0, 2, 4)]
        h, l, s = colorsys.rgb_to_hls(r, g, b)
        l = min(1.0, l + amount)
        r, g, b = colorsys.hls_to_rgb(h, l, s)
        return f"#{int(r*255):02x}{int(g*255):02x}{int(b*255):02x}"
    
    def darken_color(self, color_hex: str, amount: float = 0.1) -> str:
        """Darken a color by specified amount"""
        return self.lighten_color(color_hex, -amount)

# Global theme instance
theme = ThemeManager()
