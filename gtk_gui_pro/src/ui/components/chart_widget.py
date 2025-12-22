#!/usr/bin/env python3
"""ShieldEye Professional - Chart Widget"""

import math
from enum import Enum
import gi
gi.require_version('Gtk', '3.0')
try:
    gi.require_version('PangoCairo', '1.0')
except ValueError:
    pass 
from gi.repository import Gtk, Gdk, GLib, Pango, PangoCairo
import cairo

class ChartType(Enum):
    LINE = "line"
    BAR = "bar"
    DONUT = "donut"

class ChartWidget(Gtk.Box):
    """Professional chart widget using Cairo"""
    
    def __init__(self, title: str, chart_type: ChartType, width: int = -1, height: int = 250):
        super().__init__(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        
        self.title = title
        self.chart_type = chart_type
        self.data = []
        
        self.animation_progress = 0.0
        self.animation_step = 0.05
        self.is_animating = False
        
        self.get_style_context().add_class('chart-widget')
        self.get_style_context().add_class('card')
        self.set_size_request(width, height)
        
        self._build_ui()
    
    def _build_ui(self):
        """Build chart widget UI."""
        title_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        title_box.set_margin_left(10)
        title_box.set_margin_right(10)
        title_box.set_margin_top(8)
        
        icon = "📊"
        if "Trend" in self.title or "trend" in self.title:
            icon = "📈"
        elif "Risk" in self.title or "Distribution" in self.title:
            icon = "⚠️"
        elif "Vulnerability" in self.title:
            icon = "🔍"
        
        icon_label = Gtk.Label()
        icon_label.set_markup(f'<span size="large">{icon}</span>')
        title_box.pack_start(icon_label, False, False, 0)
        
        title_label = Gtk.Label()
        title_label.set_markup(f'<span weight="semibold" size="large">{self.title}</span>')
        title_label.set_xalign(0)
        title_box.pack_start(title_label, False, False, 0)
        
        self.pack_start(title_box, False, False, 0)
        
        self.drawing_area = Gtk.DrawingArea()
        self.drawing_area.set_margin_left(10)
        self.drawing_area.set_margin_right(10)
        self.drawing_area.set_margin_bottom(8)
        self.drawing_area.connect("draw", self._on_draw)
        self.pack_start(self.drawing_area, True, True, 0)
    
    def update_data(self, data: list):
        """Update chart data and request redraw"""
        self.data = data
        
        # Reset and start animation
        self.animation_progress = 0.0
        
        # Remove any existing timeout to avoid duplicates
        if hasattr(self, '_anim_source_id') and self._anim_source_id:
            GLib.source_remove(self._anim_source_id)
            self._anim_source_id = None
            
        self.is_animating = True
        self._anim_source_id = GLib.timeout_add(20, self._animate)
        
        self.drawing_area.queue_draw()
        
    def _animate(self):
        """Animation loop"""
        if self.animation_progress >= 1.0:
            self.animation_progress = 1.0
            self.is_animating = False
            self.drawing_area.queue_draw()
            self._anim_source_id = None
            return False # Stop timeout
            
        self.animation_progress += self.animation_step
        self.drawing_area.queue_draw()
        return True # Continue timeout
        
    def _on_draw(self, widget, cr):
        """Handle draw event"""
        width = widget.get_allocated_width()
        height = widget.get_allocated_height()
        
        if not self.data:
            self._draw_no_data(cr, width, height)
            return

        if self.chart_type == ChartType.LINE:
            self._draw_line_chart(cr, width, height)
        elif self.chart_type == ChartType.DONUT or self.chart_type == ChartType.BAR:
            self._draw_horizontal_bars(cr, width, height)
            
    def _draw_no_data(self, cr, width, height):
        cr.set_source_rgb(0.5, 0.5, 0.5)
        layout = self.drawing_area.create_pango_layout("No data available")
        font_desc = Pango.FontDescription("Sans 10")
        layout.set_font_description(font_desc)
        
        ink_rect, logical_rect = layout.get_extents()
        text_width = logical_rect.width / Pango.SCALE
        text_height = logical_rect.height / Pango.SCALE
        
        cr.move_to((width - text_width) / 2, (height - text_height) / 2)
        PangoCairo.show_layout(cr, layout)

    def _draw_text(self, cr, text, x, y, font="Sans 9", color=(0.7, 0.7, 0.7), align="left"):
        # Handle alpha channel in color tuple
        if len(color) == 4:
            cr.set_source_rgba(*color)
        else:
            cr.set_source_rgb(*color)
            
        layout = self.drawing_area.create_pango_layout(str(text))
        layout.set_font_description(Pango.FontDescription(font))
        ink, logical = layout.get_extents()
        w = logical.width / Pango.SCALE
        h = logical.height / Pango.SCALE
        
        tx, ty = x, y
        if align == "center":
            tx -= w / 2
        elif align == "right":
            tx -= w
        elif align == "middle": # vertical center
            ty -= h / 2
        elif align == "middle_center": # both
            tx -= w / 2
            ty -= h / 2
            
        cr.move_to(tx, ty)
        PangoCairo.show_layout(cr, layout)
        return w, h

    def _draw_line_chart(self, cr, width, height):
        # Config
        padding_left = 30
        padding_bottom = 20
        padding_top = 10
        padding_right = 10
        
        chart_w = width - padding_left - padding_right
        chart_h = height - padding_top - padding_bottom
        
        if not self.data:
            self._draw_no_data(cr, width, height)
            return
            
        # Parse data
        values = [d.get('y', 0) for d in self.data]
        labels = [d.get('x', '') for d in self.data]
        
        max_val = max(values) if values else 5
        # Round up max_val to nice number
        if max_val == 0: max_val = 5
        elif max_val < 5: max_val = 5
        else: max_val = math.ceil(max_val / 5.0) * 5
        
        # Draw grid lines (Horizontal only - Clean Look)
        cr.set_line_width(1)
        
        steps = 5
        for i in range(steps + 1):
            val = i * (max_val / steps)
            y_pos = (height - padding_bottom) - (val / max_val * chart_h)
            
            # Grid line (dotted)
            if i > 0:
                cr.save()
                cr.set_dash([2.0, 4.0], 0)
                cr.set_source_rgba(0.3, 0.3, 0.3, 0.3)
                cr.move_to(padding_left, y_pos)
                cr.line_to(width - padding_right, y_pos)
                cr.stroke()
                cr.restore()
            
            # Label
            self._draw_text(cr, f"{int(val)}", padding_left - 8, y_pos - 7, align="right", font="Sans 8")
        
        # X Axis labels
        if len(labels) == 1:
             short_label = labels[0][-5:] if len(labels[0]) >= 5 else labels[0]
             self._draw_text(cr, short_label, padding_left + chart_w/2, height - padding_bottom + 8, align="center", font="Sans 8")
        else:
            label_skip = max(1, len(labels) // 5)
            step_x = chart_w / max(1, len(labels) - 1)
            for i in range(0, len(labels), label_skip):
                x = padding_left + i * step_x
                lbl = labels[i]
                if len(lbl) >= 10:
                    lbl = lbl[5:] 
                self._draw_text(cr, lbl, x, height - padding_bottom + 8, align="center", font="Sans 8")

        # Calculate points
        points = []
        if len(values) == 1:
            x = padding_left + chart_w / 2
            y = (height - padding_bottom) - (values[0] / max_val * chart_h)
            points.append((x, y))
        else:
            step_x = chart_w / max(1, len(values) - 1)
            for i, val in enumerate(values):
                x = padding_left + i * step_x
                y = (height - padding_bottom) - (val / max_val * chart_h)
                points.append((x, y))

        if not points:
            return

        # Animation Clip
        # We only draw points up to animation_progress % of width
        current_progress = self.animation_progress if self.is_animating else 1.0
        
        # Clip area for line drawing animation
        clip_width = padding_left + chart_w * current_progress
        
        cr.save()
        cr.rectangle(padding_left, padding_top, chart_w * current_progress, height - padding_bottom)
        cr.clip()

        # 1. Draw Area Gradient
        if len(points) > 1:
            gradient = cairo.LinearGradient(0, padding_top, 0, height - padding_bottom)
            # Brand green (darker, consistent)
            gradient.add_color_stop_rgba(0, 0.12, 0.56, 0.45, 0.28)
            gradient.add_color_stop_rgba(1, 0.12, 0.56, 0.45, 0.08)
            
            cr.save()
            cr.move_to(points[0][0], height - padding_bottom)
            cr.line_to(*points[0])
            for x, y in points[1:]:
                cr.line_to(x, y)
            cr.line_to(points[-1][0], height - padding_bottom)
            cr.close_path()
            cr.set_source(gradient)
            cr.fill()
            cr.restore()

        # 2. Draw Line
        cr.save()
        cr.set_source_rgb(0.12, 0.56, 0.45)
        cr.set_line_width(2.5)
        cr.set_line_join(cairo.LINE_JOIN_ROUND)
        cr.set_line_cap(cairo.LINE_CAP_ROUND)
        
        cr.move_to(*points[0])
        for x, y in points[1:]:
            cr.line_to(x, y)
        cr.stroke()
        cr.restore()
        
        cr.restore() # End clip
            
        # 3. Draw points (dots) with halo - only if they are within visible area
        for x, y in points:
            if x <= clip_width + 5: # Small buffer
                # Halo
                cr.arc(x, y, 5, 0, 2 * math.pi)
                cr.set_source_rgb(0.1, 0.1, 0.15)
                cr.fill()
                
                # Dot
                cr.arc(x, y, 3, 0, 2 * math.pi)
                cr.set_source_rgb(0.12, 0.56, 0.45)
                cr.fill()

    def _hex_to_rgb(self, hex_color):
        hex_color = hex_color.lstrip('#')
        try:
            return tuple(int(hex_color[i:i+2], 16)/255.0 for i in (0, 2, 4))
        except:
            return (0.5, 0.5, 0.5)

    def _draw_horizontal_bars(self, cr, width, height):
        """Draws a horizontal bar distribution chart"""
        items = self.data
        count = len(items)
        
        # If no items, draw empty state
        if count == 0:
            self._draw_no_data(cr, width, height)
            return
            
        total = sum(d.get('value', 0) for d in items)
        
        # Determine scale base (Total or Max?)
        scale_base = total if total > 0 else 1
        
        # Layout Config
        padding_x = 8
        padding_y = 6
        
        # Calculate row height
        avail_height = height - 2 * padding_y
        row_height = min(50, avail_height / count)
        
        # Dimensions
        label_width = 70
        value_width = 40
        bar_start_x = padding_x + label_width + 10
        bar_max_width = width - bar_start_x - value_width - padding_x
        
        current_y = padding_y + (avail_height - count * row_height) / 2
        
        # Animation easing
        progress = self.animation_progress if self.is_animating else 1.0
        # Simple ease-out cubic
        progress = 1 - pow(1 - progress, 3)
        
        for item in items:
            val = item.get('value', 0)
            label = item.get('label', '')
            color_hex = item.get('color', '#cccccc')
            r, g, b = self._hex_to_rgb(color_hex)
            
            # Vertical center of row
            cy = current_y + row_height / 2
            
            # 1. Label
            self._draw_text(cr, label, padding_x, cy - 6, 
                           font="Sans 11", color=(0.8, 0.8, 0.8), align="left")
            
            # 2. Bar Background (Track)
            bar_h = 10
            bar_y = cy - bar_h / 2 + 1
            
            cr.set_source_rgba(1, 1, 1, 0.08)
            self._draw_rounded_rect(cr, bar_start_x, bar_y, bar_max_width, bar_h, bar_h/2)
            cr.fill()
            
            # 3. Bar Fill (Progress)
            if val > 0:
                fill_pct = val / scale_base
                target_w = max(bar_h, bar_max_width * fill_pct)
                current_w = target_w * progress
                
                cr.set_source_rgb(r, g, b)
                self._draw_rounded_rect(cr, bar_start_x, bar_y, current_w, bar_h, bar_h/2)
                cr.fill()
            
            # 4. Value
            # Always show value, but fade it in
            opacity = 1.0
            if self.is_animating:
                if progress > 0.5:
                    opacity = (progress - 0.5) * 2
                else:
                    opacity = 0
            
            cr.set_source_rgba(1, 1, 1, opacity)
            self._draw_text(cr, str(val), width - padding_x, cy - 6, 
                        font="Sans Bold 11", color=(1, 1, 1, opacity), align="right")
            
            current_y += row_height

    def _draw_rounded_rect(self, cr, x, y, w, h, r):
        """Helper to draw rounded rectangle path"""
        r = min(r, w/2, h/2)
        
        cr.new_sub_path()
        cr.arc(x + w - r, y + r, r, -math.pi / 2, 0)
        cr.arc(x + w - r, y + h - r, r, 0, math.pi / 2)
        cr.arc(x + r, y + h - r, r, math.pi / 2, math.pi)
        cr.arc(x + r, y + r, r, math.pi, 3 * math.pi / 2)
        cr.close_path()
