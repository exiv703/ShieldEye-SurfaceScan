#!/usr/bin/env python3
"""ShieldEye Professional - Recent Scans Widget"""

import math
import cairo
import gi
gi.require_version('Gtk', '3.0')
from gi.repository import Gtk, Gdk, GLib, Pango, PangoCairo


class RecentScansWidget(Gtk.Box):
    """Widget displaying recent scans chart (Vertical Bars)"""
    
    def __init__(self, main_window, height: int = 250):
        super().__init__(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        
        self.main_window = main_window
        self.data = []
        
        self.animation_progress = 0.0
        self.animation_step = 0.05
        self.is_animating = False
        
        self.get_style_context().add_class('recent-scans-widget')
        self.get_style_context().add_class('card')
        self.set_size_request(-1, height)
        
        self._build_ui()
    
    def _build_ui(self):
        """Build widget UI."""
        title_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        title_box.set_margin_left(10)
        title_box.set_margin_right(10)
        title_box.set_margin_top(8)
        
        icon_label = Gtk.Label()
        icon_label.set_markup('<span size="large">🔍</span>')
        title_box.pack_start(icon_label, False, False, 0)
        
        title = Gtk.Label()
        title.set_markup('<span weight="semibold" size="large">Recent Scans</span>')
        title.set_xalign(0)
        title_box.pack_start(title, False, False, 0)
        
        self.pack_start(title_box, False, False, 0)
        
        self.drawing_area = Gtk.DrawingArea()
        self.drawing_area.set_margin_left(10)
        self.drawing_area.set_margin_right(10)
        self.drawing_area.set_margin_bottom(8)
        self.drawing_area.connect("draw", self._on_draw)
        self.pack_start(self.drawing_area, True, True, 0)

    def update_data(self, data: list):
        self.data = data
        self.animation_progress = 0.0
        if hasattr(self, '_anim_source_id') and self._anim_source_id:
            GLib.source_remove(self._anim_source_id)
            self._anim_source_id = None
        self.is_animating = True
        self._anim_source_id = GLib.timeout_add(20, self._animate)
        self.drawing_area.queue_draw()

    def _animate(self):
        if self.animation_progress >= 1.0:
            self.animation_progress = 1.0
            self.is_animating = False
            self.drawing_area.queue_draw()
            self._anim_source_id = None
            return False
        self.animation_progress += self.animation_step
        self.drawing_area.queue_draw()
        return True

    def _on_draw(self, widget, cr):
        width = widget.get_allocated_width()
        height = widget.get_allocated_height()
        
        if not self.data:
            return
            
        items = self.data
        count = len(items)
        if count == 0: return

        padding_top = 4
        padding_bottom = 35 
        chart_h = height - padding_top - padding_bottom
        
        bar_spacing = 6
        total_spacing = bar_spacing * (count - 1)
        avail_width = width
        bar_width = (avail_width - total_spacing) / count
        
        max_val = max([d['value'] for d in items]) if items else 1
        if max_val == 0: max_val = 1
        
        progress = self.animation_progress
        progress = 1 - pow(1 - progress, 3)

        current_x = 0
        
        for item in items:
            val = item.get('value', 0)
            label = item.get('label', '')
            
            bar_target_h = (val / max_val) * chart_h
            current_bar_h = max(2, bar_target_h * progress)
            y = padding_top + chart_h - current_bar_h
            
            gradient = cairo.LinearGradient(current_x, y, current_x, y + current_bar_h)
            gradient.add_color_stop_rgb(0, 0.0, 0.7, 0.7)
            gradient.add_color_stop_rgb(1, 0.0, 0.5, 0.6)
            
            cr.set_source(gradient)
            
            radius = min(4, bar_width / 2)
            self._draw_rounded_top_rect(cr, current_x, y, bar_width, current_bar_h, radius)
            cr.fill()
            
            # Label
            cr.set_source_rgb(0.9, 0.9, 0.9) # Brighter text
            self._draw_text(cr, label, current_x + bar_width/2, height - 26, font="Sans 8", align="center")

            current_x += bar_width + bar_spacing

    def _draw_rounded_top_rect(self, cr, x, y, w, h, r):
        if h < r: r = h
        cr.new_sub_path()
        cr.move_to(x, y + h)
        cr.line_to(x, y + r)
        cr.arc(x + r, y + r, r, math.pi, 3 * math.pi / 2)
        cr.arc(x + w - r, y + r, r, 3 * math.pi / 2, 0)
        cr.line_to(x + w, y + h)
        cr.close_path()

    def _draw_text(self, cr, text, x, y, font="Sans 9", align="left"):
        layout = self.drawing_area.create_pango_layout(str(text))
        layout.set_font_description(Pango.FontDescription(font))
        ink, logical = layout.get_extents()
        w = logical.width / Pango.SCALE
        h = logical.height / Pango.SCALE
        tx, ty = x, y
        if align == "center": tx -= w / 2
        elif align == "right": tx -= w
        ty -= h / 2
        cr.move_to(tx, ty)
        PangoCairo.show_layout(cr, layout)
