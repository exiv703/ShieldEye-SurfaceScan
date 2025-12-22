#!/usr/bin/env python3
"""ShieldEye Professional - Threat Overview Widget"""

import math
import cairo
import gi
gi.require_version('Gtk', '3.0')
from gi.repository import Gtk, Gdk, GLib, Pango, PangoCairo


class ThreatOverviewWidget(Gtk.Box):
    """Widget displaying threat overview chart (Donut)"""
    
    def __init__(self, main_window, height: int = 250):
        super().__init__(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        
        self.main_window = main_window
        self.data = []
        
        self.animation_progress = 0.0
        self.animation_step = 0.05
        self.is_animating = False
        
        self.get_style_context().add_class('threat-overview-widget')
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
        icon_label.set_markup('<span size="large">🛡️</span>')
        title_box.pack_start(icon_label, False, False, 0)
        
        title = Gtk.Label()
        title.set_markup('<span weight="semibold" size="large">Threat Overview</span>')
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
        
    def _hex_to_rgb(self, hex_color):
        hex_color = hex_color.lstrip('#')
        try:
            return tuple(int(hex_color[i:i+2], 16)/255.0 for i in (0, 2, 4))
        except:
            return (0.5, 0.5, 0.5)

    def _on_draw(self, widget, cr):
        width = widget.get_allocated_width()
        height = widget.get_allocated_height()
        
        if not self.data:
            return
            
        items = self.data
        total = sum(d['value'] for d in items)
        if total == 0: return

        # Layout baseline (we reuse the old naming but render a stacked bar instead
        # of a donut). Keep generous vertical padding so summary and legend can
        # breathe around the main bar.
        donut_size = min(width * 0.45, height - 56)
        radius = donut_size / 2

        # Center vertically with a slight upward shift so there is room for
        # the legend below the bar.
        center_y = (height / 2) - 4

        progress = self.animation_progress
        progress = 1 - pow(1 - progress, 3) # Ease out

        # Main stacked bar spanning almost the full card width
        bar_total_width = width - 20
        bar_height = 32
        bar_x = 10
        bar_y = center_y - (bar_height / 2)

        # Summary line above the bar – show top category and total categories
        top_item = max(items, key=lambda d: d.get('value', 0)) if items else None
        top_label = top_item.get('label', '') if top_item else ''
        top_percent = int((top_item.get('value', 0) / total) * 100) if top_item else 0

        clean_item = next((d for d in items if str(d.get('label', '')).lower() == 'clean'), None)
        clean_percent = int((clean_item.get('value', 0) / total) * 100) if clean_item else None

        summary_parts = []
        if top_label:
            summary_parts.append(f"Top: {top_label} {top_percent}%")
        # Avoid repeating the same label twice when the top category is already
        # "Clean" – in that case the first part is enough.
        if clean_percent is not None and top_label.lower() != 'clean':
            summary_parts.append(f"Clean {clean_percent}%")
        summary_parts.append(f"{len(items)} types")
        summary_text = " · ".join(summary_parts)

        if summary_text:
            summary_markup = f"<span fgcolor='#9ca3af'>{summary_text}</span>"
            self._draw_markup(
                cr,
                summary_markup,
                width / 2,
                bar_y - 10,
                font="Sans 9",
                align="center",
            )

        current_x = bar_x
        for item in items:
            val = item.get('value', 0)
            if val == 0:
                continue

            fraction = (val / total) * progress
            seg_width = max(2, bar_total_width * fraction)

            color = self._hex_to_rgb(item.get('color', '#cccccc'))
            cr.set_source_rgb(*color)

            # Draw slice
            cr.rectangle(current_x, bar_y, seg_width, bar_height)
            cr.fill()

            # Separator lines
            if len(items) > 1:
                cr.set_source_rgb(0.11, 0.11, 0.16) # Match bg color roughly
                cr.set_line_width(1.5)
                cr.move_to(current_x + seg_width, bar_y)
                cr.line_to(current_x + seg_width, bar_y + bar_height)
                cr.stroke()

            current_x += seg_width

        # Cut out center (Hole)
        cr.set_source_rgb(0.11, 0.11, 0.16) # Background color
        cr.set_line_width(1.0)
        cr.rectangle(bar_x, bar_y, bar_total_width, bar_height)
        cr.stroke()

        # Draw Legend – compact 2x2 grid under the bar to fill the lower area
        legend_x_left = bar_x + 4
        legend_x_right = width / 2 + 8
        row_height = 20
        legend_y_start = bar_y + bar_height + 12
        
        for i, item in enumerate(items):
            color = self._hex_to_rgb(item.get('color', '#cccccc'))
            label = item.get('label', '')
            val = item.get('value', 0)
            percent = int((val / total) * 100)

            row = i // 2
            col = i % 2
            legend_x = legend_x_left if col == 0 else legend_x_right
            y = legend_y_start + row * row_height

            # Dot
            cr.set_source_rgb(*color)
            cr.arc(legend_x, y + 5, 4, 0, 2 * math.pi)
            cr.fill()

            # Text
            cr.set_source_rgb(0.9, 0.9, 0.9)
            text = f"{label} <span fgcolor='#888888'>({percent}%)</span>"
            self._draw_markup(cr, text, legend_x + 12, y + 5, font="Sans 9", align="left")

    def _draw_markup(self, cr, markup, x, y, font="Sans 9", align="left"):
        layout = self.drawing_area.create_pango_layout("")
        layout.set_markup(markup)
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
