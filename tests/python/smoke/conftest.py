import sys
from pathlib import Path

# The GUI code lives in gtk_gui_pro/src and uses package-relative imports.
GUI_ROOT = Path(__file__).resolve().parents[3] / "gtk_gui_pro"
if str(GUI_ROOT) not in sys.path:
    sys.path.insert(0, str(GUI_ROOT))
