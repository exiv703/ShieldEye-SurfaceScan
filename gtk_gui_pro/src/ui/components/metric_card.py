#!/usr/bin/env python3
"""
ShieldEye Professional - Metric Card Component
Professional metric display cards for dashboard
"""

import gi
gi.require_version('Gtk', '3.0')
from gi.repository import Gtk, GLib
import cairo

class MetricCard(Gtk.EventBox):
    """Professional metric card with icon, value, and trend"""
    
    def __init__(self, title: str, value: str, subtitle: str = "", icon: str = "📊"):
        super().__init__()
        
        self.title = title
        self.current_value = value
        self.current_subtitle = subtitle
        self.icon = icon
        self._is_alert = False
        
        # Style
        self.get_style_context().add_class('metric-card')
        self.get_style_context().add_class('card')
        
        # Build UI
        self._build_ui()
        
        # Hover effects
        self.connect('enter-notify-event', self._on_enter)
        self.connect('leave-notify-event', self._on_leave)
    
    def _build_ui(self):
        """Build metric card UI"""
        
        # Main layout container (Horizontal Box)
        # Left side: Metrics
        # Right side: Sparkline chart
        main_layout = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=0)
        self.add(main_layout)
        
        # --- LEFT SIDE: METRICS ---
        metrics_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=0)
        main_layout.pack_start(metrics_box, True, True, 0)
        
        # Header with icon and title (visually prominent but compact)
        header = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=10)
        header.set_margin_top(12)
        header.set_margin_left(14)
        header.set_margin_right(8)  # Slightly smaller right margin
        header.set_margin_bottom(6)
        
        # Small Icon
        self.icon_label = Gtk.Label(label=self.icon)
        self.icon_label.get_style_context().add_class('metric-icon')
        header.pack_start(self.icon_label, False, False, 0)
        
        # Title
        title_label = Gtk.Label(label=self.title)
        title_label.get_style_context().add_class('metric-title')
        title_label.set_xalign(0)
        header.pack_start(title_label, True, True, 0)
        
        metrics_box.pack_start(header, False, False, 0)
        
        # Value section
        value_section = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=2)
        value_section.set_margin_left(14)
        value_section.set_margin_right(8)
        value_section.set_margin_bottom(12)
        
        # Main value (odrobinę mniejsze, żeby karta była niższa)
        self.value_label = Gtk.Label()
        self.value_label.set_markup(f'<span size="x-large" weight="bold">{self.current_value}</span>')
        self.value_label.get_style_context().add_class('metric-value')
        self.value_label.set_xalign(0)
        value_section.pack_start(self.value_label, False, False, 0)
        
        # Subtitle/trend
        self.subtitle_label = Gtk.Label(label=self.current_subtitle)
        self.subtitle_label.get_style_context().add_class('metric-subtitle')
        self.subtitle_label.set_xalign(0)
        value_section.pack_start(self.subtitle_label, False, False, 0)
        
        metrics_box.pack_start(value_section, True, True, 0)
        
        # --- RIGHT SIDE: CHART ---
        self.chart_area = Gtk.DrawingArea()
        self.chart_area.set_size_request(72, -1)  # Slightly narrower chart
        self.chart_area.set_margin_right(14)
        self.chart_area.set_margin_top(16)
        self.chart_area.set_margin_bottom(16)
        self.chart_area.connect("draw", self._draw_bar_chart)
        
        main_layout.pack_end(self.chart_area, False, False, 0)

    def _draw_bar_chart(self, widget, cr):
        """Draw a decorative bar chart (stock-like)"""
        width = widget.get_allocated_width()
        height = widget.get_allocated_height()
        
        # Config
        num_bars = 5
        bar_gap = 4
        bar_width = (width - (num_bars - 1) * bar_gap) / num_bars
        
        # Generate pseudo-random values based on title hash
        import math
        seed = sum(ord(c) for c in self.title)
        
        is_alert = bool(getattr(self, "_is_alert", False))
        
        # Color setup
        if is_alert:
            # Red/Orange for alerts
            base_r, base_g, base_b = 0.9, 0.4, 0.4
        else:
            # Brand green (match vulnerability trends)
            base_r, base_g, base_b = 0.12, 0.56, 0.45
            
        for i in range(num_bars):
            # Deterministic "random" height
            # Use sin/cos to make it look like a trend
            val = (math.sin(i * 0.8 + seed) + 1.2) / 2.2 # Range approx 0.1 to 1.0
            
            # Make the last bar emphasize the "current state" (higher/different)
            if i == num_bars - 1:
                if is_alert:
                    val = 0.9 # High for alert
                else:
                    val = 0.7 # Moderate for normal
            
            bar_height = val * height
            x = i * (bar_width + bar_gap)
            y = height - bar_height
            
            # Gradient for bar
            pat = cairo.LinearGradient(x, y, x, height)
            pat.add_color_stop_rgba(0, base_r, base_g, base_b, 0.8) # Top
            pat.add_color_stop_rgba(1, base_r, base_g, base_b, 0.3) # Bottom
            
            cr.set_source(pat)
            
            # Rounded top for bars
            radius = 2
            cr.new_sub_path()
            cr.arc(x + bar_width - radius, y + radius, radius, -math.pi/2, 0) # Top-right
            cr.line_to(x + bar_width, height) # Bottom-right
            cr.line_to(x, height) # Bottom-left
            cr.line_to(x, y + radius) # Top-left start
            cr.arc(x + radius, y + radius, radius, math.pi, 3*math.pi/2) # Top-left
            cr.close_path()
            
            cr.fill()
    
    def update_value(self, new_value: str, new_subtitle: str = None):
        """Update card value and subtitle"""
        self.current_value = new_value
        self.value_label.set_markup(f'<span size="x-large" weight="bold">{new_value}</span>')
        
        if new_subtitle is not None:
            self.current_subtitle = new_subtitle
            self.subtitle_label.set_text(new_subtitle)
        
        # Add update animation class
        self.get_style_context().add_class('metric-updated')
        GLib.timeout_add(500, self._remove_update_class)
    
    def set_trend(self, trend: str, trend_type: str = "neutral"):
        """Set trend indicator"""
        self.subtitle_label.set_text(f"{self.current_subtitle} {trend}")
        
        # Apply trend styling
        self.subtitle_label.get_style_context().remove_class('trend-positive')
        self.subtitle_label.get_style_context().remove_class('trend-negative')
        self.subtitle_label.get_style_context().remove_class('trend-neutral')
        
        self.subtitle_label.get_style_context().add_class(f'trend-{trend_type}')
    
    def set_alert_state(self, is_alert: bool):
        """
        Set alert state for the metric card.

        We keep the card styling consistent with other cards (no red background),
        but still provide a subtle alert accent via icon color + sparkline color.
        """
        self._is_alert = bool(is_alert)
        if self._is_alert:
            self.icon_label.get_style_context().add_class('metric-icon-alert')
        else:
            self.icon_label.get_style_context().remove_class('metric-icon-alert')
            
        # Redraw chart to update colors
        if hasattr(self, 'chart_area'):
            self.chart_area.queue_draw()
    
    def _remove_update_class(self):
        """Remove update animation class"""
        self.get_style_context().remove_class('metric-updated')
        return False  # Don't repeat
    
    def _on_enter(self, widget, event):
        """Handle mouse enter"""
        self.get_style_context().add_class('metric-card-hover')
        return False
    
    def _on_leave(self, widget, event):
        """Handle mouse leave"""
        self.get_style_context().remove_class('metric-card-hover')
        return False
